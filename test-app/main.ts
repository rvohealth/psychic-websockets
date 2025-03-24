import './src/conf/global.js'

import { PsychicServer } from '@rvoh/psychic'
import initializePsychicApplication from './src/cli/helpers/initializePsychicApplication.js'

async function start() {
  await initializePsychicApplication()

  const server = new PsychicServer()
  await server.start()
}

void start()
