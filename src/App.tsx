import { Breadcrumb } from './components/Breadcrumb'
import { LocationLabel } from './components/LocationLabel'
import { TimeControls } from './components/TimeControls'
import { useGameClock } from './hooks/useGameClock'
import { GalacticViewScene } from './scene/GalacticViewScene'
import { InterstellarScene } from './scene/InterstellarScene'
import { PLANETS } from './scene/planetData'
import { PlanetViewScene } from './scene/PlanetViewScene'
import { SolarSystemScene } from './scene/SolarSystemScene'
import { useViewStore } from './state/viewStore'
import './App.css'

function ActiveScene() {
  const level = useViewStore((s) => s.level)
  const selectedStarId = useViewStore((s) => s.selectedStarId)
  const selectedPlanetName = useViewStore((s) => s.selectedPlanetName)

  let scene = <SolarSystemScene />
  if (level === 'galactic') scene = <GalacticViewScene />
  else if (level === 'interstellar') scene = <InterstellarScene />
  else if (level === 'planet') {
    const planet = PLANETS.find((p) => p.name === selectedPlanetName)
    if (planet) scene = <PlanetViewScene data={planet} />
  }

  // Keying on the full location forces a remount on every navigation change,
  // which retriggers the fade/scale-in animation below — a lightweight
  // "smooth transition" between view levels without needing to keep two
  // WebGL canvases alive at once.
  const transitionKey = `${level}:${selectedStarId}:${selectedPlanetName ?? ''}`

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
