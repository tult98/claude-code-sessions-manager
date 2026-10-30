---
name: verify-hero-code
description: Launch, health-check and drive hero-code (the Claude Code Sessions Manager VS Code extension, a webview sidebar) the way a user does, and capture evidence. Use when verifying a change in hero-code works in the real app, reproducing a bug, or before recording evidence. Read features/ for the recipe per feature.
---

# Verify hero-code

The extension is a **Sessions** sidebar (a webview) inside VS Code. The thing a user touches is that sidebar, plus the terminals it opens. There is no dev server and no port. "Launching the app" means building `dist/` and opening a real VS Code window with this repo loaded as a development extension.

Other surfaces, not driven by this skill's proof run: the command `hero-code.mentionInSession` (`alt+cmd+k` in an editor), notifications (toasts, macOS banners, the activity-bar badge and the status-bar item), and the `heroCode.*` settings.

## Harness, and why

The repo already drives the extension with `playwright-core`'s Electron API in `scripts/demo/launch.mjs` and `scripts/demo/record.mjs` (the README demo recorder). This skill uses the same thing. `scripts/vh.mjs` imports `sidebar` and `Pointer` from `scripts/demo/launch.mjs` and adds a sandbox around them.

Every run is fully isolated. Nothing touches the developer's VS Code, `~/.claude`, or tmux server.

- **Own HOME.** VS Code runs with `HOME=<sandbox>/home`. The extension reads `~/.claude/projects` and `~/.claude/sessions` through `os.homedir()`, so it sees only transcripts the run seeded.
- **Stub `claude`.** `<sandbox>/bin/claude` is a shell script, not the real CLI. It writes `~/.claude/sessions/<pid>.json` the way Claude does, prints `stub-claude session=<id>`, then reads lines from the terminal. Typing `busy`, `idle` or `waiting` changes its registry status. Typing `exit` ends it. No tokens are spent and no login is needed.
- **Own tmux.** `heroCode.tmuxPath` points at `<sandbox>/bin/tmux-sandbox`, which sets `TMUX_TMPDIR=<sandbox>/tmux`. The developer's own `herocode` tmux server is never touched.
- **Own VS Code profile.** `--user-data-dir` and `--extensions-dir` live under the sandbox.
- **Invisible by default.** The developer keeps working, or watching something, while a run goes. `launchVSCode` starts VS Code paused in the debugger (`--inspect-brk`), and patches Electron before any VS Code code runs. The app is never activated, and every window is fully transparent and click-through from before its first frame. A run never takes focus and never draws over the screen.

### Invisible versus visible

macOS never composites a window nobody can see. Playwright's screenshots, video and real mouse clicks (`locator.click()`, `ptr.to()`) wait for a composited frame, so in the invisible window they hang until they time out. The page itself keeps running, with animation frames and timers at full speed. So:

- **Invisible (the default).** Drive through DOM events. Use `locator.dispatchEvent('click')` for clicks, and `locator.fill()`, `locator.press()` and `win.keyboard.type()` for text. Read state with `innerText()`, `inputValue()` and `waitFor()`. Evidence is `checks.json`, not pixels.
- **Visible (`launchVSCode(p, { visible: true })`, implied by `video: true`).** A normal window that takes focus and sits on top of the developer's screen. Screenshots, clips and mouse clicks work. Run this only when the developer has said they're away from the screen, or has explicitly OK'd the window appearing.

To verify against the real `claude` (real turns, real permission prompts), follow `scripts/demo/record.mjs` instead. It needs a logged-in `claude` and spends tokens.

## Paths

- `<run-id>` is `$(date +%Y%m%d-%H%M%S)`.
- `<root>` is `/private/tmp/verify-hero-code/<run-id>`. It must stay short and symlink-free. VS Code's IPC socket path must fit in 103 characters, so `$TMPDIR` (`/var/folders/...`) is too long. Claude files transcripts under the real cwd, so `/tmp` (a symlink) would not match.
- `<root>/sandbox/` is the throwaway HOME, workspace, profile and tmux dir. Cleanup deletes it.
- `<root>/evidence/` is the evidence dir. Cleanup never touches it.

