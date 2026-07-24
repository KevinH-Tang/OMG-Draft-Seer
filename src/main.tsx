import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './i18n'
import './styles.css'

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
