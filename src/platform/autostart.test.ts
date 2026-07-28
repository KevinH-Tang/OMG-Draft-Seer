import { beforeEach, describe, expect, it, vi } from 'vitest'
import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart'
import { readAutostartEnabled, setAutostartEnabled } from './autostart'

vi.mock('@tauri-apps/plugin-autostart', () => ({
  disable: vi.fn(),
  enable: vi.fn(),
  isEnabled: vi.fn(),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('autostart platform adapter', () => {
  it('reads the registration state from the native plugin', async () => {
    vi.mocked(isEnabled).mockResolvedValue(true)

    await expect(readAutostartEnabled()).resolves.toBe(true)
  })

  it('enables startup registration when requested', async () => {
    await setAutostartEnabled(true)

    expect(enable).toHaveBeenCalledOnce()
    expect(disable).not.toHaveBeenCalled()
  })

  it('disables startup registration when requested', async () => {
    await setAutostartEnabled(false)

    expect(disable).toHaveBeenCalledOnce()
    expect(enable).not.toHaveBeenCalled()
  })
})
