import { RESOURCE_TYPES } from '../data/resourceData'
import { useResourceStore } from '../state/resourceStore'
import { ResourceIcon } from './ResourceIcons'

// Real values, currently all zero — see resourceStore for why that's the
// honest number rather than an invented one.
export function ResourceBar() {
  const amounts = useResourceStore((s) => s.amounts)

  return (
    <div className="resource-bar">
      {RESOURCE_TYPES.map((resource) => (
        <div key={resource.id} className="resource-item" title={resource.name}>
          <ResourceIcon id={resource.id} className="resource-icon" />
          <span className="resource-value">{amounts[resource.id].toLocaleString()}</span>
        </div>
      ))}
    </div>
  )
}
