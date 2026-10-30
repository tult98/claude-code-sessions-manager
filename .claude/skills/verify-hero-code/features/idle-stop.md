# Stop idle sessions

With `heroCode.idleSessions.stopAfterMinutes` above 0, a live session that has sat at an empty prompt for that long has its `claude` process stopped, to free the memory it and its MCP servers hold. The row turns `Idle` and keeps its title, pin and name. Clicking it resumes the conversation. The setting defaults to `120`. `0` turns it off.

## Sub-features

- `idle-off`: at `0`, no session is ever stopped.
- `idle-stop`: a `Ready` session quiet for longer than the setting is stopped, and its row reads `Idle`.
- `idle-keep-command`: a session with a Bash command running under it (a dev server or watcher) is kept.
- `idle-keep-waiting`: a `Waiting for input` session is kept.
- `idle-keep-on-screen`: the session shown in the terminal is kept.
- `idle-keep-foreign`: a session in a terminal this extension didn't open is kept. This isn't driven, because the sandbox only has extension-hosted sessions.
- `idle-resume`: clicking a stopped row resumes it to `Ready`.

## How to get to it (user POV)

- It's on by default at 120 minutes. Change `heroCode.idleSessions.stopAfterMinutes` in Settings, or set it to `0` to turn it off. The check runs once a minute.

## Driving it with playwright-core

Preconditions:

- Four sessions in `todo-api`, each resumed by clicking its row, with the on-screen one clicked last. Call `stubHook(p, id, { command: true })` for the command case and `stubHook(p, id, { status: 'waiting' })` for the waiting case, before launch.
- The ready-made scenario is `../scenarios/idle-stop.mjs`.

- **Run it.** Run `node .claude/skills/verify-hero-code/scenarios/idle-stop.mjs "$RUN_ID"`. It exits `0` and prints `PASS` after about 3 minutes.
- **Off.** Launch with the setting at `0`, then wait 70s. Every row keeps its status, and `<sandbox>/home/.claude/sessions` still holds 4 entries.
- **On.** Rewrite the profile's `User/settings.json` with the setting at `0.05` (VS Code picks the file change up). The plain row reads `Idle` within 90s. After another 65s, the command, waiting and on-screen rows keep their status, and the registry holds exactly those 3 ids.
- **Resume.** Dispatch a click on the stopped row. It reads `Ready` again.
- **Proof.** `checks.json` holds the statuses and registry ids for each phase, plus `resumedA`.

## Gotchas

- The check runs every 60s, so a phase has to wait a little over a minute. A shorter wait proves nothing.
- "Idle for N minutes" means the transcript's mtime and the registry's `statusUpdatedAt` are both older than N minutes. Seeded transcripts are written at launch, so the clock starts then.
- The command check looks for a direct child whose command line contains `/.claude/shell-snapshots/`, which is how Claude runs every Bash command. If a Claude release changes that, `idle-keep-command` silently stops protecting sessions. Check a live `claude`'s children with `ps -axo pid=,ppid=,command=` when upgrading.
- The stub's command child must source a file that exists. `source` of a missing file is fatal in a POSIX `sh`, and the child would exit at once.
