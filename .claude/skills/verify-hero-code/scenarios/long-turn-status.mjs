// A turn that runs longer than five minutes stays "Working…". Claude rewrites its
// registry entry only when the status changes, never as a heartbeat, so a busy
// session's timestamp is as old as its turn. The stub writes the same way. Next to
// it, a session in Claude's `shell` status (idle with a background shell) and one
// parked on a prompt must keep their own statuses. Invisible; drives through DOM
// events. Takes about six minutes.
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { createSandbox, launchVSCode, openSidebar, rows, stubHook, cleanup } from '../scripts/vh.mjs'

const runId = process.argv[2]
const S = {
  A: '11111111-1111-4111-8111-111111111111',
  B: '22222222-2222-4222-8222-222222222222',
  C: '33333333-3333-4333-8333-333333333333',
}
const TITLE = { A: 'A long turn', B: 'B background shell', C: 'C on a prompt' }
const p = createSandbox(runId, [
  { name: 'todo-api', sessions: Object.keys(S).map((k) => ({ id: S[k], prompt: k, title: TITLE[k] })) },
])
stubHook(p, S.A, { status: 'busy' })
stubHook(p, S.B, { status: 'shell' })
stubHook(p, S.C, { status: 'waiting' })

const statusOf = async (sb) => {
  const out = {}
  for (const t of await rows(sb, 'todo-api').allInnerTexts()) {
    const [title, status] = t.split('\n')
    out[title[0]] = status
  }
  return out
}
const expected = (o) => o.A === 'Working…' && o.B === 'Ready' && o.C === 'Waiting for input'
const checks = {}
let pass = false
try {
  const { win } = await launchVSCode(p)
  const sb = await openSidebar(win)
  for (const [key, expect] of [['A', 'Working'], ['B', 'Ready'], ['C', 'Waiting for input']]) {
    const row = rows(sb, 'todo-api').filter({ hasText: TITLE[key] })
    await row.dispatchEvent('click')
    await row.filter({ hasText: expect }).waitFor({ timeout: 30_000 })
  }
  checks.started = await statusOf(sb)

  await win.waitForTimeout(5.5 * 60_000)
  checks.after5m30s = await statusOf(sb)

  pass = expected(checks.started) && expected(checks.after5m30s)
} catch (e) {
  checks.error = e.message.split('\n')[0]
} finally {
  writeFileSync(path.join(p.evidence, 'checks.json'), JSON.stringify(checks, null, 2))
  cleanup(runId)
}
console.log(pass ? 'PASS' : 'FAIL', JSON.stringify(checks))
process.exit(pass ? 0 : 1)
