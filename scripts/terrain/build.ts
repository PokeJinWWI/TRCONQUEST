// Builds the real maps of the solar system's solid bodies (build-time only):
//   src/data/bodyTopography.ts   per map node: elevation, roughness, brightness,
//                                water share, named-feature code, mapped flag
//   public/maps/<body>.png       a 1024×512 picture for the globe/flat map
// Run:  npx tsx scripts/terrain/build.ts [cacheDir]
// Sources and sea levels are in sources.ts; the raw downloads are cached in
// cacheDir (default: $TMPDIR/trc-terrain-cache) so a rerun is offline.

import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { deflateSync } from 'node:zlib'
import { bytesDownloaded, readFeatureShapes, readFeatures, type Feature, type FeatureShape, type Grid } from './readers'
import { BODIES, EARTH_OCEAN_COVERAGE, type BodySource } from './sources'
import { surfaceMesh, nearestNode, normalize, type SurfacePoint } from '../../src/scene/surfaceMesh'
import { fromLonLat, lonLatOf } from '../../src/scene/mapProjection'
import { FEATURE_CODES, type FeatureCode } from '../../src/data/topographyCodes'

const CACHE = process.argv[2] ?? `${tmpdir()}/trc-terrain-cache`
const IMG_W = 1024
const IMG_H = 512
const DEG = Math.PI / 180

// --- Grid helpers -----------------------------------------------------------------

const idx = (g: Grid, r: number, c: number) => r * g.w + (((c % g.w) + g.w) % g.w)

// Bilinear sample at lon/lat (degrees), NaN-aware.
function sample(g: Grid, lon: number, lat: number): number {
  const x = ((lon + 180) / 360) * g.w - 0.5
  const y = ((90 - lat) / 180) * g.h - 0.5
  const x0 = Math.floor(x), y0 = Math.max(0, Math.min(g.h - 1, Math.floor(y)))
  const y1 = Math.min(g.h - 1, y0 + 1)
  const fx = x - x0, fy = Math.max(0, Math.min(1, y - y0))
  let s = 0, w = 0
  for (const [r, c, k] of [[y0, x0, (1 - fx) * (1 - fy)], [y0, x0 + 1, fx * (1 - fy)], [y1, x0, (1 - fx) * fy], [y1, x0 + 1, fx * fy]] as [number, number, number][]) {
    const v = g.data[idx(g, r, c)]
    if (Number.isFinite(v)) {
      s += v * k
      w += k
    }
  }
  return w > 0 ? s / w : NaN
}

// Fill gaps from their neighbours (repeated smoothing into the holes). Returns
// the filled grid and which cells were originally measured.
function fillGaps(g: Grid): { grid: Grid; measured: Uint8Array } {
  const measured = new Uint8Array(g.data.length)
  const data = Float32Array.from(g.data)
  for (let i = 0; i < data.length; i++) measured[i] = Number.isFinite(data[i]) ? 1 : 0
  for (let pass = 0; pass < 4000; pass++) {
    let holes = 0
    const next = Float32Array.from(data)
    for (let r = 0; r < g.h; r++)
      for (let c = 0; c < g.w; c++) {
        const i = r * g.w + c
        if (Number.isFinite(data[i])) continue
        let s = 0, n = 0
        for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          const rr = r + dr
          if (rr < 0 || rr >= g.h) continue
          const v = data[idx(g, rr, c + dc)]
          if (Number.isFinite(v)) { s += v; n++ }
        }
        if (n > 0) next[i] = s / n
        else holes++
      }
    data.set(next)
    if (holes === 0) break
  }
  return { grid: { ...g, data }, measured }
}

// Area of each row's cells on a unit sphere.
const rowArea = (g: Grid, r: number) => ((2 * Math.PI) / g.w) * (Math.sin((90 - (r / g.h) * 180) * DEG) - Math.sin((90 - ((r + 1) / g.h) * 180) * DEG))

