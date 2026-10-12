import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { BufferAttribute, BufferGeometry, DoubleSide, type PointsMaterial } from 'three'
import { useGroundViewStore } from '../state/groundViewStore'
import { useInfrastructureStore } from '../state/infrastructureStore'
import { useLensStore } from '../state/lensStore'
import { useGameTimeStore } from '../state/gameTimeStore'
import type { LocationKind } from '../data/locationData'
import { lensSites } from './lensActions'
import { locationById } from './locations'
import { flatPos } from './mapProjection'
import type { BodySurface } from './planetTerrain'
import { surfaceMesh, nodePoint, normalize, type SurfacePoint } from './surfaceMesh'
import { useZoneStore } from '../state/zoneStore'
import { ruralSummary } from './ruralState'
import { cellShape } from './cellOutline'

// What the build lens draws on the ground map (state/lensStore, scene/lensActions): the zones districts may grow into, the cells
// under the pointer with the tool in hand (green: it would work, red: it would not), the pulse where something was just ordered,
// the roads and railways, and the nature reserves. All as point clouds and line segments built once per change, never per frame.
const GLOBE_RADIUS = 5
function positionOf(node: number, flat: boolean, lift: number): [number, number, number] {
  const mesh = surfaceMesh()
  if (flat) return flatPos({ x: mesh.positions[node * 3], y: mesh.positions[node * 3 + 1], z: mesh.positions[node * 3 + 2] }, 0.02 + lift)
  const r = GLOBE_RADIUS * (1.01 + lift * 0.01)
  return [mesh.positions[node * 3] * r, mesh.positions[node * 3 + 1] * r, mesh.positions[node * 3 + 2] * r]
}

function useCloud(cells: readonly number[], colors: readonly [number, number, number][] | [number, number, number], flat: boolean, lift = 0): BufferGeometry {
  const geometry = useMemo(() => {
    const pos = new Float32Array(cells.length * 3)
    const col = new Float32Array(cells.length * 3)
    cells.forEach((c, i) => {
      pos.set(positionOf(c, flat, lift), i * 3)
      const rgb = Array.isArray(colors[0]) ? (colors as [number, number, number][])[i] : (colors as [number, number, number])
      col.set(rgb, i * 3)
    })
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(pos, 3))
    g.setAttribute('color', new BufferAttribute(col, 3))
    return g
  }, [cells, colors, flat, lift])
  useEffect(() => () => geometry.dispose(), [geometry])
  return geometry
}

// The Zoning map mode: every district's zone as a tinted area with a defined border, the ground it has actually built over picked out in
// white inside it, nature reserves in green. Shown while the mode is on in the ground menu, and while the zone or reserve tool is in hand.
// Vivid zone colours (normal blending, so they read on light ground and dark alike).
const ZONE_COLOR: Record<LocationKind, [number, number, number]> = {
  settlement: [1, 0.78, 0.2],
  industrial: [1, 0.45, 0.1],
  resource: [0.8, 0.5, 0.3],
  agricultural: [0.45, 0.95, 0.2],
  infrastructure: [0.4, 0.7, 1],
  strategic: [1, 0.35, 0.35],
}

// A line drawn as a flat ribbon of constant width on the map (WebGL lines are one pixel, which is too thin to read as a border).
function ribbon(pts: Float32Array, width: number, flat: boolean, colors?: number[]): { position: Float32Array; color?: Float32Array } {
  const segs = pts.length / 6
  const pos = new Float32Array(segs * 18)
  const col = colors ? new Float32Array(segs * 18) : undefined
  for (let i = 0; i < segs; i++) {
    const o = i * 6
    const ax = pts[o], ay = pts[o + 1], az = pts[o + 2], bx = pts[o + 3], by = pts[o + 4], bz = pts[o + 5]
    const dx = bx - ax, dy = by - ay, dz = bz - az
    // Perpendicular on the surface: the globe's normal is the point itself, the flat map's is z.
    const nx = flat ? 0 : (ax + bx) / 2, ny = flat ? 0 : (ay + by) / 2, nz = flat ? 1 : (az + bz) / 2
    let px = dy * nz - dz * ny, py = dz * nx - dx * nz, pz = dx * ny - dy * nx
    const len = Math.hypot(px, py, pz) || 1
    px = (px / len) * width
    py = (py / len) * width
    pz = (pz / len) * width
    const q = [ax - px, ay - py, az - pz, ax + px, ay + py, az + pz, bx + px, by + py, bz + pz, ax - px, ay - py, az - pz, bx + px, by + py, bz + pz, bx - px, by - py, bz - pz]
    pos.set(q, i * 18)
    if (col && colors) for (let k = 0; k < 6; k++) col.set([colors[i * 3], colors[i * 3 + 1], colors[i * 3 + 2]], i * 18 + k * 3)
  }
  return { position: pos, color: col }
}

