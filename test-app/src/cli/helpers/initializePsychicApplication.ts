import '../../conf/global.js'

import { PsychicApplication, PsychicApplicationInitOptions } from '@rvoh/psychic'
import psychicConf from '../../conf/app.js'
import dreamConf from '../../conf/dream.js'

export default async function initializePsychicApplication(opts: PsychicApplicationInitOptions = {}) {
  return await PsychicApplication.init(psychicConf, dreamConf, opts)
}
