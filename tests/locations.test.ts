// Development locations (scene/locations.ts, state/locationStore.ts): deterministic,
// stable ids, valid placement, the same in both economy modes, and saved with the game.
//
// Run:  npx tsx tests/locations.test.ts
import { COUNTRIES } from '../src/data/countryData'
import { KEY_MIN_SEPARATION_CELLS, TERRAIN } from '../src/data/groundData'
import { depositTables } from '../src/data/deposits'
import { CLASS_PROFILE, LOCATION_KINDS } from '../src/data/locationData'
import { EARTH_ANCHORS } from '../src/data/earthEconomicGeography'
import { fromLonLat } from '../src/scene/mapProjection'
import { PLANETS_BY_STAR } from '../src/scene/planetData'
import { bodyDevelopment, beltLocations, bodyOfLocation, clearLocationCache, locationById, locationsOf } from '../src/scene/locations'
import { bodyGroundInfoAny, clearSurfaceCache, surfaceOf, terrainAt } from '../src/scene/planetTerrain'
import { arc, nodePoint, surfaceMesh } from '../src/scene/surfaceMesh'
import { useLocationStore, siteOwner } from '../src/state/locationStore'
import { usePlayerStore } from '../src/state/playerStore'
import { resetGame } from '../src/scene/gameReset'
import { applySave, createSave } from '../src/state/saveGame'
import { sameData } from '../src/state/saveCodec'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}
const counts = (body: string) => {
  const d = bodyDevelopment(body)
  return LOCATION_KINDS.map((k) => `${k}:${d[k].sites}`).join(' ')
}

console.log('\n=== 1. Deterministic, with stable ids ===')
{
  const first = ['Mars', 'Earth', 'Venus', 'Jupiter'].map((b) => JSON.parse(JSON.stringify(locationsOf(b))))
  clearLocationCache()
  clearSurfaceCache()
  const second = ['Mars', 'Earth', 'Venus', 'Jupiter'].map((b) => JSON.parse(JSON.stringify(locationsOf(b))))
  check('regenerating after clearing every cache gives the same sites', JSON.stringify(first) === JSON.stringify(second))
  // Generation order must not matter: Venus first this time.
  clearLocationCache()
  const venusFirst = JSON.stringify(locationsOf('Venus'))
  locationsOf('Mars')
  check('a body\'s sites do not depend on which bodies were generated before it', venusFirst === JSON.stringify(first[2]))
  // Pinned: a change here means every site id on that body moved (a save-breaking change). Farmland and the extra settlements were appended (their own streams), so Mars's first ids are the original ones; Earth is hand-placed (data/earthEconomicGeography.ts).
  check('Mars: pinned site counts', counts('Mars') === 'resource:3 settlement:37 industrial:2 infrastructure:1 strategic:1 agricultural:2', counts('Mars'))
  check('Earth: pinned site counts', counts('Earth') === 'resource:25 settlement:56 industrial:16 infrastructure:6 strategic:2 agricultural:16', counts('Earth'))
}

console.log('\n=== 2. Valid placement ===')
{
  const mesh = surfaceMesh()
  for (const body of ['Mars', 'Earth', 'Venus', 'Luna', 'Ceres']) {
    const sites = locationsOf(body)
    const surface = surfaceOf(body, 'wild')
    check(`${body}: ids are unique and name their body`, new Set(sites.map((s) => s.id)).size === sites.length && sites.every((s) => bodyOfLocation(s.id) === body && s.id.startsWith(`${body}#${s.kind}-`)))
    check(`${body}: every site stands on walkable ground`, sites.every((s) => s.node !== null && surface.landComponent[s.node] >= 0 && TERRAIN[terrainAt(surface, s.node)].passable === 'all'))
    // Earth's hand-placed sites of different kinds may stand a cell apart (same kind ANCHOR_MIN_SEPARATION_CELLS, data/locationData.ts), every other body keeps the key-node spacing.
    const minSep = (body === 'Earth' ? 0.85 : KEY_MIN_SEPARATION_CELLS - 1) * mesh.fineSpacingRad
    let tooClose = 0
    for (const a of sites) for (const b of sites) if (a.id < b.id && (!a.fixed || !b.fixed) && arc(nodePoint(a.node!), nodePoint(b.node!)) < minSep) tooClose++
    check(`${body}: placed sites keep their distance`, tooClose === 0, `${tooClose} too close`)
    check(`${body}: suitability 0..1, capacity at least 1`, sites.every((s) => s.suitability >= 0 && s.suitability <= 1 && s.capacity >= 1))
  }
}

