// Readers for the planetary data the terrain pipeline uses (build-time only;
// never shipped). Every reader returns the same thing: an equirectangular grid
// with row 0 at +90° latitude and column 0 at −180° longitude, NaN where there
// is no data. Sources are read over HTTP with range requests, so only the rows
// we sample are downloaded, and results are cached on disk.
//
//   readTiffGrid   uncompressed strip TIFF / BigTIFF (the USGS global mosaics)
//   readRawGrid    raw PDS .img (MOLA MEGDR)
//   readEtopo      NOAA ETOPO 2022 via OPeNDAP (binary DAP2)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export interface Grid {
  w: number
  h: number
  data: Float32Array // row-major, north first, west first
}

export let bytesDownloaded = 0

async function fetchBytes(url: string, start?: number, end?: number, attempt = 0): Promise<Uint8Array> {
  try {
    const res = await fetch(url, start === undefined ? {} : { headers: { Range: `bytes=${start}-${end}` } })
    if (!res.ok) throw new Error(`${res.status} ${url}`)
    const buf = new Uint8Array(await res.arrayBuffer())
    bytesDownloaded += buf.length
    return buf
  } catch (e) {
    if (attempt >= 4) throw e
    await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)))
    return fetchBytes(url, start, end, attempt + 1)
  }
}

// Runs `jobs` with at most `n` in flight.
async function pool<T>(jobs: (() => Promise<T>)[], n: number): Promise<T[]> {
  const out = new Array<T>(jobs.length)
  let next = 0
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (next < jobs.length) {
        const i = next++
        out[i] = await jobs[i]()
      }
    }),
  )
  return out
}

function cached(path: string, build: () => Promise<Grid>): Promise<Grid> {
  if (existsSync(path)) {
    const buf = readFileSync(path)
    const w = buf.readUInt32LE(0)
    const h = buf.readUInt32LE(4)
    const data = new Float32Array(buf.buffer.slice(buf.byteOffset + 8, buf.byteOffset + 8 + w * h * 4))
    return Promise.resolve({ w, h, data })
  }
  return build().then((g) => {
    mkdirSync(dirname(path), { recursive: true })
    const head = Buffer.alloc(8)
    head.writeUInt32LE(g.w, 0)
    head.writeUInt32LE(g.h, 4)
    writeFileSync(path, Buffer.concat([head, Buffer.from(g.data.buffer)]))
    return g
  })
}

// Shift a grid whose column 0 is at `lon0` (degrees) so column 0 is at −180°.
function recentre(g: Grid, lon0: number): Grid {
  const shift = Math.round(((((lon0 + 180) % 360) + 360) % 360) / (360 / g.w))
  if (shift === 0) return g
  const out = new Float32Array(g.data.length)
  for (let r = 0; r < g.h; r++) for (let c = 0; c < g.w; c++) out[r * g.w + ((c + shift) % g.w)] = g.data[r * g.w + c]
  return { ...g, data: out }
}

// --- TIFF ------------------------------------------------------------------------

interface Ifd {
  width: number
  height: number
  bits: number
  format: number // 1 uint, 2 int, 3 float
  spp: number // samples per pixel (averaged, e.g. RGB → grey)
  rowsPerStrip: number
  stripOffsets: number[]
  compression: number
  scale: number
  offset: number
  nodata: number | null
  lon0: number // west edge of column 0, degrees
  tie: number[] | null
  pix: number[] | null
  lat0: number // north edge of row 0
  big: boolean
  le: boolean
}

