import type { Options } from '@wdio/types'
import {
  readTauriTestTarget,
  resolveTauriTestBinaryPath,
} from './scripts/tauri-test-target'

const appBinaryPath = resolveTauriTestBinaryPath({
  target: readTauriTestTarget(),
})
const isWindows = process.platform === 'win32'

export const config: Options.Testrunner = {
  runner: 'local',
  specs: ['./tests/tauri/**/*.e2e.ts'],
  maxInstances: 1,
  services: [
    [
      '@wdio/tauri-service',
      {
        driverProvider: 'embedded',
        embeddedPort: 4445,
        ...(isWindows ? { autoDownloadEdgeDriver: true } : {}),
        startTimeout: 120_000,
        commandTimeout: 30_000,
        captureBackendLogs: true,
        captureFrontendLogs: true,
        logLevel: 'warn',
      },
    ],
  ],
  capabilities: [
    {
      browserName: 'tauri',
      'tauri:options': { application: appBinaryPath },
    },
  ],
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
