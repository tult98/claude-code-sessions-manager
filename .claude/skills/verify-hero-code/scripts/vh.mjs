// Sandbox + driver for verifying the Claude Code Sessions Manager extension in a
// real VS Code window. Each run gets its own HOME (so ~/.claude is seeded, never
// the developer's), its own VS Code profile, its own tmux socket dir, and a stub
// `claude` that costs no tokens. Import it from a scenario script by absolute path.
import { _electron as electron } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:net'
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { Pointer, sidebar } from '../../../../scripts/demo/launch.mjs'

export { sidebar, Pointer }
export const REPO = path.resolve(import.meta.dirname, '../../../..')
export const CODE = process.env.VSCODE_BIN ?? '/Applications/Visual Studio Code.app/Contents/MacOS/Code'
export const TMUX = process.env.TMUX_BIN ?? '/opt/homebrew/bin/tmux'

/** Tunable pacing for recorded clips. A reviewer can speed a clip up, never slow it down. */
export const PACE = {
  beforeMs: 1000,
  afterMs: 1200,
  keyDelayMs: 90,
  labelHoldMs: 1600,
  finalHoldMs: 2200,
}

const encode = (p) => p.replace(/[^a-zA-Z0-9]/g, '-')

/**
 * Paths for one run. The root must stay short and symlink-free: VS Code's IPC
 * socket path must fit in 103 chars, and Claude files transcripts under the real
 * cwd, which the sidebar matches against.
 */
export function runPaths(runId) {
  const root = `/private/tmp/verify-hero-code/${runId}`
  const sandbox = path.join(root, 'sandbox')
  return {
    root,
    sandbox,
    evidence: path.join(root, 'evidence'),
    home: path.join(sandbox, 'home'),
    ws: path.join(sandbox, 'ws'),
    bin: path.join(sandbox, 'bin'),
    tmuxDir: path.join(sandbox, 'tmux'),
    profile: path.join(sandbox, 'profile'),
    extensions: path.join(sandbox, 'extensions'),
  }
}

// The stub stands in for `claude`: it registers itself in ~/.claude/sessions the
// way the real CLI does, then reads commands from the terminal so a scenario can
// flip its live status. Its command line contains "claude", which is what the
// extension's pid check requires.
const STUB = `#!/bin/sh
id=""
while [ $# -gt 0 ]; do
  case "$1" in --resume|--session-id) id="$2"; shift ;; esac
  shift
done
reg="$HOME/.claude/sessions/$$.json"
mkdir -p "$HOME/.claude/sessions"
write() { printf '{"pid":%s,"sessionId":"%s","status":"%s","updatedAt":%s000}' $$ "$id" "$1" "$(date +%s)" > "$reg"; }
trap 'rm -f "$reg"; exit 0' EXIT INT TERM HUP
# Test hooks, set per session id by a scenario: start in another status, or with a
# child shaped exactly like Claude's Bash tool (a shell sourcing its snapshot).
hooks="$HOME/.stub-hooks"
write "$(cat "$hooks/status-$id" 2>/dev/null || echo idle)"
if [ -f "$hooks/command-$id" ]; then
  mkdir -p "$HOME/.claude/shell-snapshots"
  # \`source\` of a missing file is fatal in a POSIX sh, and real snapshots always exist.
  : > "$HOME/.claude/shell-snapshots/snapshot-sh-stub.sh"
  /bin/sh -c "source $HOME/.claude/shell-snapshots/snapshot-sh-stub.sh 2>/dev/null; while :; do sleep 1; done" &
fi
echo "stub-claude session=$id"
echo "type: busy | idle | waiting | exit"
while IFS= read -r line; do
  case "$line" in
    busy|idle|waiting) write "$line"; echo "status=$line" ;;
    exit) exit 0 ;;
  esac
done
`

/** Make the stub for `sessionId` start in `status`, or with a running Bash-tool-shaped command. */
export function stubHook(p, sessionId, { status, command } = {}) {
  const dir = path.join(p.home, '.stub-hooks')
  mkdirSync(dir, { recursive: true })
  if (status) {
    writeFileSync(path.join(dir, `status-${sessionId}`), status)
  }
  if (command) {
    writeFileSync(path.join(dir, `command-${sessionId}`), '')
  }
}

/**
 * Seed a sandbox. `projects` is `[{ name, sessions: [{ id, prompt, reply?, title?, error? }] }]`.
 * Sessions are written as finished transcripts, so they render as `Idle` until a
 * stub process for them is running.
 */
