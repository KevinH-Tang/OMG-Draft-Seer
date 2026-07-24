import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  readTauriTestTarget,
  resolveTauriTestBinaryPath,
} from './tauri-test-target'

describe('Tauri test binary target', () => {
  it('uses the native release path for macOS builds', () => {
    expect(
      resolveTauriTestBinaryPath({
        platform: 'darwin',
        projectRoot: '/workspace/app',
      }),
    ).toBe(
      join(
        '/workspace/app',
        'src-tauri',
        'target',
        'release',
        'omg-draft-seer',
      ),
    )
  })

  it('uses the Windows executable name for Windows builds', () => {
    expect(
      resolveTauriTestBinaryPath({
        platform: 'win32',
        projectRoot: '/workspace/app',
      }),
    ).toBe(
      join(
        '/workspace/app',
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
        projectRoot: '/workspace/app',
        target: 'x86_64-pc-windows-msvc',
      }),
    ).toBe(
      join(
        '/workspace/app',
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