// The level L at which the ocean holds `volumeKm3` over this body's relief.
function levelForVolume(g: Grid, radiusKm: number, volumeKm3: number): number {
  let lo = -20000, hi = 20000
  for (let k = 0; k < 60; k++) {
    const L = (lo + hi) / 2
    let v = 0
    for (let r = 0; r < g.h; r++) {
      const a = rowArea(g, r) * radiusKm * radiusKm
      for (let c = 0; c < g.w; c++) v += Math.max(0, L - g.data[r * g.w + c]) / 1000 * a
    }
    if (v > volumeKm3) hi = L
    else lo = L
  }
  return (lo + hi) / 2
}

// The level at which `share` of the surface (by area) is at or below it.
function levelForCoverage(g: Grid, share: number): number {
  let lo = -20000, hi = 20000
  let total = 0
  for (let r = 0; r < g.h; r++) total += rowArea(g, r) * g.w
  for (let k = 0; k < 60; k++) {
    const L = (lo + hi) / 2
    let wet = 0
    for (let r = 0; r < g.h; r++) {
      const a = rowArea(g, r)
      for (let c = 0; c < g.w; c++) if (g.data[r * g.w + c] <= L) wet += a
    }
    if (wet / total > share) hi = L
    else lo = L
  }
  return (lo + hi) / 2
}

// Water mask: every cell at or below `level`, or (connected) only the cells
// reachable from the seed through cells at or below it.
function waterMask(g: Grid, level: number, seed?: [number, number]): Uint8Array {
  const m = new Uint8Array(g.w * g.h)
  if (!seed) {
    for (let i = 0; i < m.length; i++) m[i] = g.data[i] <= level ? 1 : 0
    return m
  }
  const start = idx(g, Math.floor(((90 - seed[1]) / 180) * g.h), Math.floor(((seed[0] + 180) / 360) * g.w))
  const stack = [start]
  m[start] = 1
  while (stack.length) {
    const i = stack.pop()!
    const r = Math.floor(i / g.w), c = i % g.w
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const rr = r + dr
      if (rr < 0 || rr >= g.h) continue
      const j = idx(g, rr, c + dc)
      if (!m[j] && g.data[j] <= level) {
        m[j] = 1
        stack.push(j)
      }
    }
  }
  return m
}

const maskGrid = (g: Grid, m: Uint8Array): Grid => ({ w: g.w, h: g.h, data: Float32Array.from(m) })

// --- Features --------------------------------------------------------------------

function featureCodeOf(type: string, src: BodySource): FeatureCode | null {
  const t = type.toLowerCase()
  // Only true mountains: ridges and scarps (dorsa, rupes) are long and thin, and
  // their "diameter" is a length, so a disc would overstate them.
  if (/^(mons|tholus)/.test(t)) return 'mountain'
  if (/^(patera|eruptive|fluctus)/.test(t) && src.volcanicPaterae) return 'volcano'
  if (/^(mare|lacus|sinus|fretum|fluctus)/.test(t) && src.liquidSeas) return 'sea'
  if (/^planitia|^planum/.test(t)) return 'plain'
  return null
}

function inRing(lon: number, lat: number, ring: [number, number][]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j]
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

// Great-circle distance (km) on a sphere.
function distKm(lon1: number, lat1: number, lon2: number, lat2: number, R: number): number {
  const a = Math.sin(((lat2 - lat1) * DEG) / 2) ** 2 + Math.cos(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.sin(((lon2 - lon1) * DEG) / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)))
}

// --- Per-node sampling --------------------------------------------------------------

interface NodeData {
  elev: Int16Array
  rough: Uint8Array
  bright: Uint8Array | null
  water: Uint8Array | null
  feature: Uint8Array
  mapped: Uint8Array
}