export function createSandbox(runId, projects) {
  const p = runPaths(runId)
  for (const d of [p.home, p.ws, p.bin, p.tmuxDir, p.evidence, path.join(p.evidence, 'video')]) {
    mkdirSync(d, { recursive: true })
  }
  writeFileSync(path.join(p.bin, 'claude'), STUB, { mode: 0o755 })
  writeFileSync(
    path.join(p.bin, 'tmux-sandbox'),
    `#!/bin/sh\nexport TMUX_TMPDIR=${p.tmuxDir} HOME=${p.home} SHELL=/bin/zsh\nunset ZDOTDIR\nexec ${TMUX} "$@"\n`,
    { mode: 0o755 },
  )
  const rc = `export PATH="${p.bin}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"\nPROMPT='%1~ %# '\n`
  writeFileSync(path.join(p.home, '.zshrc'), rc)
  writeFileSync(path.join(p.home, '.zprofile'), rc)

  const t0 = Date.now() - 60 * 60_000
  for (const proj of projects) {
    const dir = path.join(p.ws, proj.name)
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, 'README.md'), `# ${proj.name}\n`)
    const tdir = path.join(p.home, '.claude', 'projects', encode(dir))
    mkdirSync(tdir, { recursive: true })
    proj.sessions.forEach((s, i) => {
      const ts = new Date(t0 + i * 60_000).toISOString()
      const lines = [
        { type: 'user', sessionId: s.id, cwd: dir, timestamp: ts, message: { role: 'user', content: s.prompt } },
        {
          type: 'assistant',
          sessionId: s.id,
          cwd: dir,
          timestamp: ts,
          ...(s.error ? { isApiErrorMessage: true } : {}),
          message: { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: s.reply ?? 'Done.' }] },
        },
        ...(s.title ? [{ type: 'ai-title', sessionId: s.id, aiTitle: s.title }] : []),
      ]
      writeFileSync(path.join(tdir, `${s.id}.jsonl`), lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
    })
  }
  writeFileSync(
    path.join(p.ws, 'verify.code-workspace'),
    JSON.stringify({ folders: projects.map((x) => ({ path: x.name })) }),
  )
  return p
}

// Runs inside VS Code's main process before any of VS Code's own code, so the
// test window never disturbs the developer: the app is never activated, and every
// window is fully transparent and click-through from before its first frame
// (\`_init\` runs before Electron shows a window created with \`show: true\`).
//
// Trade-off: macOS never composites a window nobody can see, and Playwright's
// screenshots, video and real mouse clicks wait for a composited frame. The page
// itself keeps running, so DOM-level driving works. Pass \`visible: true\` to
// \`launchVSCode\` when recording, and only while the developer is away.
const BACKGROUND_PATCH = `(() => {
  const { app, BrowserWindow } = process.getBuiltinModule('node:module').createRequire('/electron-main.js')('electron')
  app.setActivationPolicy('prohibited')
  app.focus = () => {}
  const hide = (w) => { w.setOpacity(0); w.setIgnoreMouseEvents(true) }
  const init = BrowserWindow.prototype._init
  if (typeof init !== 'function') return 'no _init'
  BrowserWindow.prototype._init = function (...args) { init.apply(this, args); hide(this) }
  BrowserWindow.prototype.show = function () { hide(this); this.showInactive() }
  BrowserWindow.prototype.focus = function () {}
  BrowserWindow.prototype.setOpacity = ((set) => function () { set.call(this, 0) })(BrowserWindow.prototype.setOpacity)
  return 'patched'
})()`

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer().listen(0, '127.0.0.1', () => {
      const { port } = srv.address()
      srv.close(() => resolve(port))
    })
    srv.on('error', reject)
  })
}

/** Patch a VS Code started with `--inspect-brk=<port>`, then let it run. Always resumes it. */
async function releaseInBackground(port) {
  const deadline = Date.now() + 30_000
  let target
  while (!target) {
    try {
      ;[target] = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
    } catch {
      // inspector not listening yet
    }
    if (!target) {
      if (Date.now() > deadline) {
        throw new Error('VS Code inspector never came up')
      }
      await new Promise((r) => setTimeout(r, 100))
    }
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = reject
  })
  let next = 0
  const waiting = new Map()
  let onPaused
  const paused = new Promise((r) => (onPaused = r))
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data)
    if (d.method === 'Debugger.paused') {
      onPaused(d.params)
    }
    waiting.get(d.id)?.(d)
  }
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++next
      waiting.set(id, resolve)
      ws.send(JSON.stringify({ id, method, params }))
    })
  // While "waiting for the debugger" Node isn't bootstrapped yet, so let it run
  // to the break on the main script's first line and patch from there.
  await send('Debugger.enable')
  await send('Runtime.runIfWaitingForDebugger')
  const { callFrames } = await paused
  try {
    const r = await send('Debugger.evaluateOnCallFrame', {
      callFrameId: callFrames[0].callFrameId,
      expression: BACKGROUND_PATCH,
      returnByValue: true,
    })
    if (r.result?.result?.value !== 'patched') {
      console.warn('verify-hero-code: background patch failed, VS Code may take focus:', JSON.stringify(r.result?.exceptionDetails ?? r.error))
    }
  } finally {
    await send('Debugger.resume')
    await send('Debugger.disable')
    ws.close()
  }
}

