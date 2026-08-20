import { Breadcrumb } from './components/Breadcrumb'
import { LocationLabel } from './components/LocationLabel'
import { TimeControls } from './components/TimeControls'
import { useGameClock } from './hooks/useGameClock'
import { GalacticViewScene } from './scene/GalacticViewScene'
import { InterstellarScene } from './scene/InterstellarScene'
import { SatelliteViewScene } from './scene/SatelliteViewScene'
import { SolarSystemScene } from './scene/SolarSystemScene'
import { useViewStore } from './state/viewStore'
import './App.css'

function ActiveScene() {
  const level = useViewStore((s) => s.level)
  const selectedStarId = useViewStore((s) => s.selectedStarId)
  const selectedBodyName = useViewStore((s) => s.selectedBodyName)

  let scene = <SolarSystemScene />
  if (level === 'galactic') scene = <GalacticViewScene />
  else if (level === 'interstellar') scene = <InterstellarScene />
  else if (level === 'satellite' && selectedBodyName) {
    scene = <SatelliteViewScene bodyName={selectedBodyName} />
  }

  // Keying on the full location forces a remount on every navigation change,
  // which retriggers the fade/scale-in animation below — a lightweight
  // "smooth transition" between view levels without needing to keep two
  // WebGL canvases alive at once.
  const transitionKey = `${level}:${selectedStarId}:${selectedBodyName ?? ''}`

  return (
    <div key={transitionKey} className="view-transition">
      {scene}
    </div>
  )
}

function App() {
  useGameClock()

  return (
    <div id="app-root">
      <header className="hud-bar hud-top">
        <div className="hud-title-block">
          <span className="hud-title">TERRA RELICTA: CONQUEST</span>
          <LocationLabel />
        </div>
        <Breadcrumb />
      </header>

      <ActiveScene />

      <footer className="hud-bar hud-bottom">
        <TimeControls />
      </footer>
    </div>
  )
}

export default App
