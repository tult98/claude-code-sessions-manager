// Launches the installed VS Code against this extension in a throwaway profile,
// plus the helpers the demo recorder drives it with. Nothing here touches the
// user's own VS Code profile, extensions or tmux server.
import { _electron as electron } from 'playwright-core'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import path from 'node:path'

export const REPO = path.resolve(import.meta.dirname, '../..')
const CODE = process.env.VSCODE_BIN ?? '/Applications/Visual Studio Code.app/Contents/MacOS/Code'

export async function launch({ workdir, workspace, settings = {}, size = { width: 1440, height: 900 }, devPath = REPO }) {
  const userData = path.join(workdir, 'profile')
  const extensions = path.join(workdir, 'extensions')
  rmSync(userData, { recursive: true, force: true })
  mkdirSync(path.join(userData, 'User'), { recursive: true })
  mkdirSync(extensions, { recursive: true })
  writeFileSync(
    path.join(userData, 'User', 'settings.json'),
    JSON.stringify(
      {
        'workbench.colorTheme': 'Default Dark Modern',
        'workbench.startupEditor': 'none',
        'workbench.tips.enabled': false,
        'workbench.enableExperiments': false,
        'workbench.panel.defaultLocation': 'right',
        'workbench.secondarySideBar.defaultVisibility': 'hidden',
        'workbench.secondarySideBar.showLabels': false,
        'chat.commandCenter.enabled': false,
        'chat.disableAIFeatures': true,
        'window.commandCenter': false,
        'editor.minimap.enabled': false,
        'editor.fontSize': 13,
        'update.mode': 'none',
        'telemetry.telemetryLevel': 'off',
        'extensions.ignoreRecommendations': true,
        'security.workspace.trust.enabled': false,
        'terminal.integrated.fontSize': 13,
        'terminal.integrated.tabs.enabled': false,
        'terminal.integrated.gpuAcceleration': 'off',
        'git.enabled': false,
        'heroCode.notifications.style': 'toast',
        'heroCode.notifications.whenFocused': 'always',
        'heroCode.notifications.onTurnFinished': false,
        ...settings,
      },
      null,
      2,
    ),
  )
  const args = [
    `--user-data-dir=${userData}`,
    `--extensions-dir=${extensions}`,
    '--disable-workspace-trust',
    '--skip-welcome',
    '--skip-release-notes',
    '--disable-telemetry',
    '--new-window',
    workspace,
  ]
  if (devPath) {
    args.unshift(`--extensionDevelopmentPath=${devPath}`)
  }
  const app = await electron.launch({ executablePath: CODE, args })
  const win = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }, s) => {
    const w = BrowserWindow.getAllWindows()[0]
    w.setContentSize(s.width, s.height)
    w.center()
  }, size)
  return { app, win }
}

/** The sessions webview's inner document (webviews nest two iframes deep). */
export function sidebar(win) {
  return win.frameLocator('iframe.webview.ready').frameLocator('iframe#active-frame')
}

/** Bring the window to the front: VS Code only pops toasts in a focused window. */
export async function focusWindow(app) {
  await app.evaluate(({ app: a, BrowserWindow }) => {
    a.focus({ steal: true })
    BrowserWindow.getAllWindows()[0].focus()
  })
}

// --- a visible cursor ------------------------------------------------------
// Screen captures of the page don't include the OS pointer, so we draw one in
// the workbench document and move it alongside the real (synthetic) mouse.

const CURSOR_JS = `(() => {
  if (document.getElementById('demo-cursor')) return
  const c = document.createElement('div')
  c.id = 'demo-cursor'
  // Built with DOM calls: the workbench enforces Trusted Types, so no innerHTML.
  const NS = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(NS, 'svg')
  svg.setAttribute('width', '22'); svg.setAttribute('height', '22'); svg.setAttribute('viewBox', '0 0 22 22')
  const p = document.createElementNS(NS, 'path')
  p.setAttribute('d', 'M3 2 L3 18 L7.5 13.8 L10.6 20.5 L13.4 19.2 L10.4 12.7 L16.5 12.7 Z')
  p.setAttribute('fill', 'white'); p.setAttribute('stroke', 'black'); p.setAttribute('stroke-width', '1.3'); p.setAttribute('stroke-linejoin', 'round')
  svg.appendChild(p)
  c.appendChild(svg)
  Object.assign(c.style, { position: 'fixed', left: '0', top: '0', width: '22px', height: '22px', zIndex: 2147483647, pointerEvents: 'none', transform: 'translate(720px, 450px)', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,.5))' })
  document.body.appendChild(c)
  const r = document.createElement('div')
  r.id = 'demo-ripple'
  Object.assign(r.style, { position: 'fixed', left: '0', top: '0', width: '28px', height: '28px', marginLeft: '-14px', marginTop: '-14px', borderRadius: '50%', border: '2px solid #d97757', zIndex: 2147483646, pointerEvents: 'none', opacity: '0' })
  document.body.appendChild(r)
})()`

export class Pointer {
  constructor(win) {
    this.win = win
    this.x = 720
    this.y = 450
  }

  async install() {
    await this.win.evaluate(CURSOR_JS)
  }

  async moveTo(x, y, ms = 500) {
    const steps = Math.max(8, Math.round(ms / 16))
    const sx = this.x
    const sy = this.y
    for (let i = 1; i <= steps; i++) {
      const t = i / steps
      const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2
      const px = sx + (x - sx) * e
      const py = sy + (y - sy) * e
      await this.win.mouse.move(px, py)
      await this.win.evaluate(
        ([a, b]) => {
          const c = document.getElementById('demo-cursor')
          if (c) c.style.transform = `translate(${a}px, ${b}px)`
        },
        [px, py],
      )
      await this.win.waitForTimeout(12)
    }
    this.x = x
    this.y = y
  }

  async ripple() {
    await this.win.evaluate(([a, b]) => {
      const r = document.getElementById('demo-ripple')
      if (!r) return
      r.style.transition = 'none'
      r.style.transform = `translate(${a}px, ${b}px) scale(0.4)`
      r.style.opacity = '1'
      requestAnimationFrame(() => {
        r.style.transition = 'transform 350ms ease-out, opacity 450ms ease-out'
        r.style.transform = `translate(${a}px, ${b}px) scale(1.4)`
        r.style.opacity = '0'
      })
    }, [this.x, this.y])
  }

  /** Move onto a locator's center (or an offset into it) and optionally click. */
  async to(locator, { click = true, dx, dy, ms } = {}) {
    await locator.waitFor({ state: 'visible', timeout: 120_000 })
    const b = await locator.boundingBox()
    const x = b.x + (dx ?? b.width / 2)
    const y = b.y + (dy ?? b.height / 2)
    await this.moveTo(x, y, ms)
    if (click) {
      await this.ripple()
      await this.win.mouse.click(x, y)
    }
  }
}

// --- capture ---------------------------------------------------------------
// CDP screencast: full-resolution frames, timestamped, only when the page
// changes. `stop()` returns the frame list for encoding.

export async function startCapture(win, dir) {
  mkdirSync(dir, { recursive: true })
  const cdp = await win.context().newCDPSession(win)
  const frames = []
  cdp.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
    const file = path.join(dir, `f${String(frames.length).padStart(6, '0')}.jpg`)
    writeFileSync(file, Buffer.from(data, 'base64'))
    frames.push({ file, t: metadata.timestamp })
    await cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {})
  })
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, everyNthFrame: 1 })
  return {
    frames,
    now: () => Date.now() / 1000,
    async stop() {
      await cdp.send('Page.stopScreencast').catch(() => {})
      return frames
    },
  }
}
