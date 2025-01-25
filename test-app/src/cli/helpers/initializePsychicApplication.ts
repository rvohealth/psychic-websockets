import '../../conf/global'

import psychicConf from '../../conf/app'
import dreamConf from '../../conf/dream'
import websocketsConf from '../../conf/websockets'
import { PsychicApplication, PsychicApplicationInitOptions } from '@rvohealth/psychic'
import { PsychicApplicationWebsockets } from '../../../../src'

export default async function initializePsychicApplication(opts: PsychicApplicationInitOptions = {}) {
  const psychicApp = await PsychicApplication.init(psychicConf, dreamConf, opts)
  await PsychicApplicationWebsockets.init(psychicApp, websocketsConf)
  return psychicApp
}