function nodeSamples(): { center: SurfacePoint; pts: { lon: number; lat: number }[]; wide: { lon: number; lat: number }[] }[] {
  const mesh = surfaceMesh()
  const cell = mesh.fineSpacingRad
  const ring = (k: number, n: number, r: number, ph = 0) => Array.from({ length: n }, (_, j) => [Math.cos((j * 2 * Math.PI) / n + ph) * r * cell, Math.sin((j * 2 * Math.PI) / n + ph) * r * cell] as [number, number])
  const near: [number, number][] = [[0, 0], ...ring(0, 6, 0.28), ...ring(0, 12, 0.55, 0.26)]
  const wideOff: [number, number][] = [...near, ...ring(0, 18, 0.85, 0.1)]
  const out = []
  for (let i = 0; i < mesh.count.fine; i++) {
    const c = { x: mesh.positions[i * 3], y: mesh.positions[i * 3 + 1], z: mesh.positions[i * 3 + 2] }
    const ref = Math.abs(c.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 }
    const t1 = normalize({ x: ref.y * c.z - ref.z * c.y, y: ref.z * c.x - ref.x * c.z, z: ref.x * c.y - ref.y * c.x })
    const t2 = { x: c.y * t1.z - c.z * t1.y, y: c.z * t1.x - c.x * t1.z, z: c.x * t1.y - c.y * t1.x }
    const at = ([a, b]: [number, number]) => {
      const p = normalize({ x: c.x + t1.x * a + t2.x * b, y: c.y + t1.y * a + t2.y * b, z: c.z + t1.z * a + t2.z * b })
      const ll = lonLatOf(p)
      return { lon: ll.lon / DEG, lat: ll.lat / DEG }
    }
    out.push({ center: c, pts: near.map(at), wide: wideOff.map(at) })
  }
  return out
}

function sampleNodes(src: BodySource, elev: Grid | null, measured: Uint8Array | null, bright: Grid | null, water: Grid | null, features: Feature[], shapes: FeatureShape[]): NodeData {
  const nodes = nodeSamples()
  const n = nodes.length
  const out: NodeData = {
    elev: new Int16Array(n),
    rough: new Uint8Array(n),
    bright: bright ? new Uint8Array(n) : null,
    water: water ? new Uint8Array(n) : null,
    feature: new Uint8Array(n),
    mapped: new Uint8Array(n),
  }
  // Brightness is ranked (0–255 by percentile) so bodies compare alike.
  const brightRaw: number[] = []
  const measuredGrid: Grid | null = elev && measured ? { w: elev.w, h: elev.h, data: Float32Array.from(measured) } : null
  const featureRules = features.map((f) => ({ f, code: featureCodeOf(f.type, src) })).filter((x) => x.code && (x.f.diameterKm >= src.minFeatureKm || x.code === 'volcano' || x.code === 'mountain'))
  const shapeRules = shapes.map((s) => ({ s, code: featureCodeOf(s.type, src) })).filter((x) => x.code)
  nodes.forEach((node, i) => {
    const { lon, lat } = node.pts[0]
    if (elev) {
      const vals = node.pts.map((p) => sample(elev, p.lon, p.lat))
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length
      out.elev[i] = Math.max(-32000, Math.min(32000, Math.round(mean)))
      const wide = node.wide.map((p) => sample(elev, p.lon, p.lat))
      const wm = wide.reduce((a, b) => a + b, 0) / wide.length
      const sd = Math.sqrt(wide.reduce((a, b) => a + (b - wm) ** 2, 0) / wide.length)
      out.rough[i] = Math.min(255, Math.round(sd / src.roughUnitM))
    }
    const m = measuredGrid ? node.pts.reduce((a, p) => a + sample(measuredGrid, p.lon, p.lat), 0) / node.pts.length : 1
    out.mapped[i] = m >= 0.5 ? 1 : 0
    if (bright) brightRaw.push(node.pts.reduce((a, p) => a + sample(bright, p.lon, p.lat), 0) / node.pts.length)
    if (water && out.water) out.water[i] = Math.round((node.pts.reduce((a, p) => a + (sample(water, p.lon, p.lat) >= 0.5 ? 1 : 0), 0) / node.pts.length) * 255)
    // Named features: an outline covering the node, or a centre within the
    // feature's radius (at least a quarter of a cell, so small peaks register).
    let code: FeatureCode | null = null
    for (const { s, code: c } of shapeRules) {
      if (node.pts.filter((p) => s.rings.some((r) => inRing(p.lon, p.lat, r))).length >= node.pts.length / 2) code = c
    }
    if (!code) {
      const cellKm = surfaceMesh().fineSpacingRad * src.radiusKm
      for (const { f, code: c } of featureRules) {
        if (distKm(lon, lat, f.lon, f.lat, src.radiusKm) <= Math.max(f.diameterKm / 2, cellKm * 0.3)) {
          code = c
          break
        }
      }
    }
    out.feature[i] = code ? FEATURE_CODES.indexOf(code) : 0
    if (src.featuresOnly) out.mapped[i] = code ? 1 : 0
  })
  // Named peaks and volcanoes smaller than a map cell still mark the node
  // nearest their centre (Ceres's Ahuna Mons, Io's smaller paterae).
  for (const { f, code } of featureRules) {
    if (code !== 'mountain' && code !== 'volcano') continue
    const i = nearestNode(fromLonLat(f.lon * DEG, f.lat * DEG), 'fine')
    if (out.feature[i] === 0) out.feature[i] = FEATURE_CODES.indexOf(code)
    if (src.featuresOnly) out.mapped[i] = 1
  }
  if (bright && out.bright) {
    const order = brightRaw.map((v, i) => [Number.isFinite(v) ? v : 0, i]).sort((a, b) => a[0] - b[0])
    order.forEach(([, i], r) => (out.bright![i] = Math.round((r / (order.length - 1)) * 255)))
  }
  return out
}

