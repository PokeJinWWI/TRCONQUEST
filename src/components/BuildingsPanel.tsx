import { Fragment, useMemo, useState } from 'react'
import { RECIPES, getMethod, BUREAUCRACY_OUTPUT } from '../economy/recipes'
import { GOODS } from '../economy/goods'
import { estimateWorldGdp, constructionCost, JOB_SCALE, canBuild } from '../economy/economyTick'
import { DISTRICT_LABELS, districtOfRecipe } from '../economy/recipes'
import { economicSystemDef, type EconomicSystem } from '../economy/laws'
import { useEconomyStore } from '../state/economyStore'
import { usePlayerStore } from '../state/playerStore'
import { getCountry } from '../data/countryData'
import { formatPop, formatMoney } from '../economy/format'
import type { Building, Corporation, Country, World } from '../economy/economyTypes'

const CLASS_LABEL: Record<string, string> = {
  subsistence: 'Subsistence',
  labor: 'Labor',
  technical: 'Technical',
  professional: 'Professional',
  investor: 'Investor',
  political: 'Political',
}

// The full detail of one building — its inputs, outputs, employment by class,
// owner and finances — shown when a building row is clicked.
function BuildingDetail({ b, corporations }: { b: Building; corporations: Corporation[] }) {
  const recipe = RECIPES[b.recipeId]
  const method = getMethod(b.recipeId, b.methodId)
  if (!recipe || !method) return null
  const t = b.throughput
  const perTick = (amount: number) => amount * b.level * t
  const owner = ownerLabel(b, corporations)
  const bureaucracy = BUREAUCRACY_OUTPUT[b.recipeId]

  return (
    <div className="bld-detail">
      <div className="bld-detail-title">
        {recipe.label} · Level {b.level} · <span className="bld-detail-owner">{owner}</span>
      </div>
      <div className="bld-detail-desc">{method.description}</div>

      <div className="bld-detail-cols">
        <div className="bld-detail-col">
          <div className="bld-detail-h econ-neg">Inputs / tick</div>
          {method.inputs.length === 0 ? (
            <div className="bld-detail-none">none</div>
          ) : (
            method.inputs.map((i) => (
              <div className="bld-detail-line" key={i.good}>
                <span>{GOODS[i.good].label}</span>
                <span>{perTick(i.amount).toFixed(0)}</span>
              </div>
            ))
          )}
        </div>
        <div className="bld-detail-col">
          <div className="bld-detail-h econ-pos">Outputs / tick</div>
          {method.outputs.length === 0 ? (
            <div className="bld-detail-none">{bureaucracy ? `${(bureaucracy * b.level * t).toFixed(0)} bureaucracy` : 'none (overhead)'}</div>
          ) : (
            method.outputs.map((o) => (
              <div className="bld-detail-line" key={o.good}>
                <span>{GOODS[o.good].label}</span>
                <span>{perTick(o.amount).toFixed(0)}</span>
              </div>
            ))
          )}
        </div>
        <div className="bld-detail-col">
          <div className="bld-detail-h">Employment</div>
          {method.jobs.map((j) => {
            const posted = j.count * b.level * JOB_SCALE
            const filled = posted * t
            return (
              <div className="bld-detail-line" key={j.class}>
                <span>{CLASS_LABEL[j.class] ?? j.class}</span>
                <span>{formatPop(filled)}</span>
              </div>
            )
          })}
        </div>
      </div>
      <div className="bld-detail-foot">
        Throughput {Math.round(t * 100)}% · Employs {formatPop(b.employed)} of {formatPop(b.jobsPosted)} jobs · Profit{' '}
        <span className={b.lastProfit >= 0 ? 'econ-pos' : 'econ-neg'}>{formatMoney(b.lastProfit)}</span>/tick
      </div>
    </div>
  )
}

const TAB_CATEGORIES: Record<string, string[] | null> = {
  Development: null,
  Agriculture: ['agriculture'],
  Resources: ['extraction', 'energy'],
  Urban: ['industry', 'services', 'corporate'],
}

