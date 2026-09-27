// Verification of the real maps of the solar system's solid bodies
// (data/bodyTopography.ts, built by scripts/terrain/build.ts; decoded and
// turned into terrain by scene/bodyTopography.ts): the data, the sea levels
// the user chose, and known places landing where they really are.
// Run:  npx tsx tests/topography.test.ts

import { BODY_TOPOGRAPHY } from '../src/data/bodyTopography'
import { featureAt, realTerrain, topographyOf } from '../src/scene/bodyTopography'
import { fromLonLat } from '../src/scene/mapProjection'
import { clearSurfaceCache, surfaceOf, terrainAt } from '../src/scene/planetTerrain'
import { nearestNode, surfaceMesh } from '../src/scene/surfaceMesh'
import { COUNTRIES } from '../src/data/countryData'
import { keyNameOf } from '../src/scene/keyNames'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}
const node = (lon: number, lat: number) => nearestNode(fromLonLat((lon * Math.PI) / 180, (lat * Math.PI) / 180), 'fine')
const n = surfaceMesh().count.fine

console.log('=== 1. The data ===')
{
  const bodies = Object.keys(BODY_TOPOGRAPHY)
  check('the solar system’s mapped bodies are all there', ['Earth', 'Venus', 'Mars', 'Mercury', 'Luna', 'Ceres', 'Phobos', 'Pluto', 'Io', 'Europa', 'Ganymede', 'Callisto', 'Titan', 'Rhea', 'Dione', 'Iapetus', 'Triton'].every((b) => bodies.includes(b)), bodies.join(', '))
  check('every body decodes to one value per map node', bodies.every((b) => {
    const t = topographyOf(b)!
    return t.feature.length === n && t.mapped.length === n && (!t.elev || t.elev.length === n) && (!t.water || t.water.length === n) && (!t.bright || t.bright.length === n)
  }))
  check('bodies nobody has mapped stay procedural', ['Haumea', 'Makemake', 'Eris', 'Deimos', 'Miranda', 'Ariel', 'Umbriel', 'Titania', 'Oberon', 'Proxima b', 'Arcadia'].every((b) => !(b in BODY_TOPOGRAPHY)))
  check('every body credits its source', bodies.every((b) => BODY_TOPOGRAPHY[b].source.length > 10))
}

console.log('\n=== 2. Sea levels ===')
{
  const share = (b: string) => Array.from(topographyOf(b)!.water!).filter((w) => w >= 128).length / n
  check('Earth: the sea is 70 m higher (every ice sheet melted)', topographyOf('Earth')!.seaLevelM === 70)
  check('Venus: the sea covers Earth’s share of the surface (~71%)', Math.abs(share('Venus') - 0.708) < 0.04, `${(share('Venus') * 100).toFixed(1)}%, sea at +${topographyOf('Venus')!.seaLevelM} m`)
  check('Mars: the sea is at the Arabia shoreline, −2,090 m', topographyOf('Mars')!.seaLevelM === -2090)
  check('Mars: about a third of the planet is sea (the northern ocean, Hellas, Argyre)', share('Mars') > 0.25 && share('Mars') < 0.45, `${(share('Mars') * 100).toFixed(1)}%`)
  check('Titan: its real methane seas are sea, a few percent of the surface', share('Titan') > 0.01 && share('Titan') < 0.08, `${(share('Titan') * 100).toFixed(1)}%`)
}

console.log('\n=== 3. Known places ===')
{
  clearSurfaceCache()
  const at = (b: string, lon: number, lat: number) => terrainAt(surfaceOf(b, 'wild'), node(lon, lat))
  check('Mars: Olympus Mons is mountains', at('Mars', -134, 18) === 'mountains', at('Mars', -134, 18))
  check('Mars: the Hellas basin is sea', at('Mars', 70, -42) === 'ocean')
  check('Mars: the northern plains are sea', at('Mars', 0, 70) === 'ocean')
  check('Mars: Tharsis is land', at('Mars', -110, 0) !== 'ocean')
  check('Venus: Maxwell Montes is land (and mountains)', at('Venus', 3, 65) === 'mountains', at('Venus', 3, 65))
  check('Venus: the lowland plains are sea', at('Venus', -150, 30) === 'ocean')
  check('Earth: the Himalaya are mountains', at('Earth', 85, 31) === 'mountains')
  check('Luna: Mare Imbrium is plains (a dark mare)', at('Luna', -16, 34) === 'plains', at('Luna', -16, 34))
  check('Luna: the far-side highlands are rock or mountains', ['rock', 'mountains'].includes(at('Luna', 170, 10)), at('Luna', 170, 10))
  check('Io: Loki Patera is lava', at('Io', 51, 13) === 'lava', at('Io', 51, 13))
  check('Titan: Kraken Mare is sea', at('Titan', 50, 68) === 'ocean', at('Titan', 50, 68))
  check('Pluto: Sputnik Planitia is plains', at('Pluto', 178, 20) === 'plains', at('Pluto', 178, 20))
  check('Pluto: its far side (never seen) is unmapped', topographyOf('Pluto')!.mapped[node(0, -40)] === 0)
  check('Ceres: Ahuna Mons is mountains', featureAt(topographyOf('Ceres')!, node(-44, -10)) === 'mountain' || at('Ceres', -44, -10) === 'mountains', at('Ceres', -44, -10))
  check('real terrain is deterministic', realTerrain(topographyOf('Mars')!).every((t, i) => t === realTerrain(topographyOf('Mars')!)[i]))
}

console.log('\n=== 4. Worlds still work as worlds ===')
{
  for (const c of COUNTRIES) {
    const s = surfaceOf(c.capitalBodyName, 'capital')
    const kinds = s.keySlots.map((k) => k.kind)
    check(`${c.capitalBodyName}: the capital and its spaceport fit on its mainland`, kinds.includes('capital') && kinds.includes('spaceport') && s.keySlots.every((k) => s.landComponent[k.node] === s.mainland), kinds.join(','))
    const capital = s.keySlots.find((k) => k.kind === 'capital')!
    const urban = (k: number) => [k, ...surfaceMesh().neighbors.fine[k]].flatMap((j) => [j, ...surfaceMesh().neighbors.fine[j]]).filter((j, i, a) => a.indexOf(j) === i && terrainAt(s, j) === 'urban').length
    const cities = s.keySlots.filter((k) => k.kind === 'city')
    check(`${c.capitalBodyName}: the capital is the biggest city`, cities.every((k) => urban(capital.node) > urban(k.node)), `${urban(capital.node)} vs ${cities.map((k) => urban(k.node)).join('/')}`)
  }
  const mars = surfaceOf('Mars', 'capital')
  const cap = mars.keySlots.find((k) => k.kind === 'capital')!
  check('Akakyō, the Martian capital, stands in Xanthe Terra', cap.node === node(-48.1, 1.6) || surfaceMesh().neighbors.fine[node(-48.1, 1.6)].includes(cap.node))
  check('...and is named on its key node', keyNameOf(mars, cap).label === 'Akakyō (capital)')
  check('Venus’s capital is Paphos', keyNameOf(surfaceOf('Venus', 'capital'), surfaceOf('Venus', 'capital').keySlots.find((k) => k.kind === 'capital')!).label === 'Paphos (capital)')
  check('the terrain map gets real relief on Mars', !!mars.reliefM && mars.reliefM[node(-134, 18)] > 15000)
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
