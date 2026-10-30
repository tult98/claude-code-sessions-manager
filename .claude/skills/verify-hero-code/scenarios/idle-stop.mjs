// heroCode.idleSessions.stopAfterMinutes: an idle session's claude is stopped,
// and the ones that must survive do. Four live sessions resumed through the
// sidebar: A plain, B running a Bash-tool-shaped command, C waiting for input,
// D the one on screen (clicked last). With the setting at 0 nothing may stop;
// at 0.05 minutes only A may. The check runs once a minute, so each phase waits
// a little over that. Then A must resume with one click. Invisible; drives
// through DOM events.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createSandbox, launchVSCode, openSidebar, rows, stubHook, cleanup } from '../scripts/vh.mjs'

const runId = process.argv[2]
const S = {
  A: '11111111-1111-4111-8111-111111111111',
  B: '22222222-2222-4222-8222-222222222222',
  C: '33333333-3333-4333-8333-333333333333',
  D: '44444444-4444-4444-8444-444444444444',
}
const TITLE = { A: 'A plain', B: 'B running a command', C: 'C waiting for input', D: 'D on screen' }
const p = createSandbox(runId, [
  { name: 'todo-api', sessions: Object.keys(S).map((k) => ({ id: S[k], prompt: k, title: TITLE[k] })) },
])
stubHook(p, S.B, { command: true })
stubHook(p, S.C, { status: 'waiting' })

const statusOf = async (sb) => {
  const out = {}
  for (const t of await rows(sb, 'todo-api').allInnerTexts()) {
    const [title, status] = t.split('\n')
    out[title[0]] = status
  }
  return out
}
const liveRegistry = () => {
  const dir = path.join(p.home, '.claude', 'sessions')
  return existsSync(dir) ? readdirSync(dir).map((f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8')).sessionId) : []
}
const checks = {}
let pass = false
try {
  const { win } = await launchVSCode(p, { settings: { 'heroCode.idleSessions.stopAfterMinutes': 0 } })
  const sb = await openSidebar(win)
  for (const [key, expect] of [['A', 'Ready'], ['B', 'Ready'], ['C', 'Waiting for input'], ['D', 'Ready']]) {
    const row = rows(sb, 'todo-api').filter({ hasText: TITLE[key] })
    await row.dispatchEvent('click')
    await row.filter({ hasText: expect }).waitFor({ timeout: 30_000 })
  }
  checks.started = await statusOf(sb)

  await win.waitForTimeout(70_000)
  checks.offAfter70s = await statusOf(sb)
  checks.offRegistry = liveRegistry().length

  const settingsFile = path.join(p.profile, 'User', 'settings.json')
  const settings = JSON.parse(readFileSync(settingsFile, 'utf8'))
  writeFileSync(settingsFile, JSON.stringify({ ...settings, 'heroCode.idleSessions.stopAfterMinutes': 0.05 }))
  await rows(sb, 'todo-api').filter({ hasText: TITLE.A }).filter({ hasText: 'Idle' }).waitFor({ timeout: 90_000 })
  await win.waitForTimeout(65_000)
  checks.onAfterStop = await statusOf(sb)
  checks.onRegistry = liveRegistry().sort()

  const stopped = rows(sb, 'todo-api').filter({ hasText: TITLE.A })
  await stopped.dispatchEvent('click')
  await stopped.filter({ hasText: 'Ready' }).waitFor({ timeout: 30_000 })
  checks.resumedA = (await stopped.innerText()).split('\n')[1]

  const allLive = (o) => o.A === 'Ready' && o.B === 'Ready' && o.C === 'Waiting for input' && o.D === 'Ready'
  pass =
    allLive(checks.started) &&
    allLive(checks.offAfter70s) &&
    checks.offRegistry === 4 &&
    checks.onAfterStop.A === 'Idle' &&
    checks.onAfterStop.B === 'Ready' &&
    checks.onAfterStop.C === 'Waiting for input' &&
    checks.onAfterStop.D === 'Ready' &&
    JSON.stringify(checks.onRegistry) === JSON.stringify([S.B, S.C, S.D].sort()) &&
    checks.resumedA === 'Ready'
} catch (e) {
  checks.error = e.message.split('\n')[0]
} finally {
  writeFileSync(path.join(p.evidence, 'checks.json'), JSON.stringify(checks, null, 2))
  cleanup(runId)
}
console.log(pass ? 'PASS' : 'FAIL', JSON.stringify(checks))
process.exit(pass ? 0 : 1)
