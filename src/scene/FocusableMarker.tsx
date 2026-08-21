import { Html } from '@react-three/drei'
import { forwardWheelToCanvas } from '../utils/forwardWheel'

interface FocusableMarkerProps {
  name: string
  radius: number
  onSelect: () => void
  /** Right-click — orders the currently-selected ship (if any) here. Omitted
   * by MoonDetailScene, since a moon isn't a valid move-order target yet. */
  onOrderTo?: () => void
}

// The prominent name label for the sole/primary subject of a satellite-view
// scene (the planet/star in SatelliteViewScene, the moon in
// MoonDetailScene) — anchored above the hologram rather than sitting on it,
// so it doesn't compete visually with the hologram itself. Always shown for
// as long as that body is the view's subject, not just while its inspect
// window happens to be open.
export function FocusableMarker({ name, radius, onSelect, onOrderTo }: FocusableMarkerProps) {
  return (
    <Html position={[0, radius + 0.6, 0]} center zIndexRange={[0, 0]} style={{ pointerEvents: 'auto' }}>
      <div
        className="focused-label"
        onClick={onSelect}
        onContextMenu={(e) => {
          e.preventDefault()
          onOrderTo?.()
        }}
        onWheel={forwardWheelToCanvas}
      >
        {name}
      </div>
    </Html>
  )
}
