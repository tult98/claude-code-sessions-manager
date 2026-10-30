import * as vscode from 'vscode'
import * as fs from 'fs'
import * as os from 'os'
import { SerialState } from '../../../../../src/state'
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
export async function activate(ctx: vscode.ExtensionContext) {
  const serial = new SerialState(ctx.globalState)
  const stores = {
    raw: { get: (k: string) => ctx.globalState.get(k), update: (k: string, v: unknown) => void ctx.globalState.update(k, v) },
    serial: { get: (k: string) => serial.get(k, undefined), update: (k: string, v: unknown) => void serial.update(k, v) },
  }
  const out: Record<string, { trials: number; lost: number; lostAt: number[] }> = {}
  for (const [name, s] of Object.entries(stores)) {
    const r = (out[name] = { trials: 0, lost: 0, lostAt: [] as number[] })
    for (const gap of [0, 1, 2, 3, 5, 8, 12, 20, 30, 50]) {
      for (let t = 0; t < 8; t++) {
        const key = `k-${name}`
        s.update(key, { step: 0 })
        await sleep(300)
        s.update(key, { step: 1 })
        if (gap) await sleep(gap)
        s.update(key, { step: 2 })
        const immediate = (s.get(key) as { step: number } | undefined)?.step
        await sleep(400)
        const settled = (s.get(key) as { step: number } | undefined)?.step
        r.trials++
        if (immediate !== 2 || settled !== 2) {
          r.lost++
          r.lostAt.push(gap)
        }
      }
    }
  }
  fs.writeFileSync(`${os.homedir()}/memtest.json`, JSON.stringify(out))
}