console.log('\n=== 2b. Earth\'s economic geography ===')
{
  const sites = locationsOf('Earth')
  const surface = surfaceOf('Earth', 'wild')
  const named = new Map(sites.map((x) => [x.name, x]))
  const placed = EARTH_ANCHORS.filter((a) => named.has(a.name))
  check('almost every anchor found dry ground within reach (at most 5% skipped)', placed.length >= EARTH_ANCHORS.length * 0.95, `${placed.length}/${EARTH_ANCHORS.length}, skipped ${EARTH_ANCHORS.filter((a) => !named.has(a.name)).map((a) => a.name).join(', ')}`)
  check('every Earth site stands above the risen sea (relief above 70 m sea level)', sites.every((x) => x.node !== null && (surface.reliefM?.[x.node] ?? 1) > 0), sites.filter((x) => x.node !== null && (surface.reliefM?.[x.node] ?? 1) <= 0).map((x) => x.name).join(', '))
  const distanceDeg = (name: string, at: [number, number]): number => {
    const site = named.get(name)
    if (!site || site.node === null) return 999
    return (arc(nodePoint(site.node), fromLonLat((at[0] * Math.PI) / 180, (at[1] * Math.PI) / 180)) * 180) / Math.PI
  }
  const anchor = (name: string) => EARTH_ANCHORS.find((a) => a.name === name)!
  check('farmland lies in the Prairies and the Ukrainian steppe', distanceDeg('Prairie Farmlands', anchor('Prairie Farmlands').at) < 9 && distanceDeg('Ukrainian Steppe Farmlands', anchor('Ukrainian Steppe Farmlands').at) < 9)
  check('mining lies by the Urals and the Pilbara', distanceDeg('Urals Iron Mines', anchor('Urals Iron Mines').at) < 9 && distanceDeg('Pilbara Iron Mines', anchor('Pilbara Iron Mines').at) < 9)
  check('industry stands on the Ganges uplands and in Germany', distanceDeg('Ganges Upland Industrial Zone', anchor('Ganges Upland Industrial Zone').at) < 9 && distanceDeg('Hessian Industrial Zone', anchor('Hessian Industrial Zone').at) < 9)
  check('Africa is a developed core: at least ten settlements south of the Sahara and east of 0 degrees', EARTH_ANCHORS.filter((a) => a.kind === 'settlement' && a.at[1] < 12 && a.at[0] > 0 && a.at[0] < 50 && named.has(a.name)).length >= 10)
  check('a mine holds its anchor\'s resource', sites.filter((x) => x.kind === 'resource' && x.good).every((x) => EARTH_ANCHORS.some((a) => a.name === x.name && a.good === x.good)))
  check('the capital and Earth\'s cities keep their real names', ['Chengyu Megalopolis', 'Great Lakes Megalopolis', 'São Paulo', 'Nairobi'].every((n) => named.has(n)))
  check('every site has a name and names are unique per body', sites.every((x) => !!x.name) && new Set(sites.map((x) => x.name)).size === sites.length)
}

console.log('\n=== 3. The kinds a body gets follow its class ===')
{
  const solBodies = PLANETS_BY_STAR['sol'].map((p) => p.name)
  const t = Date.now()
  let bad = ''
  for (const body of solBodies) {
    const cls = bodyGroundInfoAny(body)!.planetClass
    const sites = locationsOf(body)
    const profile = CLASS_PROFILE[cls]
    if (profile.settlement === 0 && sites.some((s) => s.kind === 'settlement' && !s.fixed)) bad += ` ${body}:settlement`
    if (profile.strategic === 0 && sites.some((s) => s.kind === 'strategic')) bad += ` ${body}:strategic`
    if ((cls === 'gas-giant' || cls === 'ice-giant') && sites.some((s) => s.terrain !== 'aerostat')) bad += ` ${body}:off-aerostat`
    if (sites.length === 0) bad += ` ${body}:none`
  }
  check(`all ${solBodies.length} Sol planets and dwarfs respect their class profile`, bad === '', bad || `${Date.now() - t} ms`)
  const jupiter = locationsOf('Jupiter')
  check('Jupiter: aerostat sites only, no strategic ground', jupiter.length > 0 && jupiter.every((s) => s.terrain === 'aerostat' && s.tags.includes('aerostat')) && !jupiter.some((s) => s.kind === 'strategic'))
}

