// A building belongs to a place (economy/buildingSites.ts, docs/territorial-design.md section 14): the same recipe in two places is two
// buildings, each with its own level; splitting and merging never change a total.
//
// Run:  npx tsx tests/buildingSites.test.ts
import { buildingKey, findBuilding, keyOfBuilding, levelAtSite, levelOf, mergeSites, splitBySites } from '../src/economy/buildingSites'
import type { Building } from '../src/economy/economyTypes'
import { resetGame } from '../src/scene/gameReset'
import { setUpNewGame } from '../src/scene/gameSetup'
import { ensureSeeded } from '../src/scene/seedPlacementOrders'
import { useEconomyStore, worldByName } from '../src/state/economyStore'
import { useGameTimeStore } from '../src/state/gameTimeStore'
import { usePlacementStore } from '../src/state/placementStore'
import { usePlayerStore } from '../src/state/playerStore'
import { useResourceStore } from '../src/state/resourceStore'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}
const mk = (id: string, recipeId: string, level: number, over: Partial<Building> = {}): Building => ({
  id, recipeId, methodId: 'm', methodLocked: false, level, owner: { kind: 'state' }, inventory: { steel: level * 10 } as Building['inventory'],
  throughput: 0.8, lastProfit: level * 5, employed: level * 100, jobsPosted: level * 120, ...over,
})
const sum = (bs: Building[], f: (b: Building) => number) => bs.reduce((n, b) => n + f(b), 0)

console.log('\n=== 1. Keys and lookups ===')
{
  const corp = { kind: 'corporation' as const, corporationId: 'c1' }
  check('the key separates recipe, owner and place', buildingKey('a', { kind: 'state' }, 'X#1') !== buildingKey('a', { kind: 'state' }, 'X#2') && buildingKey('a', { kind: 'state' }) !== buildingKey('a', corp) && buildingKey('a', { kind: 'state' }) === buildingKey('a', { kind: 'state' }, undefined))
  const list = [mk('1', 'factory', 2), mk('2', 'factory', 1, { siteId: 'X#1' }), mk('3', 'factory', 3, { siteId: 'X#2', owner: corp })]
  check('findBuilding picks by place', findBuilding(list, 'factory', { kind: 'state' })?.id === '1' && findBuilding(list, 'factory', { kind: 'state' }, 'X#1')?.id === '2' && findBuilding(list, 'factory', corp, 'X#2')?.id === '3' && !findBuilding(list, 'factory', corp))
  check('levelOf sums every place; levelAtSite one', levelOf(list, 'factory') === 6 && levelOf(list, 'factory', { kind: 'state' }) === 3 && levelAtSite(list, 'factory', 'X#2') === 3)
}

console.log('\n=== 2. Splitting by the ledger ===')
{
  const world = [mk('f', 'factory', 4), mk('c', 'clinic', 2), mk('m', 'mine', 1)]
  const ledger = { 'X#settlement-0': { factory: 2, clinic: 1 }, 'X#industrial-0': { factory: 2 }, 'X#resource-0': { mine: 3 } }
  const out = splitBySites(world, ledger)
  check('two places make two factory buildings of level 2', out.filter((b) => b.recipeId === 'factory').length === 2 && out.filter((b) => b.recipeId === 'factory').every((b) => b.level === 2 && b.siteId))
  check('a clinic with one unit placed leaves one unplaced', levelOf(out, 'clinic') === 2 && levelAtSite(out, 'clinic', 'X#settlement-0') === 1 && out.some((b) => b.recipeId === 'clinic' && !b.siteId && b.level === 1))
  check('a ledger larger than the level is capped at the level', levelOf(out, 'mine') === 1 && levelAtSite(out, 'mine', 'X#resource-0') === 1)
  for (const k of ['level', 'inventory', 'lastProfit', 'employed', 'jobsPosted'] as const) {
    const f = (b: Building) => (k === 'inventory' ? (b.inventory as Record<string, number>).steel ?? 0 : (b[k] as number))
    check(`${k} is shared out exactly`, Math.abs(sum(world, f) - sum(out, f)) < 1e-9, `${sum(world, f)} = ${sum(out, f)}`)
  }
  check('the output a month would make is unchanged (level x throughput)', Math.abs(sum(world, (b) => b.level * b.throughput) - sum(out, (b) => b.level * b.throughput)) < 1e-9)
  check('ids are unique', new Set(out.map((b) => b.id)).size === out.length)
  const byId = (bs: Building[]) => JSON.stringify([...bs].sort((a, b) => (a.id < b.id ? -1 : 1)))
  check('splitting twice changes nothing more', byId(splitBySites(out, ledger)) === byId(out))
  const back = mergeSites(out)
  check('merging gives the original levels and throughput back', back.length === 3 && back.every((b) => !b.siteId) && levelOf(back, 'factory') === 4 && Math.abs(sum(back, (b) => b.level * b.throughput) - sum(world, (b) => b.level * b.throughput)) < 1e-9)
}

