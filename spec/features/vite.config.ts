import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    dir: './spec/features',
    globals: true,
    setupFiles: ['luxon-jest-matchers', './spec/features/setup/hooks.ts'],
    fileParallelism: false,
    maxConcurrency: 1,
    maxWorkers: 1,
    minWorkers: 1,
    mockReset: true,
    watch: false,
    printConsoleTrace: true,
    testTimeout: 20000,
    hookTimeout: 20000,

    globalSetup: './spec/features/setup/globalSetup.ts',
  },
})
