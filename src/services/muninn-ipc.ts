/**
 * Muninn IPC Client for MCP Server
 *
 * Connects to Muninn's Huginn IPC socket as an extension client,
 * translating MCP tool calls into domain:action IPC messages.
 *
 * Modeled after kawa.i18n/src/ipc/muninn-socket.ts but simplified:
 * - No UI bundle or manifest (MCP has no UI)
 * - Request/response correlation via _msgId
 * - 30s timeout per request
 */

import * as net from 'net'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import * as crypto from 'crypto'

const EXTENSION_ID = 'mcp'
const EXTENSION_DOMAINS = ['intent', 'intent-block', 'decision', 'claude-code', 'code', 'inference']
const REQUEST_TIMEOUT_MS = 30_000
const HANDSHAKE_TIMEOUT_MS = 10_000

/**
 * Muninn's Tauri bundle identifier.
 * Used on macOS to locate the App Sandbox container.
 */
const MUNINN_BUNDLE_ID = 'com.codeawareness.muninn'

interface PendingRequest {
  resolve: (data: any) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

let socket: net.Socket | null = null
let connected = false
let cawId = ''
let connectionPromise: Promise<void> | null = null
const pendingRequests = new Map<string, PendingRequest>()

/**
 * Get the default Muninn socket path for the current platform.
 */
function getDefaultMuninnSocketPath(): string {
  if (process.platform === 'win32') {
    return '\\\\.\\pipe\\muninn'
  }
  if (process.platform === 'darwin') {
    // App Store (sandboxed) Muninn: socket may be inside the sandbox container
    const containerSocketPath = path.join(
      os.homedir(),
      'Library', 'Containers', MUNINN_BUNDLE_ID, 'Data',
      'Library', 'Application Support', 'Kawa Code', 'sockets', 'muninn'
    )
    if (fs.existsSync(containerSocketPath)) {
      return containerSocketPath
    }
  }
  // All platforms (incl. macOS dev/brew): ~/.kawa-code/sockets/muninn
  // Matches Muninn's paths.rs: sockets_dir().join("muninn")
  return path.join(os.homedir(), '.kawa-code', 'sockets', 'muninn')
}

/**
 * Connect to Muninn's Huginn IPC socket.
 *
 * Sends extension handshake and waits for acknowledgment.
 * Throws if Muninn is not running or handshake fails.
 */
export function connectToMuninn(socketPath?: string): Promise<void> {
  if (connectionPromise) return connectionPromise
  connectionPromise = _connectToMuninn(socketPath).finally(() => {
    connectionPromise = null
  })
  return connectionPromise
}

function _connectToMuninn(socketPath?: string): Promise<void> {
  const targetPath = socketPath || process.env.MUNINN_SOCKET || getDefaultMuninnSocketPath()

  return new Promise((resolve, reject) => {
    console.error(`[MuninnIPC] Connecting to Muninn catalog at ${targetPath}...`)

    const catalogSock = net.createConnection(targetPath, () => {
      // Send extension handshake
      const handshake = JSON.stringify({
        domain: 'system',
        action: 'handshake',
        data: {
          clientType: 'extension',
          extensionId: EXTENSION_ID,
          domains: EXTENSION_DOMAINS,
        },
      })
      catalogSock.write(handshake + '\n')
    })

    let handshakeReceived = false
    let switchedToClientPipe = false  // Windows: true after catalog→client pipe handoff
    let buffer = ''

    catalogSock.on('data', (data: Buffer) => {
      buffer += data.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.trim()) continue

        try {
          const msg = JSON.parse(line)

          if (!handshakeReceived && msg.domain === 'system' && msg.action === 'handshake') {
            handshakeReceived = true
            cawId = msg.data?.caw || ''

            const pipePath: string | undefined = msg.data?.pipePath

            if (pipePath) {
              // Windows two-pipe protocol: catalog pipe only handles registration.
              // Muninn sends back a dedicated client pipe path; connect to it for I/O.
              switchedToClientPipe = true
              console.error(`[MuninnIPC] Handshake complete (caw=${cawId}), connecting to ${pipePath}`)
              catalogSock.destroy()
              // Small delay so Muninn's thread has time to start the client pipe server
              setTimeout(() => connectClientPipe(pipePath, resolve, reject), 50)
            } else {
              // Unix: single persistent connection, keep using catalogSock
              socket = catalogSock
              connected = true
              console.error(`[MuninnIPC] Handshake complete (caw=${cawId})`)
              resolve()
            }
            continue
          }

          // Unix path: responses arrive on the same socket
          routeResponse(msg)
        } catch {
          // Ignore non-JSON lines
        }
      }
    })

    catalogSock.on('error', (err: Error) => {
      console.error(`[MuninnIPC] Catalog socket error: ${err.message}`)
      if (!handshakeReceived) {
        reject(new Error(
          `Muninn is not running. Please start Muninn first.\n` +
          `(Could not connect to ${targetPath}: ${err.message})`
        ))
      }
      if (!switchedToClientPipe) cleanup()
    })

    catalogSock.on('close', () => {
      // On Windows the catalog pipe closes after handshake — expected, skip cleanup.
      // On Unix the catalog socket IS the main socket, so closing means disconnected.
      if (!switchedToClientPipe) {
        console.error('[MuninnIPC] Socket closed')
        cleanup()
      }
    })

    // Handshake timeout
    setTimeout(() => {
      if (!handshakeReceived) {
        catalogSock.destroy()
        reject(new Error('Muninn handshake timeout (10s). Is Muninn running?'))
      }
    }, HANDSHAKE_TIMEOUT_MS)
  })
}

