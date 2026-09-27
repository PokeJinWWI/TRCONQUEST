import { useState } from 'react'
import { useAbstractEconomyStore, stockOf } from '../../state/abstractEconomyStore'
import { useTerritoryStore } from '../../state/territoryStore'
import {
  abstractReport,
  districtBonus,
  districtsOf,
  freeLand,
  freeSlots,
  buildingsInDistrict,
  districtSlots,
  landOf,
  districtLevelsTotal,
  orderCost,
  orderName,
  worldJobs,
  worldStaffing,
  worldStrata,
  worldWorkforce,
  type ConstructionOrder,
  type WorldState,
} from '../../economy-abstract/abstractEconomy'
import {
  DISTRICT_COST,
  DISTRICT_OF_BUILDING,
  SIMPLE_BUILDING_DEFS,
  SIMPLE_BUILDINGS,
  SIMPLE_DISTRICT_DEFS,
  SIMPLE_DISTRICTS,
  SIMPLE_GOOD_NAMES,
  SIMPLE_GOODS,
  SLOTS_PER_DISTRICT,
  type SimpleBuildingId,
  type SimpleDistrictId,
  type SimpleGood,
  type SimpleProduct,
} from '../../data/simplisticEconomyData'
import { getCountry } from '../../data/countryData'
import { formatPop } from '../../economy/format'
import { PlanetIcon } from './PlanetIcons'
import { usePlanetViewStore } from '../../state/planetViewStore'
import { ForeignHoldingsRow } from './ForeignHoldings'
import { CivicDistrict, MilitaryTiles } from './KeySites'

// Simple mode's planet screen tabs (Stellaris-style): the world's summary
// numbers, its districts with their building slots, and its population.

const pct = (n: number, d = 0) => `${(n * 100).toFixed(d)}%`

// Who may build here: the owner, while they also hold it.
function useBuildRights(countryId: string | null, bodyName: string) {
  const owner = useTerritoryStore((s) => s.bodyOwner[bodyName])
  const controller = useTerritoryStore((s) => s.bodyController[bodyName] ?? s.bodyOwner[bodyName])
  return { owner, controller, canBuild: !!countryId && owner === countryId && controller === countryId }
}

// --- Summary ------------------------------------------------------------------
export function SimpleWorldSummary({ bodyName }: { bodyName: string }) {
  const w = useAbstractEconomyStore((s) => s.worlds[bodyName])
  const owner = useTerritoryStore((s) => s.bodyOwner[bodyName])
  const nation = useAbstractEconomyStore((s) => (owner ? s.byCountry[owner] : undefined))
  if (!w) return null
  // This world's own output: the nation's economy run over just this world.
  const r = nation ? abstractReport(nation, [w], stockOf(nation.countryId)) : undefined
  const staffing = worldStaffing(w)
  const unemployed = Math.max(0, worldWorkforce(w) - worldJobs(w))
  return (
    <div className="pl-summary">
      <div className="pl-stat-grid">
        <div className="pl-stat" title="People living here"><span>Population</span><b>{formatPop(w.population)}</b></div>
        <div className="pl-stat" title="Jobs offered here / workers available"><span>Jobs</span><b>{formatPop(worldJobs(w))} / {formatPop(worldWorkforce(w))}</b></div>
        <div className={`pl-stat${unemployed > worldWorkforce(w) * 0.06 ? ' warn' : ''}`} title="Workers without a job here"><span>Unemployed</span><b>{formatPop(unemployed)}</b></div>
        <div className={`pl-stat${staffing < 1 ? ' warn' : ''}`} title="Share of this world's jobs that can be filled"><span>Staffed</span><b>{pct(staffing)}</b></div>
        <div className="pl-stat" title="District levels developed / the land this world has for them"><span>Land used</span><b>{districtLevelsTotal(w)} / {landOf(w)}</b></div>
        {nation && <div className="pl-stat" title="National stability (it follows approval)"><span>Stability</span><b>{pct(nation.stability)}</b></div>}
        {r && r.amenities.need > 0 && (
          <div className={`pl-stat${r.amenities.ratio < 1 ? ' warn' : ''}`} title="Amenities here: supplied / needed. The city provides some; Entertainment Centers, Commercial Zones and Clinics add more. A shortfall makes this world's people unhappy, a surplus a little happier.">
            <span>Amenities</span><b>{num(r.amenities.supply)} / {num(r.amenities.need)}</b>
          </div>
        )}
      </div>
      {r && (
        <div className="pl-output" title="What this world produces each month">
          {SIMPLE_GOODS.filter((g) => r.produced[g] > 0.05).map((g) => (
            <span key={g} className="pl-output-chip">{SIMPLE_GOOD_NAMES[g]} <b>+{r.produced[g].toFixed(r.produced[g] < 10 ? 1 : 0)}</b></span>
          ))}
          {r.research > 0.05 && <span className="pl-output-chip">Research <b>+{r.research.toFixed(1)}</b></span>}
        </div>
      )}
    </div>
  )
}

