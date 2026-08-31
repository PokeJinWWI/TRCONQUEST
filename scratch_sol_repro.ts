import { SHIP_CLASSES } from './src/data/shipData'
import { pristineCombatState, type ShipInstance } from './src/state/shipStore'
import { syncEngagements, stepEngagements, COMBAT_STEP_DAYS } from './src/scene/combatResolution'

function makeShip(classId: string, id: string, allegiance: 'player' | 'hostile'): ShipInstance {
  const cls = SHIP_CLASSES.find((c) => c.id === classId)!
  return {
    id, classId, name: `${cls.name} ${id}`, allegiance,
    location: { kind: 'orbiting', systemId: 'sol', bodyName: 'Sol', periodDays: 20, phaseDeg: 0, inclinationDeg: 0 },
    order: null, hyperdriveReadySimDays: 0, warpReadySimDays: 0, warpEnabled: true, warpWhenReady: false,
    chaffAutoDeploy: true, pendingHyperdriveJump: null, followingShipId: null,
    combat: pristineCombatState(cls.combat), stance: 'balanced',
  }
}

function seededRng(seed: number) {
  let s = seed
  return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296 }
}

let ships: ShipInstance[] = [makeShip('corvette', 'e1', 'hostile'), makeShip('corvette', 'p1', 'player')]
let engagements = syncEngagements(ships, [], 0)
console.log(`initial: ${ships.length} ships, ${engagements.length} engagement(s)`)
console.log('obstacles:', JSON.stringify(engagements[0]?.obstacles))

const rng = seededRng(1)
let simDays = 0
let disengagedIds = new Set<string>()
for (let i = 0; i < 5000; i++) {
  simDays += COMBAT_STEP_DAYS
  const syncable = ships.filter((s) => !disengagedIds.has(s.id))
  engagements = syncEngagements(syncable, engagements, simDays)
  const result = stepEngagements(engagements, syncable, simDays, rng)
  engagements = result.engagements
  const before = ships.length
  ships = ships.filter((s) => !result.destroyedShipIds.includes(s.id)).map((s) => (result.shipCombat[s.id] ? { ...s, combat: result.shipCombat[s.id] } : s))
  for (const id of result.disengagedShipIds) disengagedIds.add(id)
  if (result.destroyedShipIds.length > 0) console.log(`step ${i}: destroyed=${result.destroyedShipIds.join(',')}, ${before}->${ships.length}`)
  if (result.disengagedShipIds.length > 0) console.log(`step ${i}: disengaged=${result.disengagedShipIds.join(',')}`)
  if (ships.length === 0) { console.log('ALL SHIPS GONE at step', i); break }
  if (engagements.length === 0 && ships.length > 0) {
    console.log(`engagement ended at step ${i}, ${ships.length} ships alive: ${ships.map(s=>s.id).join(',')}`)
    break
  }
}
console.log(`final: ${ships.length} ships remain (${ships.map(s => s.id).join(',')})`)
