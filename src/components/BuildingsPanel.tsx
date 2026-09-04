import { Fragment, useMemo, useState } from 'react'
import { RECIPES, getMethod, BUREAUCRACY_OUTPUT, buildingGroup, BUILDING_GROUP_LABELS, BUILDING_GROUP_ORDER, type BuildingGroup } from '../economy/recipes'
import { GOODS } from '../economy/goods'
import { estimateWorldGdp, estimateConstructionCost, JOB_SCALE, canBuild, BUILD_COST_PER_LEVEL, DEPLETABLE_GOODS, TICKS_PER_YEAR } from '../economy/economyTick'
import { DISTRICT_LABELS, districtOfRecipe } from '../economy/recipes'
import { economicSystemDef, type EconomicSystem } from '../economy/laws'
import { useEconomyStore } from '../state/economyStore'
import { usePlayerStore } from '../state/playerStore'
import { useConfirmStore } from '../state/confirmStore'
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

// Buckets a category-filtered list into its finer BuildingGroup subdivisions,
// in BUILDING_GROUP_ORDER, dropping empty groups. Used to add divider headers
// once a tab (or the build-buttons grid) holds enough distinct building types
// that a flat list stops being legible.
function groupedByBuilding<T>(items: T[], recipeIdOf: (t: T) => string): { group: BuildingGroup; items: T[] }[] {
  const buckets = new Map<BuildingGroup, T[]>()
  for (const item of items) {
    const g = buildingGroup(recipeIdOf(item))
    if (!buckets.has(g)) buckets.set(g, [])
    buckets.get(g)!.push(item)
  }
  return BUILDING_GROUP_ORDER.filter((g) => buckets.has(g)).map((g) => ({ group: g, items: buckets.get(g)! }))
}

// Compact "12.3k" / "4.5M" formatting for a raw deposit quantity.
function formatDeposit(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return n.toFixed(0)
}