// "+15 Alloys, −10 Minerals" for the build picker.
function pickerSummary(b: SimpleBuildingId): string {
  const def = SIMPLE_BUILDING_DEFS[b]
  const out = (Object.entries(def.outputs) as [SimpleProduct, number][]).map(([p, n]) => `+${num(n)} ${PRODUCT_NAME[p]}`)
  const up = (Object.entries(def.upkeep) as [SimpleGood, number][]).map(([g, n]) => `−${num(n)} ${SIMPLE_GOOD_NAMES[g]}`)
  return [...out, ...up].join(', ')
}

// --- Districts & Buildings --------------------------------------------------------
function BuildingTile({ b, staffing, bonus, selected, onClick, count }: { b: SimpleBuildingId; staffing: number; bonus: number; selected: boolean; onClick: () => void; count?: number }) {
  const def = SIMPLE_BUILDING_DEFS[b]
  return (
    <button
      type="button"
      className={`pl-tile${staffing < 1 ? ' understaffed' : ''}${selected ? ' selected' : ''}`}
      title={`${def.name}\n${def.description}\nJobs: ${def.jobs}M · staffed ${pct(staffing)}${bonus > 0 ? ` · district bonus +${pct(bonus, 1)}` : ''}\nClick for details`}
      onClick={onClick}
    >
      <PlanetIcon id={b} size={22} />
      <span className="pl-tile-name">{def.name}</span>
      {count !== undefined && count > 1 && <span className="pl-tile-level">×{count}</span>}
      <span className="pl-tile-bar"><span style={{ width: pct(Math.min(1, staffing)) }} /></span>
    </button>
  )
}

const PRODUCT_NAME: Record<SimpleProduct, string> = {
  ...SIMPLE_GOOD_NAMES,
  construction: 'Construction',
  physics: 'Physics research',
  society: 'Society research',
  engineering: 'Engineering research',
  amenities: 'Amenities',
  services: 'Services ($B)',
}
const num = (n: number) => n.toFixed(Math.abs(n) < 10 ? 1 : 0)

