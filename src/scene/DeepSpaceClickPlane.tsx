import type { ThreeEvent } from '@react-three/fiber'

interface DeepSpaceClickPlaneProps {
  onDeselect: () => void
  onOrderTo: (point: [number, number, number]) => void
  size?: number
}

// An invisible ground-plane covering the whole navigable area — the
// canonical "empty space" target for both left-click (deselect) and
// right-click (issue a move order to a deep-space point, if a ship is
// selected). Without this, right-clicking empty space would have nothing to
// raycast against and no world point to send a ship to. Left-click here
// replicates the same deselect Canvas's onPointerMissed already does for a
// true miss — this plane just gives clicks something to hit instead of
// missing, so both paths need to do the same thing.
//
// Same marker-click race as onPointerMissed elsewhere in this codebase, one
// level deeper: since this plane now covers what used to raycast to nothing
// underneath most markers, a marker click can *also* land on the plane
// (marker overlays are DOM/HTML, not part of the 3D scene, so the click
// still reaches whatever the ray hits beneath it) — without the same
// `.planet-marker`/`.ship-marker` guard, that would immediately undo the
// marker's own onClick selection.
export function DeepSpaceClickPlane({ onDeselect, onOrderTo, size = 100000 }: DeepSpaceClickPlaneProps) {
  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.nativeEvent.target instanceof Element && e.nativeEvent.target.closest('.planet-marker, .ship-marker')) return
    onDeselect()
  }

  const handleContextMenu = (e: ThreeEvent<MouseEvent>) => {
    e.nativeEvent.preventDefault()
    if (e.nativeEvent.target instanceof Element && e.nativeEvent.target.closest('.planet-marker, .ship-marker')) return
    e.stopPropagation()
    onOrderTo([e.point.x, 0, e.point.z])
  }

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} onClick={handleClick} onContextMenu={handleContextMenu}>
      <planeGeometry args={[size, size]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  )
}
