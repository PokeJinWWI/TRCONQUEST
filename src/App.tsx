import { Breadcrumb } from './components/Breadcrumb'
import { ChatPlaceholder } from './components/ChatPlaceholder'
import { DebugConsole } from './components/DebugConsole'
import { LocationLabel } from './components/LocationLabel'
import { LockOnToggle } from './components/LockOnToggle'
import { NavBar } from './components/NavBar'
import { Outliner } from './components/Outliner'
import { TimeControls } from './components/TimeControls'
import { useGameClock } from './hooks/useGameClock'
import { useShipOrderSettler } from './hooks/useShipOrderSettler'
import { useShipDriftIntegrator } from './hooks/useShipDriftIntegrator'
import { useCombatResolver } from './hooks/useCombatResolver'
import { CombatViewScene } from './scene/CombatViewScene'
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
  const combatEngagementId = useViewStore((s) => s.combatEngagementId)

  let scene = <SolarSystemScene />
  if (level === 'galactic') scene = <GalacticViewScene />
  else if (level === 'interstellar') scene = <InterstellarScene />
  else if (level === 'satellite' && selectedBodyName) {
    scene = <SatelliteViewScene bodyName={selectedBodyName} />
  } else if (level === 'combat' && combatEngagementId) {
    scene = <CombatViewScene engagementId={combatEngagementId} />
  }

  // Keying on the full location forces a remount on every navigation change,
  // which retriggers the fade/scale-in animation below — a lightweight
  // "smooth transition" between view levels without needing to keep two
  // WebGL canvases alive at once.
  const transitionKey = `${level}:${selectedStarId}:${selectedBodyName ?? ''}:${combatEngagementId ?? ''}`

  return (
    <div key={transitionKey} className="view-transition">
      {scene}
    </div>
  )
}

function App() {
  useGameClock()
  useShipOrderSettler()
  useShipDriftIntegrator()
  // Resolves every active engagement independent of which view is mounted —
  // a battle in another system happens whether or not anyone is watching it.
  useCombatResolver()

  return (
    <div id="app-root">
      <header className="hud-bar hud-top">
        <span className="hud-title">TERRA RELICTA: CONQUEST</span>
        <div className="hud-top-right">
          <LockOnToggle />
          <Breadcrumb />
        </div>
      </header>

      <ActiveScene />

      <NavBar />
      <Outliner />
      {/* Dev-only spawn tool — import.meta.env.DEV is a compile-time
          constant Vite replaces with `false` in production builds, so this
          branch (and the whole DebugConsole module) is dead-code-eliminated
          out of what ships to players, not just hidden at runtime. */}
      {import.meta.env.DEV && <DebugConsole />}

      <footer className="hud-bar hud-bottom">
        <div className="hud-bottom-left">
          <ChatPlaceholder />
          <TimeControls />
        </div>
        <LocationLabel />
      </footer>
    </div>
  )
}

export default App
