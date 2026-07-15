import { Cable } from '../../../src/index.js'

/**
 * Regression: a socket.io long-polling request must not crash the websocket
 * process.
 *
 * The cable attaches an http 'request' listener for the health-check route.
 * socket.io/engine.io's `attach()` snapshots the server's existing 'request'
 * listeners and installs one delegating listener that calls that snapshot only
 * for non-socket.io requests. If the health-check listener is registered AFTER
 * socket.io attaches, it is not part of the snapshot and fires independently for
 * every request — including socket.io's own polling requests, which engine.io
 * has already answered. The health-check listener then calls res.writeHead() on
 * the already-sent response and throws "Cannot write headers after they are sent
 * to the client"; on this raw http path that is an uncaughtException that kills
 * the ws process (observed in production as Sentry issue: ServerResponse.writeHead
 * from cable/index.js). Registering the health check before socket.io attaches
 * (so engine.io owns the delegation) fixes it.
 */
describe('http health check + socket.io coexistence', () => {
  let cable: Cable

  beforeEach(async () => {
    cable = new Cable()
    await cable.start(8899)
  })

  afterEach(async () => {
    await cable.stop()
  })

  it('does not crash the process when a socket.io long-polling request arrives', async () => {
    const captured: unknown[] = []
    const onUncaught = (err: unknown) => captured.push(err)
    process.on('uncaughtException', onUncaught)

    try {
      // engine.io HTTP long-polling handshake — the request socket.io answers
      // itself. On the pre-fix ordering the health-check listener also fired and
      // threw when it tried to writeHead() the already-answered response.
      await fetch('http://localhost:8899/socket.io/?EIO=4&transport=polling').catch(() => undefined)
      // let every http 'request' listener finish firing for this request
      await new Promise(resolve => setTimeout(resolve, 100))
    } finally {
      process.off('uncaughtException', onUncaught)
    }

    const doubleWriteError = captured.find(
      err => err instanceof Error && /cannot write headers after they are sent/i.test(err.message),
    )
    expect(doubleWriteError).toBeUndefined()

    // the ws process is still alive and serving the health check
    const status = (await fetch('http://localhost:8899/healthcheck')).status
    expect(status).toEqual(200)
  })
})