function ZoningLayer({ surface, flat }: { surface: BodySurface; flat: boolean }) {
  const mode = useGroundViewStore((s) => s.zoningMode)
  const armed = useLensStore((s) => s.armed)
  const picked = useLensStore((s) => s.zoneSiteId)
  const reserves = useZoneStore((s) => s.reserves[surface.bodyName])
  const show = mode || armed?.kind === 'zone' || armed?.kind === 'reserve'
  const geometries = useMemo(() => {
    if (!show) return null
    const mesh = surfaceMesh()
    const lon = (i: number) => Math.atan2(-mesh.positions[i * 3 + 2], mesh.positions[i * 3])
    // On the flat map a triangle across the 180th meridian would smear across the whole map: leave it out.
    const skip = flat ? (a: number, b: number, c: number) => Math.max(Math.abs(lon(a) - lon(b)), Math.abs(lon(b) - lon(c)), Math.abs(lon(c) - lon(a))) > Math.PI : undefined
    const fill: number[] = []
    const fillColor: number[] = []
    const border: number[] = []
    const borderColor: number[] = []
    const built: number[] = []
    const add = (shape: { tris: number[]; lines: number[] }, rgb: number[], borderRgb: number[]) => {
      fill.push(...shape.tris)
      for (let i = 0; i < shape.tris.length / 3; i++) fillColor.push(rgb[0], rgb[1], rgb[2])
      border.push(...shape.lines)
      for (let i = 0; i < shape.lines.length / 6; i++) borderColor.push(...borderRgb)
    }
    for (const s of lensSites(surface.bodyName)) {
      if (s.zone.length === 0) continue
      const kind = (locationById(s.siteId)?.kind ?? 'settlement') as LocationKind
      const rgb = ZONE_COLOR[kind]
      const chosen = picked === s.siteId
      add(cellShape(new Set(s.zone), skip), chosen ? [1, 1, 1] : rgb, chosen ? [1, 1, 1] : rgb)
      if (s.footprint.length > 0) built.push(...cellShape(new Set(s.footprint), skip).lines)
    }
    if (reserves && reserves.length > 0) add(cellShape(new Set(reserves), skip), [0.2, 0.9, 0.45], [0.3, 1, 0.55])
    // Project onto the map: lifted just above the ground, fill under border under the built-over outline.
    const lifted = (pts: number[], lift: number): Float32Array => {
      const out = new Float32Array(pts.length)
      for (let i = 0; i < pts.length; i += 3) {
        const p = normalize({ x: pts[i], y: pts[i + 1], z: pts[i + 2] })
        if (flat) out.set(flatPos(p, 0.012 + lift * 0.008), i)
        else {
          const r = GLOBE_RADIUS * (1.006 + lift * 0.004)
          out.set([p.x * r, p.y * r, p.z * r], i)
        }
      }
      return out
    }
    const bandW = flat ? 0.07 : 0.014
    const make = (position: Float32Array, color?: Float32Array) => {
      const g = new BufferGeometry()
      g.setAttribute('position', new BufferAttribute(position, 3))
      if (color) g.setAttribute('color', new BufferAttribute(color, 3))
      return g
    }
    const borderRib = ribbon(lifted(border, 2), bandW, flat, borderColor)
    const builtRib = ribbon(lifted(built, 4), bandW * 0.7, flat)
    return { fill: make(lifted(fill, 0), Float32Array.from(fillColor)), border: make(borderRib.position, borderRib.color), built: make(builtRib.position) }
  }, [show, flat, surface, picked, reserves])
  useEffect(
    () => () => {
      geometries?.fill.dispose()
      geometries?.border.dispose()
      geometries?.built.dispose()
    },
    [geometries],
  )
  if (!geometries) return null
  return (
    <>
      <mesh geometry={geometries.fill} renderOrder={3}>
        <meshBasicMaterial vertexColors transparent opacity={0.34} depthWrite={false} depthTest={!flat} side={DoubleSide} />
      </mesh>
      <mesh geometry={geometries.border} renderOrder={4}>
        <meshBasicMaterial vertexColors transparent opacity={0.95} depthWrite={false} depthTest={!flat} side={DoubleSide} />
      </mesh>
      <mesh geometry={geometries.built} renderOrder={5}>
        <meshBasicMaterial color="#ffffff" transparent opacity={0.95} depthWrite={false} depthTest={!flat} side={DoubleSide} />
      </mesh>
    </>
  )
}

// The homesteads and farmsteads of the countryside: small warm marks on rural ground, one for about two million rural people.
function RuralMarks({ surface, flat }: { surface: BodySurface; flat: boolean }) {
  const marks = useMemo(() => ruralSummary(surface.bodyName).marks, [surface])
  const geometry = useCloud(marks, [1, 0.88, 0.6], flat, 0)
  if (marks.length === 0) return null
  return (
    <points geometry={geometry}>
      <pointsMaterial vertexColors size={flat ? 2.5 : 0.03} sizeAttenuation={!flat} transparent opacity={0.85} depthWrite={false} />
    </points>
  )
}

