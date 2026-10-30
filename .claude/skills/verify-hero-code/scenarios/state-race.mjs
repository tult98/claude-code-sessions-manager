// Regression for globalState writes clobbering each other. VS Code echoes every
// globalState write back to the extension host and the echo replaces the host's
// whole in-memory state, so a write landing 1 to 8ms after another is lost.
// src/state.ts serializes writes to close that window. A probe extension loaded
// next to this one writes twice at gaps from 0 to 50ms through the raw memento
// and through SerialState, and records how often the second write was lost. The
// UI can't hit this window reliably; this can. Runs in the invisible window.
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createSandbox, launchVSCode, cleanup, REPO } from '../scripts/vh.mjs'

const runId = process.argv[2]
const p = createSandbox(runId, [{ name: 'empty', sessions: [] }])
const probe = path.join(p.sandbox, 'state-race-probe')
cpSync(path.join(import.meta.dirname, '../probes/state-race'), probe, { recursive: true })
execFileSync(path.join(REPO, 'node_modules/.bin/esbuild'), [
  path.join(import.meta.dirname, '../probes/state-race/probe.ts'),
  '--bundle', '--platform=node', '--format=cjs', '--external:vscode', `--outfile=${path.join(probe, 'out.js')}`,
])
let result
try {
  const { app } = await launchVSCode(p, { extraDevPaths: [probe] })
  const file = path.join(p.home, 'memtest.json')
  const deadline = Date.now() + 120_000
  while (!existsSync(file) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500))
  }
  result = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : undefined
  await app.close()
} finally {
  writeFileSync(path.join(p.evidence, 'checks.json'), JSON.stringify(result ?? { error: 'probe wrote no result' }, null, 2))
  cleanup(runId)
}
// The raw count shows the race still exists in this VS Code; zero there means
// the probe no longer exercises it and proves nothing about SerialState.
const pass = result && result.serial.lost === 0 && result.raw.lost > 0
console.log(pass ? 'PASS' : 'FAIL', JSON.stringify(result))
process.exit(pass ? 0 : 1)
