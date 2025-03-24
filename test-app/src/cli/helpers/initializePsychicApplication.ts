import '../../conf/global.js'

import { PsychicApplication, PsychicApplicationInitOptions } from '@rvoh/psychic'
import { PsychicApplicationWebsockets } from '../../../../src/index.js'
import psychicConf from '../../conf/app.js'
import dreamConf from '../../conf/dream.js'
import websocketsConf from '../../conf/websockets.js'

export default async function initializePsychicApplication(opts: PsychicApplicationInitOptions = {}) {
  const psychicApp = await PsychicApplication.init(psychicConf, dreamConf, opts)
  await PsychicApplicationWebsockets.init(psychicApp, websocketsConf)
  return psychicApp
}
