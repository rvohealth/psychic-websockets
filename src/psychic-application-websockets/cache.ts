import PsychicApplicationWebsockets from '.'

let _psychicAppWebsockets: PsychicApplicationWebsockets | undefined = undefined

export function cachePsychicApplicationWebsockets(psychicAppWebsockets: PsychicApplicationWebsockets) {
  _psychicAppWebsockets = psychicAppWebsockets
}

export function getCachedPsychicApplicationWebsockets() {
  return _psychicAppWebsockets
}

export function getCachedPsychicApplicationWebsocketsOrFail() {
  if (!_psychicAppWebsockets)
    throw new Error(
      'must call `cachePsychicApplicationWebsockets` before loading cached psychic application websockets',
    )
  return _psychicAppWebsockets
}
