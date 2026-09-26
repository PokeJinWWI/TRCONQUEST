// Earth's planetary map is the real Earth: the Natural Earth coastline for land
// and sea, with biomes laid over the land (src/scene/earthTerrain.ts).
//
// Run:  npx tsx tests/earth.test.ts

import { earthBiome, earthLandValues, isEarthLand } from '../src/scene/earthTerrain'
import { fromLonLat } from '../src/scene/mapProjection'
import { clearSurfaceCache, terrainAt, surfaceOf } from '../src/scene/planetTerrain'
import { nearestNode, surfaceMesh } from '../src/scene/surfaceMesh'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}
const deg = (d: number) => (d * Math.PI) / 180

console.log('\n=== 1. The coastline ===')
{
  const land: [string, number, number][] = [
    ['Cairo', 31.2, 30.0], ['London', -0.1, 51.5], ['Sydney', 151.2, -33.9], ['Manaus', -60, -3.1], ['Beijing', 116.4, 39.9],
    ['Chicago', -87.6, 41.9], ['Nairobi', 36.8, -1.3], ['Moscow', 37.6, 55.7], ['the South Pole', 0, -89], ['central Greenland', -40, 74],
  ]
  const sea: [string, number, number][] = [
    ['mid-Pacific', -150, 0], ['mid-Atlantic', -30, 20], ['the Indian Ocean', 80, -25], ['the Southern Ocean', 0, -60], ['the Arctic Ocean', 0, 88], ['the Gulf of Mexico', -90, 25],
  ]
  for (const [name, lon, lat] of land) check(`${name} is land`, isEarthLand(lon, lat))
  for (const [name, lon, lat] of sea) check(`${name} is sea`, !isEarthLand(lon, lat))
}

console.log('\n=== 2. The map ===')
{
  clearSurfaceCache()
  const mesh = surfaceMesh()
  const values = earthLandValues()
  const landNodes = values.reduce((s, v) => s + (v >= 0.5 ? 1 : 0), 0)
  const share = landNodes / mesh.count.fine
  check('about 29% of the surface is land (the real share)', share > 0.25 && share < 0.34, `${(share * 100).toFixed(1)}%`)
  const earth = surfaceOf('Earth', 'wild')
  const at = (lon: number, lat: number) => terrainAt(earth, nearestNode(fromLonLat(deg(lon), deg(lat)), 'fine'))
  check('the node under the Pacific is ocean', at(-150, 0) === 'ocean')
  check('the node under Kansas is land', at(-98, 38) !== 'ocean')
  check('the Sahara is desert', at(15, 24) === 'desert')
  check('the Himalaya are mountains', at(85, 31) === 'mountains')
  check('the Amazon is forest', at(-62, -4) === 'forest')
  check('Antarctica is ice', at(20, -80) === 'tundra')
  check('Siberia in the north is ice or forest, not desert', ['tundra', 'forest'].includes(at(100, 62)))
  check('the surface carries the coastline for the map to draw', earth.landValue === values)
  check('a node is land exactly when at least half of it is', Array.from({ length: mesh.count.fine }, (_, i) => (values[i] >= 0.5) === (earth.terrain[i] !== 0)).every(Boolean))
  check('there is a walkable mainland (Eurasia and Africa are one landmass)', earth.mainland >= 0)
  check('Earth has 5+ biomes', new Set(earth.terrain).size >= 5, `${new Set(earth.terrain).size} kinds`)
  check('biome lookup: the Gobi is desert', earthBiome(105, 42) === 'desert')
  const again = (clearSurfaceCache(), surfaceOf('Earth', 'wild'))
  check('regenerating gives the same map', again.terrain.every((t, i) => t === earth.terrain[i]))
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`)
process.exit(failures === 0 ? 0 : 1)
