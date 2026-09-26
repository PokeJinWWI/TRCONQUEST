import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, type ThreeEvent } from '@react-three/fiber'
import { Html, Line, OrbitControls } from '@react-three/drei'
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, ShaderMaterial, SRGBColorSpace, type Group } from 'three'
import type { Line2 } from 'three-stdlib'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { ownerDisplay } from '../data/countryRoster'
import { TERRAIN, UNIT_TYPES } from '../data/groundData'
import { LINE_THICKNESS_PX, useSettingsStore } from '../state/settingsStore'
import { useGroundViewStore } from '../state/groundViewStore'
import { usePlayerStore } from '../state/playerStore'
import { atWar } from '../state/diplomacyStore'
import { relationColorOf, useRelationKey } from '../state/shipRelations'
import { useTerrainStore } from '../state/terrainStore'
import { useViewStore } from '../state/viewStore'
import { TerrainPanel, describeCover } from '../components/TerrainPanel'
import { DistanceThresholdWatcher } from './DistanceThresholdWatcher'
import { KeyboardPan } from './KeyboardPan'
import { isAdditiveClick } from './selectionInput'
import { isQueueModifierHeld } from './queueModifier'
import { bodyGroundInfo } from './planetTerrain'
import { heightAtLocal, terrainAtLocal, type TerrainGrid } from './terrainMap'
import { rangeCells } from './terrainBattle'

// The terrain map: a fight that has come to close quarters, on real relief. The
// ground is a glowing point cloud (the world's own glow colour, brighter where
// it is higher) over a faint contour mesh; the units stand on it, and the
// player commands them exactly as on the planetary map — click to select
// (Shift/Ctrl/Cmd adds), right-click the ground to move, Shift + right-click
// to queue, right-click an enemy to focus fire. The rules are in
// scene/terrainBattle.ts; this only draws and sends orders.
const CELL = 1.4 // world units per fine cell
const HEIGHT_SCALE = 0.0011 // world units per metre (the relief is exaggerated so it reads)
const CLOUD_SIDE = 176 // points along a side of the drawn cloud
const EXIT_DISTANCE = 30

const toWorld = (x: number, y: number, h: number): [number, number, number] => [x * CELL, h * HEIGHT_SCALE, -y * CELL]

// --- Ground ------------------------------------------------------------------

const TERRAIN_LIGHT: Record<string, number> = {
  ocean: 0.22,
  plains: 0.85,
  forest: 0.68,
  desert: 1.0,
  tundra: 1.1,
  mountains: 1.05,
  urban: 1.2,
  rock: 0.9,
  lava: 1,
  cloud: 0.5,
  aerostat: 0.9,
}

// Smooth 2D value noise, for the ground's fine texture (drawn only — the fight
// uses the grid's own heights).
function noise2(x: number, y: number): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const sm = (t: number) => t * t * (3 - 2 * t)
  const fx = sm(x - xi)
  const fy = sm(y - yi)
  const h = (a: number, b: number) => hash2(a, b, 7)
  return (h(xi, yi) * (1 - fx) + h(xi + 1, yi) * fx) * (1 - fy) + (h(xi, yi + 1) * (1 - fx) + h(xi + 1, yi + 1) * fx) * fy
}

