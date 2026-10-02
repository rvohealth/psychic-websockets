import '../../../test-app/src/conf/loadEnv.js'

import { PsychicDevtools } from '@rvoh/psychic/system'

export async function setup() {
  await PsychicDevtools.launchDevServer('client', { port: 3000, cmd: 'pnpm client:fspec' })

  // Dream >=2.33 gives every process that runs under vitest (VITEST=true / VITEST_POOL_ID)
  // its own database from a per-worker test-database pool. The websocket server is a
  // separate process that must read the rows the feature spec's worker creates, so it must
  // not inherit the vitest markers (launchDevServer copies process.env into the child).
  // Without them it connects to the base test database, which the spec worker claims first
  // (pool index 1 is the unsuffixed base name).
  const { VITEST, VITEST_POOL_ID, VITEST_WORKER_ID } = process.env
  delete process.env.VITEST
  delete process.env.VITEST_POOL_ID
  delete process.env.VITEST_WORKER_ID
  try {
    await PsychicDevtools.launchDevServer('ws', {
      cmd: 'pnpm ws:fspec',
      port: 8889,
    })
  } finally {
    if (VITEST !== undefined) process.env.VITEST = VITEST
    if (VITEST_POOL_ID !== undefined) process.env.VITEST_POOL_ID = VITEST_POOL_ID
    if (VITEST_WORKER_ID !== undefined) process.env.VITEST_WORKER_ID = VITEST_WORKER_ID
  }
}

export function teardown() {
  PsychicDevtools.stopDevServers()
}
