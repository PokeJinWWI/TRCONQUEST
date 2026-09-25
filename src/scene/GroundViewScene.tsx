import { useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, type ThreeEvent } from '@react-three/fiber'
import { Html, OrbitControls, Stars } from '@react-three/drei'
import { BufferAttribute, BufferGeometry, Color, type Group, type LineSegments } from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { TERRAIN, UNIT_TYPES } from '../data/groundData'
import { ownerDisplay } from '../data/countryRoster'
import { useArmyStore } from '../state/armyStore'
import { useTerritoryStore } from '../state/territoryStore'
import { useGroundViewStore } from '../state/groundViewStore'
import { useViewStore } from '../state/viewStore'
import { usePlayerStore } from '../state/playerStore'
import { atWar } from '../state/diplomacyStore'
import { relationColorOf, useRelationKey } from '../state/shipRelations'
import { groundSurface, holderOf, radToKm, unitSpeedRadPerDay } from './groundLogic'
import { TERRAIN_IDS, type BodySurface } from './planetTerrain'
import { nearestNode, normalize, surfaceMesh, type SurfacePoint } from './surfaceMesh'
import { DistanceThresholdWatcher } from './DistanceThresholdWatcher'
import { isAdditiveClick } from './selectionInput'
import { GroundPanel, UnitCard, describeDefense, describeMoveCost, handleGroundClick, orderSelectedUnitsTo, targetWithSelection } from '../components/GroundPanel'

// The planetary map: a world's surface as a globe of terrain, its front lines
// (who holds each node, painted as the fighting moves), its key nodes, and
// every unit on it — the ground war's equivalent of the space combat arena
// (CombatViewScene), on the strategic clock. Click a unit to select it
// (Shift/Ctrl/Cmd to add more), right-click the ground to send the selection
// there, right-click an enemy to concentrate fire on it. With a transport
// waiting in orbit ("Choose landing site"), a click on the ground picks where
// its armies land.
const GLOBE_RADIUS = 5
const INITIAL_DISTANCE = 19
const MIN_DISTANCE = 6.5
const MAX_DISTANCE = 44
const EXIT_DISTANCE = 36
// How much a holder's colour tints the ground (the rest is terrain).
const HOLDER_TINT = 0.42
const GRID_OPACITY = { coarse: 0.35, standard: 0.22, fine: 0.14 } as const

function toVec(p: SurfacePoint, r: number): [number, number, number] {
  return [p.x * r, p.y * r, p.z * r]
}

export function GroundViewScene({ bodyName }: { bodyName: string }) {
  const controlsRef = useRef<OrbitControlsImpl>(null)
  const exitGround = useViewStore((s) => s.exitGround)
  const bodyOwner = useTerritoryStore((s) => s.bodyOwner)
  const surface = useMemo(() => groundSurface(bodyName, bodyOwner), [bodyName, bodyOwner])

  // Leaving the map ends any landing/spawn pick, and drops the selection.
  // Only once the view has really changed — React's dev StrictMode runs this
  // cleanup on mount too, which would otherwise cancel the pick that brought
  // us here.
  useEffect(
    () => () => {
      const view = useViewStore.getState()
      if (view.level === 'ground' && view.selectedBodyName === bodyName) return
      useGroundViewStore.getState().setMode({ kind: 'order' })
      useGroundViewStore.getState().selectUnits([])
      useGroundViewStore.getState().setHoverNode(null)
    },
    [bodyName],
  )

  if (!surface) {
    return (
      <div className="solar-system-wrapper">
        <div className="planet-ground-hud">{bodyName} has no surface to fight on.</div>
      </div>
    )
  }

  return (
    <div className="solar-system-wrapper">
      <Canvas camera={{ position: [0, 5, INITIAL_DISTANCE], fov: 50 }} onPointerMissed={(e) => {
        // A plain click on empty space clears the selection.
        if (e.type === 'click' && !isAdditiveClick(e)) useGroundViewStore.getState().selectUnits([])
      }}>
        <color attach="background" args={['#020409']} />
        <ambientLight intensity={0.9} />
        <Stars radius={300} depth={80} count={2500} factor={2} fade speed={0.2} />
        <SurfaceGlobe surface={surface} />
        <SurfaceGrid />
        <FrontLines surface={surface} />
        <KeyNodeMarkers surface={surface} />
        <UnitMarkers bodyName={bodyName} />
        <GroundLines bodyName={bodyName} />
        <DistanceThresholdWatcher mode="max" threshold={EXIT_DISTANCE} onTrigger={exitGround} controlsRef={controlsRef} />
        <OrbitControls ref={controlsRef} enablePan={false} enableDamping dampingFactor={0.08} minDistance={MIN_DISTANCE} maxDistance={MAX_DISTANCE} />
      </Canvas>
      <GroundPanel bodyName={bodyName} surface={surface} />
      <UnitCard bodyName={bodyName} surface={surface} />
      <HoverTooltip bodyName={bodyName} surface={surface} />
    </div>
  )
}

