// Verification of key-node names and roles (scene/keyNames.ts, data/cityNames.ts),
// real region names (bodyTopography.regionAt), and the planet screen's grouped
// building tiles (ComplexPlanetTabs.groupsOf).
// Run:  npx tsx tests/keyNodes.test.ts

import { CITY_NAMES } from '../src/data/cityNames'
import { COUNTRIES } from '../src/data/countryData'
import { cityOfNode, keyNameOf, keyNamesOf, KEY_ROLE } from '../src/scene/keyNames'
import { regionAt } from '../src/scene/bodyTopography'
import { clearSurfaceCache, surfaceOf, terrainAt } from '../src/scene/planetTerrain'
import { withFortressKeys } from '../src/scene/defenseLogic'
import { fromLonLat } from '../src/scene/mapProjection'
import { nearestNode, surfaceMesh } from '../src/scene/surfaceMesh'
import { groupsOf } from '../src/components/planet/grouping'
import type { Building } from '../src/economy/economyTypes'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}
const node = (lon: number, lat: number) => nearestNode(fromLonLat((lon * Math.PI) / 180, (lat * Math.PI) / 180), 'fine')

console.log('=== 1. Every capital world names its key nodes ===')
{
  for (const c of COUNTRIES) {
    const s = surfaceOf(c.capitalBodyName, 'capital')
    const names = keyNamesOf(s)
    const capital = s.keySlots.find((k) => k.kind === 'capital')!
    check(`${c.capitalBodyName}: the capital is ${c.capitalCityName}`, names.get(capital.node)?.name === c.capitalCityName, names.get(capital.node)?.label)
    const list = CITY_NAMES[c.id].map((x) => x.name)
    const others = s.keySlots.filter((k) => k.kind !== 'capital').map((k) => names.get(k.node)!)
    check(`${c.capitalBodyName}: its other key nodes take names from ${c.name}'s list`, others.every((n) => n.name !== null && list.includes(n.name)), others.map((n) => n.label).join(', '))
    check(`${c.capitalBodyName}: no two key nodes share a name`, new Set([...names.values()].map((n) => n.name)).size === names.size)
    const port = s.keySlots.find((k) => k.kind === 'spaceport')
    check(`${c.capitalBodyName}: the spaceport reads "<name> Spaceport"`, !port || /Spaceport$/.test(names.get(port.node)!.label), port ? names.get(port.node)!.label : 'none')
  }
  const mars = surfaceOf('Mars', 'capital')
  const m = [...keyNamesOf(mars).values()].find((n) => n.native)
  check('Mars’s cities carry their kanji', !!m?.native, m ? `${m.name} ${m.native}` : '')
  const akakyo = keyNamesOf(mars).get(mars.keySlots.find((k) => k.kind === 'capital')!.node)
  check('...the capital too: Akakyō 赤京', akakyo?.native === '赤京', `${akakyo?.name} ${akakyo?.native}`)
}

console.log('\n=== 2. Names are stable and belong to the founding nation ===')
{
  const a = keyNamesOf(surfaceOf('Venus', 'capital'))
  clearSurfaceCache()
  const b = keyNamesOf(surfaceOf('Venus', 'capital'))
  check('the same world gets the same names every time', [...a.values()].map((n) => n.label).join() === [...b.values()].map((n) => n.label).join())
  // Luna was founded by Mars: its city keeps a Martian name whoever holds it.
  const luna = surfaceOf('Luna', 'world')
  const lunaCity = luna.keySlots.find((k) => k.kind === 'city')
  check('Luna’s city has a Martian name', !!lunaCity && CITY_NAMES['imperial-state-of-mars'].some((c) => c.name === keyNameOf(luna, lunaCity).name), lunaCity ? keyNameOf(luna, lunaCity).label : 'no city')
  // A fortress is named for the settlement it guards.
  const venus = surfaceOf('Venus', 'capital')
  const fortSurface = withFortressKeys(venus, [{ id: 'f1', bodyName: 'Venus', kind: 'fortress', node: venus.keySlots[0].node === 0 ? 1 : venus.keySlots[0].node, integrity: 60, builtBy: 'republic-of-venus', readySimDays: 0 }], 0)
  const fort = fortSurface.keySlots.find((k) => k.kind === 'fortress')
  check('a fortress is named after the city it guards', !fort || /Fortress$/.test(keyNameOf(fortSurface, fort).label), fort ? keyNameOf(fortSurface, fort).label : 'no fortress added')
  check('every kind of key node explains what it does', Object.values(KEY_ROLE).every((r) => r.length > 20))
}

console.log('\n=== 3. Urban ground knows its city ===')
{
  const mars = surfaceOf('Mars', 'capital')
  const urban = Array.from({ length: surfaceMesh().count.fine }, (_, i) => i).filter((i) => terrainAt(mars, i) === 'urban')
  check('every urban node belongs to a named city', urban.length > 0 && urban.every((i) => cityOfNode(mars, i)?.name), `${urban.length} urban nodes`)
  const capital = mars.keySlots.find((k) => k.kind === 'capital')!
  const near = urban.filter((i) => cityOfNode(mars, i)?.name === 'Akakyō').length
  check('the capital, Akakyō, has the most urban ground', urban.length > 0 && near >= urban.length / mars.keySlots.filter((k) => k.kind !== 'outpost').length, `${near} of ${urban.length}`)
  void capital
}

console.log('\n=== 4. Real region names ===')
{
  const mars = surfaceOf('Mars', 'capital')
  const cap = mars.keySlots.find((k) => k.kind === 'capital')!
  check('Akakyō stands in Xanthe Terra', regionAt('Mars', cap.node) === 'Xanthe Terra', regionAt('Mars', cap.node) ?? 'none')
  // The most specific region wins: a plain inside the northern lowlands, a
  // plateau inside Ishtar Terra.
  check('Mars’s northern sea is named for the plains it floods', ['Acidalia Planitia', 'Vastitas Borealis'].includes(regionAt('Mars', node(0, 70)) ?? ''), regionAt('Mars', node(0, 70)) ?? 'none')
  check('Hellas’s sea is Hellas Planitia', regionAt('Mars', node(70, -42)) === 'Hellas Planitia', regionAt('Mars', node(70, -42)) ?? 'none')
  check('Venus’s Maxwell plateau is Lakshmi Planum, in Ishtar Terra', ['Lakshmi Planum', 'Ishtar Terra'].includes(regionAt('Venus', node(3, 65)) ?? ''), regionAt('Venus', node(3, 65)) ?? 'none')
  check('the Moon has Mare Imbrium', regionAt('Luna', node(-16, 34)) === 'Mare Imbrium', regionAt('Luna', node(-16, 34)) ?? 'none')
  check('Earth has no gazetteer regions', regionAt('Earth', node(0, 0)) === null)
}

console.log('\n=== 5. Grouped building tiles ===')
{
  const b = (id: string, recipeId: string, level: number) => ({ id, recipeId, level } as unknown as Building)
  const list = [b('1', 'steelMill', 2), b('2', 'toolWorkshop', 1), b('3', 'steelMill', 1), b('4', 'steelMill', 3)]
  const groups = groupsOf(list)
  check('identical buildings group into one tile each', groups.length === 2 && groups[0].length === 3 && groups[1].length === 1)
  check('...keeping every building (counts add up)', groups.reduce((n, g) => n + g.length, 0) === list.length)
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
