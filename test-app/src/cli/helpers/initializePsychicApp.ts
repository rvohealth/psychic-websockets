import '../../conf/global.js'

import { PsychicApp } from '@rvoh/psychic'
import { PsychicAppInitOptions } from '@rvoh/psychic/types'
import psychicConf from '../../conf/app.js'
import dreamConf from '../../conf/dream.js'

export default async function initializePsychicApp(opts: PsychicAppInitOptions = {}) {
  return await PsychicApp.init(psychicConf, dreamConf, opts)
}