// The globe: every fine node coloured by its terrain, tinted by whoever holds
// it. Colours are rewritten in place when the front moves.
function SurfaceGlobe({ surface }: { surface: BodySurface }) {
  const mesh = surfaceMesh()
  const bodyName = surface.bodyName
  const holders = useTerritoryStore((s) => s.nodeHolders[bodyName])
  const owners = useTerritoryStore((s) => s.bodyOwner)
  const geometry = useMemo(() => {
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(Float32Array.from(mesh.positions, (v) => v * GLOBE_RADIUS), 3))
    g.setAttribute('normal', new BufferAttribute(Float32Array.from(mesh.positions), 3))
    g.setAttribute('color', new BufferAttribute(new Float32Array(mesh.count.fine * 3), 3))
    g.setIndex(new BufferAttribute(mesh.faces, 1))
    return g
  }, [mesh])
  useEffect(() => () => geometry.dispose(), [geometry])

  useEffect(() => {
    const colors = geometry.getAttribute('color') as BufferAttribute
    const c = new Color()
    const tint = new Color()
    const all = { [bodyName]: holders ?? {} }
    for (let i = 0; i < mesh.count.fine; i++) {
      const terrain = TERRAIN[TERRAIN_IDS[surface.terrain[i]]]
      c.set(terrain.tint)
      const h = terrain.paintable ? holderOf(bodyName, i, owners, all) : undefined
      if (h) c.lerp(tint.set(ownerDisplay(h).color), HOLDER_TINT)
      colors.setXYZ(i, c.r, c.g, c.b)
    }
    colors.needsUpdate = true
  }, [geometry, holders, owners, surface, bodyName, mesh])

  const pickNode = (e: ThreeEvent<MouseEvent | PointerEvent>) => nearestNode(normalize(e.point), useGroundViewStore.getState().density)

  return (
    <mesh
      geometry={geometry}
      onPointerMove={(e) => {
        e.stopPropagation()
        const node = nearestNode(normalize(e.point), 'fine')
        if (useGroundViewStore.getState().hoverNode !== node) useGroundViewStore.getState().setHoverNode(node)
      }}
      onPointerOut={() => useGroundViewStore.getState().setHoverNode(null)}
      onClick={(e) => {
        e.stopPropagation()
        handleGroundClick(bodyName, pickNode(e))
      }}
      onContextMenu={(e) => {
        e.stopPropagation()
        e.nativeEvent.preventDefault()
        orderSelectedUnitsTo(pickNode(e))
      }}
    >
      <meshBasicMaterial vertexColors />
    </mesh>
  )
}

// The current density's grid: its nodes and edges, just above the ground.
// Changing density redraws this and changes what a click snaps to — nothing
// on the ground moves.
function SurfaceGrid() {
  const density = useGroundViewStore((s) => s.density)
  const mesh = surfaceMesh()
  const { edges, points } = useMemo(() => {
    const r = GLOBE_RADIUS * 1.004
    const seg: number[] = []
    const seen = new Set<string>()
    const faces = mesh.facesByDensity[density]
    for (let f = 0; f < faces.length; f += 3) {
      const tri = [faces[f], faces[f + 1], faces[f + 2]]
      for (let k = 0; k < 3; k++) {
        const a = tri[k]
        const b = tri[(k + 1) % 3]
        const key = a < b ? `${a}|${b}` : `${b}|${a}`
        if (seen.has(key)) continue
        seen.add(key)
        seg.push(mesh.positions[a * 3] * r, mesh.positions[a * 3 + 1] * r, mesh.positions[a * 3 + 2] * r)
        seg.push(mesh.positions[b * 3] * r, mesh.positions[b * 3 + 1] * r, mesh.positions[b * 3 + 2] * r)
      }
    }
    const e = new BufferGeometry()
    e.setAttribute('position', new BufferAttribute(Float32Array.from(seg), 3))
    const p = new BufferGeometry()
    p.setAttribute('position', new BufferAttribute(Float32Array.from(mesh.positions.subarray(0, mesh.count[density] * 3), (v) => v * r), 3))
    return { edges: e, points: p }
  }, [density, mesh])
  useEffect(() => () => {
    edges.dispose()
    points.dispose()
  }, [edges, points])
  return (
    <group>
      <lineSegments geometry={edges}>
        <lineBasicMaterial color="#6fe3ff" transparent opacity={GRID_OPACITY[density]} />
      </lineSegments>
      <points geometry={points}>
        <pointsMaterial color="#6fe3ff" size={density === 'fine' ? 0.035 : 0.06} transparent opacity={0.7} />
      </points>
    </group>
  )
}

