import { isDeepStrictEqual } from 'node:util'
import InProcessWebsocketsAdapter, { RecordedBroadcast } from '../cable/adapter/InProcessWebsocketsAdapter.js'
import PsychicAppWebsockets from '../psychic-app-websockets/index.js'

/**
 * Spec helpers for asserting on websocket broadcasts. These read the in-process
 * adapter's recorded-broadcast buffer, so they require the in-process adapter to be
 * active (the default in the `test` environment). They sit alongside — and do not
 * replace — the existing `vi.spyOn(AppWs, 'emit')` pattern, which keeps working.
 *
 * ```ts
 * import { assertBroadcast, clearBroadcasts } from '@rvoh/psychic-websockets/testing'
 *
 * beforeEach(() => clearBroadcasts())
 *
 * it('notifies the user', async () => {
 *   await subject()
 *   assertBroadcast('/ops/howyadoin', { to: user.id, data: { hello: 'world' } })
 * })
 * ```
 */

export interface AssertBroadcastOptions {
  /** the id the broadcast was emitted to (matched against the namespaced user key) */
  to?: string | number
  /** the redisKeyPrefix used when emitting; defaults to 'user' (matching `Ws`'s default) */
  prefix?: string
  /** the payload the broadcast carried; compared with deep strict equality */
  data?: unknown
}

/**
 * Returns the broadcasts recorded by the in-process adapter, in emit order,
 * optionally filtered to a single path.
 */
export function websocketBroadcasts(path?: string): RecordedBroadcast[] {
  const broadcasts = inProcessAdapterOrFail().broadcasts
  return path === undefined ? [...broadcasts] : broadcasts.filter(broadcast => broadcast.path === path)
}

/**
 * Clears the recorded-broadcast buffer. Call between examples (e.g. in `beforeEach`)
 * so assertions only see broadcasts from the example under test.
 */
export function clearBroadcasts(): void {
  inProcessAdapterOrFail().clearBroadcasts()
}

/**
 * Asserts at least one recorded broadcast matches `path` (and the optional `to` /
 * `data` constraints), throwing a descriptive error otherwise.
 */
export function assertBroadcast(path: string, options: AssertBroadcastOptions = {}): void {
  const { to, prefix = 'user', data } = options
  const expectedUserKey = to === undefined ? undefined : `${prefix}:${to.toString()}`

  const matches = websocketBroadcasts(path).filter(broadcast => {
    if (expectedUserKey !== undefined && broadcast.userKey !== expectedUserKey) return false
    if (data !== undefined && !isDeepStrictEqual(broadcast.data, data)) return false
    return true
  })

  if (matches.length === 0) {
    const constraints: string[] = []
    if (expectedUserKey !== undefined) constraints.push(`to "${expectedUserKey}"`)
    if (data !== undefined) constraints.push(`with data ${JSON.stringify(data)}`)
    const constraintText = constraints.length ? ` ${constraints.join(' ')}` : ''

    throw new Error(
      `Expected a websocket broadcast to "${path}"${constraintText}, but none was recorded.\n` +
        `Recorded broadcasts: ${JSON.stringify(websocketBroadcasts(), null, 2)}`,
    )
  }
}

/**
 * @internal
 *
 * resolves the active adapter, asserting it is the in-process adapter (the only one
 * that records broadcasts).
 */
function inProcessAdapterOrFail(): InProcessWebsocketsAdapter {
  const adapter = PsychicAppWebsockets.getOrFail().adapter()

  if (!(adapter instanceof InProcessWebsocketsAdapter)) {
    throw new Error(
      'websocket broadcast test helpers require the in-process websockets adapter, but a ' +
        `different adapter is active (${adapter.constructor.name}). Ensure the test environment ` +
        "uses the in-process adapter (the default in `test`), e.g. wsApp.set('adapter', 'in_process').",
    )
  }

  return adapter
}
