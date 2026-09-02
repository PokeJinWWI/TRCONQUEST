import { useMemo } from 'react'
import { RECIPES, getMethod } from '../economy/recipes'
import { GOODS } from '../economy/goods'
import { estimateWorldGdp, constructionCost } from '../economy/economyTick'
import { economicSystemDef, STATE_OWNERSHIP_THRESHOLD, type EconomicSystem } from '../economy/laws'
import { useEconomyStore } from '../state/economyStore'
import { usePlayerStore } from '../state/playerStore'
import { getCountry } from '../data/countryData'
import { formatPop, formatMoney } from '../economy/format'
import type { Building, Country, World } from '../economy/economyTypes'

const TAB_CATEGORIES: Record<string, string[] | null> = {
  Development: null,
  Agriculture: ['agriculture'],
  Resources: ['extraction'],
  Urban: ['industry', 'healthcare'],
}

interface BuildingsPanelProps {
  subtab: string | null
  worldName?: string
  world?: World
  // The owning country — its treasury funds construction here.
  country?: Country
}

type Control = 'state' | 'owner' | 'pinned'

// Who runs a building and whether the state is interfering: state-run (player
// directs freely), owner-run (the owner picks the method), or pinned (a private
// building the state has overridden — which under a market economy carries the
// interference malus).
function buildingControl(b: Building, system: EconomicSystem): { control: Control; malus: number } {
  if (b.stateFraction >= STATE_OWNERSHIP_THRESHOLD) return { control: 'state', malus: 1 }
  if (b.methodLocked) return { control: 'pinned', malus: economicSystemDef(system).interferenceMalus }
  return { control: 'owner', malus: 1 }
}