console.log('\n=== 4. The ground map\'s own cities and spaceports are sites ===')
{
  for (const country of COUNTRIES) {
    const body = country.capitalBodyName
    const slots = surfaceOf(body, 'capital').keySlots
    const sites = locationsOf(body)
    const fixedNodes = new Set(sites.filter((s) => s.fixed).map((s) => s.node))
    const want = slots.filter((k) => k.kind === 'capital' || k.kind === 'city' || k.kind === 'spaceport')
    check(`${country.name}: every capital, city and spaceport slot of ${body} is a site on the same node`, want.length > 0 && want.every((k) => fixedNodes.has(k.node)))
    check(`...and exactly one capital site`, sites.filter((s) => s.tags.includes('capital')).length === 1)
  }
}

console.log('\n=== 5. Hyperium and exotic matter ===')
{
  const hy = depositTables().hyperium
  const ex = depositTables().exoticMatter
  const matSites = (body: string) => locationsOf(body).filter((s) => s.material)
  check('Mars has its hyperium deposit as a resource site', matSites('Mars').some((s) => s.material === 'hyperium' && s.tags.includes('hyperium')))
  check('Venus has its exotic matter deposit as a site', matSites('Venus').some((s) => s.material === 'exoticMatter' && s.tags.includes('exotic-matter')))
  const without = PLANETS_BY_STAR['sol'].map((p) => p.name).find((n) => !(n in hy) && !(n in ex))
  check('a body with no deposit has no material site', !!without && matSites(without).length === 0, without)
}

console.log('\n=== 6. Belts ===')
{
  const belt = beltLocations('Main Belt')
  check('a belt has resource sites only, with no ground', belt.length > 0 && belt.every((s) => s.kind === 'resource' && s.node === null && s.terrain === null && s.tags.includes('belt') && !!s.good))
  clearLocationCache()
  check('...the same every time', JSON.stringify(belt) === JSON.stringify(beltLocations('Main Belt')))
  check('a belt site is found by id', locationById('Main Belt#resource-2')?.bodyName === 'Main Belt')
}

console.log('\n=== 7. Both economy modes see the same sites ===')
{
  const seen: string[] = []
  for (const model of ['complex', 'abstract'] as const) {
    usePlayerStore.getState().setEconomyModel(model)
    clearLocationCache()
    seen.push(JSON.stringify(['Mars', 'Venus'].map((b) => locationsOf(b))))
  }
  check('Mars and Venus are identical in Complex and Simple mode', seen[0] === seen[1])
}

console.log('\n=== 8. Who holds a site ===')
{
  resetGame()
  const capital = 'Mars#settlement-0'
  check('a starting world\'s capital site belongs to its starting owner', siteOwner(capital) === 'imperial-state-of-mars')
  check('open ground (a seeded site) belongs to nobody', siteOwner('Mars#industrial-0') === undefined)
  const store = useLocationStore.getState()
  check('a nation can establish open ground', store.establish('Mars#industrial-0', 'imperial-state-of-mars', 10) && siteOwner('Mars#industrial-0') === 'imperial-state-of-mars')
  check('another nation cannot take an established site', !useLocationStore.getState().establish('Mars#industrial-0', 'republic-of-venus', 11) && siteOwner('Mars#industrial-0') === 'imperial-state-of-mars')
  check('nor a starting world\'s fixed site', !useLocationStore.getState().establish(capital, 'republic-of-venus', 11))
  check('an unknown site id is refused', !useLocationStore.getState().establish('Nowhere#settlement-9', 'republic-of-venus', 11))
  useLocationStore.getState().abandon(capital)
  check('an abandoned site is open ground again', siteOwner(capital) === undefined)
  check('...and another nation can then establish it', useLocationStore.getState().establish(capital, 'republic-of-venus', 12) && siteOwner(capital) === 'republic-of-venus')

  const before = useLocationStore.getState().established
  const file = JSON.parse(JSON.stringify(await createSave('locations')))
  resetGame()
  check('a reset clears them', Object.keys(useLocationStore.getState().established).length === 0)
  await applySave(file)
  check('they survive save and load', sameData(before, useLocationStore.getState().established) && siteOwner(capital) === 'republic-of-venus')
  resetGame()
}

console.log(failures ? `\n${failures} FAILED` : '\nAll location checks passed')
process.exit(failures ? 1 : 0)
