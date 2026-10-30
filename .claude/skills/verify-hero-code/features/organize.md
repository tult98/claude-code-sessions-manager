# Organize sessions

A user can pin a session to a `Pinned` group at the top, give it a custom name, or delete it from the sidebar. Delete asks for confirmation, stops the process if one is running, and hides the row. The transcript stays on disk. All three persist in the extension's `globalState`.

## Sub-features

- `pin`: `Pin` moves the row into a `Pinned` group at the top, and `Unpin` moves it back.
- `rename`: `Rename` turns the title into an input. Enter saves and Escape cancels.
- `delete`: `Delete session` opens a confirmation with `Cancel` and `Delete Session`. Confirming removes the row.
- `delete-persists`: a deleted row stays hidden after a refresh and after other sidebar activity.

## How to get to it (user POV)

- Hover a row to reveal its actions, then click the pin, pencil or trash icon.

## Driving it with playwright-core

Preconditions:

- The same seed as filter-search.md (three rows, one of them `Error`).
- Sidebar open via `openSidebar(win)`.

- **Pin.** Hover the `landing-page` row with `rec.ptr.to(row, { click: false, dx: 120 })`, then click `row.locator('[title="Pin"]')`. `sb.locator('summary:has-text("Pinned")')` appears, and `rows(sb, 'Pinned')` holds `Orange button`.
- **Rename.** Hover the pinned row and click `[title="Rename"]`. `sb.locator('li input')` appears with the old name selected. Press `Meta+A`, type `Landing polish`, and press Enter. `rows(sb, 'Pinned').filter({ hasText: 'Landing polish' })` appears.
- **Delete.** Hover `Fix flaky test` and click `[title="Delete session"]`. `win.locator('.monaco-dialog-box')` shows `Cancel` and `Delete Session`. Click `dlg.locator('.monaco-button', { hasText: 'Delete Session' })`. The row detaches.
- **Persists.** Click `[title="Refresh"]`, wait 7s, then click a folder's `[title="New session in workspace"]`. `Fix flaky test` must still be absent.
- **Proof.** Screenshots after each action, plus the dialog. `checks.json` holds the row list after Refresh and after the new session.

## Gotchas

- The delete dialog is modal. `launchVSCode` sets `window.dialogStyle: custom` so it renders in the DOM. With native dialogs, Playwright can't click it.
- `heroCode.debugMode: true` removes the `title` attributes these handles rely on.
- Pin, rename or delete could be lost when another `globalState` write landed 1 to 8ms after it. That was VS Code's write echo overwriting the newer value. It was fixed on 2026-10-30 by `src/state.ts`, which runs every write one at a time. A UI run rarely hits that window, so a PASS here doesn't prove the fix. `scenarios/state-race.mjs` does.
- Invisible runs (`scenarios/organize-persists.mjs`) click with `dispatchEvent('click')`, so they don't need the hover step.
- Checked in an unrecorded run. No clip has been recorded for this feature yet.