/**
 * Launch VS Code on the sandbox workspace with this repo's `dist/` as a development extension.
 * Invisible by default (see BACKGROUND_PATCH). `visible: true` shows a normal window that takes
 * focus; recording and screenshots need it. `keepProfile: true` relaunches on the previous
 * launch's profile, so `globalState` written there is read back. `extraDevPaths` loads more
 * development extensions alongside this one, such as a throwaway probe.
 */
export async function launchVSCode(p, { video = false, visible = video, settings = {}, size = { width: 1440, height: 900 }, keepProfile = false, extraDevPaths = [] } = {}) {
  if (!keepProfile) {
    rmSync(p.profile, { recursive: true, force: true })
  }
  mkdirSync(path.join(p.profile, 'User'), { recursive: true })
  mkdirSync(p.extensions, { recursive: true })
  writeFileSync(
    path.join(p.profile, 'User', 'settings.json'),
    JSON.stringify({
      'workbench.colorTheme': 'Default Dark Modern',
      'workbench.startupEditor': 'none',
      'workbench.tips.enabled': false,
      'workbench.panel.defaultLocation': 'right',
      'workbench.secondarySideBar.defaultVisibility': 'hidden',
      'chat.disableAIFeatures': true,
      'window.commandCenter': false,
      'update.mode': 'none',
      'telemetry.telemetryLevel': 'off',
      'extensions.ignoreRecommendations': true,
      'security.workspace.trust.enabled': false,
      'terminal.integrated.gpuAcceleration': 'off',
      'git.enabled': false,
      // Delete confirmations are modal; native macOS dialogs can't be clicked from Playwright.
      'window.dialogStyle': 'custom',
      'heroCode.tmuxPath': path.join(p.bin, 'tmux-sandbox'),
      'heroCode.notifications.style': 'toast',
      ...settings,
    }),
  )
  const env = { ...process.env, HOME: p.home, SHELL: '/bin/zsh' }
  delete env.ZDOTDIR
  delete env.TMUX
  const inspectPort = visible ? undefined : await freePort()
  const launching = electron.launch({
    executablePath: CODE,
    env,
    args: [
      // Paused until releaseInBackground has patched window activation.
      ...(visible ? [] : [`--inspect-brk=${inspectPort}`]),
      // Keep the page's timers and animation frames running in a window that is never active.
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      '--disable-background-timer-throttling',
      `--extensionDevelopmentPath=${REPO}`,
      ...extraDevPaths.map((d) => `--extensionDevelopmentPath=${d}`),
      `--user-data-dir=${p.profile}`,
      `--extensions-dir=${p.extensions}`,
      '--disable-workspace-trust',
      '--skip-welcome',
      '--skip-release-notes',
      '--disable-telemetry',
      // HOME points at the sandbox, so macOS has no login keychain to hand out
      // the "Code Key" and would block startup on a "keychain cannot be found"
      // dialog. Chromium's mock keychain keeps that key in memory instead.
      '--use-mock-keychain',
      '--new-window',
      path.join(p.ws, 'verify.code-workspace'),
    ],
    ...(video ? { recordVideo: { dir: path.join(p.evidence, 'video', '.raw'), size } } : {}),
  })
  try {
    if (!visible) {
      await releaseInBackground(inspectPort)
    }
  } catch (e) {
    await launching.then((a) => a.close()).catch(() => {})
    throw e
  }
  const app = await launching
  writeFileSync(path.join(p.root, 'vscode.pid'), String(app.process().pid))
  try {
    const win = await app.firstWindow()
    await app.evaluate(({ BrowserWindow }, s) => {
      const w = BrowserWindow.getAllWindows()[0]
      w.setContentSize(s.width, s.height)
      w.center()
    }, size)
    await win.waitForSelector('.monaco-workbench', { timeout: 60_000 })
    return { app, win }
  } catch (e) {
    await app.close().catch(() => {})
    throw e
  }
}

