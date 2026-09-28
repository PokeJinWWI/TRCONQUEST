import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { TooltipLayer } from './components/TooltipLayer'
import { BoxSelectLayer } from './components/BoxSelectLayer'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <TooltipLayer />
    <BoxSelectLayer />
  </StrictMode>,
)