function hash2(i: number, j: number, seed: number): number {
  let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(seed, 2147483647)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

// The relief gradient: low ground deep blue, through teal and green to yellow,
// then orange and a pale gold on the peaks (sRGB, low to high). Stretched over
// the patch's own lowest and highest ground, so even a gentle plain shows its
// swells.
const RELIEF_RAMP: [number, [number, number, number]][] = [
  [0, [0.1, 0.25, 0.85]],
  [0.22, [0.08, 0.72, 0.78]],
  [0.45, [0.24, 0.86, 0.42]],
  [0.68, [0.92, 0.88, 0.25]],
  [0.86, [1, 0.6, 0.22]],
  [1, [1, 0.93, 0.78]],
]
const MIN_RELIEF_SPAN_M = 700
// The gradient runs on height to this power (under 1), so the lowlands, where
// most fights are, spread across the colours instead of all being deep blue
// beside one tall peak.
const RELIEF_GAMMA = 0.55
const reliefShare = (h: number, range: { min: number; max: number }) => Math.pow(Math.max(0, Math.min(1, (h - range.min) / (range.max - range.min))), RELIEF_GAMMA)

export function reliefColor(t: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, t))
  for (let k = 1; k < RELIEF_RAMP.length; k++) {
    const [t1, c1] = RELIEF_RAMP[k]
    if (x <= t1) {
      const [t0, c0] = RELIEF_RAMP[k - 1]
      const f = (x - t0) / (t1 - t0)
      return [c0[0] + (c1[0] - c0[0]) * f, c0[1] + (c1[1] - c0[1]) * f, c0[2] + (c1[2] - c0[2]) * f]
    }
  }
  return RELIEF_RAMP[RELIEF_RAMP.length - 1][1]
}

// The heights the gradient is stretched over.
export function reliefRange(grid: TerrainGrid): { min: number; max: number } {
  let min = Infinity
  let max = -Infinity
  for (const h of grid.height) {
    if (h < min) min = h
    if (h > max) max = h
  }
  return { min, max: Math.max(max, min + MIN_RELIEF_SPAN_M) }
}

interface Cloud {
  points: BufferGeometry
  lines: BufferGeometry
}

function buildCloud(grid: TerrainGrid, glow: [number, number, number]): Cloud {
  const n = CLOUD_SIDE
  const half = grid.half
  const pos = new Float32Array(n * n * 3)
  const col = new Float32Array(n * n * 3)
  const flat = new Float32Array(n * n * 3)
  const range = reliefRange(grid)
  const step = (2 * half) / n
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = -half + (i + 0.5) * step
      const y = -half + (j + 0.5) * step
      const h = heightAtLocal(grid, x, y)
      const o = (j * n + i) * 3
      const fine = (noise2(x * 5, y * 5) * 0.6 + noise2(x * 11, y * 11) * 0.4 - 0.5) * (70 + 0.09 * h)
      const micro = fine + (hash2(i, j, 1) - 0.5) * 25
      const jx = (hash2(i, j, 2) - 0.5) * step * 0.7
      const jy = (hash2(i, j, 3) - 0.5) * step * 0.7
      const p = toWorld(x + jx, y + jy, h + micro)
      pos[o] = p[0]
      pos[o + 1] = p[1]
      pos[o + 2] = p[2]
      const q = toWorld(x, y, h)
      flat[o] = q[0]
      flat[o + 1] = q[1]
      flat[o + 2] = q[2]
      // Colour by height along the gradient, a touch of the world's own glow
      // through it, dimmed over water.
      const ramp = reliefColor(reliefShare(h, range))
      const tf = TERRAIN_LIGHT[terrainAtLocal(grid, x, y)] ?? 1
      for (let c = 0; c < 3; c++) col[o + c] = Math.min(1, (ramp[c] * 0.85 + glow[c] * 0.15) * tf)
    }
  }
  const points = new BufferGeometry()
  points.setAttribute('position', new BufferAttribute(pos, 3))
  points.setAttribute('color', new BufferAttribute(col, 3))
  // A contour mesh: every sixth row and column of the (unjittered) cloud, each
  // segment coloured by its height.
  const seg: number[] = []
  const segCol: number[] = []
  const push = (a: number, b: number) => {
    seg.push(flat[a], flat[a + 1], flat[a + 2], flat[b], flat[b + 1], flat[b + 2])
    segCol.push(col[a], col[a + 1], col[a + 2], col[b], col[b + 1], col[b + 2])
  }
  const every = 6
  for (let j = 0; j < n; j += every) {
    for (let i = 0; i + 1 < n; i++) {
      const a = (j * n + i) * 3
      const b = (j * n + i + 1) * 3
      push(a, b)
    }
  }
  for (let i = 0; i < n; i += every) {
    for (let j = 0; j + 1 < n; j++) {
      const a = (j * n + i) * 3
      const b = ((j + 1) * n + i) * 3
      push(a, b)
    }
  }
  const lines = new BufferGeometry()
  lines.setAttribute('position', new BufferAttribute(Float32Array.from(seg), 3))
  lines.setAttribute('color', new BufferAttribute(Float32Array.from(segCol), 3))
  return { points, lines }
}

