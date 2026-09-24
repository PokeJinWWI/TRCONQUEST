import { useState } from 'react'
import { ARMY_KINDS, type ArmyKind } from '../data/armyData'
import { ARMY_SCENARIOS, type ArmyScenario } from '../data/armyScenarios'
import {
  SANDBOX_OWNER_BY_RELATION,
  SANDBOX_RELATIONS,
  SANDBOX_RELATION_LABELS,
  ownerDisplay,
  type SandboxRelation,
} from '../data/countryRoster'
import { SCENARIOS, SCENARIO_DIFFICULTY_LABELS, type Scenario } from '../data/scenarios'
import { SHIP_CLASSES, type ShipClass } from '../data/shipData'
import { STARS, getSystemStars } from '../data/starData'
import { currentScenarioOwners, loadArmyScenario, loadShipScenario } from '../scene/scenarioLoader'
import { clearSandboxArmies, clearSandboxShips, spawnSandboxArmy } from '../scene/sandboxSetup'
import { getMoonsForPlanet } from '../scene/moonData'
import { getPlanetsForStar } from '../scene/planetData'
import { spawnOwnedShip } from '../scene/shipyardLogic'
import { SOL_BODY_NAME, SOL_SYSTEM_ID } from '../scene/shipPhysics'
import { resolveShipClass } from '../state/shipClassResolver'
import { useArmyStore } from '../state/armyStore'
import { useGroundViewStore } from '../state/groundViewStore'
import { useShipDesignStore } from '../state/shipDesignStore'
import { useShipStore } from '../state/shipStore'
import { useDebugConsoleStore } from '../state/debugConsoleStore'
import { useViewStore } from '../state/viewStore'

// Only charted systems have anything to spawn near.
const SPAWNABLE_STARS = STARS.filter((s) => s.hasSystemData)

// How each relation reads in a button label ("Place your ships").
const RELATION_NOUNS: Record<SandboxRelation, string> = {
  own: 'your',
  friendly: 'friendly',
  neutral: 'neutral',
  hostile: 'hostile',
}

const RELATION_HINTS: Record<SandboxRelation, string> = {
  own: 'Yours — you command it.',
  friendly: 'Allied. Fights only the hostile.',
  neutral: 'Keeps to itself. Fights only the hostile.',
  hostile: 'Fights everyone: you, the friendly, the neutral.',
}

