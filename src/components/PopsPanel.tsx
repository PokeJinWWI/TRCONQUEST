import { useMemo } from 'react'
import { CULTURES, RELIGIONS } from '../economy/demographics'
import { SPECIES_TEMPLATES, NEED_TIERS } from '../economy/species'
import { formatPop, formatMoney } from '../economy/format'
import type { Pop, World } from '../economy/economyTypes'

interface PopsPanelProps {
  worldName?: string
  world?: World
}

const CLASS_LABEL: Record<string, string> = {
  subsistence: 'Subsistence',
  labor: 'Labor',
  technical: 'Technical',
  professional: 'Professional',
  investor: 'Investor',
  political: 'Political',
}

// The living standard proxy until the full Standard-of-Living loop (Milestone
// 3): how well the pop is meeting the needs tiers its species actually has.
function needsMet(pop: Pop): number {
  const species = SPECIES_TEMPLATES[pop.speciesTemplateId]
  if (!species) return 0
  const real = NEED_TIERS.filter((t) => species.needs[t].length > 0)
  if (real.length === 0) return 1
  return real.reduce((s, t) => s + pop.needsSatisfaction[t], 0) / real.length
}

// The actual pop cohorts living on a world — the four-axis population the whole
// economy and politics are built from (species + culture + religion + class),
// each with a real headcount, wealth, and how well its needs are met. Sorted
// biggest cohort first.
export function PopsPanel({ worldName, world }: PopsPanelProps) {
  const cohorts = useMemo(() => (world ? [...world.pops].sort((a, b) => b.populationSize - a.populationSize) : []), [world])

  if (!world) {
    return <div className="nav-placeholder">{worldName ? `${worldName} is uninhabited — no population.` : 'No world in focus.'}</div>
  }

  const totalPop = world.pops.reduce((s, p) => s + p.populationSize, 0)
  const culture = CULTURES[world.cultureId]?.name ?? world.cultureId
  const speciesIds = [...new Set(world.pops.map((p) => p.speciesTemplateId))]
  const speciesLabel = speciesIds.map((id) => SPECIES_TEMPLATES[id]?.name ?? id).join(', ')

  return (
    <div className="econ-panel">
      <div className="econ-summary">
        <span>
          <span className="econ-summary-label">{world.name}</span> · {formatPop(totalPop)} people · {culture}
          {speciesLabel && <> · {speciesLabel}</>}
        </span>
      </div>

      {cohorts.length === 0 ? (
        <div className="nav-placeholder">No pops on this world.</div>
      ) : (
        <table className="econ-table">
          <thead>
            <tr>
              <th>Class</th>
              <th>Religion</th>
              <th>Pop</th>
              <th>Wealth</th>
              <th>Needs</th>
            </tr>
          </thead>
          <tbody>
            {cohorts.map((p) => {
              const met = Math.round(needsMet(p) * 100)
              const religion = RELIGIONS[p.religionId]
              return (
                <tr key={p.id}>
                  <td>{CLASS_LABEL[p.class] ?? p.class}</td>
                  <td>
                    <span className="pops-faith-dot" style={{ background: religion?.color ?? '#8a8f96' }} />
                    {religion?.name ?? p.religionId}
                  </td>
                  <td>{formatPop(p.populationSize)}</td>
                  <td title="Cohort wealth (USD)">{formatMoney(p.wealth)}</td>
                  <td className={met >= 60 ? 'econ-pos' : met >= 30 ? '' : 'econ-neg'} title="Share of this pop's needs met (living standard proxy)">
                    {met}%
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      <div className="ship-panel-hint">
        Pops are cohorts of species + culture + religion + class. Wealth and needs drive the coming Standard-of-Living
        loop (growth, education, consumption).
      </div>
    </div>
  )
}