const LINE_VERT = /* glsl */ `
attribute vec3 color;
varying vec3 vColor;
void main() {
  vColor = color;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`
const LINE_FRAG = /* glsl */ `
varying vec3 vColor;
void main() {
  gl_FragColor = vec4(vColor, 0.3);
}
`

const POINT_VERT = /* glsl */ `
attribute vec3 color;
varying vec3 vColor;
uniform float uSize;
void main() {
  vColor = color;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = clamp(uSize * 320.0 / -mv.z, 1.0, 7.0);
  gl_Position = projectionMatrix * mv;
}
`
const POINT_FRAG = /* glsl */ `
varying vec3 vColor;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d) * 2.0;
  if (r > 1.0) discard;
  float a = pow(1.0 - r, 1.4);
  gl_FragColor = vec4(vColor, a * 0.8);
}
`

function Relief({ grid, glow }: { grid: TerrainGrid; glow: [number, number, number] }) {
  const cloud = useMemo(() => buildCloud(grid, glow), [grid, glow])
  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: POINT_VERT,
        fragmentShader: POINT_FRAG,
        uniforms: { uSize: { value: 0.2 } },
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    [],
  )
  const lineMaterial = useMemo(
    () => new ShaderMaterial({ vertexShader: LINE_VERT, fragmentShader: LINE_FRAG, transparent: true, depthWrite: false, blending: AdditiveBlending }),
    [],
  )
  useEffect(
    () => () => {
      cloud.points.dispose()
      cloud.lines.dispose()
      material.dispose()
      lineMaterial.dispose()
    },
    [cloud, material, lineMaterial],
  )
  const tint = useMemo(() => new Color().setRGB(glow[0], glow[1], glow[2], SRGBColorSpace), [glow])
  const side = grid.half * 2 * CELL
  const h = grid.half * CELL
  return (
    <group>
      <points geometry={cloud.points} material={material} frustumCulled={false} raycast={() => null} />
      <lineSegments geometry={cloud.lines} material={lineMaterial} frustumCulled={false} raycast={() => null} />
      {/* The plate the ground sits on. */}
      <mesh position={[0, -0.03, 0]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
        <planeGeometry args={[side, side]} />
        <meshBasicMaterial color="#02080d" transparent opacity={0.92} depthWrite={false} />
      </mesh>
      <Line
        points={[
          [-h, -0.02, -h],
          [h, -0.02, -h],
          [h, -0.02, h],
          [-h, -0.02, h],
          [-h, -0.02, -h],
        ]}
        color={tint}
        lineWidth={1.4}
        transparent
        opacity={0.8}
      />
      {/* A line per cell of the planetary map, so distances read. */}
      <CellGrid grid={grid} color={tint} />
    </group>
  )
}

function CellGrid({ grid, color }: { grid: TerrainGrid; color: Color }) {
  const geometry = useMemo(() => {
    const seg: number[] = []
    const h = grid.half
    for (let k = -Math.floor(h); k <= Math.floor(h); k++) {
      seg.push(k * CELL, -0.015, -h * CELL, k * CELL, -0.015, h * CELL, -h * CELL, -0.015, k * CELL, h * CELL, -0.015, k * CELL)
    }
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(Float32Array.from(seg), 3))
    return g
  }, [grid])
  useEffect(() => () => geometry.dispose(), [geometry])
  return (
    <lineSegments geometry={geometry} raycast={() => null}>
      <lineBasicMaterial color={color} transparent opacity={0.1} depthWrite={false} />
    </lineSegments>
  )
}

