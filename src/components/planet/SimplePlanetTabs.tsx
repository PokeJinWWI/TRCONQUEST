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
} from '../../data/simplisticEconomyData'
import { getCountry } from '../../data/countryData'
import { formatPop } from '../../economy/format'
import { PlanetIcon } from './PlanetIcons'
import { ForeignHoldingsRow } from './ForeignHoldings'

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

// --- Districts & Buildings --------------------------------------------------------
function BuildingTile({ b, staffing, bonus }: { b: SimpleBuildingId; staffing: number; bonus: number }) {
  const def = SIMPLE_BUILDING_DEFS[b]
  return (
    <div
      className={`pl-tile${staffing < 1 ? ' understaffed' : ''}`}
      title={`${def.name}\n${def.description}\nJobs: ${def.jobs}M · staffed ${pct(staffing)}${bonus > 0 ? ` · district bonus +${pct(bonus, 1)}` : ''}`}
    >
      <PlanetIcon id={b} size={22} />
      <span className="pl-tile-name">{def.name}</span>
      <span className="pl-tile-bar"><span style={{ width: pct(Math.min(1, staffing)) }} /></span>
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

export function SimpleDistrictsTab({ countryId, bodyName }: { countryId: string | null; bodyName: string }) {
  const w = useAbstractEconomyStore((s) => s.worlds[bodyName])
  const owner = useTerritoryStore((s) => s.bodyOwner[bodyName])
  const queue = useAbstractEconomyStore((s) => (owner ? s.byCountry[owner]?.queue : undefined))
  const queueBuilding = useAbstractEconomyStore((s) => s.queueBuilding)
  const queueDistrict = useAbstractEconomyStore((s) => s.queueDistrict)
  const cancelOrder = useAbstractEconomyStore((s) => s.cancelOrder)
  const { canBuild } = useBuildRights(countryId, bodyName)
  const [picking, setPicking] = useState<SimpleDistrictId | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  if (!w) return <div className="abs-dim">No economy on this world.</div>

  const q = (queue ?? []).filter((o) => o.bodyName === bodyName)
  const ds = districtsOf(w)
  const staffing = worldStaffing(w)
  const land = freeLand(w, queue ?? [])
  const shown = SIMPLE_DISTRICTS.filter((d) => ds[d] > 0 || q.some((o) => o.district === d || (o.building && DISTRICT_OF_BUILDING[o.building] === d)))
  const addable = SIMPLE_DISTRICTS.filter((d) => !shown.includes(d))

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
      </div>
      {message && <div className="econ-neg pl-message">{message}</div>}

      {shown.map((d) => {
        const def = SIMPLE_DISTRICT_DEFS[d]
        const bonus = districtBonus(w, d)
        const slots = districtSlots(w, d)
        const used = buildingsInDistrict(w, d)
        const queuedHere = q.filter((o) => o.building && DISTRICT_OF_BUILDING[o.building] === d)
        const queuedLevels = q.filter((o) => o.district === d)
        const free = freeSlots(w, queue ?? [], d)
        const tiles: SimpleBuildingId[] = []
        for (const b of def.buildings) for (let i = 0; i < (w.buildings[b] ?? 0); i++) tiles.push(b)
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
            {def.buildings.length === 0 ? (
              <ForeignHoldingsRow bodyName={bodyName} playerId={countryId} />
            ) : (
              <div className="pl-grid">
                {tiles.map((b, i) => <BuildingTile key={`${b}-${i}`} b={b} staffing={staffing} bonus={bonus.total} />)}
                {queuedHere.map((o) => <QueuedTile key={o.id} o={o} />)}
                {Array.from({ length: Math.max(0, free) }, (_, i) =>
                  canBuild ? (
                    <button key={`free-${i}`} type="button" className="pl-tile empty" title={`Build in the ${def.name}`} onClick={() => setPicking(picking === d ? null : d)}>
                      <span className="pl-plus">+</span>
                    </button>
                  ) : (
                    <div key={`free-${i}`} className="pl-tile empty" title="Empty slot" />
                  ),
                )}
              </div>
            )}
            {picking === d && (
              <div className="pl-picker">
                {def.buildings.map((b) => (
                  <button key={b} type="button" className="pl-pick" title={SIMPLE_BUILDING_DEFS[b].description} onClick={() => build(b)}>
                    <PlanetIcon id={b} size={18} />
                    <span>{SIMPLE_BUILDING_DEFS[b].name}</span>
                    <span className="abs-dim">{SIMPLE_BUILDING_DEFS[b].cost} CP · {SIMPLE_BUILDING_DEFS[b].jobs}M jobs</span>
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
    { key: 'workers', label: 'Workers', hint: 'Farms, mines, power plants and factories' },
    { key: 'specialists', label: 'Specialists', hint: 'Research labs and refineries' },
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
