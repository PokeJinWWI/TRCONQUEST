import { useState } from 'react'
import { RESOURCE_TYPES, HUD_RESOURCE_IDS, type ResourceId } from '../data/resourceData'
import { useResourceStore } from '../state/resourceStore'
import { ResourceIcon } from './ResourceIcons'
import { DraggableWindow } from './DraggableWindow'

// A signed, HUD-terse rendering of a monthly gain/deficit — `toLocaleString`
// already prefixes a negative number with its own minus sign, so only the
// positive/zero cases need an explicit "+" added.
function formatDelta(delta: number): string {
  if (delta > 0) return `+${delta.toLocaleString()}`
  if (delta < 0) return delta.toLocaleString()
  return '±0'
}

// Real values, currently all zero — see resourceStore for why that's the
// honest number rather than an invented one. Clicking a resource opens a
// small info window with its description plus stockpile/monthly gain-or-
// deficit/debt — a real, functional UI even though the numbers behind it
// stay at zero until an actual production/consumption tick exists to
// produce them, same "build the real thing, the data catches up later"
// pattern this project already follows for Society/Engineering's tech
// trees and the Outliner's Colonies/Starbases sections.
export function ResourceBar() {
  const amounts = useResourceStore((s) => s.amounts)
  const monthlyDelta = useResourceStore((s) => s.monthlyDelta)
  const [openId, setOpenId] = useState<ResourceId | null>(null)
  const openResource = RESOURCE_TYPES.find((r) => r.id === openId) ?? null
  const visibleResources = HUD_RESOURCE_IDS.map((id) => RESOURCE_TYPES.find((r) => r.id === id)!)

  return (
    <div className="resource-bar">
      {visibleResources.map((resource) => {
        const delta = monthlyDelta[resource.id]
        return (
          <button
            key={resource.id}
            type="button"
            className="resource-item"
            title={resource.name}
            onClick={() => setOpenId(resource.id)}
          >
            <ResourceIcon id={resource.id} className="resource-icon" />
            <span className="resource-value">{amounts[resource.id].toLocaleString()}</span>
            <span className={`resource-delta${delta > 0 ? ' econ-pos' : delta < 0 ? ' econ-neg' : ''}`}>
              {formatDelta(delta)}/mo
            </span>
          </button>
        )
      })}

      {openResource && (
        <DraggableWindow title={openResource.name} onClose={() => setOpenId(null)} maximizable={false}>
          <div className="inspect-row">
            <span className="inspect-label">Stockpile</span>
            <span className="inspect-value">{amounts[openResource.id].toLocaleString()}</span>
          </div>
          <div className="inspect-row">
            <span className="inspect-label">Monthly</span>
            <span
              className={`inspect-value${
                monthlyDelta[openResource.id] > 0 ? ' econ-pos' : monthlyDelta[openResource.id] < 0 ? ' econ-neg' : ''
              }`}
            >
              {formatDelta(monthlyDelta[openResource.id])}/mo
            </span>
          </div>
          <div className="inspect-row">
            <span className="inspect-label">Debt</span>
            {/* A resource going negative — nothing does yet, since no
                consumption system exists — IS debt: a shortfall the economy
                is running against rather than a stockpile it holds. Derived
                from the stockpile itself rather than a separate stored
                field, so it can never drift out of sync with it. */}
            <span className={`inspect-value${amounts[openResource.id] < 0 ? ' econ-neg' : ''}`}>
              {amounts[openResource.id] < 0 ? Math.abs(amounts[openResource.id]).toLocaleString() : 0}
            </span>
          </div>
          <div className="inspect-divider" />
          <div className="resource-info-description">{openResource.description}</div>
        </DraggableWindow>
      )}
    </div>
  )
}
