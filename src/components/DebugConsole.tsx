import { useEffect, useRef, useState } from 'react'
import { pristineCombatState, useShipStore } from '../state/shipStore'
import type { ShipClass } from '../data/shipData'
import { SHIP_CLASSES, describeFtlDrive } from '../data/shipData'
import { COUNTRIES } from '../data/countryData'
import { ROGUE_FACTIONS, SANDBOX_OWNER_BY_RELATION, SANDBOX_RELATIONS, SANDBOX_RELATION_LABELS } from '../data/countryRoster'
import { ARMY_KINDS, type ArmyKind } from '../data/armyData'
import { useArmyStore } from '../state/armyStore'
import { useGroundViewStore } from '../state/groundViewStore'
import { useViewStore } from '../state/viewStore'
import { getMoonsForPlanet } from '../scene/moonData'
import { resolveShipClass } from '../state/shipClassResolver'
import { useShipDesignStore } from '../state/shipDesignStore'
import { getPlanetsForStar } from '../scene/planetData'
import { STARS, getSystemStars } from '../data/starData'
import { SOL_SYSTEM_ID, SOL_BODY_NAME, DEFAULT_SHIP_ORBIT_PERIOD_DAYS } from '../scene/shipPhysics'
import { SCENARIOS, SCENARIO_DIFFICULTY_LABELS, type Scenario } from '../data/scenarios'
import { ARMY_SCENARIOS, type ArmyScenario } from '../data/armyScenarios'
import { currentScenarioOwners, loadArmyScenario, loadShipScenario } from '../scene/scenarioLoader'
import { usePlayerStore } from '../state/playerStore'
import { useDebugConsoleStore } from '../state/debugConsoleStore'
import { useTechStore } from '../state/techStore'
import type { TechCategory } from '../data/techData'

// Only charted systems (hasSystemData) have anything to spawn near.
const SPAWNABLE_STARS = STARS.filter((s) => s.hasSystemData)

// A small, fixed ring of starting orbital phases so ships spawned at the
// same body don't all start at the same point in their orbit — purely
// cosmetic, not physically meaningful.
const SPAWN_PHASE_OFFSETS_DEG = [0, 90, 180, 270]

