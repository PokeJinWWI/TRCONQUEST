// District footprints (scene/footprint.ts pure, scene/footprintState.ts live): a developed site covers ground that grows with what
// stands on it, never reshuffles as it grows, never overlaps another site, stays on walkable land of its landmass, and only
// seeded bodies show it.
//
// Run:  npx tsx tests/footprint.test.ts
import { surfaceOf, terrainAt } from '../src/scene/planetTerrain'
import { locationsOf } from '../src/scene/locations'
import { applyFootprints, claimFootprints, footprintSize, growthOrder, type FootprintSite } from '../src/scene/footprint'
import { withFootprints } from '../src/scene/footprintState'
import { groundSurface } from '../src/scene/groundLogic'
import { resetGame } from '../src/scene/gameReset'
import { usePlayerStore } from '../src/state/playerStore'
import { usePlacementStore } from '../src/state/placementStore'
import { useTerritoryStore } from '../src/state/territoryStore'
import { TERRAIN } from '../src/data/groundData'
import { MAX_FOOTPRINT_CELLS } from '../src/data/footprintData'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const base = surfaceOf('Mars', 'world')
const sites = locationsOf('Mars').filter((s) => s.node !== null)
const industrial = sites.filter((s) => s.kind === 'industrial')
const settlements = sites.filter((s) => s.kind === 'settlement')
const asSites = (sizes: Record<string, number>): FootprintSite[] => sites.filter((s) => sizes[s.id]).map((s) => ({ id: s.id, kind: s.kind, node: s.node!, size: sizes[s.id] }))

console.log('\n=== 1. Size ===')
{
  check('nothing developed, no footprint', footprintSize('industrial', 0, 0) === 0)
  check('a level or a building covers at least a cell', footprintSize('industrial', 1, 0) >= 1 && footprintSize('industrial', 0, 1) >= 1)
  let monotone = true
  for (let l = 0; l < 10; l++) if (footprintSize('settlement', l + 1, l) < footprintSize('settlement', l, l)) monotone = false
  check('more levels, never fewer cells', monotone)
  check('people add to a settlement but not to a mine', footprintSize('settlement', 1, 0, 40) > footprintSize('settlement', 1, 0, 0) && footprintSize('resource', 1, 0, 40) === footprintSize('resource', 1, 0, 0))
  check('a footprint is capped', footprintSize('agricultural', 500, 500, 500) === MAX_FOOTPRINT_CELLS)
  check('a spaceport site covers no ground of its own', footprintSize('infrastructure', 3, 3) === 0)
}

console.log('\n=== 2. The order a site grows in ===')
{
  const node = industrial[0].node!
  const order = growthOrder(base, node)
  check('it starts at the site\'s own node', order[0] === node)
  check('every cell is walkable ground of the node\'s landmass', order.every((c) => base.landComponent[c] === base.landComponent[node] && TERRAIN[terrainAt(base, c)].passable === 'all'))
  check('no cell twice', new Set(order).size === order.length)
  check('it is the same order every time (deterministic, cached)', growthOrder(base, node) === order && JSON.stringify(growthOrder(surfaceOf('Mars', 'world'), node)) === JSON.stringify(order))
  check('it reaches far enough for the largest footprint', order.length >= MAX_FOOTPRINT_CELLS)
}