// The full detail of one building — its inputs, outputs, employment by class,
// owner and finances — shown when a building row is clicked. When the viewer
// governs this world, it also carries a per-building subsidy control and a
// Nationalize action (transfers a single building to the state regardless of
// its owning corporation's overall status).
function BuildingDetail({
  b,
  world,
  country,
  owned,
  corporations,
}: {
  b: Building
  world: World
  country?: Country
  owned: boolean
  corporations: Corporation[]
}) {
  const recipe = RECIPES[b.recipeId]
  const method = getMethod(b.recipeId, b.methodId)
  const setSubsidyForBuilding = useEconomyStore((s) => s.setSubsidyForBuilding)
  const nationalizeBuildingLevels = useEconomyStore((s) => s.nationalizeBuildingLevels)
  const privatizeBuildingLevels = useEconomyStore((s) => s.privatizeBuildingLevels)
  const requestConfirm = useConfirmStore((s) => s.requestConfirm)
  // How many levels to nationalize/privatize (clamped to the building's level).
  const [xferInput, setXferInput] = useState(1)
  if (!recipe || !method) return null
  const xfer = Math.max(1, Math.min(Math.floor(xferInput) || 1, b.level))
  const t = b.throughput
  const perTick = (amount: number) => amount * b.level * t
  const owner = ownerLabel(b, corporations)
  const bureaucracy = BUREAUCRACY_OUTPUT[b.recipeId]
  const subsidyKey = `${world.id}:${b.id}`
  const subsidy = country?.subsidies.buildings[subsidyKey] ?? 0

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
      {recipe.category === 'extraction' && method.outputs.some((o) => DEPLETABLE_GOODS.includes(o.good)) && (
        <div className="bld-detail-reserve">
          {method.outputs
            .filter((o) => DEPLETABLE_GOODS.includes(o.good))
            .map((o) => {
              const remaining = world.resourceDeposits?.[o.good]
              const rate = perTick(o.amount)
              if (remaining === undefined) {
                return (
                  <div className="bld-detail-line" key={o.good}>
                    <span>{GOODS[o.good].label} reserve</span>
                    <span className="econ-pos">Unlimited (unsurveyed deposit)</span>
                  </div>
                )
              }
              const depleted = remaining <= 0
              const yearsLeft = rate > 0 ? remaining / (rate * TICKS_PER_YEAR) : Infinity
              return (
                <div
                  className="bld-detail-line"
                  key={o.good}
                  title="A finite reserve shared by every building on this world extracting this good — it draws down as they produce and does not regrow."
                >
                  <span>{GOODS[o.good].label} reserve (world)</span>
                  <span className={depleted ? 'econ-neg' : undefined}>
                    {depleted
                      ? 'Depleted'
                      : `${formatDeposit(remaining)} · ~${yearsLeft >= 100 ? '100+' : yearsLeft.toFixed(1)} yrs at this rate`}
                  </span>
                </div>
              )
            })}
        </div>
      )}
      <div className="bld-detail-foot">
        Throughput {Math.round(t * 100)}% · Employs {formatPop(b.employed)} of {formatPop(b.jobsPosted)} jobs · Profit{' '}
        <span className={b.lastProfit >= 0 ? 'econ-pos' : 'econ-neg'}>{formatMoney(b.lastProfit)}</span>/tick
      </div>
      {owned && country && (
        <>
          <div
            className="econ-control-row"
            title="A standing per-tick treasury payment funding this building's production — a real, ongoing budget cost."
          >
            <span className="inspect-label">Subsidize/tick</span>
            <span className="econ-control">
              <button type="button" onClick={() => setSubsidyForBuilding(country.id, world.id, b.id, subsidy - 20)}>
                −
              </button>
              <span className="econ-control-value">{formatMoney(subsidy)}</span>
              <button type="button" onClick={() => setSubsidyForBuilding(country.id, world.id, b.id, subsidy + 20)}>
                +
              </button>
            </span>
          </div>
          {b.owner.kind !== 'state' ? (
            <div className="bld-detail-actions">
              <span className="bld-xfer-picker">
                <input
                  type="number"
                  className="bld-xfer-input"
                  min={1}
                  max={b.level}
                  value={xferInput}
                  onChange={(e) => setXferInput(Number(e.target.value))}
                  aria-label="Levels to nationalize"
                />
                <span className="bld-xfer-of">/ {b.level}</span>
                <button type="button" className="bld-xfer-all" onClick={() => setXferInput(b.level)}>
                  All
                </button>
              </span>
              <button
                type="button"
                className="corp-btn corp-btn-danger"
                onClick={() =>
                  requestConfirm({
                    title: `Nationalize ${xfer} of ${b.level} level${b.level > 1 ? 's' : ''} — ${recipe!.label}?`,
                    body:
                      xfer >= b.level
                        ? `Seize this whole building from its ${b.owner.kind === 'corporation' ? 'company' : 'co-op'}. It becomes state-run and its method is unpinned.`
                        : `Seize ${xfer} level${xfer > 1 ? 's' : ''} from this ${b.owner.kind === 'corporation' ? 'company' : 'co-op'} into a state building of the same type. The rest stays with its owner.`,
                    effects: [
                      `Pay ${formatMoney(xfer * BUILD_COST_PER_LEVEL * (b.owner.kind === 'corporation' ? 0.6 : 0.15))} compensation from the treasury`,
                      xfer >= b.level ? 'The entire building becomes state-owned' : `This building drops to level ${b.level - xfer}; a state ${recipe!.label} gains ${xfer} level${xfer > 1 ? 's' : ''}`,
                      `Lose ~${20 + xfer * 20} bureaucracy`,
                    ],
                    confirmLabel: `Nationalize ${xfer}`,
                    onConfirm: () => nationalizeBuildingLevels(world.id, b.id, xfer),
                  })
                }
              >
                Nationalize
              </button>
            </div>
          ) : (
            <div className="bld-detail-actions">
              <span className="bld-xfer-picker">
                <input
                  type="number"
                  className="bld-xfer-input"
                  min={1}
                  max={b.level}
                  value={xferInput}
                  onChange={(e) => setXferInput(Number(e.target.value))}
                  aria-label="Levels to privatize"
                />
                <span className="bld-xfer-of">/ {b.level}</span>
                <button type="button" className="bld-xfer-all" onClick={() => setXferInput(b.level)}>
                  All
                </button>
              </span>
              <button
                type="button"
                className="corp-btn"
                onClick={() =>
                  requestConfirm({
                    title: `Privatize ${xfer} of ${b.level} level${b.level > 1 ? 's' : ''} — ${recipe!.label}?`,
                    body: "Sell to the private sector — the country's largest private company (or a newly floated one if none exists) takes the levels over and runs them for profit.",
                    effects: [
                      `Bank ${formatMoney(xfer * BUILD_COST_PER_LEVEL * 0.7)} in sale proceeds to the treasury`,
                      xfer >= b.level ? 'The entire state building is sold off' : `This state building drops to level ${b.level - xfer}`,
                      `A private company gains ${xfer} level${xfer > 1 ? 's' : ''} of this type and runs it itself`,
                    ],
                    confirmLabel: `Privatize ${xfer}`,
                    onConfirm: () => privatizeBuildingLevels(world.id, b.id, xfer),
                  })
                }
              >
                Privatize
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// Each tab filters by BUILDING GROUP (the fine-grained grouping in recipes.ts),
// not by the broad BuildingCategory, so every building lands in exactly ONE
// sensible tab. Power/utilities/civic development together; extraction on its
// own; manufacturing under Industry; the soft public services under Services.
const TAB_GROUPS: Record<string, BuildingGroup[] | null> = {
  Development: ['power', 'infrastructure', 'civic'],
  Agriculture: ['agriculture'],
  Resources: ['extraction'],
  Industry: ['heavyIndustry', 'chemicals', 'consumerGoods', 'vehicles'],
  Services: ['services'],
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
  const downgradeBuilding = useEconomyStore((s) => s.downgradeBuilding)
  const setProductionMethod = useEconomyStore((s) => s.setProductionMethod)
  const releaseProductionMethod = useEconomyStore((s) => s.releaseProductionMethod)
  const corporations = useEconomyStore((s) => s.corporations)
  const [detailId, setDetailId] = useState<string | null>(null)

  const groups = subtab ? TAB_GROUPS[subtab] ?? null : null
  const rows = useMemo(() => {
    if (!world) return []
    return world.buildings
      .map((b) => ({ b, recipe: RECIPES[b.recipeId] }))
      .filter(({ recipe }) => recipe && (!groups || groups.includes(buildingGroup(recipe.id))))
  }, [world, groups])

  if (!world) {
    return <div className="nav-placeholder">{worldName ? `${worldName} is uninhabited — no economy.` : 'No world in focus.'}</div>
  }

  const totalPop = world.pops.reduce((s, p) => s + p.populationSize, 0)
  const owned = !!countryId && world.ownerId === countryId
  const treasury = country?.treasury ?? 0
  const buildable = Object.values(RECIPES).filter((r) => !groups || groups.includes(buildingGroup(r.id)))

  // Once a tab holds more than a handful of distinct building types, a flat
  // list stops being legible — add sub-category divider rows/headers. A tab
  // with few types (or only one underlying group) stays flat.
  const rowGroups = groupedByBuilding(rows, ({ b }) => b.recipeId)
  const showRowHeaders = rowGroups.length > 1 && rows.length > 6
  const buildGroups = groupedByBuilding(buildable, (r) => r.id)
  const showBuildHeaders = buildGroups.length > 1 && buildable.length > 6

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
            {rowGroups.map(({ group, items }) => (
              <Fragment key={group}>
                {showRowHeaders && (
                  <tr className="bld-group-row">
                    <td colSpan={8}>{BUILDING_GROUP_LABELS[group]}</td>
                  </tr>
                )}
                {items.map(({ b, recipe }) => {
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
                  const depletable = out && recipe!.category === 'extraction' && DEPLETABLE_GOODS.includes(out.good)
                  const remaining = depletable ? world.resourceDeposits?.[out!.good] : undefined
                  return (
                    <Fragment key={b.id}>
                    <tr className="bld-row">
                      <td>
                        <button type="button" className="bld-name-btn" onClick={() => setDetailId(open ? null : b.id)} title="Click for full details">
                          <span className="market-caret">{open ? '▾' : '▸'}</span>
                          {recipe!.label}
                        </button>
                      </td>
                      <td>
                        {owned ? (
                          <div className="bld-level-cell">
                            {control === 'state' ? (
                              <button
                                type="button"
                                className="bld-level-btn"
                                onClick={() => downgradeBuilding(world.id, b.id)}
                                title={b.level > 1 ? `Tear down one level (instant, salvages ${formatMoney(BUILD_COST_PER_LEVEL * 0.3)})` : `Demolish this building (instant, salvages ${formatMoney(BUILD_COST_PER_LEVEL * 0.3)})`}
                              >
                                −
                              </button>
                            ) : (
                              // Can't instantly demolish a company's or co-op's property — nationalize it first.
                              <span className="bld-level-btn bld-level-btn-empty" aria-hidden="true" />
                            )}
                            <span className="bld-level-num">{b.level}</span>
                            <button
                              type="button"
                              className="bld-level-btn"
                              onClick={() => queueConstruction(world.id, b.recipeId, { kind: 'state' })}
                              disabled={!canBuild(world, b.recipeId)}
                              title={
                                !canBuild(world, b.recipeId)
                                  ? 'District is full — no room to expand'
                                  : control === 'state'
                                    ? `Queue an upgrade to level ${b.level + 1} — about ${formatMoney(estimateConstructionCost(b.recipeId, world.market.prices))} of materials, built over time`
                                    : `Build a state-owned ${recipe!.label} here (about ${formatMoney(estimateConstructionCost(b.recipeId, world.market.prices))} of materials, built over time) — separate from this ${control === 'worker' ? 'co-op' : 'company'}`
                              }
                            >
                              +
                            </button>
                          </div>
                        ) : (
                          b.level
                        )}
                      </td>
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
                      <td>
                        {out ? GOODS[out.good].label : '—'}
                        {depletable && remaining !== undefined && (
                          <span
                            className={`bld-reserve-badge${remaining <= 0 ? ' bld-reserve-depleted' : ''}`}
                            title="Remaining world reserve of this good — finite, shared by every extraction building drawing on it, and does not regrow."
                          >
                            {remaining <= 0 ? 'depleted' : formatDeposit(remaining)}
                          </span>
                        )}
                      </td>
                      <td title={`Throughput ${runPct}% — ramps toward full as labor, inputs and demand allow`}>{runPct}%</td>
                      <td title={`${formatPop(b.employed)} employed of ${formatPop(b.jobsPosted)} jobs posted`}>
                        {b.jobsPosted > 0 ? `${formatPop(b.employed)} (${jobPct}%)` : '—'}
                      </td>
                      <td className={b.lastProfit >= 0 ? 'econ-pos' : 'econ-neg'}>{formatMoney(b.lastProfit)}</td>
                    </tr>
                    {open && (
                      <tr className="market-detail-row">
                        <td colSpan={8}>
                          <BuildingDetail b={b} world={world} country={country} owned={owned} corporations={corporations} />
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  )
                })}
              </Fragment>
            ))}
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
            const oc = o.owner.kind
            const ownerTag = oc === 'state' ? 'State' : oc === 'worker' ? 'Co-op' : corporations.find((c) => c.id === (o.owner as { corporationId: string }).corporationId)?.name ?? 'Corp'
            return (
              <div key={o.id} className="econ-build-row">
                <span className="econ-build-name">
                  {recipe?.label ?? o.recipeId}
                  <span className={`econ-owner-tag econ-owner-${oc === 'corporation' ? 'corporation' : oc} econ-build-owner`} title={`This will be a ${ownerTag}-owned building`}>
                    {ownerTag}
                  </span>
                </span>
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
            Build (state-owned — construction consumes materials, paid by the treasury)
          </div>
          {buildGroups.map(({ group, items }) => (
            <div className="econ-build-group" key={group}>
              {showBuildHeaders && <div className="econ-build-group-label">{BUILDING_GROUP_LABELS[group]}</div>}
              <div className="econ-build-buttons">
                {items.map((r) => {
                  const room = canBuild(world, r.id)
                  return (
                    <button
                      key={r.id}
                      type="button"
                      className="econ-build-btn"
                      onClick={() => queueConstruction(world.id, r.id)}
                      disabled={!room}
                      title={!room ? `${DISTRICT_LABELS[districtOfRecipe(r.id)]} district is full` : `Queue a ${r.label} in the ${DISTRICT_LABELS[districtOfRecipe(r.id)]} district — about ${formatMoney(estimateConstructionCost(r.id, world.market.prices))} of materials, built over time`}
                    >
                      + {r.label}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
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
