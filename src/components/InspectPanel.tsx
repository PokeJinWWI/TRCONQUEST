import type { InspectableBody } from '../scene/inspectableBody'
import { estimateHabitability, estimateSize } from '../scene/bodyStats'
import { DraggableWindow } from './DraggableWindow'

export interface InspectPanelAction {
  label: string
  pendingLabel: string
  pending?: boolean
  onClick: () => void
}

interface InspectPanelProps {
  body: InspectableBody
  onClose: () => void
  action?: InspectPanelAction
}

const KIND_LABEL: Record<InspectableBody['kind'], string> = {
  star: 'Star',
  planet: 'Planet',
  moon: 'Moon',
}

export function InspectPanel({ body, onClose, action }: InspectPanelProps) {
  const size = estimateSize(body.radiusKm)
  // Moons share their parent planet's distance from Sol, so the same
  // habitable-zone heuristic used for planets applies via orbitAU (set to
  // the parent planet's AU when the body being inspected is a moon).
  const habitability = body.kind !== 'star' ? estimateHabitability(body.name, body.orbitAU) : null

  return (
    <DraggableWindow title={body.name} onClose={onClose}>
      <div className="inspect-row">
        <span className="inspect-label">Type</span>
        <span className="inspect-value">{KIND_LABEL[body.kind]}</span>
      </div>
      <div className="inspect-row">
        <span className="inspect-label">Radius</span>
        <span className="inspect-value">{Math.round(body.radiusKm).toLocaleString()} km</span>
      </div>
      {/* Moons carry their parent planet's orbitAU too (for the habitability
          heuristic below), but that's the parent's distance from Sol, not
          the moon's own orbit — only show this row for the body it actually
          describes. */}
      {body.kind === 'planet' && body.orbitAU !== undefined && (
        <div className="inspect-row">
          <span className="inspect-label">Orbit</span>
          <span className="inspect-value">{body.orbitAU.toFixed(2)} AU · {body.orbitPeriodYears?.toFixed(2)} yr</span>
        </div>
      )}
      {body.orbitPeriodDays !== undefined && (
        <div className="inspect-row">
          <span className="inspect-label">Orbital period</span>
          <span className="inspect-value">{body.orbitPeriodDays.toFixed(2)} days</span>
        </div>
      )}
      {body.moonCount !== undefined && (
        <div className="inspect-row">
          <span className="inspect-label">Moons</span>
          <span className="inspect-value">{body.moonCount}</span>
        </div>
      )}

      {body.kind !== 'star' && (
        <>
          <div className="inspect-divider" />
          <div className="inspect-row">
            <span className="inspect-label">Size class</span>
            <span className="inspect-value">{size.label}</span>
          </div>
          <div className="inspect-row">
            <span className="inspect-label">Districts</span>
            <span className="inspect-value">{size.districts}</span>
          </div>
          {habitability && (
            <div className="inspect-row">
              <span className="inspect-label">Habitability</span>
              <span className="inspect-value">{habitability.label} ({habitability.pct}%)</span>
            </div>
          )}
        </>
      )}

      {action && (
        <>
          <div className="inspect-divider" />
          {action.pending ? (
            <div className="inspect-status ok">{action.pendingLabel}</div>
          ) : (
            <button type="button" className="detail-view-btn" onClick={action.onClick}>
              {action.label}
            </button>
          )}
        </>
      )}
    </DraggableWindow>
  )
}
