#!/usr/bin/env node
/**
 * kawacode-on-stop — Claude Code Stop hook dispatcher.
 *
 * Reads the Stop hook payload from stdin (session_id, transcript_path, cwd)
 * and sends two short IPCs to Muninn:
 *
 *   1. capture-thoughts:capture { sessionId, transcriptPath, cwd }
 *        → Muninn reads the transcript, filters thinking blocks, appends
 *          JSONL to ~/.kawa-code/thoughts/active/session-{id}.jsonl
 *   2. extractor:trigger { session_id, cwd }
 *        → Muninn wakes the (debounced) extractor service which reads the
 *          fresh JSONL and emits ephemeral decisions.
 *
 * Replaces the legacy kawacode-capture-thoughts (Node CLI that did the file
 * I/O itself, never merged to main) AND kawacode-extract-trigger (separate
 * Node CLI that did the second IPC). The whole capture pipeline now lives
 * in Muninn — this dispatcher's only job is to fire the two pings.
 *
 * Failure discipline: every error path exits 0. Claude Code's Stop hook
 * must never block the turn loop on capture failure. This is the ONLY
 * place fail-soft is allowed under the no-Muninn-independence rule —
 * because the hook script is the boundary between the harness (which
 * can't recover) and Muninn (which can re-derive missing captures from
 * the transcript on the next Stop).
 *
 * Opt out with KAWA_THOUGHT_CAPTURE=off.
 */

import { readFileSync } from 'node:fs'

import { connectToMuninn, request, disconnect } from './services/muninn-ipc.js'

interface HookPayload {
  session_id?: string
  transcript_path?: string
  cwd?: string
  hook_event_name?: string
}

function readStdin(): string {
  try {
    return readFileSync(0, 'utf8')
  } catch {
    return ''
  }
}

async function main(): Promise<void> {
  if (process.env.KAWA_THOUGHT_CAPTURE === 'off') {
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
  const transcriptPath = payload.transcript_path
  const cwd = payload.cwd
  if (!sessionId || !transcriptPath) process.exit(0)

  try {
    await connectToMuninn()
  } catch {
    // Muninn down. Capture happens whenever Muninn is next up — the
    // extractor's checkpoint advances on the next successful capture.
    process.exit(0)
  }

  // Fire both IPCs in parallel; each is independent and tolerant of the
  // other's failure. allSettled because we never want one to short-circuit
  // the other on transient failure.
  await Promise.allSettled([
    request('capture-thoughts', 'capture', {
      sessionId,
      transcriptPath,
      cwd: cwd ?? null,
    }),
    request('extractor', 'trigger', {
      session_id: sessionId,
      cwd: cwd ?? '',
    }),
  ])

  disconnect()
  process.exit(0)
}

main().catch(() => process.exit(0))
