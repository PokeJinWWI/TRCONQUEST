import { useEffect, useRef, useState } from 'react'
import { pristineCombatState, useShipStore } from '../state/shipStore'
import type { FleetAllegiance } from '../data/shipData'
import { SHIP_CLASSES, ALLEGIANCE_LABELS, describeFtlDrive } from '../data/shipData'
import { PLANETS } from '../scene/planetData'
import { SOL_SYSTEM_ID, SOL_BODY_NAME, DEFAULT_SHIP_ORBIT_PERIOD_DAYS } from '../scene/shipPhysics'

const ALLEGIANCE_OPTIONS = Object.keys(ALLEGIANCE_LABELS) as FleetAllegiance[]

const SPAWN_NEAR_OPTIONS = [SOL_BODY_NAME, ...PLANETS.map((p) => p.name)]

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
  const [nearBody, setNearBody] = useState(SOL_BODY_NAME)
  const [allegiance, setAllegiance] = useState<FleetAllegiance>('player')
  const spawnCounter = useRef(0)
  const ships = useShipStore((s) => s.ships)
  const spawnShip = useShipStore((s) => s.spawnShip)
  const removeShip = useShipStore((s) => s.removeShip)

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
        systemId: SOL_SYSTEM_ID,
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
      pendingHyperdriveJump: null,
      followingShipId: null,
      combat: pristineCombatState(shipClass.combat),
    })
  }

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
          <label htmlFor="debug-spawn-near">Spawn near</label>
          <select id="debug-spawn-near" value={nearBody} onChange={(e) => setNearBody(e.target.value)}>
            {SPAWN_NEAR_OPTIONS.map((name) => (
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