## Launch

1. Build. From the repo root, run `npm run compile`. This writes `dist/extension.js` and the webview bundle. A stale `dist/` means you're verifying old code.
2. Seed and launch, from a scenario script (see Drive). `createSandbox(runId, projects)` writes the sandbox and seeds one finished transcript per session. `launchVSCode(p)` opens VS Code invisibly on the sandbox workspace with `--extensionDevelopmentPath=<repo>`, and records the Electron pid in `<root>/vscode.pid` for Cleanup.
3. Ready means usable. `openSidebar(win)` dispatches a click on the Claude Sessions activity-bar icon (only if the view isn't already open, since a relaunch restores it and a second click closes it) and waits for the `Search sessions...` input inside the webview. It doesn't use `shift+cmd+c`. VS Code also binds that key to "Open New External Terminal", and the built-in wins while the extension is still activating. In a multi-root workspace that pops a "Select workspace folder" picker. Then wait for a seeded row, `rows(sb, '<folder>').first().waitFor()`. A cold start takes about 5 to 10s.

`launchVSCode` passes `--use-mock-keychain`. Without it, macOS shows a "A keychain cannot be found to store 'Code Key'" dialog on every launch, because the sandbox HOME has no login keychain, and startup stalls behind it.

## Doctor

Run this read-only check first, and again whenever something looks off.

```sh
cd "$(git rev-parse --show-toplevel)"
test -f dist/extension.js && [ -z "$(find src -newer dist/extension.js -name '*.ts*' | head -1)" ] && echo "dist fresh" || echo "dist STALE: run npm run compile"
test -x "/Applications/Visual Studio Code.app/Contents/MacOS/Code" && echo "vscode ok" || echo "set VSCODE_BIN"
test -x /opt/homebrew/bin/tmux && echo "tmux ok" || echo "set TMUX_BIN"
command -v ffprobe >/dev/null && echo "ffprobe ok" || echo "brew install ffmpeg (pacing check needs it)"
node -e "require.resolve('playwright-core')" && echo "playwright-core ok" || echo "run npm install"
```

Inside a run, two checks prove the window is this repo's build and not an installed copy:

- `await win.title()` contains `[Extension Development Host]`.
- The sidebar shows exactly the folders the run seeded.

## Auth

None. The stub `claude` needs no login and the extension has no accounts. No credential variables exist for this skill.

## Drive

Scenarios:

- `scenarios/resume-live-status.mjs` is visible and recorded. It's the template for a clip.
- `scenarios/organize-persists.mjs` is invisible. It does pin, rename and delete, then checks the result after a refresh, a new session, and a relaunch on the same profile. It's the template for an invisible scenario.
- `scenarios/idle-stop.mjs` is invisible and takes about 3 minutes. It covers `heroCode.idleSessions.stopAfterMinutes`. Four live sessions are resumed: plain, running a command, waiting, and on screen. With the setting at 0, nothing stops. At 0.05 minutes, only the plain one stops, and a click resumes it. The stopper checks once a minute, so each phase waits a little over a minute.
- `scenarios/state-race.mjs` is invisible. It's the regression for `globalState` writes clobbering each other (`src/state.ts`). It loads the probe extension in `probes/state-race/` next to this one. The probe writes twice at gaps from 0 to 50ms, through the raw memento and through `SerialState`. PASS means the raw memento still loses writes (so the probe still reaches the race) and `SerialState` loses none. Driving the UI can't hit that window reliably, but this can.

Copy the closest scenario as the template for a new one. Keep it under `scenarios/` so its `../scripts/vh.mjs` import resolves. `playwright-core` resolves from the repo's `node_modules`, so run it from anywhere:

```sh
RUN_ID=$(date +%Y%m%d-%H%M%S)
node .claude/skills/verify-hero-code/scenarios/resume-live-status.mjs "$RUN_ID"
```

It exits `0` on PASS. Evidence lands in `/private/tmp/verify-hero-code/$RUN_ID/evidence/`.

What `scripts/vh.mjs` exports:

- `createSandbox(runId, [{ name, sessions: [{ id, prompt, title?, reply?, error? }] }])` returns paths. `id` must be a UUID. `error: true` makes the row render `Error`. A session with no live stub renders `Idle`.
- `launchVSCode(p, { visible, video, settings, keepProfile, extraDevPaths })` returns `{ app, win }`. `settings` sets any `heroCode.*` key. `keepProfile: true` relaunches on the previous launch's profile, so `globalState` written there is read back (proof that it reached disk). `extraDevPaths` loads more development extensions, such as a probe.
- `openSidebar(win)` returns `sb`, a frame locator for the webview's inner document. The webview is nested two iframes deep: `iframe.webview.ready` then `iframe#active-frame`.
- `group(sb, folder)`, `rows(sb, folder)` (each row is an `li`), and `activeTerminal(win)`.
- `recorder(p, app, win, scenario)` returns `{ title, step, type, pause, ptr, finish }`. See Record.
- `stubHook(p, sessionId, { status, command })`, called before launch. It makes that session's stub start in `status` (for example `waiting`). With `command: true`, it also starts a child shaped exactly like Claude's Bash tool, a `/bin/sh -c source ~/.claude/shell-snapshots/...` that keeps running.
- `cleanup(runId)`.

Handles in the webview. These are all `title` attributes in `src/webview/*.tsx`:

- Search input: `input[placeholder="Search sessions..."]`.
- Status filter chips: `[title="Show all statuses"]`, `[title="Show Working"]` / `[title="Hide Working"]` (and the same for Waiting, Ready, Idle, Error).
- Group header: `[title="New session in workspace"]`, and `[title^="Delete "]` for the delete-all button.
- Row actions, shown on hover: `[title="Pin"]` / `[title="Unpin"]`, `[title="Rename"]`, `[title="Delete session"]`, `[title="Drag to reorder"]`.
- Row text lines, in order: title, then the status text (`Working…`, `Waiting for input`, `Ready`, `Error`, `Idle`), then `•`, then relative time, then folder, then activity.
- `heroCode.debugMode: true` removes these `title`s from row elements, which breaks the row-action handles. Leave it off.

Rules a proof run taught:

- Wait for an outcome, never sleep for it. `row.filter({ hasText: 'Working' }).waitFor()` is right. A fixed pause is only for pacing.
- Before branching on an optional element with `isVisible()` (which doesn't wait), first wait for one of the outcomes to appear.
- "Has not happened yet" is one read taken right after the action. A polling wait that outlasts the 5s refresh sees the later state.
- Row actions are hidden until hover. Visible: `ptr.to(row, { click: false })` first, then click the action. Invisible: `dispatchEvent('click')` on the action works without hovering, because it's in the DOM, just hidden by CSS.
- Typing in the terminal requires focusing it first. Visible: `activeTerminal(win).click()`.
- Wait for the rename input (`sb.locator('li input')`) before typing. Keys sent before it mounts go nowhere, and the rename silently doesn't happen. The input selects its text on focus, so don't press `Meta+A` first. The workbench routes that key and it eats the next keystroke.
- Status changes reach the row through a file watcher and a 5s poll. Allow up to 20s.

## Evidence

Save these in `<root>/evidence/`:

- in a visible run, a screenshot before and after every action (`win.screenshot({ path })`),
- `checks.json`, the values the script asserted,
- the clip and `clips.md` (see Record),
- in a visible run, `failure.png` when a script throws.

Proof standards:

- Exercise the real user path. Click the row, the chip, or the button. Never post webview messages directly, and never edit `globalState`.
- Capture the action and the resulting state. Visible runs take a before shot and an after shot. Invisible runs record the value read before and after in `checks.json`.
- Verify side effects as well as what's visible. Examples are the terminal's output (the stub prints the session id it was resumed with), files under `<sandbox>/home/.claude`, and the row after a refresh.
- The stub `claude` stands in for the real CLI. Say so in any proof. Anything that depends on real Claude output is unverified by this harness (transcript formats Claude writes, real permission prompts, `/clear`).

## Record

The recorder is Playwright's native Electron video. `launchVSCode(p, { video: true })` sets `recordVideo` at 1440x900, and it implies `visible: true` (see Invisible versus visible). Each scenario launches its own VS Code, so each scenario yields one clip.

```js
const rec = await recorder(p, app, win, 'my-scenario')
await rec.title('What this scenario proves') // opening label, held PACE.labelHoldMs
await rec.step('Click the idle session', () => rec.ptr.to(row))
await rec.step('Type a search', async () => {
  await rec.ptr.to(search)
  await rec.type('dark')
})
await rec.finish({ proves: 'one line for clips.md', pass })
```

- `step(label, fn)` counts one action. It shows the label at the bottom of the window, pauses `PACE.beforeMs`, runs `fn`, then holds `PACE.afterMs`.
- Labels are built from string literals in the script only. Never pass page text, terminal output or other untrusted strings to a label. The overlay has `pointer-events: none`.
- `rec.ptr.to(locator)` glides a drawn cursor to the target, shows a ripple, and clicks. Pass `{ click: false }` to hover.
- `rec.type(text)` types one character at a time, `PACE.keyDelayMs` apart. Never use `fill`.
- `finish()` holds the final state for `PACE.finalHoldMs`, closes VS Code (a clip is only complete once its page closes), moves the clip to `evidence/video/<scenario>.webm`, writes `<scenario>.actions`, and appends `- video/<scenario>.webm | <proves> | PASS|FAIL` to `clips.md`. Call it after the checks ran, so a failing scenario is never listed as a pass.
- Write the whole scenario as one script, so agent thinking time never lands in the clip. The clip does include VS Code's cold start before the first label.
- Hold on transient states. A toast or the inline rename input needs about 2s on screen to be readable.

Pacing values live in `PACE` at the top of `scripts/vh.mjs`. They're tuned from the proof run: `beforeMs 1000`, `afterMs 1200`, `keyDelayMs 90`, `labelHoldMs 1600`, `finalHoldMs 2200`. Prefer slower. A reviewer can speed a clip up but can't slow it down.

Run the pacing self-check after every recording:

```sh
.claude/skills/verify-hero-code/scripts/pacing-check.sh /private/tmp/verify-hero-code/$RUN_ID/evidence
```

It fails a clip under `MIN_SEC_PER_ACTION` (default 2) seconds per action, or one with a frozen stretch longer than `MAX_FREEZE_SEC` (default 6). Override either as an env var. A failing clip gets re-recorded with slower `PACE` values. A wait for something slow (a terminal attaching) can trip the freeze check. Fix that with a `step` around the wait, not by raising the limit.

## Cleanup

Scenario scripts call `cleanup(runId)` in `finally`. It does the following, in order:

1. Stops the VS Code from `<root>/vscode.pid`, only if that process's command line contains this run's profile path.
2. Kills the sandbox's own tmux server through `tmux-sandbox -L herocode kill-server`. That ends every stub `claude` it hosted.
3. Stops any process whose command line still contains this run's sandbox path. Those can only have been started by this run, such as a stub's fake Bash-tool command, which outlives tmux.
4. Deletes `<root>/sandbox/`.

It never touches `<root>/evidence/`, never `pkill`s by process name (only by this run's unique sandbox path), and never touches another VS Code window or the developer's tmux server.

To clean up a crashed run by hand:

```sh
node -e "import('$(git rev-parse --show-toplevel)/.claude/skills/verify-hero-code/scripts/vh.mjs').then(m => m.cleanup('<run-id>'))"
pgrep -fl "verify-hero-code/<run-id>" || echo clean
```

## Feature recipes

Read `features/README.md` for the index and the per-feature recipes.