// Bright lines along every fine edge whose two ends are held by different
// nations — the front, readable whatever the colours.
function FrontLines({ surface }: { surface: BodySurface }) {
  const bodyName = surface.bodyName
  const holders = useTerritoryStore((s) => s.nodeHolders[bodyName])
  const owners = useTerritoryStore((s) => s.bodyOwner)
  const mesh = surfaceMesh()
  const geometry = useMemo(() => {
    const r = GLOBE_RADIUS * 1.008
    const seg: number[] = []
    const all = { [bodyName]: holders ?? {} }
    const holderAt = (i: number) => (TERRAIN[TERRAIN_IDS[surface.terrain[i]]].paintable ? holderOf(bodyName, i, owners, all) : undefined)
    if (holders) {
      for (let i = 0; i < mesh.count.fine; i++) {
        const hi = holderAt(i)
        if (!hi) continue
        for (const j of mesh.neighbors.fine[i]) {
          if (j <= i) continue
          const hj = holderAt(j)
          if (!hj || hj === hi) continue
          seg.push(mesh.positions[i * 3] * r, mesh.positions[i * 3 + 1] * r, mesh.positions[i * 3 + 2] * r)
          seg.push(mesh.positions[j * 3] * r, mesh.positions[j * 3 + 1] * r, mesh.positions[j * 3 + 2] * r)
        }
      }
    }
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(Float32Array.from(seg), 3))
    return g
  }, [holders, owners, surface, bodyName, mesh])
  useEffect(() => () => geometry.dispose(), [geometry])
  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial color="#ffffff" transparent opacity={0.85} />
    </lineSegments>
  )
}

const KEY_GLYPHS = { capital: '★', city: '●', spaceport: '⚓', outpost: '◆' } as const

function KeyNodeMarkers({ surface }: { surface: BodySurface }) {
  const bodyName = surface.bodyName
  const holders = useTerritoryStore((s) => s.nodeHolders[bodyName])
  const owners = useTerritoryStore((s) => s.bodyOwner)
  const mesh = surfaceMesh()
  return (
    <>
      {surface.keySlots.map((slot) => {
        const holder = holderOf(bodyName, slot.node, owners, { [bodyName]: holders ?? {} })
        const color = holder ? ownerDisplay(holder).color : '#cfd8e3'
        const p = { x: mesh.positions[slot.node * 3], y: mesh.positions[slot.node * 3 + 1], z: mesh.positions[slot.node * 3 + 2] }
        return (
          <FacingHtml key={slot.node} point={p} radius={GLOBE_RADIUS * 1.01}>
            <div className="ground-key-marker" style={{ borderColor: color, color }} title={`${slot.kind} — held by ${holder ? ownerDisplay(holder).name : 'nobody'}`}>
              {KEY_GLYPHS[slot.kind]}
            </div>
          </FacingHtml>
        )
      })}
    </>
  )
}

// An Html label pinned to a surface point that hides itself on the far side
// of the globe (exact for a sphere: the point faces away from the camera).
function FacingHtml({ point, radius, children }: { point: SurfacePoint; radius: number; children: React.ReactNode }) {
  const groupRef = useRef<Group>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  useFrame(({ camera }) => {
    const g = groupRef.current
    if (!g) return
    g.position.set(...toVec(point, radius))
    const facing = point.x * camera.position.x + point.y * camera.position.y + point.z * camera.position.z > radius * 0.2
    if (wrapRef.current) wrapRef.current.style.display = facing ? '' : 'none'
  })
  return (
    <group ref={groupRef}>
      <Html zIndexRange={[5, 0]} pointerEvents="none">
        <div ref={wrapRef}>{children}</div>
      </Html>
    </group>
  )
}

// One chip per unit on this world. The list re-renders only when units come
// or go; positions update every frame from the store.
function UnitMarkers({ bodyName }: { bodyName: string }) {
  const idsKey = useArmyStore((s) =>
    s.armies
      .filter((a) => a.location.kind === 'body' && a.location.bodyName === bodyName)
      .flatMap((a) => a.units.map((u) => `${u.id}:${a.ownerId}:${u.type}`))
      .join('|'),
  )
  const entries = idsKey ? idsKey.split('|').map((e) => e.split(':')) : []
  return (
    <>
      {entries.map(([id, ownerId, type]) => (
        <UnitMarker key={id} unitId={id} ownerId={ownerId} type={type as keyof typeof UNIT_TYPES} />
      ))}
    </>
  )
}

