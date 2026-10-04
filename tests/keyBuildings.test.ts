// Verification of the key-node buildings (scene/keyBuildings.ts), the nations'
// landmarks (data/landmarks.ts), a built Spaceport becoming a key node, and the
// Military district rule for defenses (state/defenseStore.canBuildDefense) in
// both economy modes.
// Run:  npx tsx tests/keyBuildings.test.ts

import { COUNTRIES } from '../src/data/countryData'
import { LANDMARKS } from '../src/data/landmarks'
import { DEFENSE_DEFS } from '../src/data/defenseData'
import { seedBodyOwners } from '../src/scene/territory'
import { groundSurface, musterNode } from '../src/scene/groundLogic'
import { withInstallationKeys, type Installation } from '../src/scene/defenseLogic'
import { keyBuildingsOf } from '../src/scene/keyBuildings'
import { keyNameOf } from '../src/scene/keyNames'
import { seedStartingDefenses } from '../src/scene/gameSetup'
import { canBuildDefense, militaryInUse, useDefenseStore } from '../src/state/defenseStore'
import { militarySlotsOf } from '../src/state/nationEconomy'
import { useResourceStore } from '../src/state/resourceStore'
import { useEconomyStore } from '../src/state/economyStore'
import { useAbstractEconomyStore } from '../src/state/abstractEconomyStore'
import { usePlayerStore } from '../src/state/playerStore'
import { buildingsInDistrict } from '../src/economy-abstract/abstractEconomy'
import { districtUsage } from '../src/economy/economyTick'

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
const owners = seedBodyOwners()

console.log('=== 1. Every key node is a building ===')
{
  for (const c of COUNTRIES) {
    const s = groundSurface(c.capitalBodyName, owners)!
    const keys = keyBuildingsOf(s, [], 0, owners, {})
    const settlements = s.keySlots.filter((k) => k.kind !== 'fortress')
    check(`${c.capitalBodyName}: every key node has its building`, settlements.every((k) => keys.some((b) => b.node === k.node)), keys.map((b) => b.name).join(', '))
    const seat = keys.find((b) => b.kind === 'seat')
    check(`${c.capitalBodyName}: the seat is ${LANDMARKS[c.id].seat.name}`, seat?.name === LANDMARKS[c.id].seat.name)
    check(`${c.capitalBodyName}: its other landmarks stand at the capital`, LANDMARKS[c.id].others.every((m) => keys.some((b) => b.kind === 'landmark' && b.name === m.name && b.node === seat?.node)))
    check(`${c.capitalBodyName}: nothing is captured at peace`, keys.every((b) => !b.captured && b.holder === c.id))
  }
  const mars = keyBuildingsOf(groundSurface('Mars', owners)!, [], 0, owners, {})
  check('Mars: the Imperial Palace and the Imperial Diet Building', ['Imperial Palace of Mars', 'Imperial Diet Building'].every((n) => mars.some((b) => b.name === n)))
  check('a city’s building is its Municipal Government Building', mars.some((b) => b.kind === 'cityHall' && / Municipal Government Building$/.test(b.name)), mars.find((b) => b.kind === 'cityHall')?.name)
  const phobos = keyBuildingsOf(groundSurface('Phobos', owners)!, [], 0, owners, {})
  check('an outpost’s building is its station', phobos.length === 1 && phobos[0].kind === 'outpostStation', phobos.map((b) => b.name).join())
}

console.log('\n=== 2. Capture follows the node ===')
{
  const s = groundSurface('Mars', owners)!
  const capital = s.keySlots.find((k) => k.kind === 'capital')!
  const keys = keyBuildingsOf(s, [], 0, owners, { Mars: { [capital.node]: VENUS } })
  const atCapital = keys.filter((b) => b.node === capital.node)
  check('taking the capital node captures the palace and every landmark there', atCapital.length === 2 && atCapital.every((b) => b.captured && b.holder === VENUS))
  check('...and nothing else', keys.filter((b) => b.node !== capital.node).every((b) => !b.captured))
}

