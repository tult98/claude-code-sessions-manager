import type * as vscode from 'vscode'

/**
 * `globalState` with its writes run one at a time.
 *
 * VS Code echoes every write back to the extension host, and the echo replaces
 * the host's whole in-memory state. A write issued while an earlier one is still
 * in flight is therefore wiped by the earlier one's echo — and since `update`
 * flushes the in-memory object a tick later, the stale copy is what gets saved.
 * That is how a deleted session came back after a burst of pin/rename/delete:
 * the hide was a write that landed a few milliseconds after another one.
 *
 * The echo of a write reaches the host before the write's own promise resolves,
 * so awaiting each `update` before starting the next leaves no window for it.
 * Until its turn comes, a queued value is served from `queued`, so reads never
 * go back in time.
 */
export class SerialState {
  private readonly queued = new Map<string, unknown>()
  private tail: Promise<void> = Promise.resolve()

  constructor(private readonly memento: vscode.Memento) {}

  get<T>(key: string, fallback: T): T {
    return this.queued.has(key) ? (this.queued.get(key) as T) : this.memento.get<T>(key, fallback)
  }

  update(key: string, value: unknown): Promise<void> {
    this.queued.set(key, value)
    this.tail = this.tail.then(async () => {
      // An earlier job for this key already wrote the latest value.
      if (!this.queued.has(key)) {
        return
      }
      const latest = this.queued.get(key)
      try {
        await this.memento.update(key, latest)
      } catch {
        // A rejected write must not stall every write queued behind it.
      }
      if (this.queued.get(key) === latest) {
        this.queued.delete(key)
      }
    })
    return this.tail
  }
}
