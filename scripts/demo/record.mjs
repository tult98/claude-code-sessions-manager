// Records the README demo: real `claude` sessions driven through the extension
// in an isolated VS Code window, captured frame-by-frame and encoded with ffmpeg.
//
//   node scripts/demo/record.mjs            # → media/demo/*.gif + demo.mp4
//
// Needs macOS, VS Code, tmux, ffmpeg and a logged-in `claude`. Uses real (small)
// Claude turns. Everything it creates lives under DEMO_ROOT and is removed on
// the next run; the only thing it leaves outside is the demo projects'
// transcripts in ~/.claude/projects, which `--cleanup` deletes.
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, rmSync, writeFileSync, readdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { launch, sidebar, focusWindow, Pointer, startCapture, REPO } from './launch.mjs'

// A short, symlink-free path: VS Code's IPC socket must fit in 103 chars, and
// Claude files transcripts under the *real* cwd, which the sidebar must match.
const DEMO_ROOT = '/private/tmp/ccsm'
const PROJECTS = ['todo-api', 'landing-page']
const OUT = path.join(REPO, 'media', 'demo')
const TMUX = process.env.TMUX_BIN ?? '/opt/homebrew/bin/tmux'
const CODE_CLI = process.env.CODE_CLI ?? '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code'
const CLAUDE = process.env.CLAUDE_BIN ?? path.join(os.homedir(), '.local/bin/claude')

const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'pipe', encoding: 'utf8', ...opts })
const projectDirs = () =>
  PROJECTS.map((p) => path.join(os.homedir(), '.claude/projects', path.join(DEMO_ROOT, 'demo', p).replace(/[^a-zA-Z0-9]/g, '-')))

function cleanup() {
  try {
    sh(TMUX, ['-L', 'herocode', 'kill-server'], { env: { ...process.env, TMUX_TMPDIR: path.join(DEMO_ROOT, 'tmux') } })
  } catch {
    // no server running
  }
  // Killed `claude` processes append an exit record to their transcript; let
  // them finish so it doesn't resurrect a file we are about to delete.
  sh('sleep', ['3'])
  for (const d of projectDirs()) {
    rmSync(d, { recursive: true, force: true })
  }
}

function prepare() {
  cleanup()
  rmSync(DEMO_ROOT, { recursive: true, force: true })
  const demo = path.join(DEMO_ROOT, 'demo')
  for (const p of PROJECTS) {
    const dir = path.join(demo, p)
    cpSync(path.join(import.meta.dirname, 'fixture', p), dir, { recursive: true })
    sh('git', ['init', '-q', '-b', 'main'], { cwd: dir })
    sh('git', ['add', '-A'], { cwd: dir })
    sh('git', ['-c', 'user.name=demo', '-c', 'user.email=demo@example.com', 'commit', '-qm', 'init'], { cwd: dir })
  }
  writeFileSync(path.join(demo, 'demo.code-workspace'), JSON.stringify({ folders: PROJECTS.map((p) => ({ path: p })) }))

  // A private tmux server (TMUX_TMPDIR) so demo sessions never mix with the
  // user's own `herocode` server, and a bare zsh so their rc files stay out of shot.
  const bin = path.join(DEMO_ROOT, 'bin')
  const zdot = path.join(DEMO_ROOT, 'zdot')
  mkdirSync(bin, { recursive: true })
  mkdirSync(zdot, { recursive: true })
  mkdirSync(path.join(DEMO_ROOT, 'tmux'), { recursive: true })
  const tmuxWrapper = path.join(bin, 'tmux-demo')
  writeFileSync(
    tmuxWrapper,
    `#!/bin/sh\nexport TMUX_TMPDIR=${DEMO_ROOT}/tmux ZDOTDIR=${zdot} SHELL=/bin/zsh\nexec ${TMUX} "$@"\n`,
    { mode: 0o755 },
  )
  // Skip the user's personal settings (plugins, hooks, status line, default
  // permission mode) so the recording shows stock Claude Code.
  writeFileSync(
    path.join(bin, 'claude'),
    `#!/bin/sh\nexec ${CLAUDE} --setting-sources project,local --model sonnet --permission-mode default "$@"\n`,
    { mode: 0o755 },
  )
  const rc = `export PATH="${bin}:${path.dirname(CLAUDE)}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"\nPROMPT='%1~ %# '\n`
  writeFileSync(path.join(zdot, '.zshrc'), rc)
  writeFileSync(path.join(zdot, '.zprofile'), rc)
  return { workspace: path.join(demo, 'demo.code-workspace'), tmuxWrapper }
}

