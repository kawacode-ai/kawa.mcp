#!/usr/bin/env node
/**
 * kawacode-extract-trigger — Claude Code Stop hook for thought-chain extraction.
 *
 * Reads the Stop hook payload from stdin (session_id, cwd, transcript_path),
 * sends `req:extractor:trigger { session_id, cwd }` to Muninn over the Huginn
 * IPC socket, and exits.
 *
 * The capture itself is handled by `kawacode-capture-thoughts` — that one runs
 * regardless of Muninn. This CLI is a no-op when Muninn is down: extraction
 * picks up next time Muninn is running, from current end-of-log (per
 * PRD_ORCHESTRATION_PANEL §9.1.4).
 *
 * Behavior is best-effort: every failure path exits 0 so Claude Code's turn
 * processing is never blocked by a hook.
 *
 * Opt out with KAWA_EXTRACT_TRIGGER=off.
 */

import { readFileSync } from 'node:fs'
import * as net from 'node:net'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import * as crypto from 'node:crypto'

const HANDSHAKE_TIMEOUT_MS = 3_000
const REQUEST_TIMEOUT_MS = 5_000
const EXTENSION_ID = 'mcp-extract-trigger'
const MUNINN_BUNDLE_ID = 'com.codeawareness.muninn'

interface HookPayload {
  session_id?: string
  cwd?: string
  transcript_path?: string
}

function readStdin(): string {
  try {
    return readFileSync(0, 'utf8')
  } catch {
    return ''
  }
}

function getDefaultMuninnSocketPath(): string {
  if (process.platform === 'win32') {
    return '\\\\.\\pipe\\muninn'
  }
  if (process.platform === 'darwin') {
    const containerSocketPath = path.join(
      os.homedir(),
      'Library', 'Containers', MUNINN_BUNDLE_ID, 'Data',
      'Library', 'Application Support', 'Kawa Code', 'sockets', 'muninn',
    )
    if (fs.existsSync(containerSocketPath)) {
      return containerSocketPath
    }
  }
  return path.join(os.homedir(), '.kawa-code', 'sockets', 'muninn')
}

/** Open the catalog connection, complete the handshake, then send the trigger. */
function sendTrigger(sessionId: string, cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const socketPath = process.env.MUNINN_SOCKET || getDefaultMuninnSocketPath()
    const sock = net.createConnection(socketPath)

    let handshakeReceived = false
    let cawId = ''
    let buffer = ''
    const overall = setTimeout(() => {
      sock.destroy()
      reject(new Error('overall timeout'))
    }, REQUEST_TIMEOUT_MS)

    const handshakeTimer = setTimeout(() => {
      if (!handshakeReceived) {
        sock.destroy()
        clearTimeout(overall)
        reject(new Error('handshake timeout'))
      }
    }, HANDSHAKE_TIMEOUT_MS)

    sock.on('connect', () => {
      const handshake = JSON.stringify({
        domain: 'system',
        action: 'handshake',
        data: {
          clientType: 'extension',
          extensionId: EXTENSION_ID,
          domains: [],
        },
      })
      sock.write(handshake + '\n')
    })

    sock.on('data', (chunk: Buffer) => {
      buffer += chunk.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        if (!line.trim()) continue
        let msg: any
        try {
          msg = JSON.parse(line)
        } catch {
          continue
        }
        if (!handshakeReceived && msg.domain === 'system' && msg.action === 'handshake') {
          handshakeReceived = true
          clearTimeout(handshakeTimer)
          cawId = msg.data?.caw || ''

          // Windows two-pipe protocol — switch to dedicated client pipe.
          const pipePath: string | undefined = msg.data?.pipePath
          if (pipePath) {
            sock.destroy()
            connectAndSendOnPipe(pipePath, cawId, sessionId, cwd, overall)
              .then(resolve, reject)
            return
          }

          // Unix: send trigger on the same socket
          const msgId = `extract-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`
          const message = JSON.stringify({
            flow: 'req',
            domain: 'extractor',
            action: 'trigger',
            caw: cawId,
            data: { session_id: sessionId, cwd },
            _msgId: msgId,
          })
          sock.write(message + '\n')
          continue
        }
        // Any response after handshake — treat as ack and exit
        if (handshakeReceived) {
          clearTimeout(overall)
          sock.destroy()
          resolve()
          return
        }
      }
    })

    sock.on('error', (err: Error) => {
      clearTimeout(overall)
      clearTimeout(handshakeTimer)
      reject(err)
    })

    sock.on('close', () => {
      clearTimeout(overall)
      clearTimeout(handshakeTimer)
      // If we never got an ack, treat close as resolution — the trigger may
      // have been received and queued before the close. Either way, the hook
      // is fire-and-forget; we don't block Claude Code on the response.
      if (handshakeReceived) {
        resolve()
      } else {
        reject(new Error('socket closed before handshake'))
      }
    })
  })
}

function connectAndSendOnPipe(
  pipePath: string,
  cawId: string,
  sessionId: string,
  cwd: string,
  overall: NodeJS.Timeout,
): Promise<void> {
  return new Promise((resolve, reject) => {
    // Brief delay so Muninn's per-client pipe server has time to start.
    setTimeout(() => {
      const sock = net.createConnection(pipePath)
      sock.on('connect', () => {
        const msgId = `extract-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`
        const message = JSON.stringify({
          flow: 'req',
          domain: 'extractor',
          action: 'trigger',
          caw: cawId,
          data: { session_id: sessionId, cwd },
          _msgId: msgId,
        })
        sock.write(message + '\n')
      })
      sock.on('data', () => {
        clearTimeout(overall)
        sock.destroy()
        resolve()
      })
      sock.on('error', (err: Error) => {
        clearTimeout(overall)
        reject(err)
      })
      sock.on('close', () => {
        clearTimeout(overall)
        resolve()
      })
    }, 50)
  })
}

async function main(): Promise<void> {
  if (process.env.KAWA_EXTRACT_TRIGGER === 'off') {
    process.exit(0)
  }

  const raw = readStdin()
  if (!raw) process.exit(0)

  let payload: HookPayload
  try {
    payload = JSON.parse(raw)
  } catch {
    process.exit(0)
  }

  const sessionId = payload.session_id
  const cwd = payload.cwd
  if (!sessionId || !cwd) process.exit(0)

  try {
    await sendTrigger(sessionId, cwd)
  } catch {
    // Silent — capture log already persisted by kawacode-capture-thoughts.
    // Extraction will pick up on the next trigger when Muninn is reachable.
  }
  process.exit(0)
}

main().catch(() => process.exit(0))
