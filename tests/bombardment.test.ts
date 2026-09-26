// Verification of orbital bombardment: who may bombard, where the damage goes,
// shields, devastation (and its toll on both economies), full bombardment.
// Run:  npx tsx tests/bombardment.test.ts

import { DEFENSE_DEFS, DEVASTATION_DECAY_PER_DAY, type BombardStance } from '../src/data/defenseData'
import { UNIT_TYPES } from '../src/data/groundData'
import { seedBodyOwners } from '../src/scene/territory'
import { atWar, useDiplomacyStore } from '../src/state/diplomacyStore'
import { bombardmentStep, canBombard, type BombardShip } from '../src/scene/bombardment'
import { placeInstallation, type Installation } from '../src/scene/defenseLogic'
import { groundSurface } from '../src/scene/groundLogic'
import { nodePoint } from '../src/scene/surfaceMesh'
import type { Army } from '../src/scene/armyLogic'
import { abstractReport, emptyStockpile, type AbstractEconomyState, type WorldState } from '../src/economy-abstract/abstractEconomy'
import { useEconomyStore } from '../src/state/economyStore'
import { tickEconomy } from '../src/economy/economyTick'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const MARS = 'imperial-state-of-mars'
const VENUS = 'republic-of-venus'
const ORION = 'orion-republic'
const owners = seedBodyOwners()
useDiplomacyStore.getState().reset()
useDiplomacyStore.getState().forceWar(MARS, VENUS, 0)
const venus = groundSurface('Venus', owners)!

const ship = (id: string, ownerId: string, stance: BombardStance, bodyName = 'Venus', weapons = 4, armed = true): BombardShip => ({ id, ownerId, bodyName, armed, weapons, stance })
const bat = (): Installation => ({ id: 'b', bodyName: 'Venus', kind: 'defenseBattery', node: placeInstallation(venus, [], 'defenseBattery')!, integrity: DEFENSE_DEFS.defenseBattery.integrity, builtBy: VENUS, readySimDays: 0 })
const shield = (): Installation => ({ id: 's', bodyName: 'Venus', kind: 'shieldGenerator', node: placeInstallation(venus, [bat()], 'shieldGenerator')!, integrity: DEFENSE_DEFS.shieldGenerator.integrity, builtBy: VENUS, readySimDays: 0 })
const garrison = (): Army => {
  const max = UNIT_TYPES.infantry.maxStrength
  const node = venus.keySlots[0].node
  return { id: 'g', ownerId: VENUS, kind: 'garrison', units: [{ id: 'gu', type: 'infantry', strength: max, maxStrength: max, position: nodePoint(node), path: [], nodeHint: node, stillSinceStep: 0 }], location: { kind: 'body', bodyName: 'Venus' } }
}
const step = (ships: BombardShip[], installations: Installation[] = [], armies: Army[] = [], devastation: Record<string, number> = {}, days = 1) =>
  bombardmentStep({ days, simDays: 10, ships, installations, armies, devastation, owners, controllers: {}, holders: {}, atWar })

console.log('=== 1. Who may bombard ===')
{
  check('at war, orbit clear: yes', canBombard(MARS, 'Venus', [ship('m', MARS, 'limited')], owners, {}, atWar))
  check('not at war: no', !canBombard(ORION, 'Venus', [ship('o', ORION, 'limited')], owners, {}, atWar))
  check('enemy warships in orbit: no', !canBombard(MARS, 'Venus', [ship('m', MARS, 'limited'), ship('v', VENUS, 'off')], owners, {}, atWar))
  check('an unarmed enemy hull does not contest it', canBombard(MARS, 'Venus', [ship('m', MARS, 'limited'), ship('t', VENUS, 'off', 'Venus', 0, false)], owners, {}, atWar))
  const idle = step([ship('m', MARS, 'off')], [bat()])
  check('ships on hold fire do nothing', idle.strikes.length === 0 && idle.installations[0].integrity === DEFENSE_DEFS.defenseBattery.integrity)
}

