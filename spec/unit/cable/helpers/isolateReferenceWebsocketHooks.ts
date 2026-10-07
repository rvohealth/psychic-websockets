import PsychicAppWebsockets from '../../../../src/psychic-app-websockets/index.js'

// These fixtures exercise framework hooks/routing with intentionally auth-free
// sockets. The real reference authentication policy has its own factory specs.
export default function isolateReferenceWebsocketHooks() {
  const hooks = PsychicAppWebsockets.getOrFail().hooks
  hooks.wsStart.length = 0
  hooks.wsConnect.length = 0
}
