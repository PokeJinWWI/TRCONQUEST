// Procedural planetary terrain and key nodes (src/scene/planetTerrain.ts).
//
// Run:  npx tsx tests/terrain.test.ts

import { COUNTRIES } from '../src/data/countryData'
import { SURFACE_CLASSES } from '../src/data/groundData'
import { seedBodyOwners } from '../src/scene/territory'
import { useEconomyStore, worldByName } from '../src/state/economyStore'
import { bodyGroundInfo, clearSurfaceCache, passableFor, surfaceOf, terrainAt, type SettlementTier } from '../src/scene/planetTerrain'
import { nodePoint, surfaceMesh } from '../src/scene/surfaceMesh'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const owners = seedBodyOwners()
function tierOf(body: string): SettlementTier {
  if (COUNTRIES.some((c) => c.capitalBodyName === body)) return 'capital'
  if (worldByName(useEconomyStore.getState().worlds, body)) return 'world'
  return owners[body] ? 'outpost' : 'wild'
}
const n = surfaceMesh().count.fine

console.log('\n=== 1. Deterministic, and different per world ===')
{
  const t0 = performance.now()
  const a = Array.from(surfaceOf('Venus', 'capital').terrain)
  const ms = performance.now() - t0
  clearSurfaceCache()
  const b = Array.from(surfaceOf('Venus', 'capital').terrain)
  check('the same world always generates the same terrain', a.every((v, i) => v === b[i]))
  const c = Array.from(surfaceOf('Earth', 'wild').terrain)
  check('different worlds differ', c.some((v, i) => v !== a[i]))
  check('generation is quick', ms < 400, `${ms.toFixed(0)} ms`)
}

console.log('\n=== 2. Every owned world is invadable on foot ===')
{
  let bad: string[] = []
  const t0 = performance.now()
  for (const body of Object.keys(owners)) {
    const s = surfaceOf(body, tierOf(body))
    if (s.keySlots.length === 0) bad.push(`${body}: no key nodes`)
    for (const k of s.keySlots) {
      if (s.landComponent[k.node] !== s.mainland) bad.push(`${body}: ${k.kind} off the mainland`)
      if (!passableFor(terrainAt(s, k.node), 'infantry')) bad.push(`${body}: ${k.kind} on impassable ground`)
    }
  }
  check('every owned body has key nodes, all on its walkable mainland', bad.length === 0, bad.slice(0, 4).join('; '))
  console.log(`    (generated ${Object.keys(owners).length} owned worlds in ${(performance.now() - t0).toFixed(0)} ms)`)

  const venus = surfaceOf('Venus', 'capital')
  const land = Array.from(venus.terrain).filter((_, i) => passableFor(terrainAt(venus, i), 'infantry')).length / n
  check('Venus (an ocean world) keeps its ocean but has real land', land >= SURFACE_CLASSES.ocean.landFraction - 0.02 && land < 0.6, `${(land * 100).toFixed(0)}% land`)
  const kinds = venus.keySlots.map((k) => k.kind)
  check('the capital has a capital, a spaceport and cities', kinds.includes('capital') && kinds.includes('spaceport') && kinds.filter((k) => k === 'city').length >= 1, kinds.join(','))
  check('outposts get a single outpost key node', surfaceOf('Phobos', 'outpost').keySlots.map((k) => k.kind).join() === 'outpost')
  check('unclaimed worlds have no key nodes', surfaceOf('Earth', 'wild').keySlots.length === 0)
  check('key nodes are urban ground (except outposts)', venus.keySlots.every((k) => terrainAt(venus, k.node) === 'urban'))
}

console.log('\n=== 3. Planet classes shape the surface ===')
{
  const giants = Object.keys(owners).filter((b) => ['gas-giant', 'ice-giant'].includes(bodyGroundInfo(b)?.planetClass ?? ''))
  check('Orion owns giants to test', giants.length > 0, giants.join(', '))
  for (const g of giants.slice(0, 2)) {
    const s = surfaceOf(g, tierOf(g))
    const kinds = new Set(Array.from(s.terrain).map((_, i) => terrainAt(s, i)))
    const beltOnly = Array.from(s.terrain).every((_, i) => {
      const t = terrainAt(s, i)
      const inBelt = Math.abs(nodePoint(i).y) <= (SURFACE_CLASSES['gas-giant'].belt ?? 0)
      return inBelt ? t !== 'cloud' : t === 'cloud'
    })
    check(`${g}: only cloud and an equatorial aerostat belt`, beltOnly && !kinds.has('ocean') && kinds.has('cloud'))
  }
  const phobos = surfaceOf('Phobos', 'outpost')
  check('moons are barren rock and mountains', Array.from(phobos.terrain).every((_, i) => ['rock', 'mountains'].includes(terrainAt(phobos, i))))
  const mars = surfaceOf('Mars', 'capital')
  check('mountains are a real share of the land', Array.from(mars.terrain).filter((_, i) => terrainAt(mars, i) === 'mountains').length > 50)
}

console.log('\n=== 4. Who can go where ===')
{
  check('infantry cannot enter the ocean', !passableFor('ocean', 'infantry'))
  check('marines can', passableFor('ocean', 'marines'))
  check('nobody crosses lava or cloud', !passableFor('lava', 'marines') && !passableFor('cloud', 'infantry'))
  check('armour cannot climb mountains, infantry can', !passableFor('mountains', 'armour') && passableFor('mountains', 'infantry'))
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`)
process.exit(failures === 0 ? 0 : 1)
