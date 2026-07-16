import { Cable, PsychicAppWebsockets } from '../../../src/index.js'
import type { PsychicWebsocketsErrorContext } from '../../../src/index.js'

/**
 * The websocket server owns its own http.Server (Cable) — psychic's Koa app never
 * sees these requests. A throw while answering one (the health check + catch-all
 * 404) must not hang the request or crash the process: the response is settled
 * exactly once, then `ws:error` observers are notified with a privacy-scrubbed
 * context.
 */
describe('cable ws:error hook — ws:health-check phase', () => {
  let cable: Cable

  beforeEach(async () => {
    cable = new Cable()
    await cable.start(8890)
  })

  afterEach(async () => {
    await cable.stop()
  })

  it('fires ws:error once, settles the response as 500, and keeps the process alive when the handler throws', async () => {
    const wsApp = PsychicAppWebsockets.getOrFail()
    const error = new Error('boom while resolving health-check options')
    // Force the request handler to throw at a deterministic point. Shadow the
    // instance's healthCheckOptions getter with an own property that throws.
    Object.defineProperty(wsApp, 'healthCheckOptions', {
      configurable: true,
      get() {
        throw error
      },
    })
    vi.spyOn(PsychicAppWebsockets, 'logWithLevel').mockReturnValue(undefined)

    const observer = vi.fn()
    wsApp.on('ws:error', observer)

    const captured: unknown[] = []
    const onUncaught = (err: unknown) => captured.push(err)
    process.on('uncaughtException', onUncaught)

    let status: number
    try {
      status = (await fetch('http://localhost:8890/healthcheck?token=secret&foo=bar')).status
      // the response settles synchronously (500) before the fire-and-forget
      // dispatch runs; give the async observer a tick to be invoked
      await new Promise(resolve => setTimeout(resolve, 50))
    } finally {
      process.off('uncaughtException', onUncaught)
    }

    // response settled exactly once — a 500, no double-write uncaughtException
    expect(status).toEqual(500)
    const doubleWrite = captured.find(
      err => err instanceof Error && /cannot write headers after they are sent/i.test(err.message),
    )
    expect(doubleWrite).toBeUndefined()
    expect(captured).toHaveLength(0)

    // ws:error fired exactly once with the health-check phase
    expect(observer).toHaveBeenCalledTimes(1)
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const [errArg, ctxArg] = observer.mock.calls[0] as [unknown, PsychicWebsocketsErrorContext]
    expect(errArg).toBe(error)
    expect(ctxArg.phase).toEqual('ws:health-check')
  })

  it('scrubs the query string from the hook context path (no ?...)', async () => {
    const wsApp = PsychicAppWebsockets.getOrFail()
    const error = new Error('boom')
    Object.defineProperty(wsApp, 'healthCheckOptions', {
      configurable: true,
      get() {
        throw error
      },
    })
    vi.spyOn(PsychicAppWebsockets, 'logWithLevel').mockReturnValue(undefined)

    const observer = vi.fn()
    wsApp.on('ws:error', observer)

    await fetch('http://localhost:8890/healthcheck?token=secret&foo=bar').catch(() => undefined)
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(observer).toHaveBeenCalledTimes(1)
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const [, ctxArg] = observer.mock.calls[0] as [unknown, PsychicWebsocketsErrorContext]
    if (ctxArg.phase !== 'ws:health-check') throw new Error('expected ws:health-check phase')
    expect(ctxArg.method).toEqual('GET')
    expect(ctxArg.path).toEqual('/healthcheck')
    expect(ctxArg.path).not.toContain('?')
    expect(ctxArg.path).not.toContain('secret')
  })

  it('never fires ws:error for a socket.io polling request', async () => {
    const wsApp = PsychicAppWebsockets.getOrFail()
    const observer = vi.fn()
    wsApp.on('ws:error', observer)

    // engine.io answers its own polling request; the health-check listener (which
    // engine.io delegates to only for NON-socket.io requests) never runs for it,
    // so it never throws and never dispatches ws:error.
    await fetch('http://localhost:8890/socket.io/?EIO=4&transport=polling').catch(() => undefined)
    await new Promise(resolve => setTimeout(resolve, 100))

    expect(observer).not.toHaveBeenCalled()
  })
})
