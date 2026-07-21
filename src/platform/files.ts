export interface FileAdapter {
  readText(file: Blob): Promise<string>
  downloadText(fileName: string, content: string, mimeType: string): void
}

export function getBrowserFileAdapter(): FileAdapter {
  return {
    readText: (file) => file.text(),
    downloadText: (fileName, content, mimeType) => {
      const url = URL.createObjectURL(new Blob([content], { type: mimeType }))
      const link = document.createElement('a')
      link.href = url
      link.download = fileName
      link.click()
      URL.revokeObjectURL(url)
    },
  }
}