// A world's buildings from the live simulation: level, the production method in
// use (switchable on worlds you govern), the output good, the building's
// throughput (its ramp toward full output), how many pops it employs vs the
// jobs it posts, and profit. Construction is funded from the national treasury
// (see economyTick). Read-only on worlds you don't own.
export function BuildingsPanel({ subtab, worldName, world, country }: BuildingsPanelProps) {
  const countryId = usePlayerStore((s) => s.selectedCountryId)
  const queueConstruction = useEconomyStore((s) => s.queueConstruction)
  const cancelConstruction = useEconomyStore((s) => s.cancelConstruction)
  const setProductionMethod = useEconomyStore((s) => s.setProductionMethod)
  const releaseProductionMethod = useEconomyStore((s) => s.releaseProductionMethod)

  const cats = subtab ? TAB_CATEGORIES[subtab] : null
  const rows = useMemo(() => {
    if (!world) return []
    return world.buildings
      .map((b) => ({ b, recipe: RECIPES[b.recipeId] }))
      .filter(({ recipe }) => recipe && (!cats || cats.includes(recipe.category)))
  }, [world, cats])

  if (!world) {
    return <div className="nav-placeholder">{worldName ? `${worldName} is uninhabited — no economy.` : 'No world in focus.'}</div>
  }

  const totalPop = world.pops.reduce((s, p) => s + p.populationSize, 0)
  const owned = !!countryId && world.ownerId === countryId
  const treasury = country?.treasury ?? 0
  const buildable = Object.values(RECIPES).filter((r) => !cats || cats.includes(r.category))

  return (
    <div className="econ-panel">
      <div className="econ-summary">
        <span>
          <span className="econ-summary-label">{world.name}</span> · Pop {formatPop(totalPop)} · GDP {formatMoney(estimateWorldGdp(world))}
          {owned && <> · Treasury {formatMoney(treasury)}</>}
        </span>
        {country && (
          <div className="econ-econsystem">
            <span>Economic system:</span>
            <span className="econ-econsystem-name" title={economicSystemDef(country.economicSystem).description}>
              {economicSystemDef(country.economicSystem).name}
            </span>
            {owned && <span className="econ-econsystem-hint">— set it in Government → Laws</span>}
          </div>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="nav-placeholder">No buildings in this sector.</div>
      ) : (
        <table className="econ-table">
          <thead>
            <tr>
              <th>Building</th>
              <th>Lvl</th>
              <th>Method</th>
              <th>Output</th>
              <th>Run</th>
              <th>Jobs</th>
              <th>Profit</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ b, recipe }) => {
              const method = getMethod(b.recipeId, b.methodId)
              const out = method?.outputs[0]
              const runPct = Math.round(b.throughput * 100)
              const jobPct = b.jobsPosted > 0 ? Math.round((b.employed / b.jobsPosted) * 100) : 0
              const { control, malus } = buildingControl(b, country?.economicSystem ?? 'interventionism')
              const malusPct = Math.round((1 - malus) * 100)
              const nation = country ? getCountry(country.id)?.name ?? 'the state' : 'the state'
              const tagText = control === 'state' ? 'State' : control === 'pinned' ? (malusPct > 0 ? `State-set −${malusPct}%` : 'State-set') : 'Private'
              const tagTitle =
                control === 'state'
                  ? `State-owned: run directly by ${nation}'s government.`
                  : control === 'pinned'
                    ? malusPct > 0
                      ? `Privately owned, but ${nation} has pinned its method — resented under a market economy: −${malusPct}% output. Release (↩) to hand it back to the owner.`
                      : `Privately owned; ${nation} has set its method (no penalty under a command economy).`
                    : `Privately owned — run by private investors within ${nation}, who pick the most profitable method themselves.`
              return (
                <tr key={b.id}>
                  <td>{recipe!.label}</td>
                  <td>{b.level}</td>
                  <td>
                    <div className="econ-method-cell">
                      {owned && recipe!.methods.length > 1 ? (
                        <select
                          className="econ-method-select"
                          value={b.methodId}
                          onChange={(e) => setProductionMethod(world.id, b.id, e.target.value)}
                          title={method?.description}
                        >
                          {recipe!.methods.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span title={method?.description}>{method?.label ?? '—'}</span>
                      )}
                      <span className={`econ-owner-tag econ-owner-${control}`} title={tagTitle}>
                        {tagText}
                      </span>
                      {owned && control === 'pinned' && (
                        <button
                          type="button"
                          className="econ-release-btn"
                          onClick={() => releaseProductionMethod(world.id, b.id)}
                          title="Hand this building back to its owner"
                        >
                          ↩
                        </button>
                      )}
                    </div>
                  </td>
                  <td>{out ? GOODS[out.good].label : '—'}</td>
                  <td title={`Throughput ${runPct}% — ramps toward full as labor, inputs and demand allow`}>{runPct}%</td>
                  <td title={`${formatPop(b.employed)} employed of ${formatPop(b.jobsPosted)} jobs posted`}>
                    {b.jobsPosted > 0 ? `${formatPop(b.employed)} (${jobPct}%)` : '—'}
                  </td>
                  <td className={b.lastProfit >= 0 ? 'econ-pos' : 'econ-neg'}>{formatMoney(b.lastProfit)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {world.constructionQueue.length > 0 && (
        <>
          <div className="econ-subtitle" style={{ marginTop: 8 }}>
            Under construction
          </div>
          {world.constructionQueue.map((o) => {
            const recipe = RECIPES[o.recipeId]
            const pct = Math.max(0, Math.min(100, (o.progress / o.cost) * 100))
            return (
              <div key={o.id} className="econ-build-row">
                <span className="econ-build-name">{recipe?.label ?? o.recipeId}</span>
                <span className="econ-build-bar">
                  <span className="econ-build-fill" style={{ width: `${pct}%` }} />
                </span>
                <span className="econ-build-pct">{Math.round(pct)}%</span>
                {owned && (
                  <button type="button" className="econ-build-cancel" onClick={() => cancelConstruction(world.id, o.id)} aria-label="Cancel">
                    ×
                  </button>
                )}
              </div>
            )
          })}
        </>
      )}

      {owned ? (
        <>
          <div className="econ-subtitle" style={{ marginTop: 8 }}>
            Build (cost {constructionCost()} each)
          </div>
          <div className="econ-build-buttons">
            {buildable.map((r) => (
              <button
                key={r.id}
                type="button"
                className="econ-build-btn"
                onClick={() => queueConstruction(world.id, r.id)}
                disabled={treasury <= 0}
                title={treasury <= 0 ? 'National treasury empty — no funds to build' : `Queue a ${r.label}`}
              >
                + {r.label}
              </button>
            ))}
          </div>
          <div className="ship-panel-hint">
            New buildings ramp up throughput gradually. Private buildings are <b>owner-run</b> — owners pick their own method; overriding one pins it,
            which under a market economy costs output. Release (↩) hands it back.
          </div>
          {treasury <= 0 && <div className="ship-panel-hint">National treasury is empty — build savings (or raise tax) first.</div>}
        </>
      ) : (
        <div className="ship-panel-hint">You don't govern {world.name} — construction is only available on your own worlds.</div>
      )}
    </div>
  )
}