// The owner choices for spawning: in a normal game your nation, the other
// nations and the no-nation factions; in the sandbox there are no nations, so
// just the four sandbox relations (blank = yours, like "Your nation").
function OwnerOptions({ sandbox, selectedCountryId }: { sandbox: boolean; selectedCountryId: string | null }) {
  if (sandbox) {
    return (
      <>
        <option value="">{SANDBOX_RELATION_LABELS.own}</option>
        {SANDBOX_RELATIONS.filter((r) => r !== 'own').map((r) => (
          <option key={r} value={SANDBOX_OWNER_BY_RELATION[r]}>
            {SANDBOX_RELATION_LABELS[r]}
          </option>
        ))}
      </>
    )
  }
  return (
    <>
      <option value="">Your nation</option>
      {COUNTRIES.filter((c) => c.id !== selectedCountryId).map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
      {/* No-nation factions — pirates fight everyone, friendly irregulars
          fight only pirates (see countryRoster). */}
      {ROGUE_FACTIONS.map((r) => (
        <option key={r.id} value={r.id}>
          {r.name} (no nation)
        </option>
      ))}
    </>
  )
}

// The spawn / scenario / research cheat console — toggled with the backtick
// key. Mounted at the call site (App.tsx) in dev builds, and in the SANDBOX in
// any build (cheats are the point of the sandbox). In a normal game it's gated
// behind `import.meta.env.DEV`, which Vite replaces with a literal `false` in
// production builds; the `sandbox` half is a runtime value, so this module
// ships in production, but it only ever renders once the sandbox is started.
export function DebugConsole() {
  const open = useDebugConsoleStore((s) => s.open)
  const setOpen = useDebugConsoleStore((s) => s.setOpen)
  const sandbox = usePlayerStore((s) => s.sandbox)
  const [classId, setClassId] = useState(SHIP_CLASSES[0].id)
  const [starId, setStarId] = useState(SOL_SYSTEM_ID)
  const [nearBody, setNearBody] = useState(SOL_BODY_NAME)
  // Which nation owns a spawned ship — blank means "the player's own".
  // Whether it fights anything is then purely whether that nation is at war
  // with whoever else is present (see state/shipRelations.ts).
  const [ownerChoice, setOwnerChoice] = useState<string>('')
  const [scenarioId, setScenarioId] = useState(SCENARIOS[0].id)
  const [armyScenarioId, setArmyScenarioId] = useState(ARMY_SCENARIOS[0]?.id ?? '')
  // Army spawning (see handleSpawnArmy).
  const [armyOwner, setArmyOwner] = useState<string>('')
  const [armyKind, setArmyKind] = useState<ArmyKind>('assault')
  const [armyBody, setArmyBody] = useState<string>('')
  const [armyPlacement, setArmyPlacement] = useState<'auto' | 'pick' | 'aboard'>('auto')
  const [armyMessage, setArmyMessage] = useState<string | null>(null)
  const [researchCategory, setResearchCategory] = useState<TechCategory>('physics')
  const [researchAmount, setResearchAmount] = useState(100)
  const spawnCounter = useRef(0)
  const ships = useShipStore((s) => s.ships)
  const spawnShip = useShipStore((s) => s.spawnShip)
  const removeShip = useShipStore((s) => s.removeShip)
  const designs = useShipDesignStore((s) => s.designs)
  const selectedCountryId = usePlayerStore((s) => s.selectedCountryId)
  const grantResearch = useTechStore((s) => s.grantResearch)
  const freeResearchMode = useTechStore((s) => s.freeResearchMode)
  const setFreeResearchMode = useTechStore((s) => s.setFreeResearchMode)

  // Every real star in the system (component stars for a multi-star system)
  // plus its planets — all valid bodies to spawn a ship orbiting.
  const spawnNearOptions = [...getSystemStars(starId).map((c) => c.name), ...getPlanetsForStar(starId).map((p) => p.name)]

  // Presets plus every custom design built in the Ship Designer's builder
  // (see FleetManagement.tsx) — resolveShipClass is what makes a design
  // resolvable at all once spawned, but the spawn picker itself still needs
  // its own merged list to OFFER them in the first place.
  const spawnableClasses: ShipClass[] = [
    ...SHIP_CLASSES,
    ...designs.map((d) => resolveShipClass(`design:${d.id}`)).filter((c): c is ShipClass => !!c),
  ]

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === '`') useDebugConsoleStore.getState().toggle()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])

  if (!open) return null

  // Every planet and moon in this system — anything with ground to stand on.
  const armyBodies = getPlanetsForStar(starId).flatMap((p) => [p.name, ...getMoonsForPlanet(p.name).moons.map((m) => m.name)])

  // Puts an army of any owner (a nation or a no-nation faction) on a world:
  // at a sensible spot, at a spot picked on the planetary map, or aboard the
  // selected troop transport. No cost, no rules — it's the console.
  const handleSpawnArmy = () => {
    const ownerId = armyOwner || selectedCountryId
    const body = armyBody || armyBodies[0]
    if (!ownerId || !body) return
    if (armyPlacement === 'aboard') {
      const { ships: all, selectedShipId } = useShipStore.getState()
      const transport = all.find((s) => s.id === selectedShipId)
      if (!transport || !resolveShipClass(transport.classId)?.armyCapacity) {
        setArmyMessage('Select a troop transport first')
        return
      }
      useArmyStore.getState().addArmy({ ownerId, kind: armyKind, location: { kind: 'embarked', shipId: transport.id } })
      setArmyMessage(`Loaded aboard ${transport.name}`)
      return
    }
    if (armyPlacement === 'pick') {
      useGroundViewStore.getState().setMode({ kind: 'spawn', ownerId, armyKind })
      useViewStore.getState().enterGround(body)
      setArmyMessage('Click the ground to place it')
      return
    }
    useArmyStore.getState().addArmy({ ownerId, kind: armyKind, location: { kind: 'body', bodyName: body } })
    setArmyMessage(`${ARMY_KINDS[armyKind].name} placed on ${body}`)
  }

  const handleSpawn = () => {
    const shipClass = resolveShipClass(classId)
    if (!shipClass) return
    const ownerId = ownerChoice || selectedCountryId
    if (!ownerId) return
    spawnCounter.current += 1
    const phaseDeg = SPAWN_PHASE_OFFSETS_DEG[(spawnCounter.current - 1) % SPAWN_PHASE_OFFSETS_DEG.length]
    spawnShip({
      id: `ship-${Date.now()}-${spawnCounter.current}`,
      classId: shipClass.id,
      name: `${shipClass.name} ${spawnCounter.current}`,
      ownerId,
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

  // Loads a pre-built ship fight — see src/data/scenarios.ts for what each
  // difficulty tier actually means and how it was verified, and
  // scene/scenarioLoader.ts for what loading one does.
  const handleLoadScenario = () => {
    const scenario = SCENARIOS.find((sc) => sc.id === scenarioId)
    const owners = currentScenarioOwners()
    if (!scenario || !owners) return
    loadShipScenario(scenario, owners)
  }

  // Loads a pre-built ground battle and opens the world's planetary map.
  const handleLoadArmyScenario = () => {
    const scenario = ARMY_SCENARIOS.find((sc) => sc.id === armyScenarioId)
    const owners = currentScenarioOwners()
    if (!scenario || !owners) return
    const r = loadArmyScenario(scenario, owners)
    setArmyMessage(r.ok ? `Loaded ${scenario.name} on ${r.bodyName}` : r.reason)
  }

  const selectedScenario: Scenario | undefined = SCENARIOS.find((sc) => sc.id === scenarioId)
  const selectedArmyScenario: ArmyScenario | undefined = ARMY_SCENARIOS.find((sc) => sc.id === armyScenarioId)

  return (
    <div className="debug-console">
      <div className="debug-console-header">
        {import.meta.env.DEV ? 'DEBUG CONSOLE' : 'CHEATS'}
        <span className="debug-console-badge">{import.meta.env.DEV ? 'DEV BUILD ONLY' : 'SANDBOX'}</span>
        <button type="button" className="debug-console-close" onClick={() => setOpen(false)} aria-label="Close">
          ×
        </button>
      </div>

      <div className="debug-console-body">
        <div className="debug-console-row">
          <label htmlFor="debug-ship-class">Ship class</label>
          <select id="debug-ship-class" value={classId} onChange={(e) => setClassId(e.target.value)}>
            {spawnableClasses.map((c) => (
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
          <label htmlFor="debug-owner">Owner</label>
          <select id="debug-owner" value={ownerChoice} onChange={(e) => setOwnerChoice(e.target.value)}>
            <OwnerOptions sandbox={sandbox} selectedCountryId={selectedCountryId} />
          </select>
        </div>

        <button type="button" className="debug-console-spawn-btn" onClick={handleSpawn}>
          Spawn Ship
        </button>

        <div className="debug-console-divider" />

        {/* Ground armies — any owner, onto any world with ground (in the
            system picked above), or aboard the selected transport. */}
        <div className="debug-console-row">
          <label htmlFor="debug-army-kind">Army</label>
          <select id="debug-army-kind" value={armyKind} onChange={(e) => setArmyKind(e.target.value as ArmyKind)}>
            {(Object.keys(ARMY_KINDS) as ArmyKind[]).map((k) => (
              <option key={k} value={k}>
                {ARMY_KINDS[k].name}
              </option>
            ))}
          </select>
        </div>
        <div className="debug-console-row">
          <label htmlFor="debug-army-body">On</label>
          <select id="debug-army-body" value={armyBody || armyBodies[0] || ''} onChange={(e) => setArmyBody(e.target.value)}>
            {armyBodies.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </div>
        <div className="debug-console-row">
          <label htmlFor="debug-army-owner">Owner</label>
          <select id="debug-army-owner" value={armyOwner} onChange={(e) => setArmyOwner(e.target.value)}>
            <OwnerOptions sandbox={sandbox} selectedCountryId={selectedCountryId} />
          </select>
        </div>
        <div className="debug-console-row">
          <label htmlFor="debug-army-placement">Place</label>
          <select id="debug-army-placement" value={armyPlacement} onChange={(e) => setArmyPlacement(e.target.value as 'auto' | 'pick' | 'aboard')}>
            <option value="auto">Auto (muster point, or a landing site)</option>
            <option value="pick">Pick on the ground map</option>
            <option value="aboard">Aboard the selected transport</option>
          </select>
        </div>
        <button type="button" className="debug-console-spawn-btn" onClick={handleSpawnArmy}>
          Spawn Army
        </button>
        {armyMessage && <div className="debug-console-note">{armyMessage}</div>}

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

        {/* Ground battles on Earth's unowned ground, same tiers — see
            armyScenarios.ts. Replaces every army on the board. */}
        <div className="debug-console-row">
          <label htmlFor="debug-army-scenario">Army scenario</label>
          <select id="debug-army-scenario" value={armyScenarioId} onChange={(e) => setArmyScenarioId(e.target.value)}>
            {(['easy', 'medium', 'hard'] as const).map((tier) => (
              <optgroup key={tier} label={SCENARIO_DIFFICULTY_LABELS[tier]}>
                {ARMY_SCENARIOS.filter((sc) => sc.difficulty === tier).map((sc) => (
                  <option key={sc.id} value={sc.id}>
                    {sc.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        {selectedArmyScenario && <div className="debug-console-scenario-desc">{selectedArmyScenario.description}</div>}

        <button type="button" className="debug-console-spawn-btn" onClick={handleLoadArmyScenario}>
          Load Army Scenario
        </button>

        <div className="debug-console-divider" />

        {/* Research points have no real income yet (see techStore.ts — the
            same honest "no production system exists" situation as the top
            HUD's resourceData.ts). Granting directly here is the only way to
            test/play with the tech tree until the real economy produces it. */}
        <label className="debug-console-checkbox-row">
          <input type="checkbox" checked={freeResearchMode} onChange={(e) => setFreeResearchMode(e.target.checked)} />
          Free Research (all tech costs 0)
        </label>
        <div className="debug-console-row">
          <label htmlFor="debug-research-category">Grant research</label>
          <select id="debug-research-category" value={researchCategory} onChange={(e) => setResearchCategory(e.target.value as TechCategory)}>
            <option value="physics">Physics</option>
            <option value="society">Society</option>
            <option value="engineering">Engineering</option>
          </select>
        </div>
        <div className="debug-console-row">
          <label htmlFor="debug-research-amount">Amount</label>
          <input
            id="debug-research-amount"
            type="number"
            min={1}
            value={researchAmount}
            onChange={(e) => setResearchAmount(Math.max(1, Number(e.target.value) || 0))}
          />
        </div>
        <button
          type="button"
          className="debug-console-spawn-btn"
          disabled={!selectedCountryId}
          onClick={() => selectedCountryId && grantResearch(selectedCountryId, researchCategory, researchAmount)}
        >
          Grant Research
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