function findUnit(unitId: string) {
  for (const army of useArmyStore.getState().armies) {
    const unit = army.units.find((u) => u.id === unitId)
    if (unit) return { army, unit }
  }
  return null
}

// Chips of units sharing a node fan out on screen, so a stack of units stays
// clickable at any zoom.
const FAN_PX = 13

function UnitMarker({ unitId, ownerId, type }: { unitId: string; ownerId: string; type: keyof typeof UNIT_TYPES }) {
  const groupRef = useRef<Group>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const barRef = useRef<HTMLSpanElement>(null)
  const selected = useGroundViewStore((s) => s.selectedUnitIds.includes(unitId))
  const player = usePlayerStore((s) => s.selectedCountryId)
  useRelationKey()
  // Coloured by how the owner relates to the player, not by nation.
  const color = relationColorOf(ownerId, player)
  const hostile = !!player && atWar(ownerId, player)
  const select = (e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }) => {
    if (isAdditiveClick(e)) useGroundViewStore.getState().toggleUnit(unitId)
    else useGroundViewStore.getState().selectUnit(unitId)
  }
  useFrame(({ camera }) => {
    const found = findUnit(unitId)
    const g = groupRef.current
    if (!found?.unit.position || !g) return
    const p = found.unit.position
    const r = GLOBE_RADIUS * 1.015
    g.position.set(p.x * r, p.y * r, p.z * r)
    const facing = p.x * camera.position.x + p.y * camera.position.y + p.z * camera.position.z > r * 0.2
    if (wrapRef.current) {
      wrapRef.current.style.display = facing ? '' : 'none'
      // How many listed units share this unit's node, and its place among them.
      const node = nearestNode(p, 'fine', found.unit.nodeHint)
      let rank = 0
      let count = 0
      let k = 0
      for (const army of useArmyStore.getState().armies) {
        for (const u of army.units) {
          if (!u.position || army.location.kind !== 'body') continue
          if (nearestNode(u.position, 'fine', u.nodeHint) !== node) continue
          if (u.id === unitId) rank = k
          k++
          count++
        }
      }
      const angle = count > 1 ? (rank / count) * Math.PI * 2 : 0
      const radiusPx = count > 1 ? FAN_PX * Math.min(2, 0.6 + count / 6) : 0
      wrapRef.current.style.transform = `translate(${Math.cos(angle) * radiusPx}px, ${Math.sin(angle) * radiusPx}px)`
    }
    if (barRef.current) barRef.current.style.width = `${Math.max(0, Math.min(1, found.unit.strength / found.unit.maxStrength)) * 100}%`
  })
  return (
    <group ref={groupRef}>
      {/* The Html root and the fan wrapper must not take clicks themselves:
          the chip is shifted by a CSS translate(-50%, -50%), which moves it on
          screen but not its layout box, so these boxes sit half a chip off the
          visible square and would swallow clicks meant for the chip (or a
          neighbour's) beneath them. Only the button is clickable. */}
      <Html zIndexRange={[10, 0]} pointerEvents="none">
        <div ref={wrapRef} style={{ pointerEvents: 'none' }}>
          <button
            type="button"
            className={`ground-unit-marker${selected ? ' selected' : ''}${hostile ? ' hostile' : ''}`}
            style={{ borderColor: color, color }}
            title={`${ownerDisplay(ownerId).name} — ${UNIT_TYPES[type].name}`}
            // Select on press, not on click: a click needs the chip to still
            // be under the pointer on release, and a moving unit (or a
            // rotating globe) slides out from under it. Keyboard activation
            // (no pointer) still arrives as a click with detail 0.
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
              targetWithSelection(unitId)
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

// Paths of the player's own moving units, and every unit's line of fire,
// rebuilt every frame from the store.
const MAX_SEGMENTS = 4000

function GroundLines({ bodyName }: { bodyName: string }) {
  const pathRef = useRef<LineSegments>(null)
  const fireRef = useRef<LineSegments>(null)
  const geoms = useMemo(() => {
    const make = () => {
      const g = new BufferGeometry()
      g.setAttribute('position', new BufferAttribute(new Float32Array(MAX_SEGMENTS * 6), 3))
      g.setDrawRange(0, 0)
      return g
    }
    return { path: make(), fire: make() }
  }, [])
  useEffect(() => () => {
    geoms.path.dispose()
    geoms.fire.dispose()
  }, [geoms])

  useFrame(() => {
    const player = usePlayerStore.getState().selectedCountryId
    const armies = useArmyStore.getState().armies.filter((a) => a.location.kind === 'body' && a.location.bodyName === bodyName)
    const byId = new Map(armies.flatMap((a) => a.units.map((u) => [u.id, u] as const)))
    const r = GLOBE_RADIUS * 1.012
    const pathPos = geoms.path.getAttribute('position') as BufferAttribute
    const firePos = geoms.fire.getAttribute('position') as BufferAttribute
    let np = 0
    let nf = 0
    const push = (attr: BufferAttribute, n: number, a: SurfacePoint, b: SurfacePoint) => {
      if (n >= MAX_SEGMENTS) return n
      attr.setXYZ(n * 2, a.x * r, a.y * r, a.z * r)
      attr.setXYZ(n * 2 + 1, b.x * r, b.y * r, b.z * r)
      return n + 1
    }
    for (const army of armies) {
      for (const u of army.units) {
        if (!u.position) continue
        if (army.ownerId === player && u.path && u.path.length > 0) {
          let prev = u.position
          for (const wp of u.path) {
            np = push(pathPos, np, prev, wp)
            prev = wp
          }
        }
        if (u.firingAtId) {
          const target = byId.get(u.firingAtId)
          if (target?.position) nf = push(firePos, nf, u.position, target.position)
        }
      }
    }
    pathPos.needsUpdate = true
    firePos.needsUpdate = true
    geoms.path.setDrawRange(0, np * 2)
    geoms.fire.setDrawRange(0, nf * 2)
  })

  return (
    <>
      <lineSegments ref={pathRef} geometry={geoms.path} frustumCulled={false}>
        <lineBasicMaterial color="#4ade80" transparent opacity={0.9} />
      </lineSegments>
      <lineSegments ref={fireRef} geometry={geoms.fire} frustumCulled={false}>
        <lineBasicMaterial color="#ff6b4a" transparent opacity={0.8} />
      </lineSegments>
    </>
  )
}

// What's under the pointer: terrain and who holds it.
function HoverTooltip({ bodyName, surface }: { bodyName: string; surface: BodySurface }) {
  const node = useGroundViewStore((s) => s.hoverNode)
  const holders = useTerritoryStore((s) => s.nodeHolders[bodyName])
  const owners = useTerritoryStore((s) => s.bodyOwner)
  const selectedIds = useGroundViewStore((s) => s.selectedUnitIds)
  const armies = useArmyStore((s) => s.armies)
  if (node === null) return null
  const terrainId = TERRAIN_IDS[surface.terrain[node]]
  const terrain = TERRAIN[terrainId]
  // What this ground does to the selected units' pace, in their real km/day
  // here (slowest of them — a group moves at its slowest member's speed by
  // order, though each unit walks its own path).
  const speeds: number[] = []
  let blocked = 0
  for (const army of armies) {
    for (const u of army.units) {
      if (!selectedIds.includes(u.id) || UNIT_TYPES[u.type].holdsPosition) continue
      if (terrain.passable === 'none' || (terrain.passable === 'amphibious' && !UNIT_TYPES[u.type].amphibious) || UNIT_TYPES[u.type].terrain[terrainId]?.impassable) blocked++
      else speeds.push(radToKm(unitSpeedRadPerDay(u.type, surface.radiusKm, terrainId), surface.radiusKm))
    }
  }
  const pace =
    speeds.length > 0
      ? `your selection moves ${blocked > 0 ? `(${blocked} can't enter) ` : ''}${Math.round(Math.min(...speeds))} km/day here`
      : blocked > 0
        ? `your selection can't enter`
        : describeMoveCost(terrain.moveCost)
  const holder = terrain.paintable ? holderOf(bodyName, node, owners, { [bodyName]: holders ?? {} }) : undefined
  const key = surface.keySlots.find((k) => k.node === node)
  return (
    <div className="ground-hover">
      <strong>{terrain.name}</strong>
      {key && <span> · {key.kind}</span>}
      <span>
        {' '}
        · movement: {pace} · cover: {describeDefense(terrain.defense)}
        {terrain.passable === 'amphibious' ? ' · amphibious units only' : terrain.passable === 'none' ? ' · impassable' : ''}
      </span>
      {holder && <span style={{ color: ownerDisplay(holder).color }}> · {ownerDisplay(holder).name}</span>}
    </div>
  )
}
