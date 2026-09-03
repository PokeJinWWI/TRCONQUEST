import { useMemo, useState } from 'react'
import { CULTURES, RELIGIONS } from '../economy/demographics'
import { SPECIES_TEMPLATES, NEED_TIERS, type NeedTier } from '../economy/species'
import { GOODS, type GoodId } from '../economy/goods'
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

interface GoodConsumption {
  good: GoodId
  wanted: number
  consumed: number
}

// Aggregate every cohort's per-good needsDetail into one world-level view per
// tier — this is the real thing being consumed (goods bought, or missed),
// which is what the panel shows instead of a single blended percentage. Falls
// back to the species basket scaled by the tier's blended needsSatisfaction
// when no pop has been ticked yet (needsDetail is populated by tickWorld, so
// a freshly-seeded world with tick 0 has none).
function tierConsumption(world: World, tier: NeedTier): GoodConsumption[] {
  const totals = new Map<GoodId, { wanted: number; consumed: number }>()
  for (const pop of world.pops) {
    const entries = pop.needsDetail?.[tier]
    if (!entries) continue
    for (const e of entries) {
      const cur = totals.get(e.good) ?? { wanted: 0, consumed: 0 }
      cur.wanted += e.wanted
      cur.consumed += e.consumed
      totals.set(e.good, cur)
    }
  }
  if (totals.size === 0) {
    // No per-good detail yet — fall back to the basket scaled by whatever
    // blended satisfaction the pops already carry, so the panel isn't blank
    // before the first tick.
    const bySpecies = new Map<string, number>() // speciesTemplateId -> population
    for (const pop of world.pops) bySpecies.set(pop.speciesTemplateId, (bySpecies.get(pop.speciesTemplateId) ?? 0) + pop.populationSize)
    const totalPop = world.pops.reduce((s, p) => s + p.populationSize, 0)
    const met = totalPop > 0 ? world.pops.reduce((s, p) => s + p.needsSatisfaction[tier] * p.populationSize, 0) / totalPop : 0
    for (const [speciesId, size] of bySpecies) {
      const species = SPECIES_TEMPLATES[speciesId]
      if (!species) continue
      for (const need of species.needs[tier]) {
        const wanted = need.amountPerPop * size
        const cur = totals.get(need.good) ?? { wanted: 0, consumed: 0 }
        cur.wanted += wanted
        cur.consumed += wanted * met
        totals.set(need.good, cur)
      }
    }
  }
  return [...totals.entries()].map(([good, v]) => ({ good, ...v }))
}

// The actual pop cohorts on a world — the four-axis population (species +
// culture + religion + class) the whole economy and politics are built from,
// each with a headcount, wealth, standard of living and how well its needs are
// met. Also shows the species' needs basket (what these pops actually consume).
export function PopsPanel({ worldName, world }: PopsPanelProps) {
  const cohorts = useMemo(() => (world ? [...world.pops].sort((a, b) => b.populationSize - a.populationSize) : []), [world])
  // Which tiers are collapsed — all tiers start expanded (the breakdown is
  // short: ~11 goods total across 5 tiers), the toggle just lets the player
  // shrink a tier they don't care about right now.
  const [collapsedTiers, setCollapsedTiers] = useState<Set<NeedTier>>(new Set())
  const toggleTier = (tier: NeedTier) =>
    setCollapsedTiers((prev) => {
      const next = new Set(prev)
      if (next.has(tier)) next.delete(tier)
      else next.add(tier)
      return next
    })

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
          <div className="econ-subtitle">
            What pops actually consume ({speciesLabel}) — goods bought per capita vs. what's needed, including healthcare
          </div>
          {NEED_TIERS.map((tier) => {
            if (species.needs[tier].length === 0) return null
            const goods = tierConsumption(world, tier)
            if (goods.length === 0) return null
            const tierWanted = goods.reduce((s, g) => s + g.wanted, 0)
            const tierConsumed = goods.reduce((s, g) => s + g.consumed, 0)
            const tierMet = tierWanted > 0 ? tierConsumed / tierWanted : 1
            const collapsed = collapsedTiers.has(tier)
            return (
              <div className="pops-tier" key={tier}>
                <button type="button" className="pops-tier-head" onClick={() => toggleTier(tier)}>
                  <span className="pops-tier-chevron">{collapsed ? '▸' : '▾'}</span>
                  <span className="pops-basket-tier">{tier}</span>
                  <span className={`pops-basket-met ${tierMet >= 0.6 ? 'econ-pos' : tierMet >= 0.3 ? '' : 'econ-neg'}`}>{Math.round(tierMet * 100)}%</span>
                </button>
                {!collapsed && (
                  <div className="pops-good-list">
                    {goods.map(({ good, wanted, consumed }) => {
                      const perCapitaWanted = totalPop > 0 ? wanted / totalPop : 0
                      const perCapitaConsumed = totalPop > 0 ? consumed / totalPop : 0
                      const pct = wanted > 0 ? Math.min(1, consumed / wanted) : 1
                      return (
                        <div className="demo-bar-row pops-good-row" key={good} title={`${GOODS[good].label}: ${perCapitaConsumed.toFixed(2)} of ${perCapitaWanted.toFixed(2)} per capita needed`}>
                          <span className="demo-bar-label">{GOODS[good].label}</span>
                          <span className="demo-bar-track">
                            <span
                              className="demo-bar-fill"
                              style={{ width: `${pct * 100}%`, background: pct >= 0.6 ? '#4ade80' : pct >= 0.3 ? '#ffd23f' : '#ff6b4a' }}
                            />
                          </span>
                          <span className="demo-bar-val">
                            {perCapitaConsumed.toFixed(2)}/{perCapitaWanted.toFixed(2)} ({Math.round(pct * 100)}%)
                          </span>
                        </div>
                      )
                    })}
                  </div>
                )}
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
