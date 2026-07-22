export const SCREENSHOT_FILE_ACCEPT = 'image/png,image/jpeg,.png,.jpg,.jpeg'

const SUPPORTED_SCREENSHOT_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg'])
const SUPPORTED_SCREENSHOT_EXTENSION = /\.(png|jpe?g)$/i

export interface ScreenshotFileDescriptor {
  name: string
  type: string
}

export function isSupportedScreenshotFile(file: ScreenshotFileDescriptor): boolean {
  const type = file.type.trim().toLowerCase()
  if (type.length > 0) return SUPPORTED_SCREENSHOT_TYPES.has(type)
  return SUPPORTED_SCREENSHOT_EXTENSION.test(file.name)
}
