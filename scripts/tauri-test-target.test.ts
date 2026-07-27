import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  readTauriTestTarget,
  resolveTauriTestBinaryPath,
} from './tauri-test-target'

describe('Tauri test binary target', () => {
  const projectRoot = join('fixtures', 'project')

  it('uses the native release path for macOS builds', () => {
    expect(
      resolveTauriTestBinaryPath({
        platform: 'darwin',
        projectRoot,
      }),
    ).toBe(
      resolve(projectRoot, 'src-tauri', 'target', 'release', 'omg-draft-seer'),
    )
  })

  it('uses the Windows executable name for Windows builds', () => {
    expect(
      resolveTauriTestBinaryPath({
        platform: 'win32',
        projectRoot,
      }),
    ).toBe(
      resolve(
        projectRoot,
        'src-tauri',
        'target',
        'release',
        'omg-draft-seer.exe',
      ),
    )
  })

  it('uses target-specific output for cross-platform builds', () => {
    expect(
      resolveTauriTestBinaryPath({
        platform: 'darwin',
        projectRoot,
        target: 'x86_64-pc-windows-msvc',
      }),
    ).toBe(
      resolve(
        projectRoot,
        'src-tauri',
        'target',
        'x86_64-pc-windows-msvc',
        'release',
        'omg-draft-seer.exe',
      ),
    )
  })

  it('prefers an explicit test target over Cargo defaults', () => {
    expect(
      readTauriTestTarget({
        TAURI_TEST_TARGET: 'aarch64-apple-darwin',
        CARGO_BUILD_TARGET: 'x86_64-pc-windows-msvc',
      }),
    ).toBe('aarch64-apple-darwin')
  })
})
