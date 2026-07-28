import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart'

export function readAutostartEnabled(): Promise<boolean> {
  return isEnabled()
}

export async function setAutostartEnabled(enabled: boolean): Promise<void> {
  if (enabled) await enable()
  else await disable()
}
