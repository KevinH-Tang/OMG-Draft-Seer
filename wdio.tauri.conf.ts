import { resolve } from 'node:path'
import type { Options } from '@wdio/types'

const appBinaryPath = resolve('src-tauri/target/debug/OMG-Draft-Seer.exe')

export const config: Options.Testrunner = {
  runner: 'local',
  specs: ['./tests/tauri/**/*.e2e.ts'],
  maxInstances: 1,
  services: [[
    '@wdio/tauri-service',
    {
      driverProvider: 'embedded',
      embeddedPort: 4445,
      autoDownloadEdgeDriver: true,
      startTimeout: 120_000,
      commandTimeout: 30_000,
      captureBackendLogs: true,
      captureFrontendLogs: true,
      logLevel: 'warn',
    },
  ]],
  capabilities: [{
    browserName: 'tauri',
    'tauri:options': { application: appBinaryPath },
  }],
  logLevel: 'warn',
  waitforTimeout: 10_000,
  connectionRetryTimeout: 120_000,
  connectionRetryCount: 2,
  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: {
    ui: 'bdd',
    timeout: 90_000,
  },
}
