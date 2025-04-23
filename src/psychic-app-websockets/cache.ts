import PsychicAppWebsockets from './index.js'

let _psychicAppWebsockets: PsychicAppWebsockets | undefined = undefined

export function cachePsychicAppWebsockets(psychicAppWebsockets: PsychicAppWebsockets) {
  _psychicAppWebsockets = psychicAppWebsockets
}

export function getCachedPsychicAppWebsockets() {
  return _psychicAppWebsockets
}

export function getCachedPsychicAppWebsocketsOrFail() {
  if (!_psychicAppWebsockets)
    throw new Error(
      'must call `cachePsychicAppWebsockets` before loading cached psychic application websockets',
    )
  return _psychicAppWebsockets
}