console.log('\n=== 3. Claiming ===')
{
  const all = Object.fromEntries(sites.map((s) => [s.id, 6]))
  const fps = claimFootprints(base, asSites(all))
  const seen = new Set<number>()
  let overlap = false
  for (const fp of fps) for (const c of fp.cells) (seen.has(c) ? (overlap = true) : seen.add(c))
  check('no cell belongs to two sites', !overlap)
  const nodes = new Set(sites.filter((s) => all[s.id]).map((s) => s.node!))
  check('a site\'s own node is in its own footprint', fps.every((fp) => fp.cells.includes(sites.find((s) => s.id === fp.siteId)!.node!)))
  check('and in nobody else\'s', fps.every((fp) => fp.cells.every((c) => !nodes.has(c) || sites.find((s) => s.node === c)!.id === fp.siteId)))
  check('each gets the size it asked for, the ground allowing', fps.every((fp) => fp.cells.length === 6))
  // Growth only adds: every footprint of size n is inside the footprint of size n+3 (alone on the map, so nothing competes).
  const solo = industrial[0]
  const small = claimFootprints(base, asSites({ [solo.id]: 5 }))[0].cells
  const big = claimFootprints(base, asSites({ [solo.id]: 12 }))[0].cells
  check('a footprint of 12 contains the footprint of 5, in the same order', big.length === 12 && small.every((c, i) => big[i] === c))
  const city = settlements[0]
  const fp = claimFootprints(base, asSites({ [city.id]: 10, [solo.id]: 10 }))
  const cityCells = fp.find((f) => f.siteId === city.id)!.cells
  check('a city keeps its ground whatever is built beside it (settlements claim first)', claimFootprints(base, asSites({ [city.id]: 10 }))[0].cells.every((c, i) => cityCells[i] === c))
  check('only a settlement spreads over urban ground', fp.filter((f) => f.kind !== 'settlement').every((f) => f.cells.every((c) => terrainAt(base, c) !== 'urban')))
}

console.log('\n=== 4. Drawing ===')
{
  const fps = claimFootprints(base, asSites({ [industrial[0].id]: 8, [sites.find((s) => s.kind === 'resource')!.id]: 5 }))
  const drawn = applyFootprints(base, fps)
  const industrialCells = fps.find((f) => f.kind === 'industrial')!.cells
  check('an industrial footprint turns its cells industrial', industrialCells.every((c) => terrainAt(drawn, c) === 'industrial'))
  check('a resource footprint turns its cells to mining', fps.find((f) => f.kind === 'resource')!.cells.every((c) => terrainAt(drawn, c) === 'mining'))
  let other = true
  const touched = new Set(fps.flatMap((f) => f.cells))
  for (let i = 0; i < base.terrain.length; i++) if (!touched.has(i) && drawn.terrain[i] !== base.terrain[i]) other = false
  check('every other cell is untouched', other)
  check('the base surface is not changed', industrialCells.every((c) => terrainAt(base, c) !== 'industrial'))
  check('key nodes and landmasses are shared', drawn.keySlots === base.keySlots && drawn.landComponent === base.landComponent)
  check('no footprints, the same surface back', applyFootprints(base, []) === base)
}

console.log('\n=== 5. In the live game ===')
{
  resetGame()
  usePlayerStore.setState({ selectedCountryId: 'imperial-state-of-mars', sandbox: false, economyModel: 'abstract' })
  const owners = useTerritoryStore.getState().bodyOwner
  const site = industrial[0]
  usePlacementStore.getState().addLevel(site.id, 'industrial', 2)
  const raw = surfaceOf('Mars', 'capital')
  check('an unseeded body shows the generator\'s terrain, whatever was ordered', withFootprints(raw) === raw && groundSurface('Mars', owners) === raw)
  usePlacementStore.getState().markSeeded('Mars')
  const first = groundSurface('Mars', owners)!
  check('a seeded body shows the district under the site', terrainAt(first, site.node!) === 'industrial' && first !== raw)
  check('asking again returns the same surface (cached)', groundSurface('Mars', owners) === first)
  const count = (s: typeof first) => Array.from(s.terrain).filter((t) => t === first.terrain[site.node!]).length
  usePlacementStore.getState().addLevel(site.id, 'industrial', 2)
  const grown = groundSurface('Mars', owners)!
  check('developing more makes it cover more', count(grown) > count(first), `${count(first)} -> ${count(grown)}`)
  usePlacementStore.getState().place(site.id, 'civilianFactory', 4)
  check('buildings grow it too', count(groundSurface('Mars', owners)!) > count(grown))
  usePlacementStore.getState().removeLevel(site.id, 'industrial', 4)
  usePlacementStore.getState().unplace(site.id, 'civilianFactory', 4)
  check('and it shrinks back when they are gone', groundSurface('Mars', owners) === raw || terrainAt(groundSurface('Mars', owners)!, site.node!) !== 'industrial')
  resetGame()
}

console.log(failures ? `\n${failures} FAILED` : '\nAll footprint checks passed')
process.exit(failures ? 1 : 0)