console.log('\n=== 2. Where the damage goes ===')
{
  const r = step([ship('m', MARS, 'limited')], [bat()], [garrison()])
  check('it strikes', r.strikes.length === 1 && r.strikes[0].damage === 4)
  check('defenses take a share', r.installations[0].integrity < DEFENSE_DEFS.defenseBattery.integrity)
  check('ground forces take a share', r.armies[0].units[0].strength < UNIT_TYPES.infantry.maxStrength)
  check('the world is devastated a little', (r.devastation['Venus'] ?? 0) > 0)
  const bare = step([ship('m', MARS, 'limited')])
  check('with no targets, all of it devastates the world', (bare.devastation['Venus'] ?? 0) > (r.devastation['Venus'] ?? 0))
  let inst = [bat()]
  let days = 0
  while (inst.length > 0 && days < 200) {
    inst = step([ship('m', MARS, 'limited')], inst).installations
    days++
  }
  check('sustained bombardment destroys a battery', inst.length === 0, `${days} days with one 4-gun ship`)
}

console.log('\n=== 3. Shields ===')
{
  const open = step([ship('m', MARS, 'limited')], [bat()])
  const shielded = step([ship('m', MARS, 'limited')], [bat(), shield()])
  check('a shield soaks most of it', shielded.strikes[0].shielded && shielded.strikes[0].damage < open.strikes[0].damage * 0.3)
}

console.log('\n=== 4. Devastation: grows, heals, hurts output ===')
{
  const hit = step([ship('m', MARS, 'full')], [], [], {}, 30)
  const dev = hit.devastation['Venus'] ?? 0
  check('a month of full bombardment devastates heavily', dev > 0.3, (dev * 100).toFixed(0) + '%')
  check('full bombardment kills population', (hit.popLoss['Venus'] ?? 0) > 0)
  check('limited does not', Object.keys(step([ship('m', MARS, 'limited')], [], [], {}, 30).popLoss).length === 0)
  const healed = step([], [], [], { Venus: 0.5 }, 30)
  check('devastation heals once the bombs stop', Math.abs((healed.devastation['Venus'] ?? 0) - (0.5 - 30 * DEVASTATION_DECAY_PER_DAY)) < 1e-9)
  check('...and fully heals away', step([], [], [], { Venus: 0.001 }, 30).devastation['Venus'] === undefined)
  // Simple mode: devastated worlds produce less.
  const nation: AbstractEconomyState = {
    countryId: 'x', population: 0, gdp: 1, realGdp: 1, priceLevel: 1, inflation: 0.02, stability: 0.5, treasury: 100, reserves: 0, debt: 0, taxRate: 0.1,
    economyType: 'corporatist', moneyCreation: 0, warTaxes: false, welfare: 0, allocation: { civilian: 0.5, military: 0.2, consumer: 0.3 }, researchFocus: 'physics',
    queue: [], nextOrderId: 1, currency: { code: 'X', name: 'X', rate: 1, baseRate: 1 }, trade: {},
  }
  const world: WorldState = { bodyName: 'Home', population: 2600, buildings: { factory: 12, farm: 6, mine: 4, powerPlant: 4 } }
  const st = { ...emptyStockpile(), minerals: 5000, energy: 5000 }
  const intact = abstractReport(nation, [world], st)
  const ruined = abstractReport(nation, [{ ...world, devastation: 1 }], st)
  check('Simple mode: a fully devastated world makes half as much', Math.abs(ruined.productionUnits / intact.productionUnits - 0.5) < 1e-6)
  // Complex mode: devastation cuts building output.
  const s0 = useEconomyStore.getState()
  const venusOwner = s0.worlds.find((w) => w.name === 'Venus')!.ownerId
  const run = (dev: number) => {
    const worlds = s0.worlds.map((w) => (w.name === 'Venus' ? { ...w, devastation: dev } : w))
    return tickEconomy(s0.countries, worlds, s0.corporations, { humanCountryIds: [], tick: 1, enableAI: false }, s0.banks).reports.countries[venusOwner].gdp
  }
  check('Complex mode: a devastated world produces less (GDP)', run(1) < run(0) * 0.9, `${run(0).toFixed(1)} → ${run(1).toFixed(1)}`)
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
