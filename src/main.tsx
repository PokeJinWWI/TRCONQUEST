import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './themes/nerv.css'
import './themes/ichor.css'
import './themes/yesteryear.css'
import './themes/terminal.css'
import './themes/win95.css'
import '@fontsource/share-tech-mono/latin-400.css'
// Puts the saved theme on <html> before the first paint.
import './state/themeStore'
import App from './App.tsx'
import { TooltipLayer } from './components/TooltipLayer'
import { NativeAnnotator } from './components/NativeAnnotator'
import { BoxSelectLayer } from './components/BoxSelectLayer'

// Dev only: every store on window.__trc, for the browser tool (src/devHooks.ts). Not in a production build.
if (import.meta.env.DEV) void import('./devHooks')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <TooltipLayer />
    <NativeAnnotator />
    <BoxSelectLayer />
  </StrictMode>,
)
