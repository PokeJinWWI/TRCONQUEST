import { Fragment, useState } from 'react'
import { usePlayerStore } from '../state/playerStore'
import { useAbstractEconomyStore, worldsOf, type AbstractHistoryPoint } from '../state/abstractEconomyStore'
import { useResourceStore } from '../state/resourceStore'
import { useTerritoryStore } from '../state/territoryStore'
import {
  ECONOMY_TYPES,
  economyTypeLabel,
  fundamentalRate,
  freeSlots,
  MAX_CP_PER_ORDER,
  orderCost,
  worldJobs,
  worldLevels,
  worldStaffing,
  worldWorkforce,
  STRATA,
  NEED_GOODS,
  POP_UPKEEP,
  UNREST_BELOW,
  type AbstractEconomyState,
  type AbstractReport,
  type NeedGood,
  type Stratum,
} from '../economy-abstract/abstractEconomy'
import {
  SIMPLE_BUILDINGS,
  SIMPLE_BUILDING_DEFS,
  SIMPLE_GOODS,
  SIMPLE_GOOD_NAMES,
  GOOD_VALUE,
  type SimpleBuildingId,
  type SimpleGood,
} from '../data/simplisticEconomyData'
import { getCountry } from '../data/countryData'
import type { TechCategory } from '../data/techData'
import { formatMoney, formatPop } from '../economy/format'
import { TimeChart } from './TimeChart'

// Simple mode's economy screen for the player's nation (Complex mode has
// its own panels). Four tabs: Macro (the national accounts and policy),
// Industry (goods, worlds, buildings, construction, research), Social
// (population, needs, stability, welfare) and Trade (currency and the
// interstellar market).

type Tab = 'Macro' | 'Industry' | 'Social' | 'Trade'
const TABS: Tab[] = ['Macro', 'Industry', 'Social', 'Trade']

const fmt = (n: number, d = 0) => (Math.abs(n) < 0.05 && d === 0 ? '0' : n.toFixed(d))
const signed = (n: number, d = 1) => `${n > 0 ? '+' : ''}${n.toFixed(d)}`
const pct = (n: number, d = 1) => `${(n * 100).toFixed(d)}%`

// A headline number; clicking it picks which history the chart below draws.
function StatCard({ label, value, color, active, onClick, tip }: { label: string; value: string; color: string; active: boolean; onClick: () => void; tip: string }) {
  return (
    <button type="button" className={`abs-statcard${active ? ' active' : ''}`} onClick={onClick} title={tip + ' Click to chart it below.'}>
      <div className="abs-statcard-head" style={{ color }}>{label}</div>
      <div className="abs-statcard-value">{value}</div>
    </button>
  )
}

function Meter({ label, value, title }: { label: string; value: number; title?: string }) {
  const p = Math.round(value * 100)
  const tone = value >= 0.6 ? '#4ade80' : value >= 0.35 ? '#ffd23f' : '#ff6b4a'
  return (
    <div className="cb-meter" title={title}>
      <div className="cb-meter-head"><span>{label}</span><span className="cb-meter-val">{p}%</span></div>
      <div className="cb-meter-track"><div className="cb-meter-fill" style={{ width: `${p}%`, background: tone }} /></div>
    </div>
  )
}

function WarningSigns({ s, r }: { s: AbstractEconomyState; r: AbstractReport }) {
  const signs: { label: string; on: boolean }[] = [
    { label: 'Negative real growth', on: r.realGrowth < 0 },
    { label: 'Inflation critical', on: s.inflation > 0.08 },
    { label: 'Extremely high deficit', on: r.deficitPctGdp < -0.05 },
    { label: 'Critical debt', on: r.debtToGdp > r.debtCeilingPct * 0.9 },
    { label: 'Shortages', on: r.upkeepMet < 0.95 },
    { label: 'Unrest', on: r.unrest },
    { label: 'Industry starved of inputs', on: r.inputSatisfaction < 0.95 },
    { label: 'Bloated reserves', on: s.reserves > r.revenue && r.revenue > 0 },
    { label: 'Fiscal crisis', on: r.debtToGdp > r.debtCeilingPct || r.rating === 'CCC' },
  ]
  return (
    <div className="abs-warnings">
      {signs.map((w) => (
        <div key={w.label} className={`abs-warning${w.on ? ' on' : ''}`}>{w.label}</div>
      ))}
    </div>
  )
}

