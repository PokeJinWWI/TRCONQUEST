import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './themes/nerv.css'
// Puts the saved theme on <html> before the first paint.
import './state/themeStore'
import App from './App.tsx'
import { TooltipLayer } from './components/TooltipLayer'
import { NativeAnnotator } from './components/NativeAnnotator'
import { BoxSelectLayer } from './components/BoxSelectLayer'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <TooltipLayer />
    <NativeAnnotator />
    <BoxSelectLayer />
  </StrictMode>,
)
