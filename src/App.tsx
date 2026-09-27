import { useRef } from 'react'
import { ActionBar } from './components/ActionBar'
import { Breadcrumb } from './components/Breadcrumb'
import { HudCenterSwap } from './components/TabBar'
import { ChatPlaceholder } from './components/ChatPlaceholder'
import { DebugConsole } from './components/DebugConsole'
import { LocationLabel } from './components/LocationLabel'
import { LockOnToggle } from './components/LockOnToggle'
import { MainMenu } from './components/MainMenu'
import { NavBar } from './components/NavBar'
import { Outliner } from './components/Outliner'
import { FiscalIndicators } from './components/FiscalIndicators'
import { ConfirmDialog } from './components/ConfirmDialog'
import { EscapeMenu } from './components/EscapeMenu'
import { useKeyboardControls } from './hooks/useKeyboardControls'
import { DiplomacyToast } from './components/DiplomacyPanel'
import { TimeControls } from './components/TimeControls'
import { useGameClock } from './hooks/useGameClock'
import { useHudBarLayout } from './hooks/useHudBarLayout'
import { useShipOrderSettler } from './hooks/useShipOrderSettler'
import { useEscapeBehavior } from './hooks/useEscapeBehavior'
import { useShipDriftIntegrator } from './hooks/useShipDriftIntegrator'
import { useCombatResolver } from './hooks/useCombatResolver'
import { useGroundCombatResolver } from './hooks/useGroundCombatResolver'
import { useDefenseResolver } from './hooks/useDefenseResolver'
import { useBombardmentResolver } from './hooks/useBombardmentResolver'
import { useHoldingsResolver } from './hooks/useHoldingsResolver'
import { useCommsResolver } from './hooks/useCommsResolver'
import { useBattleTracker } from './hooks/useBattleTracker'
import { useShipyardResolver } from './hooks/useShipyardResolver'
import { useStrategicResources } from './hooks/useStrategicResources'
import { useGameSetup } from './hooks/useGameSetup'
import { useStrategicAI } from './hooks/useStrategicAI'
import { useEconomyTick } from './hooks/useEconomyTick'
import { CombatViewScene } from './scene/CombatViewScene'
import { GroundViewScene } from './scene/GroundViewScene'
import { GalacticViewScene } from './scene/GalacticViewScene'
import { InterstellarScene } from './scene/InterstellarScene'
import { TerrainViewScene } from './scene/TerrainViewScene'
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
  const terrainBattleId = useViewStore((s) => s.terrainBattleId)

  let scene = <SolarSystemScene />
  if (level === 'galactic') scene = <GalacticViewScene />
  else if (level === 'interstellar') scene = <InterstellarScene />
  else if (level === 'satellite' && selectedBodyName) {
    scene = <SatelliteViewScene bodyName={selectedBodyName} />
  } else if (level === 'combat' && combatEngagementId) {
    scene = <CombatViewScene engagementId={combatEngagementId} />
  } else if (level === 'ground' && selectedBodyName) {
    scene = <GroundViewScene bodyName={selectedBodyName} />
  } else if (level === 'terrain' && terrainBattleId) {
    scene = <TerrainViewScene battleId={terrainBattleId} />
  }

  // Keying on the full location forces a remount on every navigation change,
  // which retriggers the fade/scale-in animation below — a lightweight
  // "smooth transition" between view levels without needing to keep two
  // WebGL canvases alive at once.
  const transitionKey = `${level}:${selectedNeighborhoodId}:${selectedStarId}:${selectedBodyName ?? ''}:${combatEngagementId ?? ''}:${terrainBattleId ?? ''}`

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
  // Ground wars: invasions, occupations, recruits, and armies lost with their
  // transports — see scene/armyLogic.ts.
  useGroundCombatResolver()
  // Planetary defenses: batteries fire on hostile warships in orbit.
  useDefenseResolver()
  // Orbital bombardment of enemy worlds.
  useBombardmentResolver()
  // Foreign buildings: embassies and branch offices.
  useHoldingsResolver()
  // Fires strategic orders queued behind FTL comms delay once they arrive —
  // see commsVisual.ts / useCommsResolver's own comment.
  useCommsResolver()
  // Which battles the player is in — the Outliner's list and the combat
  // indicators on every map level.
  useBattleTracker()
  // Escape (menu) and Space (pause).
  useKeyboardControls()
  // The capital's shipyard, and the placeholder resource supply it builds from
  // — see data/shipyardData.ts.
  useShipyardResolver()
  useStrategicResources()
  // Every nation's starting navy and armies, once a nation is picked.
  useGameSetup()
  // The AI empires' strategic planning — see src/ai/coordinator.ts.
  useStrategicAI()
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
  const sandbox = usePlayerStore((s) => s.sandbox)
  if (!selectedCountryId) return <MainMenu />

  return (
    <div id="app-root">
      <header ref={topBarRef} className="hud-bar hud-top">
        <span className="hud-title">TERRA RELICTA: CONQUEST</span>
        <FiscalIndicators />
        <HudCenterSwap />
        <div className="hud-top-right">
          <LockOnToggle />
          <Breadcrumb />
        </div>
      </header>

      <ActiveScene />

      <NavBar />
      <Outliner />
      {/* The cheat console: dev builds always (import.meta.env.DEV is a
          compile-time constant Vite replaces with `false` in production, so
          that half is dead-code-eliminated there), and the sandbox in any
          build — cheats are what the sandbox is for. */}
      {(import.meta.env.DEV || sandbox) && <DebugConsole />}

      <footer ref={bottomBarRef} className="hud-bar hud-bottom">
        <div className="hud-bottom-left">
          <ChatPlaceholder />
          <TimeControls />
        </div>
        <ActionBar />
        <LocationLabel />
      </footer>
      <ConfirmDialog />
      <EscapeMenu />
      <DiplomacyToast />
    </div>
  )
}

export default App