// --- driving -----------------------------------------------------------------

async function main() {
  if (process.argv.includes('--cleanup')) {
    cleanup()
    rmSync(DEMO_ROOT, { recursive: true, force: true })
    return
  }
  const { workspace, tmuxWrapper } = prepare()
  // Install the packaged extension so the window isn't an "Extension
  // Development Host".
  const vsc = path.join(DEMO_ROOT, 'vsc')
  const vsix = path.join(DEMO_ROOT, 'demo.vsix')
  sh('npx', ['vsce', 'package', '-o', vsix], { cwd: REPO })
  sh(CODE_CLI, ['--user-data-dir', path.join(vsc, 'cli'), '--extensions-dir', path.join(vsc, 'extensions'), '--install-extension', vsix, '--force'])
  const { app, win } = await launch({
    workdir: vsc,
    workspace,
    devPath: null,
    settings: { 'heroCode.tmuxPath': tmuxWrapper },
  })
  const sb = sidebar(win)
  const ptr = new Pointer(win)
  const pause = (ms) => win.waitForTimeout(ms)
  const group = (name) => sb.locator('details', { has: sb.locator(`summary:has-text("${name}")`) }).first()
  const rows = (name) => group(name).locator('li')
  const terminal = () => win.locator('.terminal-wrapper.active .xterm').first()
  const waitRow = (loc, text, timeout = 180_000) => loc.filter({ hasText: text }).first().waitFor({ timeout })
  const typeSlow = (text) => win.keyboard.type(text, { delay: 28 })

  // Claude asks whether to trust a folder it hasn't seen; answer "Yes" if asked.
  async function trustIfAsked() {
    await pause(3500)
    const text = await terminal().innerText().catch(() => '')
    if (/trust this folder/i.test(text)) {
      await win.keyboard.press('ArrowDown')
      await win.keyboard.press('Enter')
      await pause(3500)
    }
  }
  async function prompt(text, { slow = false } = {}) {
    await terminal().click()
    if (slow) {
      await typeSlow(text)
    } else {
      await win.keyboard.type(text)
    }
    await pause(300)
    await win.keyboard.press('Enter')
  }

  await pause(4000)
  await win.keyboard.press('Meta+Shift+C')
  await sb.locator('[title="New session in workspace"]').first().waitFor()

  // --- seed (off camera): one finished session per folder --------------------
  await sb.locator('[title="New session in workspace"]').first().click()
  await pause(2500)
  // Widen the sidebar so titles fit, and the right-hand panel to a bit over half the window.
  const sashes = []
  for (const s of await win.locator('.monaco-sash.vertical').all()) {
    const b = await s.boundingBox()
    if (b && b.height > 300 && b.x > 100 && b.x < 1420) {
      sashes.push(b.x + 2)
    }
  }
  sashes.sort((a, b) => a - b)
  const drag = async (from, to) => {
    await win.mouse.move(from, 450)
    await win.mouse.down()
    await win.mouse.move(to, 450, { steps: 15 })
    await win.mouse.up()
    await pause(300)
  }
  await drag(sashes.at(-1), 700)
  await drag(sashes[0], 400)
  await trustIfAsked()
  await prompt('Add a DELETE /todos/:id endpoint to src/server.js, same style as PATCH')
  await waitRow(rows('todo-api'), 'Waiting for input')
  await terminal().click()
  await win.keyboard.press('Enter')
  await waitRow(rows('todo-api'), 'Ready')

  await group('landing-page').locator('[title="New session in workspace"]').click()
  await trustIfAsked()
  await prompt('Make the "Get started" button orange with rounded corners in styles.css')
  await waitRow(rows('landing-page'), 'Waiting for input')
  await terminal().click()
  await win.keyboard.press('Enter')
  await waitRow(rows('landing-page'), 'Ready')
  await pause(1500)
  await rows('todo-api').first().click()
  await pause(2500)

  // --- record ----------------------------------------------------------------
  await focusWindow(app)
  await ptr.install()
  const cap = await startCapture(win, path.join(DEMO_ROOT, 'frames'))
  const marks = {}
  const mark = (name) => (marks[name] = cap.now())
  await pause(1500)

  // 1. Overview → new session → it starts working.
  mark('overview')
  await pause(2000)
  await ptr.to(group('todo-api').locator('[title="New session in workspace"]'))
  await trustIfAsked()
  await prompt('Make POST /todos return 400 when title is missing', { slow: true })
  await waitRow(rows('todo-api'), 'Working', 60_000)
  await pause(1500)

  // 2. Switch sessions instantly in one terminal; start work in the other folder.
  mark('switch')
  await ptr.to(rows('landing-page').first())
  await pause(1800)
  await ptr.to(rows('todo-api').nth(1))
  await pause(1800)
  await ptr.to(rows('landing-page').first())
  await pause(1200)
  await prompt('Add a dark mode section to styles.css', { slow: true })
  await waitRow(rows('landing-page'), 'Working', 60_000)
  await pause(1500)
  mark('switchEnd')

  // 3. A session parks on a permission prompt → toast + badge → Open → approve.
  mark('notify')
  const toast = win.locator('.notification-toast').filter({ hasText: 'Needs your input' }).first()
  await toast.waitFor({ timeout: 240_000 })
  await pause(2500)
  await ptr.to(toast.locator('.monaco-button', { hasText: 'Open' }))
  await pause(2200)
  await terminal().click()
  await win.keyboard.press('Enter')
  await pause(2500)
  // Approve whatever else is still waiting so the rest of the take is calm.
  for (let i = 0; i < 4; i++) {
    const waiting = sb.locator('li', { hasText: 'Waiting for input' }).first()
    if (!(await waiting.isVisible().catch(() => false))) {
      try {
        await waiting.waitFor({ timeout: 12_000 })
      } catch {
        break
      }
    }
    await ptr.to(waiting)
    await pause(1500)
    await terminal().click()
    await win.keyboard.press('Enter')
    await pause(2500)
  }
  mark('notifyEnd')

  // 4. Filter by status and search.
  await win.locator('.notification-toast .codicon-notifications-clear').first().click({ timeout: 1500 }).catch(() => {})
  mark('filter')
  await ptr.to(sb.locator('[title^="Show Working"], [title^="Hide Working"]').first())
  await pause(1500)
  await ptr.to(sb.locator('[title^="Show Ready"], [title^="Hide Ready"]').first())
  await pause(1800)
  await ptr.to(sb.locator('[title="Show all statuses"]'))
  await pause(1000)
  await ptr.to(sb.locator('input[placeholder="Search sessions..."]'))
  await typeSlow('dark')
  await pause(2000)
  await win.keyboard.press('Meta+A')
  await win.keyboard.press('Backspace')
  await pause(1200)
  mark('filterEnd')

  // 5. Pin and rename.
  mark('organize')
  const target = rows('landing-page').first()
  await ptr.to(target, { click: false, dx: 120 })
  await pause(600)
  await ptr.to(target.locator('[title="Pin"]'))
  await pause(1800)
  const pinned = rows('Pinned').first()
  await ptr.to(pinned, { click: false, dx: 120 })
  await pause(500)
  await ptr.to(pinned.locator('[title="Rename"]'))
  await pause(400)
  await win.keyboard.press('Meta+A')
  await typeSlow('Landing page polish')
  await win.keyboard.press('Enter')
  await pause(2200)
  mark('organizeEnd')

  // 6. Send an editor selection to the selected session.
  mark('mention')
  await ptr.to(rows('todo-api').first())
  await pause(1200)
  await win.keyboard.press('Meta+P')
  await pause(500)
  await typeSlow('server.js')
  await pause(600)
  await win.keyboard.press('Enter')
  await pause(1500)
  await win.keyboard.press('Control+G')
  await win.keyboard.type('12')
  await win.keyboard.press('Enter')
  await pause(300)
  for (let i = 0; i < 5; i++) {
    await win.keyboard.press('Shift+ArrowDown')
    await pause(80)
  }
  await pause(1000)
  await win.keyboard.press('Alt+Meta+K')
  await pause(1500)
  await typeSlow('validate that title is a non-empty string')
  await pause(2500)
  mark('mentionEnd')

  const frames = await cap.stop()
  await app.close()
  encode(frames, marks)
  console.log('done →', OUT)
}

