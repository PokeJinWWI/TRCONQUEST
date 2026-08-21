import { useViewStore } from '../state/viewStore'

// Top HUD toggle for whether selecting something (a body or a ship) eases
// the camera onto it. Every scene's SelectionTracker already reads
// lockOnEnabled directly — this button is the only way to flip it.
export function LockOnToggle() {
  const lockOnEnabled = useViewStore((s) => s.lockOnEnabled)
  const toggleLockOn = useViewStore((s) => s.toggleLockOn)

  return (
    <button
      type="button"
      className={`lock-on-toggle${lockOnEnabled ? ' active' : ''}`}
      onClick={toggleLockOn}
      title={lockOnEnabled ? 'Camera follows the current selection — click to stop' : 'Camera stays put when selecting — click to follow'}
    >
      LOCK-ON {lockOnEnabled ? 'ON' : 'OFF'}
    </button>
  )
}