console.log('\n=== 3. Owners keep their own buildings ===')
{
  const corp = { kind: 'corporation' as const, corporationId: 'c1' }
  const world = [mk('s', 'factory', 3), mk('p', 'factory', 2, { owner: corp })]
  const out = splitBySites(world, { 'X#a': { factory: 4 }, 'X#b': { factory: 1 } })
  check('the biggest building is dealt first and the totals per owner hold', levelOf(out, 'factory', { kind: 'state' }) === 3 && levelOf(out, 'factory', corp) === 2 && levelOf(out, 'factory') === 5)
  check('nothing is left unplaced when the ledger covers every level', out.every((b) => !!b.siteId))
}

console.log('\n=== 4. In a running Complex game ===')
{
  const MARS = 'imperial-state-of-mars'
  resetGame()
  usePlayerStore.setState({ selectedCountryId: MARS, sandbox: false, economyModel: 'complex' })
  setUpNewGame()
  const world = () => worldByName(useEconomyStore.getState().worlds, 'Mars')!
  const before = JSON.stringify(world().buildings.map((b) => [b.recipeId, b.level]).sort())
  ensureSeeded('Mars')
  check('the starting buildings of a seeded world are all placed, one building per place', world().buildings.every((b) => !!b.siteId) && new Set(world().buildings.map(keyOfBuilding)).size === world().buildings.length)
  const sumLevels = (bs: Building[]) => JSON.stringify(Object.entries(bs.reduce((m, b) => ({ ...m, [b.recipeId]: (m[b.recipeId] ?? 0) + b.level }), {} as Record<string, number>)).sort())
  check('...and the world has exactly the levels it had', sumLevels(world().buildings) === sumLevels(JSON.parse(before).map(([recipeId, level]: [string, number]) => ({ recipeId, level }))))
  // Room for a second urban level: a clinic in each of two places is two buildings.
  useEconomyStore.getState().setWorldLand('Mars', world().land + 10)
  for (const g of ['steel', 'alloys', 'machinery', 'tools', 'minerals', 'energy']) useResourceStore.getState().setAmount(MARS, g as never, 1e6)
  const lvl = useEconomyStore.getState().queueDistrict('Mars', 'urban', 'Mars#settlement-1')
  check('a district level can be queued at a chosen place', lvl.ok, lvl.ok ? '' : lvl.reason)
  let day = 1000
  const run = (months: number) => { for (let m = 0; m < months; m++) { day += 30; useGameTimeStore.setState({ simDays: day }); useEconomyStore.getState().advance(1) } }
  run(16)
  const clinicsBefore = world().buildings.filter((b) => b.recipeId === 'clinic')
  useEconomyStore.getState().queueConstruction('Mars', 'clinic', { kind: 'state' }, 'Mars#settlement-0')
  useEconomyStore.getState().queueConstruction('Mars', 'clinic', { kind: 'state' }, 'Mars#settlement-1')
  run(16)
  const clinics = world().buildings.filter((b) => b.recipeId === 'clinic')
  check('a clinic built in a second place is a second building', clinics.length === clinicsBefore.length + 1 && new Set(clinics.map((b) => b.siteId)).size === clinics.length, clinics.map((b) => `${b.siteId}:${b.level}`).join(' '))
  check('...and one built where a clinic stands raises that building\'s level', (clinics.find((b) => b.siteId === 'Mars#settlement-0')?.level ?? 0) === (clinicsBefore.find((b) => b.siteId === 'Mars#settlement-0')?.level ?? 0) + 1)
  check('the ledger agrees with the buildings at every site', clinics.every((b) => (usePlacementStore.getState().placed[b.siteId!]?.clinic ?? 0) === b.level))
}

if (failures > 0) {
  console.log(`\n${failures} FAILED`)
  process.exit(1)
}
console.log('\nAll buildingSites tests passed')