// --- encoding ----------------------------------------------------------------

function encode(frames, marks) {
  mkdirSync(OUT, { recursive: true })
  const dir = path.join(DEMO_ROOT, 'enc')
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const end = frames.at(-1).t + 1
  // Screencast frames arrive only on change: hold each until the next.
  const concat = (from, to, file) => {
    const sel = frames.filter((f, i) => f.t < to && (frames[i + 1]?.t ?? end) > from)
    const lines = ['ffconcat version 1.0']
    sel.forEach((f, i) => {
      const a = Math.max(f.t, from)
      const b = Math.min(sel[i + 1]?.t ?? end, to)
      lines.push(`file '${f.file}'`, `duration ${Math.max(b - a, 0.001).toFixed(3)}`)
    })
    lines.push(`file '${sel.at(-1).file}'`)
    writeFileSync(file, lines.join('\n'))
  }
  const mp4 = (from, to, name) => {
    const list = path.join(dir, `${name}.txt`)
    concat(from, to, list)
    const out = path.join(dir, `${name}.mp4`)
    sh('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-vf', 'fps=30,format=yuv420p', '-c:v', 'libx264', '-crf', '18', '-preset', 'slow', out])
    return out
  }
  const gif = (src, name, width = 1200, fps = 12) => {
    const pal = path.join(dir, `${name}-pal.png`)
    const filters = `fps=${fps},scale=${width}:-1:flags=lanczos`
    sh('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-vf', `${filters},palettegen=stats_mode=diff`, pal])
    sh('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-i', pal, '-lavfi', `${filters} [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`, path.join(OUT, `${name}.gif`)])
  }

  // The full take ships as an MP4; the README's hero GIF is the first half
  // (new session → switching → notification), which is what sells it.
  const full = mp4(marks.overview, marks.mentionEnd, 'demo')
  cpSync(full, path.join(OUT, 'demo.mp4'))
  gif(mp4(marks.overview, marks.notifyEnd, 'hero'), 'demo', 1100, 10)
  const clips = [
    ['switch', 'switch', 'switchEnd'],
    ['notify', 'notify', 'notifyEnd'],
    ['filter', 'filter', 'filterEnd'],
    ['organize', 'organize', 'organizeEnd'],
    ['mention', 'mention', 'mentionEnd'],
  ]
  for (const [name, a, b] of clips) {
    gif(mp4(marks[a], marks[b], name), name)
  }
  writeFileSync(path.join(DEMO_ROOT, 'marks.json'), JSON.stringify(marks, null, 2))
  console.log(readdirSync(OUT).join('\n'))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
