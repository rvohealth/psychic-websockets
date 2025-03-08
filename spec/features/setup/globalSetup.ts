import '../../../test-app/src/conf/loadEnv'

import initializePsychicApplication from '../../../test-app/src/cli/helpers/initializePsychicApplication'
import { startDevServer, stopDevServer } from './helpers/startDevServer'

export async function setup() {
  await initializePsychicApplication()
  await startDevServer()
}

export function teardown() {
  stopDevServer()
}
