import { access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { spawn } from 'node:child_process'
import {
  readTauriTestTarget,
  resolveTauriTestBinaryPath,
} from './tauri-test-target'

function run(
  command: string,
  args: string[],
  env = process.env,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env,
      stdio: 'inherit',
      windowsHide: true,
    })

    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve()
        return
      }

      reject(
        new Error(
          `${command} ${args.join(' ')} exited with ${signal ? `signal ${signal}` : `code ${code ?? 'unknown'}`}`,
        ),
      )
    })
  })
}

const target = readTauriTestTarget()
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const cargoArgs = [
  'build',
  '--manifest-path',
  'src-tauri/Cargo.toml',
  '--release',
  '--features',
  'custom-protocol,wdio',
]

if (target) cargoArgs.push('--target', target)

await run(npmCommand, ['run', 'build', '--', '--base', './'], {
  ...process.env,
  VITE_WDIO_E2E: 'true',
})
await run('cargo', cargoArgs)

const binaryPath = resolveTauriTestBinaryPath({ target })
try {
  await access(binaryPath, constants.X_OK)
} catch (error) {
  throw new Error(
    `Tauri test binary is missing or not executable: ${binaryPath}`,
    { cause: error },
  )
}

console.log(`Built Tauri test binary: ${binaryPath}`)
