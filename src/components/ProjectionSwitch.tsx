import { useEffect, useMemo, useRef } from 'react'
import { useArmyStore } from '../state/armyStore'
import { useGroundViewStore } from '../state/groundViewStore'
import { usePlayerStore } from '../state/playerStore'
import { relationColorOf, useRelationKey } from '../state/shipRelations'
import type { HoloNode } from '../scene/HoloGlobe'
import { collectNodes, drawUnitsFlat, drawUnitsGlobe, flatThumbPixels, globeThumbPixels, thumbFocus, type ThumbUnit } from '../scene/projectionThumb'

// The switch between the globe and the flat map, top right of the planetary
// map: a small live picture of the OTHER view (with the world's units on it as
// dots); click it to swap. On the globe it shows the flat map, on the flat map
// it shows the globe.
const FLAT_W = 168
const FLAT_H = 84
const GLOBE_SIZE = 96

export function ProjectionSwitch({ bodyName, nodeAt }: { bodyName: string; nodeAt: (node: number) => HoloNode }) {
  const projection = useGroundViewStore((s) => s.projection)
  const setProjection = useGroundViewStore((s) => s.setProjection)
  const player = usePlayerStore((s) => s.selectedCountryId)
  useRelationKey()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const showFlat = projection === 'globe' // the thumbnail is of the view you'd switch to
  const w = showFlat ? FLAT_W : GLOBE_SIZE
  const h = showFlat ? FLAT_H : GLOBE_SIZE
  // The terrain picture, redone when the ground changes hands.
  const nodes = useMemo(() => collectNodes(nodeAt), [nodeAt])
  const base = useRef<{ img: ImageData; focus: ReturnType<typeof thumbFocus> } | null>(null)

  const unitsNow = (): ThumbUnit[] =>
    useArmyStore
      .getState()
      .armies.filter((a) => a.location.kind === 'body' && a.location.bodyName === bodyName)
      .flatMap((a) => a.units.filter((u) => u.position).map((u) => ({ position: u.position!, color: relationColorOf(a.ownerId, player) })))

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const focus = thumbFocus(unitsNow())
    base.current = { img: showFlat ? flatThumbPixels(FLAT_W, FLAT_H, nodes) : globeThumbPixels(GLOBE_SIZE, nodes, focus), focus }
    const paint = () => {
      if (!base.current) return
      ctx.clearRect(0, 0, w, h)
      ctx.putImageData(base.current.img, 0, 0)
      const units = unitsNow()
      if (showFlat) drawUnitsFlat(ctx, w, h, units)
      else drawUnitsGlobe(ctx, GLOBE_SIZE, units, base.current.focus)
    }
    paint()
    const timer = window.setInterval(paint, 500)
    return () => window.clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, showFlat, bodyName, player, w, h])

  return (
    <button
      type="button"
      className="projection-switch"
      title={showFlat ? 'Switch to the flat map' : 'Switch to the globe'}
      onClick={() => setProjection(showFlat ? 'flat' : 'globe')}
    >
      <canvas ref={canvasRef} width={w} height={h} className={showFlat ? 'projection-thumb-flat' : 'projection-thumb-globe'} />
      <span className="projection-switch-label">{showFlat ? 'Flat map' : 'Globe'}</span>
    </button>
  )
}