// --- PNG (8-bit greyscale) -------------------------------------------------------

function crc32(buf: Uint8Array): number {
  let c = ~0
  for (const b of buf) {
    c ^= b
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}
function chunk(type: string, data: Uint8Array): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'latin1'), Buffer.from(data)])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
function png(w: number, h: number, pix: Uint8Array): Buffer {
  const raw = Buffer.alloc((w + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w + 1)] = 2 // "up" filter: smooth maps compress well
    for (let x = 0; x < w; x++) raw[y * (w + 1) + 1 + x] = (pix[y * w + x] - (y > 0 ? pix[(y - 1) * w + x] : 0)) & 255
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 0
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', new Uint8Array())])
}

// The picture: land relief (or brightness), with 0 reserved for water; values
// land is 3–255, quantised to 64 levels (plenty for a hologram shade, and much smaller files).
function picture(elev: Grid | null, bright: Grid | null, water: Grid | null): Uint8Array {
  const pix = new Uint8Array(IMG_W * IMG_H)
  const base = elev ?? bright!
  let lo = Infinity, hi = -Infinity
  const vals = new Float32Array(IMG_W * IMG_H)
  for (let y = 0; y < IMG_H; y++)
    for (let x = 0; x < IMG_W; x++) {
      const lon = ((x + 0.5) / IMG_W) * 360 - 180, lat = 90 - ((y + 0.5) / IMG_H) * 180
      const wet = water ? sample(water, lon, lat) >= 0.5 : false
      const v = sample(base, lon, lat)
      vals[y * IMG_W + x] = wet ? NaN : v
      if (!wet && Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v) }
    }
  // Stretch between the 1st and 99th percentile of land.
  const land = Array.from(vals).filter(Number.isFinite).sort((a, b) => a - b)
  if (land.length) { lo = land[Math.floor(land.length * 0.01)]; hi = land[Math.floor(land.length * 0.99)] }
  for (let i = 0; i < vals.length; i++) {
    const v = vals[i]
    pix[i] = Number.isFinite(v) ? 3 + Math.round(Math.max(0, Math.min(1, (v - lo) / Math.max(1e-6, hi - lo))) * 63) * 4 : 0
  }
  return pix
}

// --- Main -------------------------------------------------------------------------

const b64 = (a: ArrayBufferView) => Buffer.from(a.buffer, a.byteOffset, a.byteLength).toString('base64')