// Everything about one building type on one world: what it is, how many stand
// here, its jobs and staffing, what one level and all of them make and use this
// month (after staffing, stability, productivity, the district bonus and any
// devastation), their share of the world's output, its cost — and build/demolish.
function SimpleBuildingDetail({ w, b, countryId, canBuild, onBuild, onClose }: { w: WorldState; b: SimpleBuildingId; countryId: string | null; canBuild: boolean; onBuild: () => void; onClose: () => void }) {
  const owner = useTerritoryStore((s) => s.bodyOwner[w.bodyName])
  const nation = useAbstractEconomyStore((s) => (owner ? s.byCountry[owner] : undefined))
  const demolish = useAbstractEconomyStore((s) => s.demolish)
  const [message, setMessage] = useState<string | null>(null)
  const def = SIMPLE_BUILDING_DEFS[b]
  const d = DISTRICT_OF_BUILDING[b]
  const here = w.buildings[b] ?? 0
  const staffing = worldStaffing(w)
  const bonus = districtBonus(w, d)
  const r = nation ? abstractReport(nation, [w], stockOf(nation.countryId)) : undefined
  const br = r?.byBuilding[b]
  const outputs = Object.entries(def.outputs) as [SimpleProduct, number][]
  const upkeep = Object.entries(def.upkeep) as [SimpleGood, number][]
  const worldTotal = (p: SimpleProduct): number => {
    if (!r) return 0
    if (p === 'construction') return r.constructionPoints
    if (p === 'physics' || p === 'society' || p === 'engineering') return r.researchByTree[p]
    if (p === 'amenities') return r.amenities.supply
    if (p === 'services') return Object.values(r.byBuilding).reduce((n, x) => n + (x?.output.services ?? 0), 0)
    return r.produced[p]
  }
  const doDemolish = () => {
    if (!countryId) return
    const res = demolish(countryId, w.bodyName, b)
    setMessage(res.ok ? null : (res as { reason: string }).reason)
    if (res.ok && here <= 1) onClose()
  }
  return (
    <div className="pl-detail">
      <div className="pl-detail-head">
        <PlanetIcon id={b} size={28} />
        <div>
          <div className="pl-detail-name">{def.name} <span className="abs-dim">×{here} on {w.bodyName}</span></div>
          <div className="abs-dim">{SIMPLE_DISTRICT_DEFS[d].name}{bonus.total > 0 ? ` · ecosystem +${pct(bonus.total, 1)}` : ''}</div>
        </div>
        <button type="button" className="abs-x" title="Close" onClick={onClose}>×</button>
      </div>
      <div className="pl-detail-desc">{def.description}</div>
      <div className="pl-stat-grid">
        <div className="pl-stat" title="Jobs per level, and who fills them"><span>Jobs / level</span><b>{def.jobs}M {def.stratum}</b></div>
        <div className={`pl-stat${staffing < 1 ? ' warn' : ''}`} title="Share of this world's jobs that can be filled"><span>Staffed</span><b>{pct(staffing)}</b></div>
        <div className="pl-stat" title="Construction points to build one level"><span>Build cost</span><b>{def.cost} CP</b></div>
        {def.pu ? <div className="pl-stat" title="Production Units per level: factory capacity"><span>Capacity</span><b>{def.pu} PU</b></div> : null}
        {def.popGrowth ? <div className="pl-stat" title="Extra yearly population growth on this world per level"><span>Pop growth</span><b>+{pct(def.popGrowth, 1)}/yr</b></div> : null}
      </div>
      <table className="abs-table pl-detail-table">
        <thead><tr><th></th><th title="The building's base figure for one level">Base / level</th><th title="All of them here, this month, after staffing, bonuses and shortages">All here /mo</th><th title="Their share of this world's total">Share</th></tr></thead>
        <tbody>
          {outputs.map(([p, n]) => {
            const got = br?.output[p] ?? 0
            const total = worldTotal(p)
            return (
              <tr key={p} className="econ-pos">
                <td>{PRODUCT_NAME[p]}</td><td>+{num(n)}</td><td>+{num(got)}</td><td>{total > 0 ? pct(got / total) : '—'}</td>
              </tr>
            )
          })}
          {upkeep.map(([g, n]) => (
            <tr key={g} className="econ-neg">
              <td>{SIMPLE_GOOD_NAMES[g]} (upkeep)</td><td>−{num(n)}</td><td>−{num(br?.upkeep[g] ?? 0)}</td><td></td>
            </tr>
          ))}
        </tbody>
      </table>
      {r && upkeep.some(([g]) => r.inputShortages.includes(g)) && <div className="econ-neg pl-message">Short of {upkeep.filter(([g]) => r.inputShortages.includes(g)).map(([g]) => SIMPLE_GOOD_NAMES[g]).join(', ')} — running slow.</div>}
      {message && <div className="econ-neg pl-message">{message}</div>}
      {canBuild && (
        <div className="pl-detail-actions">
          <button type="button" className="laws-enact-btn" onClick={onBuild} title={`Queue another level (${def.cost} construction points)`}>+ Build another</button>
          <button type="button" className="laws-enact-btn" disabled={here <= 0} onClick={doDemolish} title="Tear down one level now — no refund, frees its slot and jobs">Demolish one</button>
        </div>
      )}
    </div>
  )
}

