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
