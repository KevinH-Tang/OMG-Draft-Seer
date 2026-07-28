import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './i18n'
import { overlayKindFromLocation } from './platform/overlays'
import './styles.css'

if (overlayKindFromLocation())
  document.documentElement.classList.add('overlay-document')

async function bootstrap() {
  if (import.meta.env.VITE_WDIO_E2E === 'true') {
    await import('@wdio/tauri-plugin')
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void bootstrap()