interface BuildingsPanelProps {
  subtab: string | null
  worldName?: string
  world?: World
  // The owning country — its treasury funds construction here.
  country?: Country
}

type Control = 'state' | 'corporation' | 'worker'

// Who owns/runs a building, and whether the state is interfering. State-owned
// buildings the player directs freely; corporation- and worker-owned ones are
// run by their owners, and pinning a non-state building's method is the
// interference that carries the economic-system malus (laws.ts).
function buildingControl(b: Building, system: EconomicSystem): { control: Control; pinned: boolean; malus: number } {
  const control: Control = b.owner.kind === 'state' ? 'state' : b.owner.kind === 'corporation' ? 'corporation' : 'worker'
  const pinned = b.owner.kind !== 'state' && b.methodLocked
  const malus = pinned ? economicSystemDef(system).interferenceMalus : 1
  return { control, pinned, malus }
}

// The short display name of a building's owner.
function ownerLabel(b: Building, corporations: Corporation[]): string {
  if (b.owner.kind === 'worker') return 'Co-op'
  if (b.owner.kind === 'corporation') {
    const corpId = b.owner.corporationId
    return corporations.find((c) => c.id === corpId)?.name ?? 'Corporation'
  }
  return 'State'
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
  const corporations = useEconomyStore((s) => s.corporations)
  const [detailId, setDetailId] = useState<string | null>(null)

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
              <th>Owner</th>
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
              const { control, pinned, malus } = buildingControl(b, country?.economicSystem ?? 'interventionism')
              const malusPct = Math.round((1 - malus) * 100)
              const nation = country ? getCountry(country.id)?.name ?? 'the state' : 'the state'
              const ownerName = ownerLabel(b, corporations)
              const ownerTitle =
                control === 'state'
                  ? `State-owned: run directly by ${nation}. Profit flows to the treasury.`
                  : control === 'corporation'
                    ? `Owned by the corporation ${ownerName}. Profit accrues to the company.`
                    : `Worker co-op: owned by the pops who work here. Profit is paid to them as dividends.`
              const open = detailId === b.id
              return (
                <Fragment key={b.id}>
                <tr className="bld-row">
                  <td>
                    <button type="button" className="bld-name-btn" onClick={() => setDetailId(open ? null : b.id)} title="Click for full details">
                      <span className="market-caret">{open ? '▾' : '▸'}</span>
                      {recipe!.label}
                    </button>
                  </td>
                  <td>{b.level}</td>
                  <td>
                    <span className={`econ-owner-tag econ-owner-${control}`} title={ownerTitle}>
                      {ownerName}
                    </span>
                    {pinned && (
                      <span className="econ-pin-badge" title={`State-directed against the market: −${malusPct}% output.`}>
                        pinned −{malusPct}%
                      </span>
                    )}
                  </td>
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
                      {owned && pinned && (
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
                {open && (
                  <tr className="market-detail-row">
                    <td colSpan={8}>
                      <BuildingDetail b={b} corporations={corporations} />
                    </td>
                  </tr>
                )}
                </Fragment>
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
            Build (cost {formatMoney(constructionCost())} each — government pool)
          </div>
          <div className="econ-build-buttons">
            {buildable.map((r) => {
              const room = canBuild(world, r.id)
              return (
                <button
                  key={r.id}
                  type="button"
                  className="econ-build-btn"
                  onClick={() => queueConstruction(world.id, r.id)}
                  disabled={!room}
                  title={!room ? `${DISTRICT_LABELS[districtOfRecipe(r.id)]} district is full` : `Queue a ${r.label} in the ${DISTRICT_LABELS[districtOfRecipe(r.id)]} district`}
                >
                  + {r.label}
                </button>
              )
            })}
          </div>
          <div className="ship-panel-hint">
            Buildings occupy their district (see Economy → Construction for space, private pools and materials). Private
            buildings are <b>owner-run</b>; overriding one pins it (a market-economy output cost). Release (↩) hands it back.
          </div>
        </>
      ) : (
        <div className="ship-panel-hint">You don't govern {world.name} — construction is only available on your own worlds.</div>
      )}
    </div>
  )
}