// An invisible copy of the relief that catches the pointer, so a click lands on
// the hill under it and not on a flat plane behind it.
function Catcher({ grid, onHover, onOrder }: { grid: TerrainGrid; onHover: (p: { x: number; y: number } | null) => void; onOrder: (p: { x: number; y: number }) => void }) {
  const geometry = useMemo(() => {
    const n = grid.n
    const pos = new Float32Array(n * n * 3)
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = -grid.half + (i + 0.5) / grid.perCell
        const y = -grid.half + (j + 0.5) / grid.perCell
        pos.set(toWorld(x, y, grid.height[j * n + i]), (j * n + i) * 3)
      }
    }
    const idx: number[] = []
    for (let j = 0; j + 1 < n; j++) {
      for (let i = 0; i + 1 < n; i++) {
        const a = j * n + i
        idx.push(a, a + 1, a + n, a + 1, a + n + 1, a + n)
      }
    }
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(pos, 3))
    g.setIndex(idx)
    return g
  }, [grid])
  useEffect(() => () => geometry.dispose(), [geometry])
  const local = (e: ThreeEvent<MouseEvent | PointerEvent>) => ({ x: e.point.x / CELL, y: -e.point.z / CELL })
  return (
    <mesh
      geometry={geometry}
      onPointerMove={(e) => {
        e.stopPropagation()
        onHover(local(e))
      }}
      onPointerOut={() => onHover(null)}
      onContextMenu={(e) => {
        e.stopPropagation()
        e.nativeEvent.preventDefault()
        onOrder(local(e))
      }}
    >
      <meshBasicMaterial transparent opacity={0} depthWrite={false} side={2} />
    </mesh>
  )
}

// --- Units -------------------------------------------------------------------

const FAN_PX = 13

function findUnit(battleId: string, unitId: string) {
  const battle = useTerrainStore.getState().battles.find((b) => b.id === battleId)
  const unit = battle?.units.find((u) => u.id === unitId)
  return battle && unit ? { battle, unit } : null
}

function UnitMarkers({ battleId }: { battleId: string }) {
  const idsKey = useTerrainStore((s) =>
    (s.battles.find((b) => b.id === battleId)?.units ?? []).map((u) => `${u.id}:${u.ownerId}:${u.type}`).join('|'),
  )
  const entries = idsKey ? idsKey.split('|').map((e) => e.split(':')) : []
  return (
    <>
      {entries.map(([id, ownerId, type]) => (
        <UnitMarker key={id} battleId={battleId} unitId={id} ownerId={ownerId} type={type as keyof typeof UNIT_TYPES} />
      ))}
    </>
  )
}