/** Open the Sessions sidebar and wait for the webview to render this extension's UI. */
export async function openSidebar(win) {
  const sb = sidebar(win)
  // Not shift+cmd+c: VS Code binds it to "Open New External Terminal" too, and
  // that wins while the extension is still activating.
  const search = sb.locator('input[placeholder="Search sessions..."]')
  const icon = win.locator('.activitybar .action-item a[aria-label^="Claude Sessions"]')
  await icon.waitFor({ timeout: 60_000 })
  // A relaunch restores the view already open, and clicking an active icon closes it.
  try {
    await search.waitFor({ timeout: 5_000 })
  } catch {
    // A DOM click, not a mouse click: it works in the invisible window too.
    await icon.dispatchEvent('click')
  }
  await search.waitFor({ timeout: 60_000 })
  return sb
}

export const group = (sb, name) => sb.locator('details', { has: sb.locator(`summary:has-text("${name}")`) }).first()
export const rows = (sb, name) => group(sb, name).locator('li')
export const activeTerminal = (win) => win.locator('.terminal-wrapper.active .xterm').first()

// Labels are built from literals only: never pass page text or other untrusted
// strings. The workbench enforces Trusted Types, so DOM calls, no innerHTML.
async function showLabel(win, text) {
  await win.evaluate((t) => {
    let el = document.getElementById('verify-label')
    if (!el) {
      el = document.createElement('div')
      el.id = 'verify-label'
      Object.assign(el.style, {
        position: 'fixed', left: '50%', bottom: '28px', transform: 'translateX(-50%)', zIndex: 2147483647,
        pointerEvents: 'none', background: 'rgba(217,119,87,.95)', color: '#fff', font: '600 16px -apple-system, sans-serif',
        padding: '8px 16px', borderRadius: '8px', boxShadow: '0 4px 14px rgba(0,0,0,.4)',
      })
      document.body.appendChild(el)
    }
    el.textContent = t
  }, text)
}

/**
 * Paced recorder for one scenario. `step(label, fn)` shows the label, waits so the
 * viewer sees the starting state, acts, then holds on the result. `finish()` closes
 * the app (a clip only completes once its page closes), names the clip after the
 * scenario, writes the action count beside it, and appends to clips.md.
 */
export async function recorder(p, app, win, scenario) {
  const ptr = new Pointer(win)
  await ptr.install()
  let actions = 0
  const pause = (ms) => win.waitForTimeout(ms)
  return {
    ptr,
    pause,
    async title(text) {
      await showLabel(win, text)
      await pause(PACE.labelHoldMs)
    },
    async step(label, fn) {
      actions++
      await showLabel(win, label)
      await pause(PACE.beforeMs)
      await fn()
      await pause(PACE.afterMs)
    },
    type: (text) => win.keyboard.type(text, { delay: PACE.keyDelayMs }),
    async finish({ proves, pass }) {
      await pause(PACE.finalHoldMs)
      const video = win.video()
      await app.close()
      const out = path.join(p.evidence, 'video', `${scenario}.webm`)
      if (video) {
        renameSync(await video.path(), out)
        rmSync(path.join(p.evidence, 'video', '.raw'), { recursive: true, force: true })
      }
      writeFileSync(path.join(p.evidence, 'video', `${scenario}.actions`), String(actions))
      appendFileSync(path.join(p.evidence, 'clips.md'), `- video/${scenario}.webm | ${proves} | ${pass ? 'PASS' : 'FAIL'}\n`)
      return out
    },
  }
}

/** Stop everything a run started inside the sandbox. Never touches the evidence dir. */
export function cleanup(runId) {
  const p = runPaths(runId)
  const pidFile = path.join(p.root, 'vscode.pid')
  if (existsSync(pidFile)) {
    const pid = readFileSync(pidFile, 'utf8').trim()
    let cmd = ''
    try {
      cmd = execFileSync('ps', ['-o', 'command=', '-p', pid], { encoding: 'utf8' })
    } catch {
      // already exited
    }
    // Only the VS Code this run launched: its command line names this run's profile.
    if (cmd.includes(p.profile)) {
      process.kill(Number(pid), 'SIGTERM')
    }
    rmSync(pidFile, { force: true })
  }
  if (existsSync(p.tmuxDir)) {
    try {
      execFileSync(path.join(p.bin, 'tmux-sandbox'), ['-L', 'herocode', 'kill-server'], { stdio: 'ignore' })
    } catch {
      // no sandbox tmux server was running
    }
  }
  // Anything still carrying this run's sandbox path in its command line was
  // started by this run (a stub's fake Bash-tool command outlives tmux).
  try {
    execFileSync('pkill', ['-f', p.sandbox], { stdio: 'ignore' })
  } catch {
    // nothing left
  }
  rmSync(p.sandbox, { recursive: true, force: true })
}
