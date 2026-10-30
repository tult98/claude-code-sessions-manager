# Filter and search

Status chips under the search box show a count per status and toggle which statuses are listed. The search box narrows rows to those matching the typed text. Clearing either one restores the full list.

## Sub-features

- `filter-counts`: each chip shows the number of rows in that status, and `All` shows the total.
- `filter-only`: turning on one status chip lists only rows in that status.
- `filter-all`: `Show all statuses` restores every row.
- `search-match`: typing narrows rows to matches.
- `search-clear`: emptying the box restores every row.

## How to get to it (user POV)

- Click a status chip (`Working`, `Waiting`, `Ready`, `Idle`, `Error`) or `All` under the search box.
- Click the `Search sessions...` box and type.

## Driving it with playwright-core

Preconditions:

- Baseline seed, plus a second `todo-api` session `{ id: '33333333-3333-4333-8333-333333333333', prompt: 'Fix flaky test', title: 'Fix flaky test', error: true }`.
- Sidebar open via `openSidebar(win)`.

- **Counts.** Read `await sb.locator('[title="Show all statuses"]').innerText()`. It contains `3`. The `Idle` chip contains `2` and the `Error` chip contains `1`.
- **Only errors.** Click with `rec.ptr.to(sb.locator('[title="Show Error"]'))`. `sb.locator('li')` texts are exactly `Fix flaky test`. The chip's title becomes `Hide Error`.
- **All.** Click `[title="Show all statuses"]`. All three rows are back.
- **Search.** Click `input[placeholder="Search sessions..."]` and type `orange` with `rec.type('orange')`. The only row is `Orange button`.
- **Clear.** Press `Meta+A` then `Backspace` in the box. All three rows are back.
- **Proof.** Screenshots before, during and after each filter, plus `checks.json` with the row titles after each step.

## Gotchas

- Use `rec.type`, not `fill`. Filtering runs on input events, and the clip must show the typing.
- A chip whose count is `0` has `aria-disabled` and does nothing.
- Groups whose rows all filter out disappear, header included. Assert on rows, not on group headers.
- Checked in an unrecorded run on 2026-10-30. No clip has been recorded for this feature yet.
