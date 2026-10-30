# New session

The `+` on a folder group starts a fresh `claude --session-id <new uuid>` in that folder's terminal. A `New session` row appears in the group right away, before Claude writes any transcript. It takes its real title once the first prompt lands.

## Sub-features

- `new-plus`: `+` on a group starts a session in that folder.
- `new-placeholder`: a `New session` row shows immediately and is selected.
- `new-live`: the placeholder becomes `Ready` once the process registers.

## How to get to it (user POV)

- Hover a folder group's header and click `+` (`New session in workspace`).

## Driving it with playwright-core

Preconditions:

- Baseline seed. Sidebar open via `openSidebar(win)`.

- **Start.** Click `group(sb, 'todo-api').locator('[title="New session in workspace"]')`. `activeTerminal(win).filter({ hasText: 'stub-claude session=' })` appears. The id it prints is the new session's.
- **Placeholder.** `rows(sb, 'todo-api').filter({ hasText: 'New session' })` appears within 20s and reads `Ready`.
- **Proof.** Screenshot after the click and after the row appears. Record the printed id in `checks.json`.

## Gotchas

- The stub writes no transcript, so `New session` never gets a real title, and the row disappears once the stub exits. A title change needs real `claude` (see `scripts/demo/record.mjs`).
- With two folders open, the `+` in the first header is `.first()`. Scope it with `group(sb, '<folder>')`.
- Checked in an unrecorded run. No clip has been recorded for this feature yet.