function HoverCloud({ flat }: { flat: boolean }) {
  const hover = useLensStore((s) => s.hover)
  const cells = hover?.cells ?? []
  const color: [number, number, number] = hover?.ok ? [0.3, 1, 0.5] : [1, 0.3, 0.3]
  const geometry = useCloud(cells, color, flat, 1)
  if (!hover || cells.length === 0) return null
  return (
    <points geometry={geometry}>
      <pointsMaterial vertexColors size={flat ? 7 : 0.09} sizeAttenuation={!flat} transparent opacity={0.95} depthWrite={false} />
    </points>
  )
}

// Where something was just ordered: the district's cells swell and fade over about a second.
const PULSE_MS = 1300
function PulseCloud({ flat }: { flat: boolean }) {
  const pulse = useLensStore((s) => s.pulse)
  const cells = pulse?.cells ?? []
  const geometry = useCloud(cells, pulse?.ok === false ? [1, 0.3, 0.3] : [0.5, 1, 1], flat, 2)
  const material = useRef<PointsMaterial>(null)
  useFrame(() => {
    const m = material.current
    if (!m || !pulse) return
    const t = Math.min(1, (Date.now() - pulse.startedMs) / PULSE_MS)
    m.opacity = 1 - t
    m.size = (flat ? 6 : 0.08) * (1 + 2.2 * t)
  })
  if (!pulse || cells.length === 0 || Date.now() - pulse.startedMs > PULSE_MS) return null
  return (
    <points geometry={geometry} key={pulse.seq}>
      <pointsMaterial ref={material} vertexColors size={flat ? 6 : 0.08} sizeAttenuation={!flat} transparent depthWrite={false} />
    </points>
  )
}

// Points along the great circle between two nodes, `steps` segments (a route's path).
function arcPoints(a: number, b: number, steps: number): SurfacePoint[] {
  const pa = nodePoint(a)
  const pb = nodePoint(b)
  const out: SurfacePoint[] = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    out.push(normalize({ x: pa.x * (1 - t) + pb.x * t, y: pa.y * (1 - t) + pb.y * t, z: pa.z * (1 - t) + pb.z * t }))
  }
  return out
}

// Roads and railways of this world, between the sites they join: solid when working, dim while still being built, orange in disrepair.
function RouteLines({ bodyName, flat }: { bodyName: string; flat: boolean }) {
  const routes = useInfrastructureStore((s) => s.routes)
  const nowDay = useGameTimeStore((s) => Math.floor(s.simDays / 5))
  const { geometry, count } = useMemo(() => {
    const simDays = nowDay * 5
    const seg: number[] = []
    const col: number[] = []
    for (const r of routes) {
      if (r.bodyName !== bodyName) continue
      const sa = locationById(r.a)
      const sb = locationById(r.b)
      if (!sa || !sb || sa.node === null || sb.node === null) continue
      const working = simDays >= r.readySimDays
      const base: [number, number, number] = r.disrepair ? [1, 0.55, 0.2] : r.kind === 'rail' ? [0.92, 0.92, 1] : [0.85, 0.72, 0.5]
      const k = working ? 1 : 0.4
      const pts = arcPoints(sa.node, sb.node, Math.max(2, Math.round(r.cells)))
      for (let i = 0; i + 1 < pts.length; i++) {
        if (flat && Math.abs(Math.atan2(-pts[i].z, pts[i].x) - Math.atan2(-pts[i + 1].z, pts[i + 1].x)) > Math.PI) continue
        const a = flat ? flatPos(pts[i], 0.03) : [pts[i].x * GLOBE_RADIUS * 1.012, pts[i].y * GLOBE_RADIUS * 1.012, pts[i].z * GLOBE_RADIUS * 1.012]
        const b = flat ? flatPos(pts[i + 1], 0.03) : [pts[i + 1].x * GLOBE_RADIUS * 1.012, pts[i + 1].y * GLOBE_RADIUS * 1.012, pts[i + 1].z * GLOBE_RADIUS * 1.012]
        seg.push(...a, ...b)
        col.push(base[0] * k, base[1] * k, base[2] * k, base[0] * k, base[1] * k, base[2] * k)
      }
    }
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(Float32Array.from(seg), 3))
    g.setAttribute('color', new BufferAttribute(Float32Array.from(col), 3))
    return { geometry: g, count: seg.length / 3 }
  }, [routes, bodyName, flat, nowDay])
  useEffect(() => () => geometry.dispose(), [geometry])
  if (count === 0) return null
  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial vertexColors transparent opacity={0.95} depthWrite={false} />
    </lineSegments>
  )
}

export function LensLayers({ surface }: { surface: BodySurface }) {
  const flat = useGroundViewStore((s) => s.projection === 'flat')
  return (
    <>
      <RouteLines bodyName={surface.bodyName} flat={flat} />
      <RuralMarks surface={surface} flat={flat} />
      <ZoningLayer surface={surface} flat={flat} />
      <HoverCloud flat={flat} />
      <PulseCloud flat={flat} />
    </>
  )
}

