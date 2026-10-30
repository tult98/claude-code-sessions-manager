// Pin, rename and delete through the sidebar, then check the result survives a
// refresh, a new session, and a relaunch on the same profile (what reached disk).
// Drives through DOM events so it runs in the invisible window. It does not hit
// the write race fixed in src/state.ts; state-race.mjs covers that.
import { writeFileSync } from 'node:fs'
import { createSandbox, launchVSCode, openSidebar, rows, group, activeTerminal, cleanup } from '../scripts/vh.mjs'

const runId = process.argv[2]
const p = createSandbox(runId, [
  {
    name: 'todo-api',
    sessions: [
      { id: '11111111-1111-4111-8111-111111111111', prompt: 'Add a DELETE endpoint', title: 'Add DELETE endpoint' },
      { id: '33333333-3333-4333-8333-333333333333', prompt: 'Fix flaky test', title: 'Fix flaky test', error: true },
    ],
  },
  { name: 'landing-page', sessions: [{ id: '22222222-2222-4222-8222-222222222222', prompt: 'Make the button orange', title: 'Orange button' }] },
])
const titles = async (sb) => (await sb.locator('li').allInnerTexts()).map((t) => t.split('\n')[0])
const expectOk = (list) => list.includes('Landing polish') && !list.includes('Orange button') && !list.includes('Fix flaky test')
const checks = {}
let pass = false
try {
  let { app, win } = await launchVSCode(p)
  let sb = await openSidebar(win)
  await rows(sb, 'todo-api').nth(1).waitFor({ timeout: 30_000 })

  const tap = (loc) => loc.dispatchEvent('click')
  await tap(rows(sb, 'landing-page').first().locator('[title="Pin"]'))
  const pinned = rows(sb, 'Pinned').first()
  await pinned.waitFor()
  await tap(pinned.locator('[title="Rename"]'))
  const input = sb.locator('li input')
  await input.waitFor()
  await input.fill('Landing polish')
  checks.typed = await input.inputValue()
  await input.press('Enter')
  const err = rows(sb, 'todo-api').filter({ hasText: 'Fix flaky test' })
  await tap(err.locator('[title="Delete session"]'))
  await tap(win.locator('.monaco-dialog-box .monaco-button', { hasText: 'Delete Session' }))
  await err.waitFor({ state: 'detached', timeout: 15_000 })

  await win.waitForTimeout(6_000)
  await tap(sb.locator('[title="Refresh"]'))
  await win.waitForTimeout(1_500)
  checks.afterRefresh = await titles(sb)
  await tap(group(sb, 'todo-api').locator('[title="New session in workspace"]'))
  await activeTerminal(win).filter({ hasText: 'stub-claude session=' }).waitFor({ timeout: 30_000 })
  await win.waitForTimeout(7_000)
  checks.afterNewSession = await titles(sb)
  await app.close()
  ;({ app, win } = await launchVSCode(p, { keepProfile: true }))
  sb = await openSidebar(win)
  await rows(sb, 'todo-api').first().waitFor({ timeout: 30_000 })
  await win.waitForTimeout(3_000)
  checks.afterRelaunch = await titles(sb)
  await app.close()
  pass = checks.typed === 'Landing polish' && expectOk(checks.afterRefresh) && expectOk(checks.afterNewSession) && expectOk(checks.afterRelaunch)
} catch (e) {
  checks.error = e.message.split('\n')[0]
} finally {
  writeFileSync(`${p.evidence}/checks.json`, JSON.stringify(checks, null, 2))
  cleanup(runId)
}
console.log(pass ? 'PASS' : 'FAIL', JSON.stringify(checks))
process.exit(pass ? 0 : 1)
