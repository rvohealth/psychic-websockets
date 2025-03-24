import '../../../test-app/src/conf/loadEnv.js'

import initializePsychicApplication from '../../../test-app/src/cli/helpers/initializePsychicApplication.js'

export async function setup() {
  await initializePsychicApplication()
}

export async function teardown() {}