// The sandbox's own control window (Sandbox in the nav bar). There are no
// nations here: everything on the board is owned by one of four factions —
// yours, friendly, neutral, hostile (see data/countryRoster.ts) — and you put
// it there. Ships and armies of any of them, or a ready-made scenario.
export function SandboxPanel() {
  const [relation, setRelation] = useState<SandboxRelation>('own')
  const [classId, setClassId] = useState(SHIP_CLASSES[0].id)
  const [count, setCount] = useState(1)
  const [starId, setStarId] = useState(SOL_SYSTEM_ID)
  const [nearBody, setNearBody] = useState('Earth')
  const [armyKind, setArmyKind] = useState<ArmyKind>('assault')
  const [armyBody, setArmyBody] = useState('Earth')
  const [placement, setPlacement] = useState<'auto' | 'pick'>('auto')
  const [shipScenarioId, setShipScenarioId] = useState(SCENARIOS[0].id)
  const [armyScenarioId, setArmyScenarioId] = useState(ARMY_SCENARIOS[0]?.id ?? '')
  const [message, setMessage] = useState<string | null>(null)
  const designs = useShipDesignStore((s) => s.designs)
  const shipCount = useShipStore((s) => s.ships.length)
  const armyCount = useArmyStore((s) => s.armies.length)

  const ownerId = SANDBOX_OWNER_BY_RELATION[relation]
  const owner = ownerDisplay(ownerId)

  const spawnableClasses: ShipClass[] = [
    ...SHIP_CLASSES,
    ...designs.map((d) => resolveShipClass(`design:${d.id}`)).filter((c): c is ShipClass => !!c),
  ]
  // Every real star in the system plus its planets — anything a ship can orbit.
  const orbitable = [...getSystemStars(starId).map((c) => c.name), ...getPlanetsForStar(starId).map((p) => p.name)]
  // Every planet and moon — anything with ground to stand on.
  const groundBodies = getPlanetsForStar(starId).flatMap((p) => [p.name, ...getMoonsForPlanet(p.name).moons.map((m) => m.name)])
  const armyBodyChoice = groundBodies.includes(armyBody) ? armyBody : groundBodies[0] ?? ''

  const handleSystem = (next: string) => {
    setStarId(next)
    setNearBody(getSystemStars(next)[0]?.name ?? SOL_BODY_NAME)
    setArmyBody(getPlanetsForStar(next)[0]?.name ?? '')
  }

  const handleSpawnShips = () => {
    let spawned = 0
    for (let i = 0; i < count; i++) if (spawnOwnedShip(classId, ownerId, starId, nearBody)) spawned++
    setMessage(spawned > 0 ? `${spawned} × ${resolveShipClass(classId)?.name ?? 'ship'} (${SANDBOX_RELATION_LABELS[relation]}) placed at ${nearBody}` : 'Could not place a ship')
  }

  const handleSpawnArmy = () => {
    if (!armyBodyChoice) return
    if (placement === 'pick') {
      useGroundViewStore.getState().setMode({ kind: 'spawn', ownerId, armyKind })
      useViewStore.getState().enterGround(armyBodyChoice)
      setMessage('Click the ground to place it')
      return
    }
    const id = spawnSandboxArmy(ownerId, armyKind, armyBodyChoice)
    setMessage(id ? `${ARMY_KINDS[armyKind].name} (${SANDBOX_RELATION_LABELS[relation]}) placed on ${armyBodyChoice}` : `No room on ${armyBodyChoice}`)
  }

  const handleLoadShipScenario = () => {
    const scenario = SCENARIOS.find((s) => s.id === shipScenarioId)
    const owners = currentScenarioOwners()
    if (!scenario || !owners) return
    loadShipScenario(scenario, owners)
    setMessage(`Loaded ${scenario.name} — your ships against pirates at ${scenario.bodyName}`)
  }

  const handleLoadArmyScenario = () => {
    const scenario = ARMY_SCENARIOS.find((s) => s.id === armyScenarioId)
    const owners = currentScenarioOwners()
    if (!scenario || !owners) return
    const r = loadArmyScenario(scenario, owners)
    setMessage(r.ok ? `Loaded ${scenario.name} on ${r.bodyName} — your armies against pirates` : r.reason)
  }

  const shipScenario: Scenario | undefined = SCENARIOS.find((s) => s.id === shipScenarioId)
  const armyScenario: ArmyScenario | undefined = ARMY_SCENARIOS.find((s) => s.id === armyScenarioId)

  return (
    <div className="sandbox-panel">
      <div className="inspect-status">
        No nations here — only who's yours, and who's friendly, neutral or hostile to you. Pick which, then place them.
      </div>

      <div className="sandbox-relations">
        {SANDBOX_RELATIONS.map((r) => (
          <button
            key={r}
            type="button"
            className={`combat-density-btn sandbox-relation-btn${relation === r ? ' active' : ''}`}
            style={relation === r ? { borderColor: ownerDisplay(SANDBOX_OWNER_BY_RELATION[r]).color, color: ownerDisplay(SANDBOX_OWNER_BY_RELATION[r]).color } : undefined}
            onClick={() => setRelation(r)}
          >
            {SANDBOX_RELATION_LABELS[r]}
          </button>
        ))}
      </div>
      <div className="inspect-status" style={{ color: owner.color }}>
        {RELATION_HINTS[relation]}
      </div>

      <div className="inspect-divider" />
      <div className="army-group-label">Ships</div>
      <select className="slot-select" aria-label="Ship class" value={classId} onChange={(e) => setClassId(e.target.value)}>
        {spawnableClasses.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <select className="slot-select" aria-label="System" value={starId} onChange={(e) => handleSystem(e.target.value)}>
        {SPAWNABLE_STARS.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      <select className="slot-select" aria-label="Orbiting" value={nearBody} onChange={(e) => setNearBody(e.target.value)}>
        {orbitable.map((name) => (
          <option key={name} value={name}>
            Orbiting {name}
          </option>
        ))}
      </select>
      <select className="slot-select" aria-label="Number of ships" value={count} onChange={(e) => setCount(Number(e.target.value))}>
        {[1, 2, 3, 5, 8].map((n) => (
          <option key={n} value={n}>
            {n} ship{n > 1 ? 's' : ''}
          </option>
        ))}
      </select>
      <button type="button" className="detail-view-btn sandbox-btn" onClick={handleSpawnShips}>
        Place {RELATION_NOUNS[relation]} ships
      </button>

      <div className="inspect-divider" />
      <div className="army-group-label">Armies</div>
      <select className="slot-select" aria-label="Army kind" value={armyKind} onChange={(e) => setArmyKind(e.target.value as ArmyKind)}>
        {(Object.keys(ARMY_KINDS) as ArmyKind[]).map((k) => (
          <option key={k} value={k}>
            {ARMY_KINDS[k].name}
          </option>
        ))}
      </select>
      <select className="slot-select" aria-label="Army world" value={armyBodyChoice} onChange={(e) => setArmyBody(e.target.value)}>
        {groundBodies.map((b) => (
          <option key={b} value={b}>
            On {b}
          </option>
        ))}
      </select>
      <select className="slot-select" aria-label="Army placement" value={placement} onChange={(e) => setPlacement(e.target.value as 'auto' | 'pick')}>
        <option value="auto">Auto (clear of everyone else)</option>
        <option value="pick">Pick on the ground map</option>
      </select>
      <button type="button" className="detail-view-btn sandbox-btn" onClick={handleSpawnArmy}>
        Place {RELATION_NOUNS[relation]} army
      </button>

      <div className="inspect-divider" />
      <div className="army-group-label">Scenarios</div>
      <div className="inspect-status">Your side against the pirates. Replaces what's on the board.</div>
      <select className="slot-select" aria-label="Ship scenario" value={shipScenarioId} onChange={(e) => setShipScenarioId(e.target.value)}>
        {(['easy', 'medium', 'hard'] as const).map((tier) => (
          <optgroup key={tier} label={`Ships — ${SCENARIO_DIFFICULTY_LABELS[tier]}`}>
            {SCENARIOS.filter((s) => s.difficulty === tier).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {shipScenario && <div className="inspect-status">{shipScenario.description}</div>}
      <button type="button" className="detail-view-btn sandbox-btn" onClick={handleLoadShipScenario}>
        Load ship scenario
      </button>
      <select className="slot-select sandbox-gap" aria-label="Army scenario" value={armyScenarioId} onChange={(e) => setArmyScenarioId(e.target.value)}>
        {(['easy', 'medium', 'hard'] as const).map((tier) => (
          <optgroup key={tier} label={`Armies — ${SCENARIO_DIFFICULTY_LABELS[tier]}`}>
            {ARMY_SCENARIOS.filter((s) => s.difficulty === tier).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {armyScenario && <div className="inspect-status">{armyScenario.description}</div>}
      <button type="button" className="detail-view-btn sandbox-btn" onClick={handleLoadArmyScenario}>
        Load army scenario
      </button>

      <div className="inspect-divider" />
      <div className="army-group-label">Cheats</div>
      <div className="inspect-status">Spawn anything, grant research, free research — also on the ` (backtick) key.</div>
      <button type="button" className="detail-view-btn sandbox-btn" onClick={() => useDebugConsoleStore.getState().toggle()}>
        Open cheats console
      </button>

      <div className="inspect-divider" />
      <div className="sandbox-clear">
        <button type="button" className="detail-view-btn sandbox-btn" disabled={shipCount === 0} onClick={clearSandboxShips}>
          Clear ships ({shipCount})
        </button>
        <button type="button" className="detail-view-btn sandbox-btn" disabled={armyCount === 0} onClick={clearSandboxArmies}>
          Clear armies ({armyCount})
        </button>
      </div>
      {message && <div className="inspect-status ok">{message}</div>}
    </div>
  )
}