console.log('\n=== 3. A new Spaceport is a key node ===')
{
  const s = groundSurface('Phobos', owners)!
  check('Phobos has no spaceport to begin with', !s.keySlots.some((k) => k.kind === 'spaceport'))
  const port: Installation = { id: 'p', bodyName: 'Phobos', kind: 'spaceport', node: s.keySlots[0].node === 1 ? 2 : 1, integrity: DEFENSE_DEFS.spaceport.integrity, builtBy: MARS, readySimDays: 60 }
  const building = keyBuildingsOf(s, [port], 10, owners, {})
  check('while it’s built it shows, but adds no key node', building.some((b) => b.kind === 'spaceport' && b.building) && !withInstallationKeys(s, [port], 10).keySlots.some((k) => k.kind === 'spaceport'))
  const live = withInstallationKeys(s, [port], 60)
  check('once ready it is the world’s spaceport key node', live.keySlots.some((k) => k.kind === 'spaceport' && k.node === port.node))
  check('...where new armies muster', musterNode(live) === port.node)
  check('...named for the settlement', /Spaceport$/.test(keyNameOf(live, { node: port.node, kind: 'spaceport' }).label), keyNameOf(live, { node: port.node, kind: 'spaceport' }).label)
  const mars = groundSurface('Mars', owners)!
  const extra: Installation = { ...port, bodyName: 'Mars', node: 5 }
  check('a world that has a spaceport gets no second one', withInstallationKeys(mars, [extra], 60).keySlots.filter((k) => k.kind === 'spaceport').length === 1)
}

console.log('\n=== 4. Starting fortresses are the nations’ landmarks ===')
{
  useDefenseStore.setState({ installations: [] })
  seedStartingDefenses(0)
  const start = useDefenseStore.getState().installations
  check('each capital’s fortress carries its landmark name', COUNTRIES.every((c) => start.some((i) => i.bodyName === c.capitalBodyName && i.kind === 'fortress' && i.name === LANDMARKS[c.id].fortress.name)))
  const mars = withInstallationKeys(groundSurface('Mars', owners)!, start, 0)
  const fort = mars.keySlots.find((k) => k.kind === 'fortress')!
  check('Olympus Castle is the name of Mars’s fortress key node', keyNameOf(mars, fort).label === 'Olympus Castle')
}

console.log('\n=== 5. Defenses need a Military district slot (both modes) ===')
for (const mode of ['complex', 'abstract'] as const) {
  usePlayerStore.setState({ economyModel: mode })
  useDefenseStore.setState({ installations: [] })
  seedStartingDefenses(0)
  useResourceStore.getState().setAmount(VENUS, 'alloys', 10000)
  useResourceStore.getState().setAmount(VENUS, 'energy', 10000)
  for (const k of ['fortress', 'shieldGenerator', 'defenseBattery'] as const) for (const r of Object.keys(DEFENSE_DEFS[k].cost)) useResourceStore.getState().setAmount(VENUS, r as 'alloys', 10000)
  const label = mode === 'complex' ? 'Complex' : 'Simple'
  const inUse = () => (mode === 'complex' ? districtUsage(useEconomyStore.getState().worlds.find((w) => w.name === 'Venus')!).military : buildingsInDistrict(useAbstractEconomyStore.getState().worlds.Venus, 'military'))
  check(`${label}: the capital starts with a Military level holding its fortress and battery`, militarySlotsOf('Venus') > 0 && militaryInUse('Venus', useDefenseStore.getState().installations) === 2)
  check(`${label}: the economy counts them in the Military district`, inUse() === 2, `${inUse()}`)
  // Fill the district, then one more is refused.
  let built = 0
  for (const kind of ['defenseBattery', 'defenseBattery', 'shieldGenerator', 'fortress'] as const) {
    if (militaryInUse('Venus', useDefenseStore.getState().installations) >= militarySlotsOf('Venus')) break
    if (useDefenseStore.getState().build(VENUS, 'Venus', kind, 0).ok) built++
  }
  const full = militaryInUse('Venus', useDefenseStore.getState().installations) >= militarySlotsOf('Venus')
  const refused = canBuildDefense(VENUS, 'Venus', 'shieldGenerator', useDefenseStore.getState().installations)
  check(`${label}: a full (or per-world-capped) district refuses more`, !refused.ok && /Military|At most/.test((refused as { reason: string }).reason), `${built} built, ${full ? 'full' : 'capped'}: ${(refused as { reason?: string }).reason}`)
  check(`${label}: a spaceport needs no Military slot (and Venus has one)`, !canBuildDefense(VENUS, 'Venus', 'spaceport', useDefenseStore.getState().installations).ok && /already has a spaceport/.test((canBuildDefense(VENUS, 'Venus', 'spaceport', useDefenseStore.getState().installations) as { reason: string }).reason))
  // Destroyed defenses free their slots.
  useDefenseStore.getState().setInstallations(useDefenseStore.getState().installations.map((i) => (i.bodyName === 'Venus' ? { ...i, integrity: 0 } : i)))
  check(`${label}: destroyed defenses free their slots`, militaryInUse('Venus', useDefenseStore.getState().installations) === 0 && inUse() === 0)
}
usePlayerStore.setState({ economyModel: 'complex' })

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
