// Earth's planetary map is the real Earth with every ice sheet melted: ETOPO
// 2022 bedrock, the sea 70 m higher and only where it connects to the ocean
// (data/bodyTopography.ts, scripts/terrain), with biomes laid over the land
// (src/scene/earthTerrain.ts).
//
// Run:  npx tsx tests/earth.test.ts

import { earthBiome } from '../src/scene/earthTerrain'
import { fromLonLat } from '../src/scene/mapProjection'
import { clearSurfaceCache, terrainAt, surfaceOf } from '../src/scene/planetTerrain'
import { nearestNode, surfaceMesh } from '../src/scene/surfaceMesh'
import { topographyOf } from '../src/scene/bodyTopography'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}
const deg = (d: number) => (d * Math.PI) / 180
const node = (lon: number, lat: number) => nearestNode(fromLonLat(deg(lon), deg(lat)), 'fine')

console.log('\n=== 1. Land and sea after 70 m of sea-level rise ===')
{
  const topo = topographyOf('Earth')!
  check('the sea is 70 m above today', topo.seaLevelM === 70)
  const wet = (lon: number, lat: number) => topo.water![node(lon, lat)] >= 128
  const land: [string, number, number][] = [
    ['Kansas', -98, 38], ['the Sahara', 15, 24], ['Tibet', 88, 32], ['the Brazilian highlands', -47, -15], ['Mongolia', 103, 46],
    ['central Australia', 133, -24], ['the Siberian plateau', 100, 62], ['the Congo basin rim', 25, -5], ['the East Antarctic highlands', 80, -80],
  ]
  const sea: [string, number, number][] = [
    ['mid-Pacific', -150, 0], ['mid-Atlantic', -30, 20], ['the Indian Ocean', 80, -25], ['the Arctic Ocean', 0, 88], ['the Gulf of Mexico', -90, 25],
    ['West Antarctica (its bedrock lies below the sea)', -110, -78],
  ]
  for (const [name, lon, lat] of land) check(`${name} is land`, !wet(lon, lat))
  for (const [name, lon, lat] of sea) check(`${name} is sea`, wet(lon, lat))
  // Low coasts drown: the map's cells are ~500 km, so these show as partly wet.
  for (const [name, lon, lat] of [['the lower Amazon', -52, -1], ['Florida', -81.5, 28], ['the Netherlands', 5, 52.5], ['Bangladesh', 90, 23.5]] as [string, number, number][]) {
    const w = topo.water![node(lon, lat)] / 255
    check(`${name} is at least partly under the sea`, w > 0.15, `${(w * 100).toFixed(0)}% of its cell`)
  }
}

console.log('\n=== 2. The map ===')
{
  clearSurfaceCache()
  const mesh = surfaceMesh()
  const earth = surfaceOf('Earth', 'wild')
  const values = earth.landValue!
  const share = values.reduce((s, v) => s + (v >= 0.5 ? 1 : 0), 0) / mesh.count.fine
  check('less land than today’s 29%, but still about a quarter of the surface', share > 0.2 && share < 0.28, `${(share * 100).toFixed(1)}%`)
  const at = (lon: number, lat: number) => terrainAt(earth, node(lon, lat))
  check('the node under the Pacific is ocean', at(-150, 0) === 'ocean')
  check('the node under Kansas is land', at(-98, 38) !== 'ocean')
  check('the Sahara is desert', at(15, 24) === 'desert')
  check('the Himalaya are mountains', at(85, 31) === 'mountains')
  check('East Antarctica is ice', at(80, -80) === 'tundra')
  check('Siberia in the north is ice or forest, not desert', ['tundra', 'forest'].includes(at(100, 62)))
  // Earth's land cutoff is deliberately generous (a node is sea only when >= 210/255 of its cell is
  // water, so coasts and archipelagos survive: scene/bodyTopography.realTerrain), and the big named
  // lakes are painted back in as water: so no wet node is ever land, and the only dry nodes that are
  // ocean are those few lake nodes.
  const topo = topographyOf('Earth')!
  let wetLand = 0
  let dryOcean = 0
  for (let i = 0; i < mesh.count.fine; i++) {
    const land = earth.terrain[i] !== 0
    if (land && topo.water![i] >= 210) wetLand++
    if (!land && topo.water![i] < 210) dryOcean++
  }
  check('a node is sea when most of its cell is water, apart from the painted-in lakes', wetLand === 0 && dryOcean < mesh.count.fine * 0.01, `${wetLand} wet land nodes, ${dryOcean} lake nodes`)
  check('there is a walkable mainland (Eurasia and Africa are one landmass)', earth.mainland >= 0)
  check('Earth has 5+ biomes', new Set(earth.terrain).size >= 5, `${new Set(earth.terrain).size} kinds`)
  check('the terrain map gets the real relief', !!earth.reliefM && earth.reliefM[node(88, 32)] > 3000)
  check('biome lookup: the Gobi is desert', earthBiome(105, 42) === 'desert')
  const again = (clearSurfaceCache(), surfaceOf('Earth', 'wild'))
  check('regenerating gives the same map', again.terrain.every((t, i) => t === earth.terrain[i]))
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`)
process.exit(failures === 0 ? 0 : 1)
