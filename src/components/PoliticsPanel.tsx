import { interestGroupStrengths } from '../economy/politics'
import type { World } from '../economy/economyTypes'

// The interest-group balance of power on a world, derived live from its pops
// (see economy/politics.ts). Raw material for the legislature and Political map
// mode in later milestones.
export function PoliticsPanel({ worldName, world }: { worldName?: string; world?: World }) {
  if (!world) {
    return <div className="nav-placeholder">{worldName ? `${worldName} is uninhabited — no politics.` : 'No world in focus.'}</div>
  }
  const groups = interestGroupStrengths(world)
  const max = Math.max(...groups.map((g) => g.strength), 1)

  return (
    <div className="econ-panel">
      <div className="econ-subtitle">Interest groups on {world.name}</div>
      {groups.map((g) => (
        <div key={g.def.id} className="pol-group-row">
          <span className="pol-group-name" style={{ color: g.def.color }}>
            {g.def.name}
          </span>
          <span className="pol-group-bar">
            <span className="pol-group-fill" style={{ width: `${(g.strength / max) * 100}%`, background: g.def.color }} />
          </span>
          <span className="pol-group-share">{Math.round(g.share * 100)}%</span>
        </div>
      ))}
      <div className="ship-panel-hint">
        Strength weights population by class and wealth. Parties, agendas and the legislature come next.
      </div>
    </div>
  )
}