export async function readIfd(url: string): Promise<Ifd> {
  const head = await fetchBytes(url, 0, 65535)
  const dv = new DataView(head.buffer)
  const le = head[0] === 0x49
  const big = dv.getUint16(2, le) === 43
  const off = big ? Number(dv.getBigUint64(8, le)) : dv.getUint32(4, le)
  const count = big ? Number(dv.getBigUint64(off, le)) : dv.getUint16(off, le)
  const entrySize = big ? 20 : 12
  const tags = new Map<number, { type: number; n: number; valueAt: number }>()
  for (let i = 0; i < count; i++) {
    const e = off + (big ? 8 : 2) + i * entrySize
    tags.set(dv.getUint16(e, le), { type: dv.getUint16(e + 2, le), n: big ? Number(dv.getBigUint64(e + 4, le)) : dv.getUint32(e + 4, le), valueAt: e + (big ? 12 : 8) })
  }
  const typeSize: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 11: 4, 12: 8, 16: 8 }
  // Read a tag's values, fetching them from further in the file when they
  // don't fit in the entry.
  const values = async (tag: number): Promise<number[] | string | null> => {
    const t = tags.get(tag)
    if (!t) return null
    const size = typeSize[t.type] * t.n
    let buf: DataView
    let base: number
    if (size <= (big ? 8 : 4)) {
      buf = dv
      base = t.valueAt
    } else {
      const at = big ? Number(dv.getBigUint64(t.valueAt, le)) : dv.getUint32(t.valueAt, le)
      const bytes = at + size <= head.length ? head.slice(at, at + size) : await fetchBytes(url, at, at + size - 1)
      buf = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      base = 0
    }
    if (t.type === 2) return new TextDecoder().decode(new Uint8Array(buf.buffer, buf.byteOffset + base, t.n)).replace(/\0+$/, '')
    const out: number[] = []
    for (let i = 0; i < t.n; i++) {
      const p = base + i * typeSize[t.type]
      out.push(
        t.type === 3 ? buf.getUint16(p, le) : t.type === 4 ? buf.getUint32(p, le) : t.type === 16 ? Number(buf.getBigUint64(p, le)) : t.type === 12 ? buf.getFloat64(p, le) : t.type === 11 ? buf.getFloat32(p, le) : buf.getUint8(p),
      )
    }
    return out
  }
  const num = async (tag: number, dflt: number) => ((await values(tag)) as number[] | null)?.[0] ?? dflt
  const width = await num(256, 0)
  const height = await num(257, 0)
  const meta = ((await values(42112)) as string | null) ?? ''
  const nodataStr = ((await values(42113)) as string | null) ?? null
  const scale = Number(/<Item name="SCALE"[^>]*>([^<]+)</i.exec(meta)?.[1] ?? 1)
  const offset = Number(/<Item name="OFFSET"[^>]*>([^<]+)</i.exec(meta)?.[1] ?? 0)
  const tie = (await values(33922)) as number[] | null
  const pix = (await values(33550)) as number[] | null
  // Georeference: pixel scale and tiepoint are in metres for these mosaics
  // (equirectangular); the span is the whole globe, so use the tiepoint's sign
  // to tell 0–360 from −180–180.
  // The projection's central meridian (GeoKeys ProjCenterLong 3088 /
  // ProjNatOriginLong 3080, stored as doubles in tag 34736): x is measured
  // from it, so a clon=180 mosaic's west edge is at 0°, not −180°.
  const geoKeys = (await values(34735)) as number[] | null
  const geoDoubles = (await values(34736)) as number[] | null
  let centralMeridian = 0
  if (geoKeys && geoDoubles) {
    for (let k = 4; k + 3 < geoKeys.length; k += 4) {
      if ((geoKeys[k] === 3088 || geoKeys[k] === 3080) && geoKeys[k + 1] === 34736) centralMeridian = geoDoubles[geoKeys[k + 3]]
    }
  }
  let lon0 = -180
  if (tie && pix) {
    const spanX = pix[0] * width
    const west = tie[3] - tie[0] * pix[0]
    lon0 = (west / spanX) * 360 + centralMeridian
    if (Math.abs(lon0) < 1) lon0 = 0
    else if (Math.abs(lon0 + 180) < 1) lon0 = -180
  }
  return {
    width,
    height,
    bits: await num(258, 8),
    format: await num(339, 1),
    spp: await num(277, 1),
    rowsPerStrip: await num(278, height),
    stripOffsets: ((await values(273)) as number[]) ?? [],
    compression: await num(259, 1),
    scale,
    offset,
    nodata: nodataStr !== null && nodataStr.trim() !== '' ? Number(nodataStr) : null,
    lon0,
    tie,
    pix,
    lat0: 90,
    big,
    le,
  }
}

