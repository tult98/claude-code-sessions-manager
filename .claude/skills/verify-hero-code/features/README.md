# hero-code verification map

This directory is the maintained source for verifying what a user sees in the Sessions sidebar. Read the index, then use the matching feature file as the recipe. `../SKILL.md` covers launching, the sandbox, recording and cleanup.

## Baseline preconditions

- Run `npm run compile` from the repo root, then run the Doctor block in `../SKILL.md`. It must report `dist fresh`.
- Every scenario seeds its own sandbox with `createSandbox(runId, projects)` and launches with `launchVSCode(p)`. Never drive a VS Code window this run didn't launch.
- The baseline seed is folder `todo-api` with `Add DELETE endpoint` (id `11111111-1111-4111-8111-111111111111`), and folder `landing-page` with `Orange button` (id `22222222-2222-4222-8222-222222222222`). Recipes that need more seed say so.
- `claude` in the sandbox is the stub from `../scripts/vh.mjs`. It prints `stub-claude session=<id>` and takes `busy`, `idle`, `waiting` or `exit` on its own line.

## Driving conventions

- Run invisibly unless you need pixels. `../SKILL.md` explains *Invisible versus visible*. Never run a visible scenario while the developer is at the screen without their OK.
- Write the scenario as one script under `../scenarios/`, copied from the closest existing one, and run it with `node .claude/skills/verify-hero-code/scenarios/<name>.mjs "$RUN_ID"`.
- Locate by `title` attributes, the search placeholder, and row text. Rows are `li` elements inside a folder's `details` group, reached with `rows(sb, '<folder>')`.
- In a visible run, hover a row before clicking one of its actions. The actions are invisible until hover. In an invisible run, `dispatchEvent('click')` reaches them without a hover.
- Wait for an outcome with `locator.filter({ hasText }).waitFor()`. Never sleep for one.
- Start every recipe from a fresh sandbox. Metadata (pin, rename, delete) lives in the sandbox profile's `globalState` and is discarded by Cleanup.

## Proof and skip reporting

- Write the asserted values to `checks.json`. In a visible run, also take a screenshot before and after each action.
- Mutation proof includes a second read. Click `[title="Refresh"]` and read the row again.
- Record each scenario with the Record recipe in `../SKILL.md`, and run `pacing-check.sh`.
- Say in the proof that `claude` was the stub. Behavior that depends on real Claude output stays unverified.
- Report an unreachable path with the attempted step and the unmet precondition. Don't report an entry point as verified through a different one.

## Feature entry contract

Each feature file starts with an H1 and one paragraph of user-visible behavior. It then has exactly four H2 sections in this order.

1. `Sub-features` gives short IDs, one line each.
2. `How to get to it (user POV)` lists every user entry point.
3. `Driving it with playwright-core` starts with `Preconditions:`, then gives bullets that pair a user action with exact code and an observable result.
4. `Gotchas` lists traps that waste or invalidate a run.

## Features

- [Resume and live status](./resume-live-status.md) covers clicking an idle row to resume it, and the row following Ready, Working, Waiting and Idle. Proved end to end with a recorded clip.
- [Filter and search](./filter-search.md) covers status chips and the search box. Handles checked in an unrecorded run.
- [Organize sessions](./organize.md) covers pin, rename and delete. Proved invisibly by `scenarios/organize-persists.mjs`, including a relaunch, and by `scenarios/state-race.mjs` for the write race.
- [New session](./new-session.md) covers the `+` on a folder group. Handles checked in an unrecorded run.

Not yet mapped:
- Send selection to session (`hero-code.mentionInSession`, `alt+cmd+k`).
- Notifications. That includes the toast with its Open button, macOS banners, the activity-bar badge, and the status-bar item.
- Drag to reorder (`[title="Drag to reorder"]`).
- Delete all sessions in a folder (`[title^="Delete "]` on a group header).
- `/clear` handling, where the live id diverges from the launch id. This needs real `claude` or a stub that rewrites its registry `sessionId`.
- Switching between tmux-hosted sessions in one terminal.
- Re-adopting terminals after a window reload.
- `heroCode.debugMode` tooltip.
