import '../../../test-app/src/conf/loadEnv'

import initializePsychicApplication from '../../../test-app/src/cli/helpers/initializePsychicApplication'

export async function setup() {
  await initializePsychicApplication()
}

export async function teardown() {}