// A global equirectangular TIFF, read at `outW`×`outH`: one source row per
// output row (the nearest), and each output cell the mean of its block of
// source columns.
export function readTiffGrid(url: string, outW: number, outH: number, cachePath: string): Promise<Grid> {
  return cached(cachePath, async () => {
    const ifd = await readIfd(url)
    if (ifd.compression !== 1) throw new Error(`compressed TIFF not supported: ${url}`)
    const bpp = ifd.bits / 8
    const px = bpp * ifd.spp
    const rowBytes = ifd.width * px
    const data = new Float32Array(outW * outH)
    const jobs = Array.from({ length: outH }, (_, r) => async () => {
      const src = Math.min(ifd.height - 1, Math.floor(((r + 0.5) / outH) * ifd.height))
      const strip = Math.floor(src / ifd.rowsPerStrip)
      const start = ifd.stripOffsets[strip] + (src % ifd.rowsPerStrip) * rowBytes
      const row = await fetchBytes(url, start, start + rowBytes - 1)
      const dv = new DataView(row.buffer, row.byteOffset, row.byteLength)
      const read = (x: number): number => {
        if (ifd.spp > 1) {
          let s = 0
          for (let k = 0; k < ifd.spp; k++) s += row[x * px + k]
          return s / ifd.spp
        }
        const p = x * px
        const v =
          ifd.format === 3 ? (bpp === 4 ? dv.getFloat32(p, ifd.le) : dv.getFloat64(p, ifd.le)) : ifd.format === 2 ? (bpp === 2 ? dv.getInt16(p, ifd.le) : bpp === 4 ? dv.getInt32(p, ifd.le) : dv.getInt8(p)) : bpp === 2 ? dv.getUint16(p, ifd.le) : bpp === 4 ? dv.getUint32(p, ifd.le) : dv.getUint8(p)
        return ifd.nodata !== null && v === ifd.nodata ? NaN : v * ifd.scale + ifd.offset
      }
      for (let c = 0; c < outW; c++) {
        const x0 = Math.floor((c / outW) * ifd.width)
        const x1 = Math.max(x0 + 1, Math.floor(((c + 1) / outW) * ifd.width))
        let sum = 0
        let n = 0
        for (let x = x0; x < x1; x++) {
          const v = read(x)
          if (Number.isFinite(v)) {
            sum += v
            n++
          }
        }
        data[r * outW + c] = n > 0 ? sum / n : NaN
      }
    })
    await pool(jobs, 12)
    return recentre({ w: outW, h: outH, data }, ifd.lon0)
  })
}

// Raw int16 PDS image (MOLA MEGDR big-endian; LOLA LDEM little-endian, ×0.5): `W`×`H`, column 0 at lon0.
export function readRawGrid(url: string, W: number, H: number, lon0: number, outW: number, outH: number, cachePath: string, littleEndian = false, scale = 1): Promise<Grid> {
  return cached(cachePath, async () => {
    const buf = await fetchBytes(url)
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
    const data = new Float32Array(outW * outH)
    for (let r = 0; r < outH; r++) {
      const y0 = Math.floor((r / outH) * H), y1 = Math.max(y0 + 1, Math.floor(((r + 1) / outH) * H))
      for (let c = 0; c < outW; c++) {
        const x0 = Math.floor((c / outW) * W), x1 = Math.max(x0 + 1, Math.floor(((c + 1) / outW) * W))
        let sum = 0, n = 0
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { sum += dv.getInt16((y * W + x) * 2, littleEndian) * scale; n++ }
        data[r * outW + c] = sum / n
      }
    }
    return recentre({ w: outW, h: outH, data }, lon0)
  })
}

// NOAA ETOPO 2022 (60″, bedrock) through OPeNDAP, every `stride`-th sample,
// fetched in bands of rows. The source's rows run south→north; flipped here.
export function readEtopo(stride: number, cachePath: string): Promise<Grid> {
  return cached(cachePath, async () => {
    const base = 'https://www.ngdc.noaa.gov/thredds/dodsC/global/ETOPO2022/60s/60s_bed_elev_netcdf/ETOPO_2022_v1_60s_N90W180_bed.nc.dods'
    const W = 21600, H = 10800
    const w = Math.ceil(W / stride), h = Math.ceil(H / stride)
    const data = new Float32Array(w * h)
    const band = 150 // output rows per request
    const jobs = []
    for (let r0 = 0; r0 < h; r0 += band) {
      const rows = Math.min(band, h - r0)
      jobs.push(async () => {
        const q = `z[${r0 * stride}:${stride}:${(r0 + rows - 1) * stride}][0:${stride}:${W - 1}]`
        const buf = await fetchBytes(`${base}?${encodeURIComponent(q)}`)
        const marker = new TextEncoder().encode('\nData:\n')
        let at = -1
        for (let i = 0; i < buf.length - marker.length; i++) {
          let ok = true
          for (let j = 0; j < marker.length; j++) if (buf[i + j] !== marker[j]) { ok = false; break }
          if (ok) { at = i + marker.length; break }
        }
        if (at < 0) throw new Error('bad DAP reply')
        const dv = new DataView(buf.buffer, buf.byteOffset + at + 8)
        for (let k = 0; k < rows * w; k++) {
          const srcRow = Math.floor(k / w)
          const outRow = h - 1 - (r0 + srcRow) // flip to north-first
          data[outRow * w + (k % w)] = dv.getFloat32(k * 4, false)
        }
      })
    }
    await pool(jobs, 4)
    return { w, h, data }
  })
}

