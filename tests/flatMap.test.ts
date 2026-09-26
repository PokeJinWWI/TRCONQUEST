// The flat (rectangular) planetary map: the projection and the lookup that lets
// its shader shade every pixel like the globe (src/scene/mapProjection.ts,
// src/scene/flatLookup.ts).
//
// Run:  npx tsx tests/flatMap.test.ts

import { FLAT_HEIGHT, FLAT_WIDTH, crossesSeam, flatPos, fromFlat, fromLonLat, lonLatOf } from '../src/scene/mapProjection'
import { LOOKUP_HEIGHT, LOOKUP_WIDTH, TRI_TEX_WIDTH, flatLookup } from '../src/scene/flatLookup'
import { arc, nearestNode, surfaceMesh } from '../src/scene/surfaceMesh'
import { flatThumbPixels, globeThumbPixels, thumbFocus } from '../src/scene/projectionThumb'

// Node has no ImageData; the thumbnails only need a width, height and data.
;(globalThis as unknown as { ImageData: unknown }).ImageData = class {
  data: Uint8ClampedArray
  constructor(public width: number, public height: number) {
    this.data = new Uint8ClampedArray(width * height * 4)
  }
}

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

console.log('\n=== 1. The projection ===')
{
  let worst = 0
  for (let i = 0; i < 400; i++) {
    const lon = ((i * 0.618) % 1) * Math.PI * 2 - Math.PI
    const lat = (((i * 0.377) % 1) - 0.5) * Math.PI * 0.98
    const p = fromLonLat(lon, lat)
    const [x, y] = flatPos(p)
    worst = Math.max(worst, arc(p, fromFlat(x, y)))
  }
  check('a point projects to the map and back to itself', worst < 1e-9, `worst error ${worst.toExponential(1)} rad`)
  const [ex, ey] = flatPos(fromLonLat(0, 0))
  check('the equator at longitude 0 is the centre of the map', Math.abs(ex) < 1e-9 && Math.abs(ey) < 1e-9)
  check('north is up and east is right', flatPos(fromLonLat(0, 0.5))[1] > 0 && flatPos(fromLonLat(0.5, 0))[0] > 0)
  const [nx, ny] = flatPos({ x: 0, y: 1, z: 0 })
  check('the map is FLAT_WIDTH x FLAT_HEIGHT (the pole is the top edge)', Math.abs(ny - FLAT_HEIGHT / 2) < 1e-9 && Math.abs(nx) < 20 && FLAT_WIDTH === FLAT_HEIGHT * 2)
  const east = fromLonLat(3.0, 0.2)
  const west = fromLonLat(-3.0, 0.2)
  check('a segment across the 180° meridian is seen as crossing the seam', crossesSeam(east, west))
  check('...and one that does not, is not', !crossesSeam(fromLonLat(0.2, 0.2), fromLonLat(-0.2, 0.3)))
  check('longitude comes back in (-π, π]', Math.abs(lonLatOf(fromLonLat(2.9, 0.1)).lon - 2.9) < 1e-9)
}

console.log('\n=== 2. The lookup behind the flat map ===')
{
  const t0 = Date.now()
  const lk = flatLookup()
  const ms = Date.now() - t0
  const mesh = surfaceMesh()
  check('it is baked once, at a sensible size', lk.width === LOOKUP_WIDTH && lk.height === LOOKUP_HEIGHT && lk.pixels.length === LOOKUP_WIDTH * LOOKUP_HEIGHT * 4, `${ms} ms`)
  check('baking takes under 6 s', ms < 6000, `${ms} ms`)
  check('the second call is the cached one', flatLookup() === lk)
  const triCount = mesh.faces.length / 3
  check('the triangle table holds every triangle', lk.triangles.length >= triCount * 4 && lk.triRows * TRI_TEX_WIDTH >= triCount)

  let badTri = 0
  let nearestDisagree = 0
  let worstBack = 0
  let n = 0
  for (let j = 3; j < LOOKUP_HEIGHT; j += 37) {
    for (let i = 5; i < LOOKUP_WIDTH; i += 41) {
      n++
      const o = (j * LOOKUP_WIDTH + i) * 4
      const t = (lk.pixels[o] << 8) | lk.pixels[o + 1]
      if (t >= triCount) {
        badTri++
        continue
      }
      const wa = lk.pixels[o + 2] / 255
      const wb = lk.pixels[o + 3] / 255
      const wc = Math.max(0, 1 - wa - wb)
      const ids = [lk.triangles[t * 4], lk.triangles[t * 4 + 1], lk.triangles[t * 4 + 2]]
      const lat = ((j + 0.5) / LOOKUP_HEIGHT - 0.5) * Math.PI
      const lon = ((i + 0.5) / LOOKUP_WIDTH - 0.5) * Math.PI * 2
      const p = fromLonLat(lon, lat)
      // The point rebuilt from the triangle and weights lands back on it.
      const w = [wa, wb, wc]
      let x = 0, y = 0, z = 0
      ids.forEach((id, k) => {
        x += w[k] * mesh.positions[id * 3]
        y += w[k] * mesh.positions[id * 3 + 1]
        z += w[k] * mesh.positions[id * 3 + 2]
      })
      const l = Math.hypot(x, y, z)
      worstBack = Math.max(worstBack, arc(p, { x: x / l, y: y / l, z: z / l }))
      const heaviest = ids[w.indexOf(Math.max(...w))]
      if (heaviest !== nearestNode(p, 'fine')) nearestDisagree++
    }
  }
  check('every sampled pixel names a real triangle', badTri === 0, `${n} sampled`)
  check('weights rebuild the pixel\'s own point (to a fraction of a cell)', worstBack < 0.01, `worst ${worstBack.toFixed(4)} rad (a cell is ${mesh.fineSpacingRad.toFixed(3)})`)
  check('the heaviest corner is (almost always) the nearest node', nearestDisagree <= n * 0.02, `${nearestDisagree}/${n}`)
}

console.log('\n=== 3. The thumbnails on the projection switch ===')
{
  const mesh = surfaceMesh()
  // Half the nodes land, half water, split by latitude.
  const nodes = Array.from({ length: mesh.count.fine }, (_, i) => ({ r: 200, g: 100, b: 50, land: mesh.positions[i * 3 + 1] > 0 }))
  const flat = flatThumbPixels(64, 32, nodes)
  const px = (img: { data: Uint8ClampedArray; width: number }, x: number, y: number) => img.data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 3).join()
  check('the flat thumbnail paints north (land) with the node colour', px(flat, 32, 3) === '200,100,50', px(flat, 32, 3))
  check('...and the south as water', px(flat, 32, 28) !== '200,100,50')
  const globe = globeThumbPixels(40, nodes, thumbFocus([]))
  check('the globe thumbnail is transparent outside the disc and filled inside', globe.data[3] === 0 && globe.data[(20 * 40 + 20) * 4 + 3] === 255)
  const focus = thumbFocus([{ position: { x: 0, y: 0, z: 1 }, color: '#fff' }])
  check('it looks at the units when there are some', Math.abs(focus.z - 1) < 1e-9)
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`)
process.exit(failures === 0 ? 0 : 1)
