import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import { useThree } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import { CanvasTexture, Color, Vector3 } from 'three'
import { BattleBadge } from '../components/BattleBadge'
import { ownerInfoOf } from '../data/ownerInfo'
import { NEIGHBORHOODS, neighborhoodScenePosition, type NeighborhoodData } from '../data/neighborhoodData'
import { getStarsForNeighborhood } from '../data/starData'
import { useBattleStore } from '../state/battleStore'
import { battlesInStars } from './battleList'
import { pickNearest, type ScreenPoint } from './galaxyPick'
import type { SystemClaim } from './territory'

// The galaxy's neighbourhood markers as ONE point cloud (a ring per neighbourhood,
// in its colour) plus a ring layer for claimed ones, instead of a DOM element
// each: 321 of those, all repositioned every frame the camera moved, is what
// made this view slow. Hover and click are picked by screen distance
// (scene/galaxyPick.ts); only the hovered and selected neighbourhoods get a
// label, and only ones with a fight get a battle badge.
const POSITIONS = NEIGHBORHOODS.map(neighborhoodScenePosition)
const DOT_PX = 11
const RING_PX = 20
const HIGHLIGHT_PX = 17

// A hollow ring with a soft glow, white so vertex colours tint it.
function makeRingTexture(): CanvasTexture {
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  const c = size / 2
  const glow = ctx.createRadialGradient(c, c, c * 0.3, c, c, c)
  glow.addColorStop(0, 'rgba(255,255,255,0.35)')
  glow.addColorStop(0.55, 'rgba(255,255,255,0.12)')
  glow.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, size, size)
  ctx.strokeStyle = '#fff'
  ctx.lineWidth = 6
  ctx.beginPath()
  ctx.arc(c, c, c * 0.5, 0, Math.PI * 2)
  ctx.stroke()
  return new CanvasTexture(canvas)
}

function Cloud({ positions, colors, px, dpr, texture }: { positions: Float32Array; colors: Float32Array; px: number; dpr: number; texture: CanvasTexture }) {
  if (positions.length === 0) return null
  return (
    <points frustumCulled={false}>
      <bufferGeometry key={positions.length}>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-color" args={[colors, 3]} />
      </bufferGeometry>
      <pointsMaterial map={texture} vertexColors size={px * dpr} sizeAttenuation={false} transparent depthWrite={false} alphaTest={0.02} />
    </points>
  )
}

// Neighbourhoods that have a fight in one of their systems (a rare handful).
function useBattleNeighborhoodIds(): string[] {
  const key = useBattleStore((s) =>
    NEIGHBORHOODS.filter((n) => n.hasInterstellarData && battlesInStars(s.battles, getStarsForNeighborhood(n.id).map((st) => st.id)).length > 0)
      .map((n) => n.id)
      .join(','),
  )
  return key ? key.split(',') : []
}

