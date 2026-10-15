import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@xyflow/react/dist/style.css'
import './index.css'
import './trainer.css'
import { registerServiceWorker } from './pwa/register'
import { App } from './ui/App'
import { installViewport } from './ui/viewport'

installViewport()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

registerServiceWorker()
