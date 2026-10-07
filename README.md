> ATTENTION: we are currently in the process of releasing this code to the world, as of the afternoon of March 10th, 2025. This notice will be removed, and the version of this repo will be bumped to 1.0.0, once all of the repos have been migrated to the new spaces and we can verify that it is all working. This is anticipated to take 1 day.

# Psychic websockets

Documentation for this repo can be found at [https://psychic-docs.netlify.app/docs/plugins/websockets/overview](https://psychic-docs.netlify.app/docs/plugins/websockets/overview)

## Configuration

Both connection limits are set on the `PsychicAppWebsockets` instance in your websockets config:

```ts
// the maximum number of sockets registered simultaneously per user. Registering
// beyond this cap evicts the user's oldest socket. Defaults to 3. (redis adapter only)
wsApp.set('maxConnectionsPerUser', 3)

// TTL for a user's socket-id registry key, expressed as a whole-unit duration
// ({ seconds?, minutes?, hours?, days? }). Defaults to { days: 1 }.
wsApp.set('maxConnectionTtl', { days: 1 })
```

`maxConnectionTtl` is a garbage-collection backstop on the registry entry, not the
lifetime of the live websocket. It exists to clean up entries left behind when a
socket disconnects ungracefully and the disconnect handler never fires. The live
socket's liveness is governed by socket.io's ping settings (`socketioOptions`), so
set the TTL comfortably above the longest connection you expect — if it expires
while a socket is still connected, emits to that user silently stop.

## Per-socket authentication

Use `ws:start(server)` for startup work and `ws:connect(socket)` for each client's
asynchronous authentication, registration and delivery. `ws:connect` runs **after**
Socket.IO connects on the default namespace (`/`); it does not reject the handshake.
A client can observe transport `connect` before the app authenticates it. Wait for
an application success event to know authentication and registration completed;
a rejected client observes a server disconnect, not `connect_error`.

```ts
wsApp.on('ws:start', server => {
  // Startup work; the raw Socket.IO Server API remains available here.
})

wsApp.on('ws:connect', async socket => {
  if (!socket.connected) return
  const user = await resolveWebsocketUser(socket) // your application's auth policy
  if (!user) {
    socket.disconnect(true)
    return
  }
  if (!socket.connected) return

  await Ws.register(socket, user.id)
  if (!socket.connected) return

  const ws = new Ws(['/ops/connection-success'] as const)
  await ws.emit(user.id, '/ops/connection-success', { message: 'Connected' })
})
```

The reference app rejects missing/malformed tokens and missing users quietly,
without registration or authenticated success. Its
[auth resolver](test-app/src/conf/websocketAuth/resolveReferenceSocketUser.ts)
validates the encryption key separately before catching the specific expected
decryption error. Missing/invalid-length keys and unexpected lookup, registration
or delivery failures throw: the framework logs them, disconnects that socket and
notifies `ws:error`. A same-length wrong key cannot be distinguished from tampered
credentials by decryption alone.

Quiet disconnect-and-return continues later `ws:connect` callbacks. Keep dependent
authentication, registration and success work together, and guard any later
callbacks against disconnected or unauthenticated sockets. Check connection state
after awaited lookup and registration to prevent late registration/success in your
app; this does not change adapter registry cleanup or resolve Redis registry races.

Framework containment applies to `ws:connect` callbacks. A raw
`server.on('connection', async socket => ...)` listener installed by `ws:start` is
outside that containment and `ws:error` observation. The library supplies hooks;
each application chooses its authentication policy.

## Error observability

### The `ws:error` hook

Register a `ws:error` hook to observe framework-contained websocket failures. It is
the idiomatic point to forward such a failure to an external monitoring service
(e.g. Sentry). The hook uses a positional `(error, context)` signature — matching
the existing `ws:start(server)` / `ws:connect(socket)` hooks — and the context is
discriminated by `phase`:

```ts
import type { PsychicWebsocketsErrorContext } from '@rvoh/psychic-websockets'

wsApp.on('ws:error', (error: unknown, context: PsychicWebsocketsErrorContext) => {
  switch (context.phase) {
    case 'ws:connect':
      // a ws:connect hook threw while a socket was connecting.
      // context.socketId is that socket's id. The socket has ALREADY been
      // disconnected and the error ALREADY logged before this hook runs.
      Sentry.captureException(error, { tags: { phase: context.phase, socketId: context.socketId } })
      break

    case 'ws:health-check':
      // an error was thrown while the websocket server's own http handler
      // answered a request (Psychic's health check + catch-all 404 only). The
      // response has ALREADY been settled (500, or ended/destroyed) before this
      // hook runs, so the request can't hang. context.method / context.path are
      // the request method and the query-STRIPPED pathname.
      Sentry.captureException(error, { tags: { phase: context.phase, path: context.path } })
      break
  }
})
```

**What it covers.** Two framework-contained failure classes:

- `phase: 'ws:connect'` — a `ws:connect` hook threw (e.g. a DB/Redis blip during
  auth). The framework logs the error, disconnects that one socket, then fires
  `ws:error`. Fires on **every** `ws:connect` throw, including a deliberate
  throw-to-reject-a-connection — filter your own sentinel errors inside the hook.
- `phase: 'ws:health-check'` — a throw while the websocket server's own
  `http.Server` answered a request. This is Psychic's health check + catch-all 404
  **only**; it does not cover engine.io/socket.io internals, app-provided request
  listeners, or async `ServerResponse` `'error'` events.

**Privacy by default.** The context is intentionally minimal — `socketId` (connect)
or query-stripped `path` + `method` (health-check). It never carries a raw socket,
handshake credentials, request headers, request body, or the raw request url (whose
query string can carry tokens/PII). The framework's own internal error **log** does
carry the full `url` + `method` (it is local, same trust level as every other
framework log) so a developer can still debug from the ws process's logs; only the
external-bound hook context is scrubbed. If you need the full url in Sentry, add it
deliberately.

**`socketId` correlation caveat.** After a `ws:connect` failure the socket is
disconnected and socket.io removes it from its map, so you can map `socketId` → user
only if you recorded that mapping **before** the failure; the hook does not resolve
it post-disconnect.

**Containment.** Firing `ws:error` cannot re-break the process. The socket is
disconnected in its own try/catch, the http response is settled before observers
run, each observer runs in its own try/catch, and an observer's own failure is
logged separately — never re-dispatched through `ws:error`. A throwing or rejecting
observer cannot prevent disconnect, prevent response-settling, hide the original
log, or block a later observer.

### Adapter (Redis pub/sub) errors — no hook, an app-owned listener

The redis pub/sub clients emit `'error'` events on connection trouble. There is
**no framework hook** for these by design (forwarding ioredis's `'error'` flood
would be an unbounded emission source, and delegating that flood to the app is the
point). Observe them by attaching your own listener to the public `connection` /
`subConnection` getters, immediately after `wsApp.set('connection', ...)`:

```ts
wsApp.set('connection', new Redis({/* ... */}))

// The subConnection duplicate only exists after set('connection'), so attach here.
wsApp.connection.on('error', error => {
  // ioredis emits 'error' repeatedly for the SAME outage — throttle/dedupe before
  // forwarding, or you will flood your error service.
  Sentry.captureException(error, { tags: { source: 'ws:redis:pub' } })
})
wsApp.subConnection.on('error', error => {
  Sentry.captureException(error, { tags: { source: 'ws:redis:sub' } })
})
```

**Configure the connection once; do not replace it after `Cable#start`.** The redis
adapter captures these clients at attach time and hands them to socket.io's Redis
adapter. A later `wsApp.set('connection', ...)` disconnects the old clients but does
**not** rebind that adapter, so replacing the connection after start is broken at a
level re-attaching listeners cannot fix. Set the connection (and its listeners)
once, at initialization.
