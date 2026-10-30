# Resume and live status

Each row shows a session's live status. A session with no running `claude` is `Idle`. Clicking an idle row opens a terminal running `claude --resume <id>`. From then on the row follows the process: `Ready` at an empty prompt, `Working…` mid-turn, `Waiting for input` on a permission prompt or question, and back to `Idle` when the process exits.

## Sub-features

- `status-idle`: a seeded session with no process renders `Idle` with an outline dot.
- `status-error`: a transcript whose last assistant turn is an API error renders `Error`.
- `resume-click`: clicking an idle row opens a terminal that resumes that exact session id.
- `status-ready`: a live process at the prompt renders `Ready`.
- `status-working`: registry status `busy` renders `Working…` with a spinner.
- `status-waiting`: registry status `waiting` renders `Waiting for input`.
- `status-exit`: the process exiting returns the row to `Idle`.

## How to get to it (user POV)

- Open the Sessions sidebar from the Claude Sessions activity-bar icon (or `shift+cmd+c`), then click a row.
- The status changes on its own as Claude works. There's no user action besides using the terminal.

## Driving it with playwright-core

Preconditions:

- Baseline seed. Add `error: true` to a session to cover `status-error`.
- The ready-made scenario is `../scenarios/resume-live-status.mjs`.

- **Run it.** Run `node .claude/skills/verify-hero-code/scenarios/resume-live-status.mjs "$RUN_ID"`. It exits `0` and prints `PASS` followed by the asserted statuses.
- **Idle.** Read the row with `(await rows(sb, 'todo-api').first().innerText()).split('\n')[1]`. It returns `Idle`. Screenshot `01-idle.png`.
- **Resume.** Click the row with `rec.ptr.to(row)`. `activeTerminal(win).filter({ hasText: 'stub-claude session=11111111-1111-4111-8111-111111111111' })` appears. This proves the terminal resumed the clicked id. The row then reads `Ready`. Screenshot `02-ready.png`.
- **Working.** Click the terminal and type `busy` then Enter. The row reads `Working…` within 20s. Screenshot `03-working.png`.
- **Waiting.** Type `waiting` then Enter. The row reads `Waiting for input`. Screenshot `04-waiting.png`.
- **Exit.** Type `exit` then Enter. The row reads `Idle` again. Screenshot `05-idle-again.png`.
- **Proof.** `checks.json` holds `Idle, Ready, Working…, Waiting for input, Idle`. `video/resume-live-status.webm` is listed in `clips.md` as PASS.

## Gotchas

- The status text is `Working…` with a Unicode ellipsis, not three dots. Match on `Working`.
- After `exit`, the terminal stays open on a plain zsh, because tmux runs `claude ...; exec zsh -l`. The row still goes `Idle`. That's correct.
- The panel can show an extra plain `zsh` terminal next to the session's terminal. It's VS Code's default terminal and doesn't affect the run.
- A transcript with only a user turn and no title doesn't render at all while no process is live. Seed a `title` or an assistant reply.
- The stub can't produce real permission prompts or `/clear`. `status-waiting` here proves the registry path only, not the transcript `pendingTool` path.
