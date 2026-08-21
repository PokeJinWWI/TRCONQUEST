import { useShipStore } from '../state/shipStore'
import { ALLEGIANCE_LABELS, SHIP_CLASSES, describeFtlDrive } from '../data/shipData'
import { getShipStatusText, hyperdriveCooldownRemainingDays, warpCooldownRemainingDays } from './shipPhysics'
import { useGameTimeStore } from '../state/gameTimeStore'
import { DraggableWindow } from '../components/DraggableWindow'

function formatCooldown(label: string, remainingDays: number): string {
  return remainingDays > 0 ? `${label} ${remainingDays.toFixed(1)}d` : `${label} Ready`
}

interface ShipPanelProps {
  /** Present only when the selected ship is actually trackable in the
   * current scene (see each scene's own `trackedShip`) — flies the camera
   * to it, independent of the lockOnEnabled toggle (which only governs
   * *continuous* follow). Omitted entirely — no button rendered — when
   * there's nowhere for "Go To" to send the camera, e.g. the ship is
   * selected but actually elsewhere (a different system, still travelling
   * through a view that doesn't render it). */
  onGoTo?: () => void
  goToPending?: boolean
}

// The selected ship's info window — subscribes to simDays directly (same
// pattern TimeControls already uses) so the location/status line stays live
// while travelling, not just at the moment it was opened. Selecting a ship
// is always allowed regardless of allegiance (see shipStore.selectShip), so
// this doubles as a read-only intel view for enemy/neutral/friendly fleets —
// the right-click-to-redirect hint only applies to a ship the player
// actually owns; planMove refuses to plan a move for any other ship anyway.
export function ShipPanel({ onGoTo, goToPending }: ShipPanelProps) {
  const selectedShipId = useShipStore((s) => s.selectedShipId)
  const ship = useShipStore((s) => s.ships.find((sh) => sh.id === s.selectedShipId))
  const selectShip = useShipStore((s) => s.selectShip)
  const setWarpEnabled = useShipStore((s) => s.setWarpEnabled)
  const setWarpWhenReady = useShipStore((s) => s.setWarpWhenReady)
  const simDays = useGameTimeStore((s) => s.simDays)

  if (!selectedShipId || !ship) return null

  const shipClass = SHIP_CLASSES.find((c) => c.id === ship.classId)
  const statusText = getShipStatusText(ship, simDays)
  const owned = ship.allegiance === 'player'
  const hasHyperdrive = shipClass?.ftlDrives.some((d) => d.kind === 'hyperdrive') ?? false
  const hasWarp = shipClass?.ftlDrives.some((d) => d.kind === 'warp') ?? false
  const cooldownParts = [
    hasHyperdrive ? formatCooldown('Hyperdrive', hyperdriveCooldownRemainingDays(ship, simDays)) : null,
    hasWarp ? formatCooldown('Warp', warpCooldownRemainingDays(ship, simDays)) : null,
  ].filter((part): part is string => part !== null)

  return (
    <DraggableWindow title={ship.name} onClose={() => selectShip(null)}>
      <div className="inspect-row">
        <span className="inspect-label">Class</span>
        <span className="inspect-value">{shipClass?.name ?? 'Unknown'}</span>
      </div>
      <div className="inspect-row">
        <span className="inspect-label">Allegiance</span>
        <span className="inspect-value">{ALLEGIANCE_LABELS[ship.allegiance]}</span>
      </div>
      <div className="inspect-row">
        <span className="inspect-label">Drives</span>
        <span className="inspect-value">
          Reaction{shipClass ? `, ${shipClass.ftlDrives.map(describeFtlDrive).join(', ')}` : ''}
        </span>
      </div>
      {cooldownParts.length > 0 && (
        <div className="inspect-row">
          <span className="inspect-label">Cooldowns</span>
          <span className="inspect-value">{cooldownParts.join(' · ')}</span>
        </div>
      )}
      {hasWarp && owned && (
        <>
          <label className="ship-panel-checkbox-row">
            <input
              type="checkbox"
              checked={ship.warpEnabled}
              onChange={(e) => setWarpEnabled(ship.id, e.target.checked)}
            />
            Use Warp Drive
          </label>
          <label className="ship-panel-checkbox-row">
            <input
              type="checkbox"
              checked={ship.warpWhenReady}
              onChange={(e) => setWarpWhenReady(ship.id, e.target.checked)}
            />
            Warp When Ready
          </label>
        </>
      )}
      <div className="inspect-divider" />
      <div className="inspect-row">
        <span className="inspect-label">Location</span>
      </div>
      <div className="ship-panel-status">{statusText}</div>
      {onGoTo && (
        <button type="button" className="detail-view-btn" onClick={onGoTo} disabled={goToPending}>
          {goToPending ? 'Going to…' : 'Go To'}
        </button>
      )}
      {owned ? (
        ship.order && <div className="ship-panel-hint">Right-click a new destination to redirect.</div>
      ) : (
        <div className="ship-panel-hint">Not under your command.</div>
      )}
    </DraggableWindow>
  )
}
