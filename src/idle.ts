import * as vscode from 'vscode'
import { execFileSync } from 'child_process'
import type { SessionMonitor } from './monitor.js'
import { hasSessionTerminal, isSessionOnScreen, killSessionProcess } from './terminal.js'

const CHECK_MS = 60_000

/**
 * Claude runs every Bash command — foreground or `run_in_background` — as a
 * direct child shell that first sources its snapshot from this directory. MCP
 * servers are spawned directly, so this tells "running a command" (a dev
 * server, a watcher, a long build) apart from "just holding its MCP servers".
 */
const BASH_TOOL_RE = /\/\.claude\/shell-snapshots\//

/** `heroCode.idleSessions.stopAfterMinutes` (default 120); 0 turns the feature off. */
export function idleStopMinutes(): number {
  const minutes = vscode.workspace.getConfiguration('heroCode.idleSessions').get<number>('stopAfterMinutes', 120)
  return minutes > 0 ? minutes : 0
}

/**
 * Stops the `claude` process behind a session that has sat at an empty prompt
 * for `stopAfterMinutes`, freeing the memory it and its MCP servers hold. The
 * transcript is untouched: the row turns Idle and a click resumes it.
 *
 * Deliberately narrow about what it touches. Only `ready` rows — `waiting` is a
 * turn parked on the user, and stopping it would lose the pending call. Only
 * sessions this extension hosts, never one in a terminal the user opened
 * themselves. Never the session on screen, and never one with a command still
 * running under it.
 */
export class IdleSessionStopper implements vscode.Disposable {
  private readonly timer: ReturnType<typeof setInterval>

  constructor(private readonly monitor: SessionMonitor) {
    this.timer = setInterval(() => this.check(), CHECK_MS)
  }

  check(): void {
    const minutes = idleStopMinutes()
    if (!minutes) {
      return
    }
    const cutoff = Date.now() - minutes * 60_000
    const snap = this.monitor.snapshot
    const candidates = new Map<string, number>()
    for (const s of snap.groups.flatMap((g) => g.sessions)) {
      if (
        s.status === 'ready' &&
        s.running &&
        s.pid !== undefined &&
        // A latched 'working' cleared by the staleness guard may still be busy.
        !snap.staleDowngraded.has(s.id) &&
        // The transcript moves on every message; the registry stamp on every
        // busy/idle flip. Quiet on both is what "no interaction" means here.
        Math.max(s.mtime, s.liveUpdatedAt ?? 0) < cutoff &&
        hasSessionTerminal(s.id) &&
        !isSessionOnScreen(s.id)
      ) {
        candidates.set(s.id, s.pid)
      }
    }
    if (candidates.size === 0) {
      return
    }
    const runningCommands = pidsRunningCommands()
    if (!runningCommands) {
      return
    }
    let stopped = false
    for (const [id, pid] of candidates) {
      if (!runningCommands.has(pid)) {
        killSessionProcess(id)
        stopped = true
      }
    }
    if (stopped) {
      this.monitor.refresh()
    }
  }

  dispose(): void {
    clearInterval(this.timer)
  }
}

/** Pids with a Bash command running under them, or undefined when `ps` can't say — then stop nothing. */
function pidsRunningCommands(): Set<number> | undefined {
  let out: string
  try {
    out = execFileSync('ps', ['-axww', '-o', 'ppid=,command='], { encoding: 'utf8' })
  } catch {
    return undefined
  }
  const pids = new Set<number>()
  for (const line of out.split('\n')) {
    const m = /^\s*(\d+)\s+(.*)$/.exec(line)
    if (m && BASH_TOOL_RE.test(m[2])) {
      pids.add(Number(m[1]))
    }
  }
  return pids
}
