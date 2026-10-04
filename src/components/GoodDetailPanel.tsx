import { DraggableWindow } from './DraggableWindow'
import { useGoodDetailStore } from '../state/goodDetailStore'
import { useBuildingDetailStore } from '../state/buildingDetailStore'
import { useEconomyStore } from '../state/economyStore'
import { usePlayerStore } from '../state/playerStore'
import { useTradePolicyStore, tradePolicyOf } from '../state/tradePolicyStore'
import { GOODS } from '../economy/goods'
import { goodMarketSummary } from '../economy/goodMarket'
import { formatIEDPrice } from '../economy/format'
import { TimeChart } from './TimeChart'
import { useMemo } from 'react'

// Vic3-style market view of one good: its price (over time and by planet), who
// produces it, who consumes it, and this nation's trade policy on it. Opened by
// clicking the good anywhere (a building's inputs/outputs, the Market tab —
// state/goodDetailStore.ts). Complex mode (economyStore) only.
export function GoodDetailPanel() {
  const good = useGoodDetailStore((s) => s.good)
  const close = useGoodDetailStore((s) => s.close)
  const complex = usePlayerStore((s) => s.economyModel === 'complex')
  const countryId = usePlayerStore((s) => s.selectedCountryId)
  const worlds = useEconomyStore((s) => s.worlds)
  const reports = useEconomyStore((s) => s.worldReports)
  const countries = useEconomyStore((s) => s.countries)
  const tick = useEconomyStore((s) => s.tick)
  const priceHistory = useEconomyStore((s) => (good ? s.goodPriceHistory[good] : undefined))
  const policies = useTradePolicyStore((s) => s.policies)
  const setTariff = useTradePolicyStore((s) => s.setTariff)
  const setImportSubvention = useTradePolicyStore((s) => s.setImportSubvention)
  const setExportSubvention = useTradePolicyStore((s) => s.setExportSubvention)

  const mine = useMemo(() => worlds.filter((w) => w.ownerId === countryId), [worlds, countryId])
  const summary = useMemo(() => (good ? goodMarketSummary(good, mine, reports) : null), [good, mine, reports])

  if (!good || !summary) return null
  const def = GOODS[good]
  const rate = countries.find((c) => c.id === countryId)?.currency?.rate ?? 1
  const policy = countryId ? tradePolicyOf(policies, countryId) : undefined
  const tariff = policy?.tariffs[good] ?? 0
  const impSub = policy?.importSubventions[good] ?? 0
  const expSub = policy?.exportSubventions[good] ?? 0
  const pct = (x: number) => `${Math.round(x * 100)}%`

  const PolicyRow = ({ label, value, set, tip }: { label: string; value: number; set: (v: number) => void; tip: string }) => (
    <div className="inspect-row" title={tip}>
      <span className="inspect-label">{label}</span>
      <span className="good-policy-ctl">
        <button type="button" className="shipyard-target-btn" onClick={() => countryId && set(Math.max(0, Math.round((value - 0.05) * 100) / 100))}>−</button>
        <span className="good-policy-val">{pct(value)}</span>
        <button type="button" className="shipyard-target-btn" onClick={() => countryId && set(Math.min(1, Math.round((value + 0.05) * 100) / 100))}>+</button>
      </span>
    </div>
  )

  return (
    <DraggableWindow title={`${def.label}`} memoryKey="good" anchor="right" onClose={close}>
      <div className="econ-panel good-detail">
        {!complex ? (
          <div className="nav-placeholder">The good market view is available in Complex mode.</div>
        ) : (
          <>
            <div className="econ-summary">
              <span className="econ-summary-label">{def.label}</span>
              <span className="abs-dim" style={{ fontSize: 10 }}>
                {def.category} · base {formatIEDPrice(def.basePrice, rate)}
              </span>
            </div>

            <div className="good-stat-grid">
              <div className="pl-stat"><span>Avg price</span><b>{formatIEDPrice(summary.avgPrice, rate)}</b></div>
              <div className="pl-stat" title="Across your worlds, per tick"><span>Supply</span><b>{summary.totalSupply.toFixed(0)}</b></div>
              <div className="pl-stat"><span>Demand</span><b>{summary.totalDemand.toFixed(0)}</b></div>
              <div className="pl-stat" title="Produced by your buildings, per tick"><span>Produced</span><b>{summary.totalProduced.toFixed(0)}</b></div>
              <div className="pl-stat" title="Used by your buildings, per tick"><span>Industry use</span><b>{summary.totalConsumed.toFixed(0)}</b></div>
            </div>

            {priceHistory && priceHistory.length > 1 && (
              <TimeChart
                title="Market price"
                endTick={tick}
                format={(v) => formatIEDPrice(v, rate)}
                series={[{ label: 'Avg price', color: '#6fe3ff', values: priceHistory }]}
                tip="Your nation's transacted-weighted average price for this good, over time."
              />
            )}

            <div className="econ-subtitle">Trade policy</div>
            <PolicyRow label="Import tariff" value={tariff} set={(v) => countryId && setTariff(countryId, good, v)} tip="A tax on this good bought from foreign sellers (not shared-market partners) — revenue to your treasury, but it raises the landed price." />
            <PolicyRow label="Import subvention" value={impSub} set={(v) => countryId && setImportSubvention(countryId, good, v)} tip="Your treasury subsidises imports of this good, lowering its landed price — for a good you are short of." />
            <PolicyRow label="Export subvention" value={expSub} set={(v) => countryId && setExportSubvention(countryId, good, v)} tip="Your treasury subsidises your exports of this good, making them cheaper abroad." />

            <div className="econ-subtitle">Producers</div>
            {summary.producers.length === 0 ? (
              <div className="bld-detail-none">No buildings of yours make this.</div>
            ) : (
              summary.producers.map((r, i) => (
                <button type="button" className="good-flow-row good-flow-link" key={`p${i}`} onClick={() => useBuildingDetailStore.getState().openBuilding(r.worldId, r.buildingId)} title={`Open ${r.label} on ${r.worldName}`}>
                  <span className="good-flow-name">{r.label} <span className="abs-dim">L{r.level}</span></span>
                  <span className="good-flow-where abs-dim">{r.worldName}</span>
                  <span className="good-flow-amt econ-pos">+{r.perTick.toFixed(0)}</span>
                </button>
              ))
            )}

            <div className="econ-subtitle">Consumers — industry</div>
            {summary.consumers.length === 0 ? (
              <div className="bld-detail-none">No buildings of yours use this as an input.</div>
            ) : (
              summary.consumers.map((r, i) => (
                <button type="button" className="good-flow-row good-flow-link" key={`c${i}`} onClick={() => useBuildingDetailStore.getState().openBuilding(r.worldId, r.buildingId)} title={`Open ${r.label} on ${r.worldName}`}>
                  <span className="good-flow-name">{r.label} <span className="abs-dim">L{r.level}</span></span>
                  <span className="good-flow-where abs-dim">{r.worldName}</span>
                  <span className="good-flow-amt econ-neg">−{r.perTick.toFixed(0)}</span>
                </button>
              ))
            )}

            {summary.popConsumerWorlds.length > 0 && (
              <>
                <div className="econ-subtitle">Consumers — population</div>
                {summary.popConsumerWorlds.map((w) => (
                  <div className="good-flow-row" key={`pop${w.worldId}`}>
                    <span className="good-flow-name">Households</span>
                    <span className="good-flow-where abs-dim">{w.worldName}</span>
                    <span className="good-flow-amt abs-dim">{(w.population / 1000).toFixed(2)}B people</span>
                  </div>
                ))}
              </>
            )}

            <div className="econ-subtitle">Price by planet</div>
            {summary.perWorld.map((w) => (
              <div className="good-flow-row" key={`w${w.worldId}`}>
                <span className="good-flow-name">{w.worldName}</span>
                <span className="good-flow-where abs-dim">s {w.supply.toFixed(0)} / d {w.demand.toFixed(0)}</span>
                <span className="good-flow-amt">{formatIEDPrice(w.price, rate)}</span>
              </div>
            ))}

            <div className="ship-panel-hint" style={{ marginTop: 6 }}>
              Prices are per market lot, in International Earth Dollars (IED). Producers and consumers are your own buildings; households are the population that needs this good.
            </div>
          </>
        )}
      </div>
    </DraggableWindow>
  )
}