function UnitMarker({ battleId, unitId, ownerId, type }: { battleId: string; unitId: string; ownerId: string; type: keyof typeof UNIT_TYPES }) {
  const groupRef = useRef<Group>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const barRef = useRef<HTMLSpanElement>(null)
  const selected = useGroundViewStore((s) => s.selectedUnitIds.includes(unitId))
  const player = usePlayerStore((s) => s.selectedCountryId)
  useRelationKey()
  const color = relationColorOf(ownerId, player)
  const hostile = !!player && atWar(ownerId, player)
  const select = (e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }) => {
    if (isAdditiveClick(e)) useGroundViewStore.getState().toggleUnit(unitId)
    else useGroundViewStore.getState().selectUnit(unitId)
  }
  useFrame(() => {
    const found = findUnit(battleId, unitId)
    const g = groupRef.current
    if (!found || !g) return
    const { battle, unit } = found
    g.position.set(...toWorld(unit.x, unit.y, heightAtLocal(battle.grid, unit.x, unit.y) + 60))
    if (wrapRef.current) {
      // Units sharing a spot fan out on screen so each stays clickable.
      let rank = 0
      let count = 0
      for (const u of battle.units) {
        if (Math.hypot(u.x - unit.x, u.y - unit.y) > 0.06) continue
        if (u.id === unitId) rank = count
        count++
      }
      const angle = count > 1 ? (rank / count) * Math.PI * 2 : 0
      const radiusPx = count > 1 ? FAN_PX * Math.min(2, 0.6 + count / 6) : 0
      wrapRef.current.style.transform = `translate(${Math.cos(angle) * radiusPx}px, ${Math.sin(angle) * radiusPx}px)`
    }
    if (barRef.current) barRef.current.style.width = `${Math.max(0, Math.min(1, unit.strength / unit.maxStrength)) * 100}%`
  })
  return (
    <group ref={groupRef}>
      <Html zIndexRange={[10, 0]} pointerEvents="none">
        <div ref={wrapRef} style={{ pointerEvents: 'none' }}>
          <button
            type="button"
            className={`ground-unit-marker${selected ? ' selected' : ''}${hostile ? ' hostile' : ''}`}
            style={{ borderColor: color, color }}
            title={`${ownerDisplay(ownerId).name} — ${UNIT_TYPES[type].name}`}
            onPointerDown={(e) => {
              if (e.button !== 0) return
              e.stopPropagation()
              select(e)
            }}
            onClick={(e) => {
              e.stopPropagation()
              if (e.detail === 0) select(e)
            }}
            onContextMenu={(e) => {
              e.preventDefault()
              e.stopPropagation()
              const view = useGroundViewStore.getState()
              if (!hostile || view.selectedUnitIds.length === 0) return
              const battle = useTerrainStore.getState().battles.find((b) => b.id === battleId)
              const chosen = battle?.units.filter((u) => view.selectedUnitIds.includes(u.id)) ?? []
              const already = chosen.length > 0 && chosen.every((u) => u.targetUnitId === unitId)
              useTerrainStore.getState().targetUnits(battleId, view.selectedUnitIds, already ? null : unitId)
            }}
          >
            {UNIT_TYPES[type].glyph}
            <span className="ground-unit-bar">
              <span ref={barRef} className="ground-unit-bar-fill" style={{ background: color }} />
            </span>
          </button>
        </div>
      </Html>
    </group>
  )
}

const KEY_GLYPHS = '★'

function KeyMarkers({ battleId }: { battleId: string }) {
  const keys = useTerrainStore((s) => s.battles.find((b) => b.id === battleId)?.keys)
  const grid = useTerrainStore((s) => s.battles.find((b) => b.id === battleId)?.grid)
  if (!keys || !grid) return null
  return (
    <>
      {keys.map((k, i) => {
        const color = k.holderId ? ownerDisplay(k.holderId).color : '#cfd8e3'
        return (
          <group key={i} position={toWorld(k.x, k.y, heightAtLocal(grid, k.x, k.y) + 40)}>
            <Html zIndexRange={[5, 0]} pointerEvents="none">
              <div className="ground-key-marker" style={{ borderColor: color, color }} title={`Key node — held by ${k.holderId ? ownerDisplay(k.holderId).name : 'nobody'}`}>
                {KEY_GLYPHS}
              </div>
            </Html>
          </group>
        )
      })}
    </>
  )
}

// Routes of the player's moving units and every unit's line of fire, drawn as
// Line2 (so the thickness setting works), rebuilt each frame.
const MAX_SEGMENTS = 800

