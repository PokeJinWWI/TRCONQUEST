import { useEffect, useRef, useState } from 'react'
import { pristineCombatState, useShipStore } from '../state/shipStore'
import type { FleetAllegiance } from '../data/shipData'
import { SHIP_CLASSES, ALLEGIANCE_LABELS, describeFtlDrive } from '../data/shipData'
import { getPlanetsForStar } from '../scene/planetData'
import { STARS, getSystemStars } from '../data/starData'
import { SOL_SYSTEM_ID, SOL_BODY_NAME, DEFAULT_SHIP_ORBIT_PERIOD_DAYS } from '../scene/shipPhysics'
import { SCENARIOS, SCENARIO_DIFFICULTY_LABELS, type Scenario } from '../data/scenarios'

const ALLEGIANCE_OPTIONS = Object.keys(ALLEGIANCE_LABELS) as FleetAllegiance[]

// Only charted systems (hasSystemData) have anything to spawn near.
const SPAWNABLE_STARS = STARS.filter((s) => s.hasSystemData)

// A small, fixed ring of starting orbital phases so ships spawned at the
// same body don't all start at the same point in their orbit — purely
// cosmetic, not physically meaningful.
const SPAWN_PHASE_OFFSETS_DEG = [0, 90, 180, 270]

// Dev-only ship-spawning tool — toggled with the backtick key. Gated at the
// call site (App.tsx) behind `import.meta.env.DEV`, which Vite replaces
// with a literal `false` in production builds; dead-code elimination then
// strips this whole module (and everything it imports) out of what ships
// to players, not just hides it in the running page. Toggling it open
// doesn't need to be a secret since it can't exist in a production bundle.
export function DebugConsole() {
  const [open, setOpen] = useState(false)
  const [classId, setClassId] = useState(SHIP_CLASSES[0].id)
  const [starId, setStarId] = useState(SOL_SYSTEM_ID)
  const [nearBody, setNearBody] = useState(SOL_BODY_NAME)
  const [allegiance, setAllegiance] = useState<FleetAllegiance>('player')
  const [scenarioId, setScenarioId] = useState(SCENARIOS[0].id)
  const spawnCounter = useRef(0)
  const ships = useShipStore((s) => s.ships)
  const spawnShip = useShipStore((s) => s.spawnShip)
  const removeShip = useShipStore((s) => s.removeShip)

  // Every real star in the system (component stars for a multi-star system)
  // plus its planets — all valid bodies to spawn a ship orbiting.
  const spawnNearOptions = [...getSystemStars(starId).map((c) => c.name), ...getPlanetsForStar(starId).map((p) => p.name)]

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === '`') setOpen((o) => !o)
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])

  if (!open) return null

  const handleSpawn = () => {
    const shipClass = SHIP_CLASSES.find((c) => c.id === classId)
    if (!shipClass) return
    spawnCounter.current += 1
    const phaseDeg = SPAWN_PHASE_OFFSETS_DEG[(spawnCounter.current - 1) % SPAWN_PHASE_OFFSETS_DEG.length]
    spawnShip({
      id: `ship-${Date.now()}-${spawnCounter.current}`,
      classId: shipClass.id,
      name: `${shipClass.name} ${spawnCounter.current}`,
      allegiance,
      location: {
        kind: 'orbiting',
        systemId: starId,
        bodyName: nearBody,
        periodDays: DEFAULT_SHIP_ORBIT_PERIOD_DAYS,
        phaseDeg,
        inclinationDeg: 0,
      },
      order: null,
      hyperdriveReadySimDays: 0,
      warpReadySimDays: 0,
      warpEnabled: true,
      warpWhenReady: false,
      chaffAutoDeploy: true,
      pendingHyperdriveJump: null,
      followingShipId: null,
      combat: pristineCombatState(shipClass.combat),
      stance: 'balanced',
    })
  }

  // Loads a pre-built fight — see src/data/scenarios.ts for what each
  // difficulty tier actually means and how it was verified. Clears every
  // ship currently on the board first: a scenario is meant to be a clean,
  // reproducible test bed, and a leftover ship from an earlier manual spawn
  // (or a previous scenario) would silently change the fight without it
  // being obvious why the outcome doesn't match what was verified.
  const handleLoadScenario = () => {
    const scenario = SCENARIOS.find((sc) => sc.id === scenarioId)
    if (!scenario) return
    for (const ship of ships) removeShip(ship.id)
    scenario.ships.forEach((spec, i) => {
      const shipClass = SHIP_CLASSES.find((c) => c.id === spec.classId)
      if (!shipClass) return
      spawnCounter.current += 1
      const phaseDeg = SPAWN_PHASE_OFFSETS_DEG[i % SPAWN_PHASE_OFFSETS_DEG.length]
      spawnShip({
        id: `ship-${Date.now()}-${spawnCounter.current}`,
        classId: shipClass.id,
        name: `${shipClass.name} ${spawnCounter.current}`,
        allegiance: spec.allegiance,
        location: {
          kind: 'orbiting',
          systemId: SOL_SYSTEM_ID,
          bodyName: scenario.bodyName,
          periodDays: DEFAULT_SHIP_ORBIT_PERIOD_DAYS,
          phaseDeg,
          inclinationDeg: 0,
        },
        order: null,
        hyperdriveReadySimDays: 0,
        warpReadySimDays: 0,
        warpEnabled: true,
        warpWhenReady: false,
        chaffAutoDeploy: true,
        pendingHyperdriveJump: null,
        followingShipId: null,
        combat: pristineCombatState(shipClass.combat),
        // Medium scenarios bake the WINNING stance in here directly (see
        // scenarios.ts) — loading one starts already-tuned, since the point
        // is showing that one stance change flips the outcome, not making
        // the player rediscover which one from a cold default.
        stance: spec.stance ?? 'balanced',
      })
    })
  }

  const selectedScenario: Scenario | undefined = SCENARIOS.find((sc) => sc.id === scenarioId)

  return (
    <div className="debug-console">
      <div className="debug-console-header">
        DEBUG CONSOLE
        <span className="debug-console-badge">DEV BUILD ONLY</span>
        <button type="button" className="debug-console-close" onClick={() => setOpen(false)} aria-label="Close">
          ×
        </button>
      </div>

      <div className="debug-console-body">
        <div className="debug-console-row">
          <label htmlFor="debug-ship-class">Ship class</label>
          <select id="debug-ship-class" value={classId} onChange={(e) => setClassId(e.target.value)}>
            {SHIP_CLASSES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} — {c.ftlDrives.map(describeFtlDrive).join(', ')}
              </option>
            ))}
          </select>
        </div>

        <div className="debug-console-row">
          <label htmlFor="debug-spawn-system">System</label>
          <select
            id="debug-spawn-system"
            value={starId}
            onChange={(e) => {
              const nextStarId = e.target.value
              setStarId(nextStarId)
              // Default to orbiting the system's primary star (a real
              // component, not the system's display name).
              setNearBody(getSystemStars(nextStarId)[0]?.name ?? SOL_BODY_NAME)
            }}
          >
            {SPAWNABLE_STARS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        <div className="debug-console-row">
          <label htmlFor="debug-spawn-near">Spawn near</label>
          <select id="debug-spawn-near" value={nearBody} onChange={(e) => setNearBody(e.target.value)}>
            {spawnNearOptions.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>

        <div className="debug-console-row">
          <label htmlFor="debug-allegiance">Allegiance</label>
          <select
            id="debug-allegiance"
            value={allegiance}
            onChange={(e) => setAllegiance(e.target.value as FleetAllegiance)}
          >
            {ALLEGIANCE_OPTIONS.map((a) => (
              <option key={a} value={a}>
                {ALLEGIANCE_LABELS[a]}
              </option>
            ))}
          </select>
        </div>

        <button type="button" className="debug-console-spawn-btn" onClick={handleSpawn}>
          Spawn Ship
        </button>

        <div className="debug-console-divider" />

        {/* Pre-built fights, grouped by what the built-in automation can do
            against them — see scenarios.ts's own header for exactly what
            each tier means and how the label was proven, not just picked. */}
        <div className="debug-console-row">
          <label htmlFor="debug-scenario">Scenario</label>
          <select id="debug-scenario" value={scenarioId} onChange={(e) => setScenarioId(e.target.value)}>
            {(['easy', 'medium', 'hard'] as const).map((tier) => (
              <optgroup key={tier} label={SCENARIO_DIFFICULTY_LABELS[tier]}>
                {SCENARIOS.filter((sc) => sc.difficulty === tier).map((sc) => (
                  <option key={sc.id} value={sc.id}>
                    {sc.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        {selectedScenario && <div className="debug-console-scenario-desc">{selectedScenario.description}</div>}

        <button type="button" className="debug-console-spawn-btn" onClick={handleLoadScenario}>
          Load Scenario
        </button>

        <div className="debug-console-divider" />

        <div className="debug-console-ship-list">
          {ships.length === 0 ? (
            <div className="debug-console-empty">No ships spawned</div>
          ) : (
            ships.map((ship) => (
              <div key={ship.id} className="debug-console-ship-row">
                <span>{ship.name}</span>
                <button type="button" onClick={() => removeShip(ship.id)} aria-label={`Remove ${ship.name}`}>
                  ×
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
