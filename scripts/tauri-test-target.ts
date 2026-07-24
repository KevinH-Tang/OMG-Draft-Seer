import { join, resolve } from 'node:path'

export const TAURI_TEST_BINARY_NAME = 'omg-draft-seer'

export interface TauriTestTargetOptions {
  binaryName?: string
  platform?: NodeJS.Platform
  projectRoot?: string
  target?: string
}

function isWindowsTarget(
  platform: NodeJS.Platform,
  target: string | undefined,
): boolean {
  return platform === 'win32' || target?.includes('-windows-') === true
}

export function readTauriTestTarget(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const target = env.TAURI_TEST_TARGET ?? env.CARGO_BUILD_TARGET
  return target?.trim() || undefined
}

export function resolveTauriTestBinaryPath({
  binaryName = TAURI_TEST_BINARY_NAME,
  platform = process.platform,
  projectRoot = process.cwd(),
  target,
}: TauriTestTargetOptions = {}): string {
  const executableName = isWindowsTarget(platform, target)
    ? `${binaryName}.exe`
    : binaryName
  const targetDirectory = target
    ? join('src-tauri', 'target', target, 'release')
    : join('src-tauri', 'target', 'release')

  return resolve(projectRoot, targetDirectory, executableName)
}