function QueuedTile({ o }: { o: ConstructionOrder }) {
  const cost = orderCost(o)
  return (
    <div className="pl-tile queued" title={`Under construction: ${orderName(o)} — ${Math.round(o.progress)}/${cost} construction points`}>
      <PlanetIcon id={o.building ?? o.district ?? ''} size={22} />
      <span className="pl-tile-name">{orderName(o)}</span>
      <span className="pl-tile-bar"><span style={{ width: pct(Math.min(1, o.progress / cost)) }} /></span>
    </div>
  )
}

// `only` shows just one district (the Buildings lens's tabs).
export function SimpleDistrictsTab({ countryId, bodyName, only }: { countryId: string | null; bodyName: string; only?: SimpleDistrictId }) {
  const w = useAbstractEconomyStore((s) => s.worlds[bodyName])
  const owner = useTerritoryStore((s) => s.bodyOwner[bodyName])
  const queue = useAbstractEconomyStore((s) => (owner ? s.byCountry[owner]?.queue : undefined))
  const queueBuilding = useAbstractEconomyStore((s) => s.queueBuilding)
  const queueDistrict = useAbstractEconomyStore((s) => s.queueDistrict)
  const cancelOrder = useAbstractEconomyStore((s) => s.cancelOrder)
  const { canBuild } = useBuildRights(countryId, bodyName)
  const [picking, setPicking] = useState<SimpleDistrictId | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [selected, setSelected] = useState<SimpleBuildingId | null>(null)
  const grouped = usePlanetViewStore((s) => s.groupBuildings)
  const setGrouped = usePlanetViewStore((s) => s.setGroupBuildings)
  if (!w) return <div className="abs-dim">No economy on this world.</div>

  const q = (queue ?? []).filter((o) => o.bodyName === bodyName)
  const ds = districtsOf(w)
  const staffing = worldStaffing(w)
  const land = freeLand(w, queue ?? [])
  const shown = SIMPLE_DISTRICTS.filter((d) => (only ? d === only : ds[d] > 0 || q.some((o) => o.district === d || (o.building && DISTRICT_OF_BUILDING[o.building] === d))))
  const addable = only ? [] : SIMPLE_DISTRICTS.filter((d) => !shown.includes(d))

  const run = (res: { ok: boolean; reason?: string }) => setMessage(res.ok ? null : res.reason ?? null)
  const build = (b: SimpleBuildingId) => {
    if (!countryId) return
    run(queueBuilding(countryId, bodyName, b))
    setPicking(null)
  }
  const develop = (d: SimpleDistrictId) => countryId && run(queueDistrict(countryId, bodyName, d))

  return (
    <div className="pl-districts">
      <div className="pl-land" title="Each district level uses one unit of land; a world's land comes from its size.">
        Land <b>{districtLevelsTotal(w)}</b> / {landOf(w)} district levels
        {land > 0 ? <span className="abs-dim"> · {land} free</span> : <span className="econ-neg"> · full</span>}
        <label className="pl-group-toggle" title="Show identical buildings as one tile with a count">
          <input type="checkbox" checked={grouped} onChange={(e) => setGrouped(e.target.checked)} /> Group identical
        </label>
      </div>
      {message && <div className="econ-neg pl-message">{message}</div>}

      {(!only || only === 'urban') && <CivicDistrict bodyName={bodyName} />}

      {shown.map((d) => {
        const def = SIMPLE_DISTRICT_DEFS[d]
        const bonus = districtBonus(w, d)
        const slots = districtSlots(w, d)
        const used = buildingsInDistrict(w, d)
        const queuedHere = q.filter((o) => o.building && DISTRICT_OF_BUILDING[o.building] === d)
        const queuedLevels = q.filter((o) => o.district === d)
        const free = freeSlots(w, queue ?? [], d)
        const tiles: { b: SimpleBuildingId; count?: number }[] = []
        for (const b of def.buildings) {
          const n = w.buildings[b] ?? 0
          if (n <= 0) continue
          if (grouped) tiles.push({ b, count: n })
          else for (let i = 0; i < n; i++) tiles.push({ b })
        }
        return (
          <div key={d} className={`pl-district pl-district-${d}`}>
            <div className="pl-district-head" title={def.description}>
              <PlanetIcon id={d} size={20} />
              <span className="pl-district-name">{def.name}</span>
              <span className="pl-district-level">Lv {ds[d]}{queuedLevels.length > 0 ? ` (+${queuedLevels.length})` : ''}</span>
              <span className="pl-district-slots">{used}/{slots} slots</span>
              {bonus.total > 0 && (
                <span className="pl-district-bonus" title={`Ecosystem: +${pct(bonus.cluster, 1)} from ${used} buildings clustered here${bonus.link > 0 ? `, +${pct(bonus.link, 1)} from research parks on this world` : ''}`}>
                  +{pct(bonus.total, 1)}
                </span>
              )}
              {canBuild && (
                <button type="button" className="pl-develop" disabled={land <= 0} title={`Develop another level: +${SLOTS_PER_DISTRICT} slots · ${DISTRICT_COST} construction points · uses 1 land`} onClick={() => develop(d)}>
                  + Level
                </button>
              )}
            </div>
            {d === 'military' ? (
              <MilitaryTiles bodyName={bodyName} playerId={countryId} canBuild={canBuild} slots={slots} grouped={grouped} />
            ) : def.buildings.length === 0 ? (
              <ForeignHoldingsRow bodyName={bodyName} playerId={countryId} />
            ) : (
              <div className="pl-grid">
                {tiles.map(({ b, count }, i) => <BuildingTile key={`${b}-${i}`} b={b} count={count} staffing={staffing} bonus={bonus.total} selected={selected === b} onClick={() => setSelected(selected === b ? null : b)} />)}
                {queuedHere.map((o) => <QueuedTile key={o.id} o={o} />)}
                {Array.from({ length: grouped ? Math.min(1, Math.max(0, free)) : Math.max(0, free) }, (_, i) =>
                  canBuild ? (
                    <button key={`free-${i}`} type="button" className="pl-tile empty" title={`Build in the ${def.name}`} onClick={() => setPicking(picking === d ? null : d)}>
                      <span className="pl-plus">+</span>
                      {grouped && <span className="pl-tile-name">{free} free</span>}
                    </button>
                  ) : (
                    <div key={`free-${i}`} className="pl-tile empty" title="Empty slot">{grouped && <span className="pl-tile-name">{free} free</span>}</div>
                  ),
                )}
              </div>
            )}
            {selected && DISTRICT_OF_BUILDING[selected] === d && (
              <SimpleBuildingDetail w={w} b={selected} countryId={countryId} canBuild={canBuild} onBuild={() => build(selected)} onClose={() => setSelected(null)} />
            )}
            {picking === d && (
              <div className="pl-picker">
                {def.buildings.map((b) => (
                  <button key={b} type="button" className="pl-pick" title={SIMPLE_BUILDING_DEFS[b].description} onClick={() => build(b)}>
                    <PlanetIcon id={b} size={18} />
                    <span>{SIMPLE_BUILDING_DEFS[b].name}</span>
                    <span className="abs-dim">{pickerSummary(b)} · {SIMPLE_BUILDING_DEFS[b].cost} CP · {SIMPLE_BUILDING_DEFS[b].jobs}M jobs</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )
      })}

      {canBuild && addable.length > 0 && (
        <div className="pl-new-district">
          <span className="abs-dim">New district:</span>
          {addable.map((d) => (
            <button key={d} type="button" className="pl-pick small" disabled={land <= 0} title={`${SIMPLE_DISTRICT_DEFS[d].description}\n${DISTRICT_COST} construction points · uses 1 land`} onClick={() => develop(d)}>
              <PlanetIcon id={d} size={16} />
              <span>{SIMPLE_DISTRICT_DEFS[d].name.replace(' District', '')}</span>
            </button>
          ))}
        </div>
      )}

      {q.length > 0 && (
        <div className="pl-queue">
          <div className="econ-subtitle">Construction here</div>
          {q.map((o) => {
            const cost = orderCost(o)
            return (
              <div key={o.id} className="abs-order">
                <span><PlanetIcon id={o.building ?? o.district ?? ''} size={12} /> {orderName(o)}</span>
                <span className="abs-order-bar"><span style={{ width: `${Math.min(100, (o.progress / cost) * 100)}%` }} /></span>
                <span className="abs-dim">{Math.round(o.progress)}/{cost}</span>
                {canBuild && <button type="button" className="abs-x" title="Cancel (progress is lost)" onClick={() => countryId && cancelOrder(countryId, o.id)}>×</button>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// --- Population ------------------------------------------------------------------
export function SimplePopulationTab({ bodyName }: { bodyName: string }) {
  const w = useAbstractEconomyStore((s) => s.worlds[bodyName])
  const owner = useTerritoryStore((s) => s.bodyOwner[bodyName])
  const report = useAbstractEconomyStore((s) => (owner ? s.reports[owner] : undefined))
  if (!w) return <div className="abs-dim">Nobody lives here.</div>
  const st = worldStrata(w)
  const rows: { key: 'workers' | 'specialists' | 'unemployed'; label: string; hint: string }[] = [
    { key: 'workers', label: 'Workers', hint: 'Farms, mines, power plants, most factories and commercial zones' },
    { key: 'specialists', label: 'Specialists', hint: 'Research labs, electronics plants, refineries, fusion reactors, clinics and entertainment' },
    { key: 'unemployed', label: 'Unemployed', hint: 'No job here — unhappy' },
  ]
  return (
    <div className="pl-pop">
      <div className="pl-stat-grid">
        <div className="pl-stat"><span>Population</span><b>{formatPop(w.population)}</b></div>
        <div className="pl-stat" title="Share of people in the labour force"><span>Workforce</span><b>{formatPop(worldWorkforce(w))}</b></div>
        <div className="pl-stat"><span>Jobs</span><b>{formatPop(worldJobs(w))}</b></div>
      </div>
      <div className="econ-subtitle" style={{ marginTop: 8 }}>Strata</div>
      {rows.map((row) => {
        const people = st[row.key]
        const happy = report?.strata[row.key].happiness
        const share = w.population > 0 ? people / w.population : 0
        return (
          <div key={row.key} className="pl-stratum" title={row.hint}>
            <span className="pl-stratum-name">{row.label}</span>
            <span className="pl-stratum-bar"><span style={{ width: pct(share) }} /></span>
            <span className="pl-stratum-num">{formatPop(people)}</span>
            {happy !== undefined && <span className={`pl-stratum-happy ${happy >= 0.5 ? 'econ-pos' : 'econ-neg'}`} title="National happiness of this stratum">☺ {pct(happy)}</span>}
          </div>
        )
      })}
      <div className="econ-subtitle" style={{ marginTop: 8 }}>Jobs by building</div>
      <div className="pl-jobs">
        {SIMPLE_BUILDINGS.filter((b) => st.jobsByBuilding[b]).map((b) => (
          <div key={b} className="pl-job" title={SIMPLE_BUILDING_DEFS[b].description}>
            <PlanetIcon id={b} size={16} />
            <span>{SIMPLE_BUILDING_DEFS[b].name} ×{w.buildings[b]}</span>
            <b>{formatPop(st.jobsByBuilding[b] ?? 0)}</b>
          </div>
        ))}
      </div>
    </div>
  )
}

// A short owner line for read-only views of someone else's world.
export function OwnerNote({ bodyName, countryId }: { bodyName: string; countryId: string | null }) {
  const { owner, controller } = useBuildRights(countryId, bodyName)
  if (!owner) return null
  return (
    <div className="abs-dim pl-owner-note">
      {owner !== countryId && <>Owned by {getCountry(owner)?.name ?? owner}. </>}
      {controller !== owner && <span className="econ-neg">Occupied by {getCountry(controller ?? '')?.name ?? controller} — produces nothing for its owner.</span>}
    </div>
  )
}