// --- IAU Gazetteer (planetary nomenclature) -------------------------------------
// Named features per body from the USGS/IAU shapefiles: centre points with
// diameter and type, and (where published) outlines. Unzipped with the system
// `unzip`; cached.

export interface Feature {
  name: string
  type: string // e.g. "Mons, montes", "Patera, paterae", "Mare, maria"
  lon: number // degrees east, −180..180
  lat: number
  diameterKm: number
}

export interface FeatureShape {
  name: string
  type: string
  rings: [number, number][][] // lon, lat (degrees east, −180..180)
}

const wrapLon = (lon: number) => ((((lon + 180) % 360) + 360) % 360) - 180

function parseDbf(buf: Buffer): Record<string, string>[] {
  const n = buf.readUInt32LE(4)
  const headerLen = buf.readUInt16LE(8)
  const recLen = buf.readUInt16LE(10)
  const fields: { name: string; len: number }[] = []
  for (let p = 32; buf[p] !== 0x0d; p += 32) fields.push({ name: buf.subarray(p, p + 11).toString('latin1').replace(/\0.*$/, ''), len: buf[p + 16] })
  const out: Record<string, string>[] = []
  for (let i = 0; i < n; i++) {
    let o = headerLen + i * recLen + 1
    const rec: Record<string, string> = {}
    for (const f of fields) {
      rec[f.name] = buf.subarray(o, o + f.len).toString('utf8').trim()
      o += f.len
    }
    out.push(rec)
  }
  return out
}

async function unzipTo(url: string, dir: string): Promise<string[]> {
  const { execFileSync } = await import('node:child_process')
  const { readdirSync } = await import('node:fs')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
    const zip = await fetchBytes(url)
    writeFileSync(`${dir}/src.zip`, zip)
    execFileSync('unzip', ['-o', '-q', `${dir}/src.zip`, '-d', dir])
  }
  return readdirSync(dir).map((f) => `${dir}/${f}`)
}

export async function readFeatures(target: string, cacheDir: string): Promise<Feature[]> {
  const files = await unzipTo(`https://asc-planetarynames-data.s3.us-west-2.amazonaws.com/${target}_nomenclature_center_pts.zip`, `${cacheDir}/${target}_pts`)
  const dbf = files.find((f) => f.endsWith('.dbf'))!
  return parseDbf(readFileSync(dbf)).map((r) => ({
    name: r.clean_name || r.name,
    type: r.type,
    lon: wrapLon(Number(r.center_lon)),
    lat: Number(r.center_lat),
    diameterKm: Number(r.diameter) || 0,
  }))
}

// Polygon outlines (shapefile type 5), joined to their names in the .dbf.
export async function readFeatureShapes(target: string, cacheDir: string): Promise<FeatureShape[]> {
  const files = await unzipTo(`https://asc-planetarynames-data.s3.us-west-2.amazonaws.com/${target}_nomenclature_geometries.zip`, `${cacheDir}/${target}_geo`)
  const shp = readFileSync(files.find((f) => f.endsWith('.shp'))!)
  const recs = parseDbf(readFileSync(files.find((f) => f.endsWith('.dbf'))!))
  const out: FeatureShape[] = []
  let p = 100
  let i = 0
  while (p + 8 <= shp.length) {
    const len = shp.readUInt32BE(p + 4) * 2
    const body = p + 8
    const type = shp.readInt32LE(body)
    if (type === 5 || type === 15) {
      const numParts = shp.readInt32LE(body + 36)
      const numPoints = shp.readInt32LE(body + 40)
      const parts: number[] = []
      for (let k = 0; k < numParts; k++) parts.push(shp.readInt32LE(body + 44 + k * 4))
      const ptsAt = body + 44 + numParts * 4
      const rings: [number, number][][] = []
      for (let k = 0; k < numParts; k++) {
        const end = k + 1 < numParts ? parts[k + 1] : numPoints
        const ring: [number, number][] = []
        for (let q = parts[k]; q < end; q++) ring.push([wrapLon(shp.readDoubleLE(ptsAt + q * 16)), shp.readDoubleLE(ptsAt + q * 16 + 8)])
        rings.push(ring)
      }
      const r = recs[i] ?? {}
      out.push({ name: r.clean_name || r.name || '', type: r.type || '', rings })
    }
    p = body + len
    i++
  }
  return out
}