/**
 * Connect to the dedicated client pipe returned in the Windows handshake.
 * On Windows, Muninn creates a per-client named pipe (\\.\pipe\caw.<id>)
 * for bidirectional communication after the catalog registration.
 */
function connectClientPipe(
  pipePath: string,
  resolve: () => void,
  reject: (err: Error) => void
): void {
  console.error(`[MuninnIPC] Connecting to client pipe: ${pipePath}`)

  const clientSock = net.createConnection(pipePath, () => {
    socket = clientSock
    connected = true
    console.error('[MuninnIPC] Client pipe connected')
    resolve()
  })

  let buffer = ''

  clientSock.on('data', (data: Buffer) => {
    buffer += data.toString()
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) {
      if (!line.trim()) continue
      try { routeResponse(JSON.parse(line)) } catch { /* ignore */ }
    }
  })

  clientSock.on('error', (err: Error) => {
    console.error(`[MuninnIPC] Client pipe error: ${err.message}`)
    if (!connected) {
      reject(new Error(`Failed to connect to Muninn client pipe: ${err.message}`))
    }
    cleanup()
  })

  clientSock.on('close', () => {
    console.error('[MuninnIPC] Client pipe closed')
    cleanup()
  })
}

/** Route an inbound response message to its waiting pendingRequest entry. */
function routeResponse(msg: any): void {
  const msgId = msg._msgId
  if (msgId && pendingRequests.has(msgId)) {
    const pending = pendingRequests.get(msgId)!
    pendingRequests.delete(msgId)
    clearTimeout(pending.timer)
    if (msg.err) {
      pending.reject(new Error(msg.err))
    } else {
      pending.resolve(msg.data || {})
    }
  }
}

/**
 * Send an IPC request to Muninn and await the correlated response.
 *
 * @param domain - Handler domain (e.g., 'intent', 'decision')
 * @param action - Handler action (e.g., 'create', 'get-active')
 * @param data   - Request payload
 * @returns The response data from Muninn
 */
export async function request(domain: string, action: string, data: any = {}): Promise<any> {
  if (!socket || !connected) {
    await connectToMuninn()
  }

  const msgId = `mcp-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingRequests.delete(msgId)
      reject(new Error(`Muninn request timeout (${REQUEST_TIMEOUT_MS / 1000}s): ${domain}:${action}`))
    }, REQUEST_TIMEOUT_MS)

    pendingRequests.set(msgId, { resolve, reject, timer })

    const message = JSON.stringify({
      flow: 'req',
      domain,
      action,
      caw: cawId,
      data,
      _msgId: msgId,
    })

    socket!.write(message + '\n')
  })
}

/**
 * Ensure a repository path is registered with Muninn as a project.
 *
 * Sends `code:add` with the folder path so Muninn activates the project,
 * sets up git state, and pulls intents/decisions/lessons from the API.
 * Always sends the request — Muninn's AddHandler is idempotent and
 * returns the existing project if already added.
 * Errors are logged but not thrown — repo registration is best-effort.
 */
export async function ensureRepo(repoPath: string): Promise<void> {
  try {
    await request('code', 'add', { folder: repoPath })
  } catch (err) {
    console.error(`[MuninnIPC] ensureRepo failed for ${repoPath}: ${(err as Error).message}`)
  }
}

/**
 * Check if connected to Muninn.
 */
export function isConnected(): boolean {
  return connected
}

/**
 * Disconnect from Muninn.
 */
export function disconnect(): void {
  if (socket) {
    socket.destroy()
  }
  cleanup()
}

function cleanup(): void {
  connected = false
  socket = null
  connectionPromise = null

  // Reject all pending requests
  for (const [id, pending] of pendingRequests) {
    clearTimeout(pending.timer)
    pending.reject(new Error('Muninn connection closed'))
  }
  pendingRequests.clear()
}