function Lines({ battleId }: { battleId: string }) {
  const pathRef = useRef<Line2>(null)
  const fireRef = useRef<Line2>(null)
  const seed = useMemo(() => Array.from({ length: MAX_SEGMENTS * 2 }, () => [0, 0, 0] as [number, number, number]), [])
  const thickness = useSettingsStore((s) => LINE_THICKNESS_PX[s.armyLineThickness])
  useFrame(() => {
    const pathLine = pathRef.current
    const fireLine = fireRef.current
    const battle = useTerrainStore.getState().battles.find((b) => b.id === battleId)
    if (!pathLine || !fireLine || !battle) return
    const player = usePlayerStore.getState().selectedCountryId
    const byId = new Map(battle.units.map((u) => [u.id, u]))
    const pathBuf = (pathLine.geometry.getAttribute('instanceStart') as unknown as { data: { array: Float32Array; needsUpdate: boolean } }).data
    const fireBuf = (fireLine.geometry.getAttribute('instanceStart') as unknown as { data: { array: Float32Array; needsUpdate: boolean } }).data
    let np = 0
    let nf = 0
    const put = (buf: { array: Float32Array }, n: number, a: [number, number, number], b: [number, number, number]) => {
      if (n >= MAX_SEGMENTS) return n
      buf.array.set(a, n * 6)
      buf.array.set(b, n * 6 + 3)
      return n + 1
    }
    const at = (x: number, y: number) => toWorld(x, y, heightAtLocal(battle.grid, x, y) + 70)
    for (const u of battle.units) {
      if (u.ownerId === player && u.path.length > 0) {
        let prev = at(u.x, u.y)
        for (const wp of u.path) {
          const next = at(wp.x, wp.y)
          np = put(pathBuf, np, prev, next)
          prev = next
        }
      }
      const target = u.firingAtId ? byId.get(u.firingAtId) : undefined
      if (target) nf = put(fireBuf, nf, at(u.x, u.y), at(target.x, target.y))
    }
    pathBuf.needsUpdate = true
    fireBuf.needsUpdate = true
    ;(pathLine.geometry as unknown as { instanceCount: number }).instanceCount = np
    ;(fireLine.geometry as unknown as { instanceCount: number }).instanceCount = nf
    pathLine.visible = np > 0
    fireLine.visible = nf > 0
  })
  return (
    <>
      <Line ref={pathRef} points={seed} segments color="#4ade80" lineWidth={thickness} transparent opacity={0.9} frustumCulled={false} />
      <Line ref={fireRef} points={seed} segments color="#ff6b4a" lineWidth={thickness} transparent opacity={0.8} frustumCulled={false} />
    </>
  )
}

// A ring at each selected unit showing how far it reaches.
function RangeRings({ battleId }: { battleId: string }) {
  const ids = useGroundViewStore((s) => s.selectedUnitIds.join('|'))
  const battle = useTerrainStore((s) => s.battles.find((b) => b.id === battleId))
  if (!battle || !ids) return null
  const selected = battle.units.filter((u) => ids.split('|').includes(u.id))
  return (
    <>
      {selected.map((u) => {
        const pts = Array.from({ length: 49 }, (_, k) => {
          const a = (k / 48) * Math.PI * 2
          const x = u.x + Math.cos(a) * rangeCells(u.type)
          const y = u.y + Math.sin(a) * rangeCells(u.type)
          return toWorld(x, y, heightAtLocal(battle.grid, x, y) + 40) as [number, number, number]
        })
        return <Line key={u.id} points={pts} color="#6fe3ff" lineWidth={1} transparent opacity={0.35} />
      })}
    </>
  )
}

// --- The view ----------------------------------------------------------------

export function TerrainViewScene({ battleId }: { battleId: string }) {
  const exists = useTerrainStore((s) => s.battles.some((b) => b.id === battleId))
  const exitTerrain = useViewStore((s) => s.exitTerrain)
  // The fight ended while it was being watched: back to the planetary map.
  useEffect(() => {
    if (!exists) exitTerrain()
  }, [exists, exitTerrain])
  // Leaving drops the selection, which belongs to this view.
  useEffect(() => () => useGroundViewStore.getState().selectUnits([]), [])
  if (!exists) return null
  return <TerrainBattleView battleId={battleId} />
}

