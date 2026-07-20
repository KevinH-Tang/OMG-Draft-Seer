import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

function heroSelectionAssets(): Plugin {
  return {
    name: 'hero-selection-assets',
    async generateBundle() {
      const sourceDir = resolve('heroes/selection')
      for (const fileName of await readdir(sourceDir)) {
        if (!fileName.endsWith('.png')) continue
        this.emitFile({
          type: 'asset',
          fileName: `heroes/selection/${fileName}`,
          source: await readFile(resolve(sourceDir, fileName)),
        })
      }
    },
  }
}

export default defineConfig({
  plugins: [react(), heroSelectionAssets()],
})
