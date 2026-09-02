import { useMemo } from 'react'
import { CULTURES, RELIGIONS } from '../economy/demographics'
import { SPECIES_TEMPLATES, NEED_TIERS } from '../economy/species'
import { GOODS } from '../economy/goods'
import { formatPop } from '../economy/format'
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

// Standard of Living proxy is now a real field on the pop; keep a helper for the
// average needs-met display alongside it.
function needsMet(pop: Pop): number {
  const species = SPECIES_TEMPLATES[pop.speciesTemplateId]
  if (!species) return 0
  const real = NEED_TIERS.filter((t) => species.needs[t].length > 0)
  if (real.length === 0) return 1
  return real.reduce((s, t) => s + pop.needsSatisfaction[t], 0) / real.length
}

// The actual pop cohorts on a world — the four-axis population (species +
// culture + religion + class) the whole economy and politics are built from,
// each with a headcount, wealth, standard of living and how well its needs are
// met. Also shows the species' needs basket (what these pops actually consume).
export function PopsPanel({ worldName, world }: PopsPanelProps) {
  const cohorts = useMemo(() => (world ? [...world.pops].sort((a, b) => b.populationSize - a.populationSize) : []), [world])

  if (!world) {
    return <div className="nav-placeholder">{worldName ? `${worldName} is uninhabited — no population.` : 'No world in focus.'}</div>
  }

  const totalPop = world.pops.reduce((s, p) => s + p.populationSize, 0)
  const culture = CULTURES[world.cultureId]?.name ?? world.cultureId
  const speciesIds = [...new Set(world.pops.map((p) => p.speciesTemplateId))]
  const species = SPECIES_TEMPLATES[speciesIds[0]]
  const speciesLabel = speciesIds.map((id) => SPECIES_TEMPLATES[id]?.name ?? id).join(', ')
  const avgSoL = totalPop > 0 ? world.pops.reduce((s, p) => s + p.standardOfLiving * p.populationSize, 0) / totalPop : 0

  return (
    <div className="econ-panel">
      <div className="econ-summary">
        <span>
          <span className="econ-summary-label">{world.name}</span> · {formatPop(totalPop)} people · Avg SoL {Math.round(avgSoL * 100)}%
        </span>
        <div className="pops-meta">
          <span>
            Culture: <b>{culture}</b>
          </span>
          <span>
            Species: <b>{speciesLabel}</b>
          </span>
        </div>
      </div>

      {species && (
        <div className="pops-needs-basket">
          <div className="econ-subtitle">Needs basket ({speciesLabel})</div>
          {NEED_TIERS.map((tier) => {
            const entries = species.needs[tier]
            if (entries.length === 0) return null
            const met = totalPop > 0 ? world.pops.reduce((s, p) => s + p.needsSatisfaction[tier] * p.populationSize, 0) / totalPop : 0
            return (
              <div className="pops-basket-row" key={tier}>
                <span className="pops-basket-tier">{tier}</span>
                <span className="pops-basket-goods">{entries.map((n) => GOODS[n.good].label).join(', ')}</span>
                <span className={`pops-basket-met ${met >= 0.6 ? 'econ-pos' : met >= 0.3 ? '' : 'econ-neg'}`}>{Math.round(met * 100)}%</span>
              </div>
            )
          })}
        </div>
      )}

      <div className="econ-subtitle" style={{ marginTop: 8 }}>
        Cohorts
      </div>
      {cohorts.length === 0 ? (
        <div className="nav-placeholder">No pops on this world.</div>
      ) : (
        <table className="econ-table">
          <thead>
            <tr>
              <th>Class</th>
              <th>Culture</th>
              <th>Religion</th>
              <th>Pop</th>
              <th>SoL</th>
              <th>Needs</th>
            </tr>
          </thead>
          <tbody>
            {cohorts.map((p) => {
              const met = Math.round(needsMet(p) * 100)
              const sol = Math.round(p.standardOfLiving * 100)
              const religion = RELIGIONS[p.religionId]
              const cult = CULTURES[p.cultureId]
              return (
                <tr key={p.id}>
                  <td>{CLASS_LABEL[p.class] ?? p.class}</td>
                  <td>{cult?.name ?? p.cultureId}</td>
                  <td>
                    <span className="pops-faith-dot" style={{ background: religion?.color ?? '#8a8f96' }} />
                    {religion?.name ?? p.religionId}
                  </td>
                  <td>{formatPop(p.populationSize)}</td>
                  <td className={sol >= 60 ? 'econ-pos' : sol >= 35 ? '' : 'econ-neg'} title="Standard of Living — the meaningful measure of how well this cohort lives">
                    {sol}%
                  </td>
                  <td className={met >= 60 ? 'econ-pos' : met >= 30 ? '' : 'econ-neg'} title="Share of needs met">
                    {met}%
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      <div className="ship-panel-hint">
        Standard of Living drives population growth, education and consumption (Milestone 3). Wealthier pops reach higher
        needs tiers and grow.
      </div>
    </div>
  )
}