export function GalaxyMarkers({
  claims,
  selectedId,
  pickerRef,
}: {
  claims: Map<string, SystemClaim>
  selectedId: string | null
  // Filled with a function that turns a screen point into the neighbourhood under it.
  pickerRef: MutableRefObject<((clientX: number, clientY: number) => NeighborhoodData | null) | null>
}) {
  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)
  const dpr = useThree((s) => s.viewport.dpr)
  const texture = useMemo(makeRingTexture, [])
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const battleIds = useBattleNeighborhoodIds()

  const dots = useMemo(() => {
    const positions = new Float32Array(NEIGHBORHOODS.length * 3)
    const colors = new Float32Array(NEIGHBORHOODS.length * 3)
    const color = new Color()
    NEIGHBORHOODS.forEach((n, i) => {
      positions.set(POSITIONS[i], i * 3)
      color.set(n.color)
      colors.set([color.r, color.g, color.b], i * 3)
    })
    return { positions, colors }
  }, [])

  // A ring in the owner's colour round every claimed neighbourhood.
  const rings = useMemo(() => {
    const idx = NEIGHBORHOODS.map((n, i) => ({ n, i, claim: claims.get(n.id) })).filter((e) => e.claim && e.claim.kind !== 'unclaimed')
    const positions = new Float32Array(idx.length * 3)
    const colors = new Float32Array(idx.length * 3)
    const color = new Color()
    idx.forEach(({ i, claim }, k) => {
      positions.set(POSITIONS[i], k * 3)
      const owner = claim!.kind === 'owned' ? claim!.countryId : (claim as { countryIds: string[] }).countryIds[0]
      color.set(ownerInfoOf(owner)?.color ?? '#888888')
      colors.set([color.r, color.g, color.b], k * 3)
    })
    return { positions, colors }
  }, [claims])

  // The hovered and selected ones, drawn bigger and white.
  const highlight = useMemo(() => {
    const ids = [...new Set([hoveredId, selectedId].filter((x): x is string => !!x))]
    const positions = new Float32Array(ids.length * 3)
    const colors = new Float32Array(ids.length * 3).fill(1)
    ids.forEach((id, k) => positions.set(POSITIONS[NEIGHBORHOODS.findIndex((n) => n.id === id)] ?? [0, 0, 0], k * 3))
    return { ids, positions, colors }
  }, [hoveredId, selectedId])

  // Screen positions of every marker right now, for picking.
  const scratch = useRef(new Vector3())
  const pick = useMemo(
    () => (clientX: number, clientY: number): NeighborhoodData | null => {
      const rect = gl.domElement.getBoundingClientRect()
      const points: ScreenPoint[] = []
      NEIGHBORHOODS.forEach((n, i) => {
        const v = scratch.current.set(POSITIONS[i][0], POSITIONS[i][1], POSITIONS[i][2]).project(camera)
        if (v.z > 1 || v.z < -1) return
        points.push({ id: n.id, x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height })
      })
      const id = pickNearest(points, clientX, clientY)
      return id ? NEIGHBORHOODS.find((n) => n.id === id) ?? null : null
    },
    [camera, gl],
  )
  useEffect(() => {
    pickerRef.current = pick
    return () => {
      pickerRef.current = null
    }
  }, [pick, pickerRef])

  // Hover: the marker under the pointer, and the pointer cursor over it.
  useEffect(() => {
    const el = gl.domElement
    const onMove = (e: PointerEvent) => {
      if (e.buttons !== 0) return
      const n = pick(e.clientX, e.clientY)
      setHoveredId((prev) => (prev === (n?.id ?? null) ? prev : n?.id ?? null))
    }
    const onLeave = () => setHoveredId(null)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerleave', onLeave)
    return () => {
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerleave', onLeave)
    }
  }, [gl, pick])
  useEffect(() => {
    document.body.style.cursor = hoveredId ? 'var(--cursor-pointer)' : ''
    return () => {
      document.body.style.cursor = ''
    }
  }, [hoveredId])

  const labelled = highlight.ids
  return (
    <>
      <Cloud positions={dots.positions} colors={dots.colors} px={DOT_PX} dpr={dpr} texture={texture} />
      <Cloud positions={rings.positions} colors={rings.colors} px={RING_PX} dpr={dpr} texture={texture} />
      <Cloud positions={highlight.positions} colors={highlight.colors} px={HIGHLIGHT_PX} dpr={dpr} texture={texture} />
      {labelled.map((id) => {
        const i = NEIGHBORHOODS.findIndex((n) => n.id === id)
        if (i < 0) return null
        return (
          <Html key={`label-${id}`} position={POSITIONS[i]} zIndexRange={[0, 0]} style={{ pointerEvents: 'none' }}>
            <div className="planet-marker star-node neighborhood-node selected">
              <span className="marker-label">{NEIGHBORHOODS[i].name}</span>
            </div>
          </Html>
        )
      })}
      {battleIds.map((id) => {
        const i = NEIGHBORHOODS.findIndex((n) => n.id === id)
        return (
          <Html key={`battle-${id}`} position={POSITIONS[i]} zIndexRange={[0, 0]} style={{ pointerEvents: 'auto' }}>
            <div className="planet-marker">
              <BattleBadge scope={{ neighborhood: id }} />
            </div>
          </Html>
        )
      })}
    </>
  )
}