// Year-on-year real growth from the history once there's a year of it (the
// per-month figure jumps whenever a building completes), else the monthly rate.
function realGrowthOf(h: AbstractHistoryPoint[], r: AbstractReport): number {
  if (h.length >= 13) {
    const a = h[h.length - 13].realGdp
    const b = h[h.length - 1].realGdp
    return a > 0 ? b / a - 1 : 0
  }
  return r.realGrowth
}

export function AbstractEconomyPanel() {
  const [tab, setTab] = useState<Tab>('Macro')
  const countryId = usePlayerStore((s) => s.selectedCountryId)
  const state = useAbstractEconomyStore((s) => (countryId ? s.byCountry[countryId] : undefined))
  const report = useAbstractEconomyStore((s) => (countryId ? s.reports[countryId] : undefined))
  if (!countryId || !state || !report) return <div className="nav-placeholder">No national economy in context.</div>
  return (
    <div className="econ-panel">
      <div className="abs-tabs">
        {TABS.map((t) => (
          <button key={t} type="button" className={`abs-tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>
      {tab === 'Macro' && <MacroTab countryId={countryId} s={state} r={report} />}
      {tab === 'Industry' && <IndustryTab countryId={countryId} s={state} r={report} />}
      {tab === 'Social' && <SocialTab countryId={countryId} s={state} r={report} />}
      {tab === 'Trade' && <TradeTab countryId={countryId} s={state} r={report} />}
    </div>
  )
}

interface TabProps {
  countryId: string
  s: AbstractEconomyState
  r: AbstractReport
}

// --- Macro ------------------------------------------------------------------------
type MacroChart = 'inflation' | 'gdp' | 'debt'

function MacroTab({ countryId, s, r }: TabProps) {
  const history = useAbstractEconomyStore((st) => st.history[countryId])
  const tick = useAbstractEconomyStore((st) => st.tick)
  const [chart, setChart] = useState<MacroChart>('gdp')
  const setTaxRate = useAbstractEconomyStore((st) => st.setTaxRate)
  const setEconomyType = useAbstractEconomyStore((st) => st.setEconomyType)
  const setMoneyCreation = useAbstractEconomyStore((st) => st.setMoneyCreation)
  const setWarTaxes = useAbstractEconomyStore((st) => st.setWarTaxes)
  const setAllocation = useAbstractEconomyStore((st) => st.setAllocation)
  const invest = useAbstractEconomyStore((st) => st.invest)
  const payDebt = useAbstractEconomyStore((st) => st.payDebt)
  const h = history ?? []
  const realGrowth = realGrowthOf(h, r)
  const alloc = s.allocation

  return (
    <>
      <div className="abs-headline">
        <span className="abs-econtype">{economyTypeLabel(s.economyType)}</span>
        <span className={`abs-rating rating-${r.rating}`}>{r.rating}</span>
      </div>

      <div className="abs-statcards">
        <StatCard label="INFLATION" value={pct(s.inflation, 2)} color="#ff6b6b" active={chart === 'inflation'} onClick={() => setChart('inflation')} tip="How fast prices are rising, per year. A little (~2%) is normal; a lot erodes savings, happiness and your currency." />
        <StatCard label="GDP" value={formatMoney(s.gdp)} color="#4ade80" active={chart === 'gdp'} onClick={() => setChart('gdp')} tip="Gross domestic product: the value of everything your nation produces in a year." />
        <StatCard label="DEBT / GDP" value={pct(r.debtToGdp)} color="#ff9a6b" active={chart === 'debt'} onClick={() => setChart('debt')} tip="National debt as a share of a year's GDP. The higher it is, the worse your credit rating and the more interest you pay." />
      </div>
      {chart === 'gdp' && (
        <TimeChart title="GDP" endTick={tick} format={formatMoney} series={[
          { label: 'Nominal', color: '#4ade80', values: h.map((p) => p.gdp) },
          { label: 'Real', color: '#8ab4ff', values: h.map((p) => p.realGdp) },
        ]} tip="Nominal GDP is in today's prices; real GDP strips out inflation, so it only grows when you actually produce more." />
      )}
      {chart === 'inflation' && (
        <TimeChart title="Inflation (per year)" endTick={tick} includeZero format={(v) => pct(v, 1)} series={[{ label: 'Inflation', color: '#ff6b6b', values: h.map((p) => p.inflation) }]} />
      )}
      {chart === 'debt' && (
        <TimeChart title="Debt / GDP" endTick={tick} includeZero format={(v) => pct(v, 0)} series={[{ label: 'Debt/GDP', color: '#ff9a6b', values: h.map((p) => p.debtToGdp) }]} />
      )}

      <div className="cb-facts">
        <div title="GDP at starting prices — growth here is real: new buildings and a bigger population."><span className="inspect-label">Real GDP</span><span>{formatMoney(s.realGdp)}</span></div>
        <div title={h.length >= 13 ? 'Year on year' : 'Last month, annualized (a year of history gives a steadier figure)'}><span className="inspect-label">Real growth</span><span className={realGrowth >= 0 ? 'econ-pos' : 'econ-neg'}>{pct(realGrowth, 2)}</span></div>
        <div title="Cumulative inflation since the game began"><span className="inspect-label">Price level</span><span>{s.priceLevel.toFixed(3)}</span></div>
        <div><span className="inspect-label">Debt ceiling</span><span>{Math.round(r.debtCeilingPct * 100)}% GDP</span></div>
      </div>

      <div className="cb-governance" style={{ marginTop: 8 }}>
        <Meter label="Stability" value={s.stability} title="Order and contentment — see the Social tab for what drives it. Low stability drags every building's output." />
      </div>

      <label className="econ-control-row" title="Cover this share of any budget deficit by printing money instead of borrowing. Fast cash, but it fuels inflation and weakens the currency.">
        <span className="inspect-label">Money creation</span>
        <span>
          <input type="range" min={0} max={1} step={0.05} value={s.moneyCreation} onChange={(e) => setMoneyCreation(countryId, Number(e.target.value))} />
          <b style={{ marginLeft: 8, color: '#cdeeff' }}>{Math.round(s.moneyCreation * 100)}%</b>
        </span>
      </label>

      <div className="abs-deficit">
        <span>Yearly balance</span>
        <span className={r.balance >= 0 ? 'econ-pos' : 'econ-neg'}>{formatMoney(r.balance)} ({pct(r.deficitPctGdp)} GDP)</span>
      </div>

      <div className="abs-budget-cols">
        <div className="abs-budget-col">
          <div className="abs-budget-title econ-neg">Expenditure {formatMoney(r.spending)}</div>
          <div><span>Military</span><span>{formatMoney(r.expMilitary)}</span></div>
          <div><span>Civil</span><span>{formatMoney(r.expCivil)}</span></div>
          <div><span>Welfare</span><span>{formatMoney(r.expWelfare)}</span></div>
          <div><span>Debt servicing</span><span>{formatMoney(r.expDebt)}</span></div>
          <div><span>Other</span><span>{formatMoney(r.expOther)}</span></div>
        </div>
        <div className="abs-budget-col">
          <div className="abs-budget-title econ-pos">Revenue {formatMoney(r.revenue)}</div>
          <div><span>Income tax</span><span>{formatMoney(r.revIncome)}</span></div>
          <div><span>Business tax</span><span>{formatMoney(r.revBusiness)}</span></div>
          <div><span>Excise</span><span>{formatMoney(r.revExcise)}</span></div>
          <div><span>Other</span><span>{formatMoney(r.revOther)}</span></div>
        </div>
      </div>

      <div className="cb-facts" style={{ marginTop: 6 }}>
        <div><span className="inspect-label">Treasury</span><span>{formatMoney(s.treasury)}</span></div>
        <div><span className="inspect-label">Reserves</span><span>{formatMoney(s.reserves)}</span></div>
        <div><span className="inspect-label">National debt</span><span>{formatMoney(s.debt)}</span></div>
        <div title="Trade settles into the treasury every month (see the Trade tab)"><span className="inspect-label">Trade / mo</span><span className={r.tradeBalance >= 0 ? 'econ-pos' : 'econ-neg'}>{formatMoney(r.tradeBalance)}</span></div>
      </div>
      <div className="econ-control-row">
        <span className="inspect-label">Reserves</span>
        <span>
          <button type="button" className="laws-enact-btn" onClick={() => invest(countryId, s.treasury * 0.25)}>Invest</button>{' '}
          <button type="button" className="laws-enact-btn" onClick={() => payDebt(countryId, s.reserves + s.treasury * 0.25)}>Pay Debt</button>
        </span>
      </div>
      <label className="econ-control-row" style={{ cursor: 'pointer' }} title="Emergency wartime revenue (+25%) at a standing stability cost.">
        <span className="inspect-label">War taxes {s.warTaxes ? '(active)' : ''}</span>
        <input type="checkbox" checked={s.warTaxes} onChange={(e) => setWarTaxes(countryId, e.target.checked)} />
      </label>

      <div className="econ-subtitle" style={{ marginTop: 12 }} title="Production Units come from your factories (see Industry). The split decides what they make.">
        Production — {fmt(r.productionUnits)} PU from factories
      </div>
      {([
        { leg: 'civilian' as const, label: 'Civilian', makes: `${fmt(r.constructionPoints)} construction/mo` },
        { leg: 'military' as const, label: 'Military', makes: `${fmt(r.produced.alloys)} alloys/mo` },
        { leg: 'consumer' as const, label: 'Consumer', makes: `${fmt(r.produced.consumerGoods)} goods + ${fmt(r.produced.electronics, 1)} elec/mo` },
      ]).map(({ leg, label, makes }) => (
        <label key={leg} className="econ-control-row">
          <span className="inspect-label">{label}</span>
          <span>
            <input type="range" min={0} max={1} step={0.05} value={alloc[leg]} onChange={(e) => setAllocation(countryId, leg, Number(e.target.value))} />
            <b style={{ marginLeft: 8, color: '#cdeeff' }}>{Math.round(alloc[leg] * 100)}%</b>
            <span className="abs-dim" style={{ marginLeft: 8 }}>{makes}</span>
          </span>
        </label>
      ))}
      <div className="abs-deficit">
        <span title="Population-weighted happiness — stability follows it (see Social)">Approval</span>
        <span className={Math.round(r.approval * 100) < 50 ? 'econ-neg' : 'econ-pos'}>{pct(r.approval, 0)}{r.upkeepMet < 0.95 ? ' · shortages!' : ''}</span>
      </div>

      <div className="econ-subtitle" style={{ marginTop: 12 }}>Policy</div>
      <label className="econ-control-row">
        <span className="inspect-label">Tax rate</span>
        <span>
          <input type="range" min={0} max={0.5} step={0.01} value={s.taxRate} onChange={(e) => setTaxRate(countryId, Number(e.target.value))} />
          <b style={{ marginLeft: 8, color: '#cdeeff' }}>{Math.round(s.taxRate * 100)}%</b>
        </span>
      </label>
      <div className="econ-control-row">
        <span className="inspect-label" title="Market: +production, faster construction, −stability, lower tax yield. Corporatist: balanced. Planned: −production, +stability, higher tax yield.">Economy type</span>
        <span>
          {ECONOMY_TYPES.map((t) => (
            <button key={t} type="button" className={`laws-enact-btn${s.economyType === t ? ' abs-on' : ''}`} style={{ marginLeft: 4 }} onClick={() => setEconomyType(countryId, t)}>
              {economyTypeLabel(t)}
            </button>
          ))}
        </span>
      </div>

      <div className="econ-subtitle" style={{ marginTop: 12 }}>Economic warning signs</div>
      <WarningSigns s={s} r={r} />
    </>
  )
}

// --- Industry ---------------------------------------------------------------------
const FOCI: { id: TechCategory; label: string }[] = [
  { id: 'physics', label: 'Physics' },
  { id: 'society', label: 'Society' },
  { id: 'engineering', label: 'Engineering' },
]

function IndustryTab({ countryId, s, r }: TabProps) {
  const amounts = useResourceStore((st) => st.byCountry[countryId]?.amounts)
  const worlds = useAbstractEconomyStore((st) => st.worlds)
  const setResearchFocus = useAbstractEconomyStore((st) => st.setResearchFocus)
  const cancelOrder = useAbstractEconomyStore((st) => st.cancelOrder)
  const owners = useTerritoryStore((st) => st.bodyOwner)
  const controllers = useTerritoryStore((st) => st.bodyController)
  const mine = worldsOf(countryId, worlds, owners, controllers).sort((a, b) => b.population - a.population)
  const occupied = Object.values(worlds).filter((w) => owners[w.bodyName] === countryId && !mine.includes(w))

  return (
    <>
      <div className="econ-subtitle">Goods</div>
      <table className="abs-table">
        <thead>
          <tr><th>Good</th><th>Stock</th><th title="Produced − used by industry − consumed by the population ± trade">Net/mo</th></tr>
        </thead>
        <tbody>
          {SIMPLE_GOODS.map((g) => (
            <tr key={g} title={`Produced ${fmt(r.produced[g], 1)} · used ${fmt(r.used[g], 1)} · consumed ${fmt(r.consumed[g], 1)} · traded ${signed(r.traded[g])}`}>
              <td>{SIMPLE_GOOD_NAMES[g]}</td>
              <td>{Math.floor(amounts?.[g] ?? 0).toLocaleString()}</td>
              <td className={r.net[g] > 0.05 ? 'econ-pos' : r.net[g] < -0.05 ? 'econ-neg' : ''}>{signed(r.net[g])}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="cb-facts" style={{ marginTop: 6 }}>
        <div title="Industrial capacity from factories"><span className="inspect-label">Production Units</span><span>{fmt(r.productionUnits)}</span></div>
        <div title="Share of industry's minerals and energy that could be supplied — below 100% everything industrial slows"><span className="inspect-label">Inputs supplied</span><span className={r.inputSatisfaction < 0.95 ? 'econ-neg' : ''}>{pct(r.inputSatisfaction, 0)}</span></div>
        <div title="From the civilian share of production — spent on the queue below"><span className="inspect-label">Construction</span><span>{fmt(r.constructionPoints)}/mo</span></div>
        <div title="Output multiplier from stability and economy type"><span className="inspect-label">Efficiency</span><span>{pct(r.efficiency, 0)}</span></div>
      </div>

      <div className="econ-control-row">
        <span className="inspect-label" title="Research Labs produce points into this tree">Research {fmt(r.research, 1)}/mo</span>
        <span>
          {FOCI.map((f) => (
            <button key={f.id} type="button" className={`laws-enact-btn${s.researchFocus === f.id ? ' abs-on' : ''}`} style={{ marginLeft: 4 }} onClick={() => setResearchFocus(countryId, f.id)}>
              {f.label}
            </button>
          ))}
        </span>
      </div>

      <div className="econ-subtitle" style={{ marginTop: 10 }}>Construction queue</div>
      {s.queue.length > 0 && (() => {
        const active = s.queue.filter((o) => mine.some((w) => w.bodyName === o.bodyName)).length
        const usable = Math.min(r.constructionPoints, active * MAX_CP_PER_ORDER)
        return (
          <div className={usable < r.constructionPoints - 0.5 ? 'econ-neg' : 'abs-dim'} style={{ fontSize: 10 }} title={`Each project takes at most ${MAX_CP_PER_ORDER} construction a month — queue several to use it all.`}>
            Using {fmt(usable)} of {fmt(r.constructionPoints)} construction/mo
          </div>
        )
      })()}
      {s.queue.length === 0 ? (
        <div className="abs-dim">Nothing queued — construction points go to waste. Queue buildings on a world below.</div>
      ) : (
        s.queue.map((o, i) => {
          const cost = orderCost(o)
          const paused = !mine.some((w) => w.bodyName === o.bodyName)
          return (
            <div key={o.id} className="abs-order">
              <span>{i + 1}. {SIMPLE_BUILDING_DEFS[o.building].name} — {o.bodyName}{paused ? ' (paused: occupied)' : ''}</span>
              <span className="abs-order-bar"><span style={{ width: `${Math.min(100, (o.progress / cost) * 100)}%` }} /></span>
              <span className="abs-dim">{fmt(o.progress)}/{cost}</span>
              <button type="button" className="abs-x" title="Cancel (progress is lost)" onClick={() => cancelOrder(countryId, o.id)}>×</button>
            </div>
          )
        })
      )}

      <div className="econ-subtitle" style={{ marginTop: 10 }}>Worlds</div>
      {mine.map((w) => (
        <WorldCard key={w.bodyName} countryId={countryId} bodyName={w.bodyName} />
      ))}
      {occupied.map((w) => (
        <div key={w.bodyName} className="abs-world abs-dim">
          <b>{w.bodyName}</b> — occupied; produces nothing for you until it's liberated.
        </div>
      ))}
    </>
  )
}

// One world's population, workers and buildings. `countryId` is the viewer:
// if they own and hold the world they get the build controls, otherwise it's a
// read-only look (the planet inspect window uses it for any world).
export function WorldCard({ countryId, bodyName }: { countryId: string | null; bodyName: string }) {
  const w = useAbstractEconomyStore((st) => st.worlds[bodyName])
  const queue = useAbstractEconomyStore((st) => (countryId ? st.byCountry[countryId]?.queue : undefined))
  const queueBuilding = useAbstractEconomyStore((st) => st.queueBuilding)
  const owner = useTerritoryStore((st) => st.bodyOwner[bodyName])
  const controller = useTerritoryStore((st) => st.bodyController[bodyName] ?? st.bodyOwner[bodyName])
  const [choice, setChoice] = useState<SimpleBuildingId>('factory')
  const [message, setMessage] = useState<string | null>(null)
  if (!w) return <div className="abs-dim">No economy on this world.</div>
  const staffing = worldStaffing(w)
  const canBuild = !!countryId && owner === countryId && controller === countryId && !!queue
  const free = queue ? freeSlots(w, queue) : 0
  const queuedHere = queue?.filter((o) => o.bodyName === bodyName) ?? []
  const build = () => {
    if (!countryId) return
    const res = queueBuilding(countryId, bodyName, choice)
    setMessage(res.ok ? null : res.reason)
  }
  return (
    <div className="abs-world">
      <div className="abs-world-head">
        <b>{w.bodyName}</b>
        <span className="abs-dim">
          pop {formatPop(w.population)} · workers {fmt(worldWorkforce(w))}/{fmt(worldJobs(w))} jobs
          {staffing < 1 ? <span className="econ-neg"> (staffed {pct(staffing, 0)})</span> : null} · slots {worldLevels(w)}/{w.slots}
        </span>
        {owner && owner !== countryId && <span className="abs-dim">Owned by {getCountry(owner)?.name ?? owner}</span>}
        {owner && controller !== owner && <span className="econ-neg" style={{ fontSize: 10 }}>Occupied by {getCountry(controller ?? '')?.name ?? controller} — produces nothing</span>}
      </div>
      <div className="abs-chips">
        {SIMPLE_BUILDINGS.filter((b) => (w.buildings[b] ?? 0) > 0).map((b) => (
          <span key={b} className="abs-chip" title={SIMPLE_BUILDING_DEFS[b].description}>{SIMPLE_BUILDING_DEFS[b].name} ×{w.buildings[b]}</span>
        ))}
        {queuedHere.map((o) => (
          <span key={o.id} className="abs-chip abs-chip-queued" title="Under construction">+{SIMPLE_BUILDING_DEFS[o.building].name}</span>
        ))}
      </div>
      {canBuild && (
        <div className="abs-build">
          <select value={choice} onChange={(e) => setChoice(e.target.value as SimpleBuildingId)} title={SIMPLE_BUILDING_DEFS[choice].description}>
            {SIMPLE_BUILDINGS.map((b) => (
              <option key={b} value={b}>{SIMPLE_BUILDING_DEFS[b].name} ({SIMPLE_BUILDING_DEFS[b].cost} CP, {SIMPLE_BUILDING_DEFS[b].jobs} jobs)</option>
            ))}
          </select>
          <button type="button" className="laws-enact-btn" disabled={free <= 0} onClick={build}>Build</button>
        </div>
      )}
      {message && <div className="econ-neg" style={{ fontSize: 10 }}>{message}</div>}
    </div>
  )
}

// --- Social -----------------------------------------------------------------------
const STRATUM_LABEL: Record<Stratum, string> = { workers: 'Workers', specialists: 'Specialists', unemployed: 'Unemployed' }
const STRATUM_HINT: Record<Stratum, string> = {
  workers: 'Work farms, mines, power plants and factories',
  specialists: 'Work research labs and exotic refineries — want more consumer goods and electronics',
  unemployed: 'No job — unhappy; build to employ them',
}
const NEED_LABEL: Record<NeedGood, string> = { food: 'Food', consumerGoods: 'Consumer goods', electronics: 'Electronics' }

function HappinessBar({ value }: { value: number }) {
  const p = Math.round(value * 100)
  const tone = value >= 0.6 ? '#4ade80' : value >= 0.4 ? '#ffd23f' : '#ff6b4a'
  return (
    <span className="abs-hbar" title={`${p}% happy`}>
      <span style={{ width: `${p}%`, background: tone }} />
    </span>
  )
}

// Simple mode's pops (Stellaris-style): strata, what each consumes, how
// happy each is and why, approval and the stability that follows it.
function SocialTab({ countryId, s, r }: TabProps) {
  const setWelfare = useAbstractEconomyStore((st) => st.setWelfare)
  const worlds = useAbstractEconomyStore((st) => st.worlds)
  const owners = useTerritoryStore((st) => st.bodyOwner)
  const controllers = useTerritoryStore((st) => st.bodyController)
  const [open, setOpen] = useState<Stratum | null>(null)
  const mine = worldsOf(countryId, worlds, owners, controllers).sort((a, b) => b.population - a.population)
  const outputBonus = 0.4 * s.stability - 0.2 // the stability part of efficiency (0.8 + 0.4·stability)
  return (
    <>
      <div className="cb-facts">
        <div><span className="inspect-label">Population</span><span>{formatPop(r.population)}</span></div>
        <div title="Share of the population that works"><span className="inspect-label">Workforce</span><span>{formatPop(r.workforce)}</span></div>
        <div title="Jobs your buildings offer"><span className="inspect-label">Jobs</span><span>{formatPop(r.jobs)}</span></div>
        <div title="Workers without a job — build more to employ them"><span className="inspect-label">Unemployed</span><span className={r.workforce > r.jobs ? 'econ-neg' : ''}>{formatPop(Math.max(0, r.workforce - r.jobs))}</span></div>
      </div>

      <div className="econ-subtitle" style={{ marginTop: 10 }}>Strata</div>
      <table className="abs-table">
        <thead><tr><th>Stratum</th><th>People</th><th title="Monthly upkeep per billion: food / consumer goods / electronics">Upkeep /B</th><th>Happiness</th></tr></thead>
        <tbody>
          {STRATA.map((st) => {
            const sr = r.strata[st]
            const u = POP_UPKEEP[st]
            return (
              <Fragment key={st}>
                <tr className="abs-click" title={STRATUM_HINT[st] + ' — click for what drives their happiness'} onClick={() => setOpen(open === st ? null : st)}>
                  <td>{open === st ? '▾' : '▸'} {STRATUM_LABEL[st]}</td>
                  <td>{formatPop(sr.population)}</td>
                  <td className="abs-dim">{fmt(u.food * 1000)} / {fmt(u.consumerGoods * 1000)} / {fmt(u.electronics * 1000)}</td>
                  <td><HappinessBar value={sr.happiness} /> {pct(sr.happiness, 0)}</td>
                </tr>
                {open === st && (
                  <tr>
                    <td colSpan={4}>
                      <div className="abs-budget-col abs-parts">
                        <div><span>Base</span><span>50</span></div>
                        {sr.parts.map((p) => (
                          <div key={p.label}><span>{p.label}</span><span className={p.value > 0 ? 'econ-pos' : 'econ-neg'}>{signed(p.value * 100, 0)}</span></div>
                        ))}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>

      <div className="abs-deficit">
        <span title="Population-weighted happiness">Approval</span>
        <span className={Math.round(r.approval * 100) < 50 ? 'econ-neg' : 'econ-pos'}>{pct(r.approval, 0)}</span>
      </div>
      <div className="cb-governance"><Meter label="Stability" value={s.stability} /></div>
      <div className="abs-dim" style={{ fontSize: 10, marginTop: 2 }}>
        Stability follows approval (heading to {pct(r.stabilityTarget, 0)}). Output {signed(outputBonus * 100, 0)}% from stability
        {r.unrest ? <span className="econ-neg"> · UNREST: below {pct(UNREST_BELOW, 0)} — tax yield −20%</span> : null}
      </div>

      <div className="econ-subtitle" style={{ marginTop: 12 }}>Pop upkeep (per month)</div>
      <table className="abs-table">
        <thead><tr><th>Good</th><th>Wanted</th><th>Got</th><th>Met</th></tr></thead>
        <tbody>
          {NEED_GOODS.map((g) => {
            const n = r.needs[g]
            const met = r.goodSatisfaction[g]
            return (
              <tr key={g}>
                <td>{NEED_LABEL[g]}</td>
                <td>{fmt(n.demand, 1)}</td>
                <td>{fmt(n.got, 1)}</td>
                <td className={met < 0.999 ? 'econ-neg' : 'econ-pos'}>{pct(met, 0)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {r.foodSatisfaction < 0.95 && <div className="econ-neg" style={{ fontSize: 11 }}>Starvation — people are dying and the population is shrinking.</div>}

      <div className="econ-subtitle" style={{ marginTop: 12 }}>Welfare</div>
      <label className="econ-control-row" title="Pensions, healthcare, housing support — costs budget; makes every stratum happier (the unemployed most) and speeds population growth.">
        <span className="inspect-label">Welfare level</span>
        <span>
          <input type="range" min={0} max={1} step={0.05} value={s.welfare} onChange={(e) => setWelfare(countryId, Number(e.target.value))} />
          <b style={{ marginLeft: 8, color: '#cdeeff' }}>{Math.round(s.welfare * 100)}%</b>
        </span>
      </label>
      <div className="abs-dim" style={{ fontSize: 10 }}>Costs {formatMoney(r.expWelfare)}/yr</div>

      <div className="econ-subtitle" style={{ marginTop: 12 }}>Population by world</div>
      <table className="abs-table">
        <tbody>
          {mine.map((w) => (
            <tr key={w.bodyName}><td>{w.bodyName}</td><td>{formatPop(w.population)}</td></tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

// Society > Demographics in Simple mode: the same pops view.
export function SimplisticDemographics() {
  const countryId = usePlayerStore((st) => st.selectedCountryId)
  const state = useAbstractEconomyStore((st) => (countryId ? st.byCountry[countryId] : undefined))
  const report = useAbstractEconomyStore((st) => (countryId ? st.reports[countryId] : undefined))
  if (!countryId || !state || !report) return <div className="nav-placeholder">No population in context.</div>
  return (
    <div className="econ-panel">
      <SocialTab countryId={countryId} s={state} r={report} />
    </div>
  )
}

// --- Trade ------------------------------------------------------------------------
function TradeTab({ countryId, s, r }: TabProps) {
  const history = useAbstractEconomyStore((st) => st.history[countryId])
  const tick = useAbstractEconomyStore((st) => st.tick)
  const all = useAbstractEconomyStore((st) => st.byCountry)
  const setTrade = useAbstractEconomyStore((st) => st.setTrade)
  const amounts = useResourceStore((st) => st.byCountry[countryId]?.amounts)
  const h = history ?? []
  const rate = s.currency.rate
  const fund = fundamentalRate(s, r)

  return (
    <>
      <div className="abs-headline">
        <span className="abs-econtype">{s.currency.name} ({s.currency.code})</span>
        <span className="abs-rating" title="Exchange rate: TSC per unit">{rate.toFixed(3)} TSC</span>
      </div>
      <TimeChart title="Exchange rate (TSC per unit)" endTick={tick} format={(v) => v.toFixed(2)} series={[{ label: s.currency.code, color: '#6fe3ff', values: h.map((p) => p.rate) }]} tip="How many Terra Standard Credits one unit of your currency buys. Higher = stronger: imports get cheaper, exports earn less." />
      <div className="cb-facts">
        <div title="Where fundamentals are pulling the rate: low inflation, stability, low debt and a trade surplus strengthen it"><span className="inspect-label">Fundamentals</span><span className={fund >= rate ? 'econ-pos' : 'econ-neg'}>{fund.toFixed(3)} {fund >= rate ? '▲' : '▼'}</span></div>
        <div><span className="inspect-label">Imports / mo</span><span>{formatMoney(r.importCost)}</span></div>
        <div><span className="inspect-label">Exports / mo</span><span>{formatMoney(r.exportRevenue)}</span></div>
        <div><span className="inspect-label">Trade balance</span><span className={r.tradeBalance >= 0 ? 'econ-pos' : 'econ-neg'}>{formatMoney(r.tradeBalance)}/mo</span></div>
      </div>

      <div className="econ-subtitle" style={{ marginTop: 10 }}>Interstellar market</div>
      <div className="abs-dim" style={{ fontSize: 10, marginBottom: 4 }}>
        Standing monthly orders, settled from the treasury. A strong currency makes imports cheap and exports earn less. Positive imports, negative exports.
      </div>
      <table className="abs-table">
        <thead>
          <tr><th>Good</th><th>Stock</th><th title="Import price / export price per unit, in your currency">Buy / Sell</th><th>Order/mo</th></tr>
        </thead>
        <tbody>
          {SIMPLE_GOODS.map((g: SimpleGood) => {
            const order = s.trade[g] ?? 0
            const done = r.traded[g]
            return (
              <tr key={g}>
                <td>{SIMPLE_GOOD_NAMES[g]}</td>
                <td>{Math.floor(amounts?.[g] ?? 0).toLocaleString()}</td>
                <td className="abs-dim">{((GOOD_VALUE[g] * 1.1) / rate).toFixed(2)} / {((GOOD_VALUE[g] * 0.9) / rate).toFixed(2)}</td>
                <td>
                  <input
                    className="abs-num"
                    type="number"
                    step={5}
                    value={order}
                    onChange={(e) => setTrade(countryId, g, Number(e.target.value))}
                    title={order !== 0 && Math.abs(done - order) > 0.01 ? `Only ${fmt(Math.abs(done), 1)} went through last month (stock or cash ran short)` : undefined}
                  />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <div className="econ-subtitle" style={{ marginTop: 12 }}>Nations</div>
      <table className="abs-table">
        <thead><tr><th>Nation</th><th>Currency</th><th title="GDP converted to TSC at today's rate">GDP (TSC)</th></tr></thead>
        <tbody>
          {Object.values(all).map((n) => (
            <tr key={n.countryId} className={n.countryId === countryId ? 'abs-me' : ''}>
              <td>{getCountry(n.countryId)?.name ?? n.countryId}</td>
              <td>{n.currency.code} {n.currency.rate.toFixed(2)}</td>
              <td>{formatMoney(n.gdp * n.currency.rate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}
