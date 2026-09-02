import { useRef } from 'react'
import { ActionBar } from './components/ActionBar'
import { Breadcrumb } from './components/Breadcrumb'
import { ChatPlaceholder } from './components/ChatPlaceholder'
import { DebugConsole } from './components/DebugConsole'
import { LocationLabel } from './components/LocationLabel'
import { LockOnToggle } from './components/LockOnToggle'
import { MainMenu } from './components/MainMenu'
import { NavBar } from './components/NavBar'
import { Outliner } from './components/Outliner'
import { ResourceBar } from './components/ResourceBar'
import { FiscalIndicators } from './components/FiscalIndicators'
import { ConfirmDialog } from './components/ConfirmDialog'
import { TimeControls } from './components/TimeControls'
import { useGameClock } from './hooks/useGameClock'
import { useHudBarLayout } from './hooks/useHudBarLayout'
import { useShipOrderSettler } from './hooks/useShipOrderSettler'
import { useEscapeBehavior } from './hooks/useEscapeBehavior'
import { useShipDriftIntegrator } from './hooks/useShipDriftIntegrator'
import { useCombatResolver } from './hooks/useCombatResolver'
import { useEconomyTick } from './hooks/useEconomyTick'
import { CombatViewScene } from './scene/CombatViewScene'
import { GalacticViewScene } from './scene/GalacticViewScene'
import { InterstellarScene } from './scene/InterstellarScene'
import { SatelliteViewScene } from './scene/SatelliteViewScene'
import { SolarSystemScene } from './scene/SolarSystemScene'
import { useViewStore } from './state/viewStore'
import { usePlayerStore } from './state/playerStore'
import './App.css'

function ActiveScene() {
  const level = useViewStore((s) => s.level)
  const selectedNeighborhoodId = useViewStore((s) => s.selectedNeighborhoodId)
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
  const transitionKey = `${level}:${selectedNeighborhoodId}:${selectedStarId}:${selectedBodyName ?? ''}:${combatEngagementId ?? ''}`

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
  useEscapeBehavior()
  // Resolves every active engagement independent of which view is mounted —
  // a battle in another system happens whether or not anyone is watching it.
  useCombatResolver()
  // Advances the planetary economy simulation off the game clock.
  useEconomyTick()

  const topBarRef = useRef<HTMLElement>(null)
  const bottomBarRef = useRef<HTMLElement>(null)
  // Publishes the bars' real (content-driven, wrap-aware) heights as CSS
  // vars so Outliner/NavBar/DebugConsole can dock flush against them instead
  // of guessing a fixed pixel offset — see the hook's own comment for why a
  // guess drifts out of sync.
  useHudBarLayout(topBarRef, bottomBarRef)

  const selectedCountryId = usePlayerStore((s) => s.selectedCountryId)
  if (!selectedCountryId) return <MainMenu />

  return (
    <div id="app-root">
      <header ref={topBarRef} className="hud-bar hud-top">
        <span className="hud-title">TERRA RELICTA: CONQUEST</span>
        <FiscalIndicators />
        <ResourceBar />
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

      <footer ref={bottomBarRef} className="hud-bar hud-bottom">
        <div className="hud-bottom-left">
          <ChatPlaceholder />
          <TimeControls />
        </div>
        <ActionBar />
        <LocationLabel />
      </footer>
      <ConfirmDialog />
    </div>
  )
}

export default App
