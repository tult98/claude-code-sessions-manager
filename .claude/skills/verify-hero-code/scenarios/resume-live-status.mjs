import { writeFileSync } from 'node:fs'
import { createSandbox, launchVSCode, openSidebar, rows, activeTerminal, recorder, cleanup } from '../scripts/vh.mjs'

const runId = process.argv[2]
const ID = '11111111-1111-4111-8111-111111111111'
const p = createSandbox(runId, [
  { name: 'todo-api', sessions: [{ id: ID, prompt: 'Add a DELETE endpoint', title: 'Add DELETE endpoint' }] },
  { name: 'landing-page', sessions: [{ id: '22222222-2222-4222-8222-222222222222', prompt: 'Make the button orange', title: 'Orange button' }] },
])
const { app, win } = await launchVSCode(p, { video: true })
let pass = false
const checks = []
const statusOf = async (sb) => (await rows(sb, 'todo-api').first().innerText()).split('\n')[1]
try {
  const sb = await openSidebar(win)
  const row = rows(sb, 'todo-api').first()
  await row.waitFor({ timeout: 30_000 })
  const rec = await recorder(p, app, win, 'resume-live-status')
  await rec.title('Resume an idle session and follow its live status')
  checks.push(['before', await statusOf(sb)])
  await win.screenshot({ path: `${p.evidence}/01-idle.png` })

  await rec.step('Click the idle session to resume it', () => rec.ptr.to(row))
  const term = activeTerminal(win)
  await term.filter({ hasText: `stub-claude session=${ID}` }).waitFor({ timeout: 30_000 })
  await row.filter({ hasText: 'Ready' }).waitFor({ timeout: 20_000 })
  checks.push(['after resume', await statusOf(sb)])
  await win.screenshot({ path: `${p.evidence}/02-ready.png` })

  for (const [cmd, label, expect, shot] of [
    ['busy', 'Claude starts working', 'Working', '03-working'],
    ['waiting', 'Claude asks for permission', 'Waiting for input', '04-waiting'],
    ['exit', 'The claude process exits', 'Idle', '05-idle-again'],
  ]) {
    await rec.step(label, async () => {
      await term.click()
      await rec.type(cmd)
      await win.keyboard.press('Enter')
      await row.filter({ hasText: expect }).waitFor({ timeout: 20_000 })
    })
    checks.push([cmd, await statusOf(sb)])
    await win.screenshot({ path: `${p.evidence}/${shot}.png` })
  }
  pass = JSON.stringify(checks.map((c) => c[1])) === JSON.stringify(['Idle', 'Ready', 'Working…', 'Waiting for input', 'Idle'])
  writeFileSync(`${p.evidence}/checks.json`, JSON.stringify(checks, null, 2))
  const clip = await rec.finish({ proves: 'idle row resumes via claude --resume; row follows Ready, Working, Waiting, Idle', pass })
  console.log(pass ? 'PASS' : 'FAIL', JSON.stringify(checks), clip)
} catch (e) {
  console.error('FAIL', e)
  await win.screenshot({ path: `${p.evidence}/failure.png` }).catch(() => {})
  await app.close().catch(() => {})
} finally {
  cleanup(runId)
}
process.exit(pass ? 0 : 1)