async function main() {
  mkdirSync('public/maps', { recursive: true })
  const entries: string[] = []
  const report: string[] = []
  for (const src of BODIES) {
    const t0 = bytesDownloaded
    const rawElev = src.elevation ? await src.elevation(CACHE) : null
    const filled = rawElev ? fillGaps(rawElev) : null
    // Dry bodies: heights above the median ground (some DEMs store the full
    // radius, e.g. Ceres's), so they fit in int16. Seas keep the datum.
    if (filled && !src.sea) {
      const sorted = Array.from(filled.grid.data).filter(Number.isFinite).sort((a, b) => a - b)
      const med = sorted[Math.floor(sorted.length / 2)]
      for (let i = 0; i < filled.grid.data.length; i++) filled.grid.data[i] -= med
    }
    const elev = filled?.grid ?? null
    const bright = src.brightness ? (await src.brightness(CACHE)) : null
    const features = src.iau ? await readFeatures(src.iau, `${CACHE}/iau`) : []
    const shapes = src.iau && src.iauShapes ? await readFeatureShapes(src.iau, `${CACHE}/iau`) : []
    let seaLevel: number | null = null
    let water: Grid | null = null
    if (elev && src.sea) {
      seaLevel = src.sea.kind === 'volume' ? levelForVolume(elev, src.radiusKm, src.sea.volumeKm3) : src.sea.kind === 'coverage' ? levelForCoverage(elev, src.sea.share) : src.sea.levelM
      water = maskGrid(elev, waterMask(elev, seaLevel, src.sea.kind === 'connected' ? src.sea.seed : undefined))
    }
    const nodes = sampleNodes(src, elev, src.partial && filled ? filled.measured : null, bright, water, features, shapes)
    // Titan-style seas come from outlines, not a level: fold them into water.
    if (src.liquidSeas) {
      nodes.water = nodes.water ?? new Uint8Array(nodes.feature.length)
      nodes.feature.forEach((f, i) => { if (FEATURE_CODES[f] === 'sea') nodes.water![i] = 255 })
    }
    const hasPicture = !!(elev || bright)
    if (hasPicture) writeFileSync(`public/maps/${src.file}.png`, png(IMG_W, IMG_H, picture(elev, bright, water)))
    const n = nodes.elev.length
    const wet = nodes.water ? Array.from(nodes.water).filter((v) => v >= 128).length / n : 0
    report.push(`${src.name.padEnd(9)} ${src.kind.padEnd(8)} sea ${seaLevel === null ? '—'.padStart(8) : `${Math.round(seaLevel)} m`.padStart(8)}  water ${(wet * 100).toFixed(1).padStart(5)}%  mapped ${((Array.from(nodes.mapped).filter(Boolean).length / n) * 100).toFixed(0).padStart(3)}%  features ${Array.from(nodes.feature).filter(Boolean).length}  ${((bytesDownloaded - t0) / 1e6).toFixed(1)} MB`)
    entries.push(`  ${JSON.stringify(src.name)}: {
    kind: ${JSON.stringify(src.kind)},
    seaLevelM: ${seaLevel === null ? 'null' : Math.round(seaLevel)},
    source: ${JSON.stringify(src.credit)},
    picture: ${hasPicture ? JSON.stringify(`maps/${src.file}.png`) : 'null'},
    elev: ${elev ? JSON.stringify(b64(nodes.elev)) : 'null'},
    rough: ${elev ? JSON.stringify(b64(nodes.rough)) : 'null'},
    bright: ${nodes.bright ? JSON.stringify(b64(nodes.bright)) : 'null'},
    water: ${nodes.water ? JSON.stringify(b64(nodes.water)) : 'null'},
    feature: ${JSON.stringify(b64(nodes.feature))},
    mapped: ${JSON.stringify(b64(nodes.mapped))},
  },`)
  }
  const file = `// GENERATED by scripts/terrain/build.ts — do not edit by hand.
// Real maps of the solar system's solid bodies, sampled onto the planetary
// map's fine nodes (${surfaceMesh().count.fine}). Decoded by scene/bodyTopography.ts.
// Venus's sea covers ${(EARTH_OCEAN_COVERAGE * 100).toFixed(1)}% of it, Earth's share (not Earth's volume).

export interface RawTopography {
  kind: 'water' | 'airless' | 'icy' | 'io' | 'titan'
  seaLevelM: number | null
  source: string
  picture: string | null // under public/
  elev: string | null // Int16 metres
  rough: string | null // Uint8, units of the body's roughUnitM
  bright: string | null // Uint8 brightness percentile
  water: string | null // Uint8 share of the node's cell under water (0–255)
  feature: string // Uint8 index into FEATURE_CODES
  mapped: string // Uint8 1 = real data, 0 = unmapped (procedural there)
}

export const BODY_TOPOGRAPHY: Record<string, RawTopography> = {
${entries.join('\n')}
}
`
  writeFileSync('src/data/bodyTopography.ts', file)
  console.log(report.join('\n'))
  console.log(`downloaded ${(bytesDownloaded / 1e6).toFixed(1)} MB this run`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