function TerrainBattleView({ battleId }: { battleId: string }) {
  const controlsRef = useRef<OrbitControlsImpl>(null)
  const exitTerrain = useViewStore((s) => s.exitTerrain)
  const grid = useTerrainStore((s) => s.battles.find((b) => b.id === battleId)?.grid)
  const bodyName = useTerrainStore((s) => s.battles.find((b) => b.id === battleId)?.bodyName)
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null)
  const glow = useMemo<[number, number, number]>(() => {
    // The world's own colour, as the screen shows it (no lift toward white).
    const c = new Color(bodyName ? (bodyGroundInfo(bodyName)?.color ?? '#9fe8ff') : '#9fe8ff').convertLinearToSRGB()
    return [c.r, c.g, c.b]
  }, [bodyName])

  const orderTo = (p: { x: number; y: number }) => {
    const view = useGroundViewStore.getState()
    if (view.selectedUnitIds.length === 0) return
    const r = useTerrainStore.getState().orderUnits(battleId, view.selectedUnitIds, p, isQueueModifierHeld())
    view.setNotice(r.ok ? null : r.reason)
  }

  if (!grid || !bodyName) return null
  return (
    <div className="solar-system-wrapper">
      <Canvas
        camera={{ position: [0, 7.5, 10.5], fov: 45, near: 0.1, far: 200 }}
        onPointerMissed={(e) => {
          if (e.type === 'click' && !isAdditiveClick(e)) useGroundViewStore.getState().selectUnits([])
        }}
      >
        <color attach="background" args={['#020409']} />
        <Relief grid={grid} glow={glow} />
        <Catcher grid={grid} onHover={setHover} onOrder={orderTo} />
        <KeyMarkers battleId={battleId} />
        <UnitMarkers battleId={battleId} />
        <RangeRings battleId={battleId} />
        <Lines battleId={battleId} />
        <DistanceThresholdWatcher mode="max" threshold={EXIT_DISTANCE} onTrigger={exitTerrain} controlsRef={controlsRef} />
        <OrbitControls ref={controlsRef} target={[0, 0.6, 0]} enablePan={false} enableDamping dampingFactor={0.08} minDistance={4} maxDistance={36} maxPolarAngle={1.45} />
        <KeyboardPan controlsRef={controlsRef} mode="orbit" />
      </Canvas>
      <TerrainPanel battleId={battleId} />
      <ReliefLegend grid={grid} />
      {hover && <TerrainHover grid={grid} at={hover} />}
    </div>
  )
}

// The gradient's key: what colour is what height.
function ReliefLegend({ grid }: { grid: TerrainGrid }) {
  const range = useMemo(() => reliefRange(grid), [grid])
  const css = useMemo(
    () => `linear-gradient(to top, ${RELIEF_RAMP.map(([t, c]) => `rgb(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)}) ${t * 100}%`).join(', ')})`,
    [],
  )
  // The height at a share of the gradient (undoing the gamma).
  const at = (t: number) => Math.round(range.min + (range.max - range.min) * Math.pow(t, 1 / RELIEF_GAMMA))
  return (
    <div className="terrain-legend" title="Height of the ground">
      <div className="terrain-legend-bar" style={{ background: css }} />
      <div className="terrain-legend-labels">
        <span>{at(1)} m</span>
        <span>{at(0.75)} m</span>
        <span>{at(0.5)} m</span>
        <span>{at(0.25)} m</span>
        <span>{at(0)} m</span>
      </div>
    </div>
  )
}

function TerrainHover({ grid, at }: { grid: TerrainGrid; at: { x: number; y: number } }) {
  const id = terrainAtLocal(grid, at.x, at.y)
  const h = heightAtLocal(grid, at.x, at.y)
  const terrain = TERRAIN[id]
  return (
    <div className="ground-hover">
      <strong>{terrain.name}</strong>
      <span>
        {' '}
        · {Math.round(h)} m · cover: {describeCover(terrain.defense)}
        {terrain.passable === 'amphibious' ? ' · amphibious units only' : terrain.passable === 'none' ? ' · impassable' : ''}
      </span>
    </div>
  )
}

