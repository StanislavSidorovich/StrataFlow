import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@xyflow/react/dist/style.css'
import './family/fonts.css'
import './family/tokens.css'
import './family/switcher.js'
import './index.css'
import './trainer.css'
import './story.css'
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
