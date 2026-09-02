import { useEconomyStore } from '../state/economyStore'
import { usePlayerStore } from '../state/playerStore'
import { GOODS, GOOD_IDS } from '../economy/goods'
import { formatPop } from '../economy/format'

// Economy → Trade: the country's logistics backbone (Milestone 5). Surplus goods
// are shipped between the country's worlds each tick within the freight
// capacity, minus transit losses, so worlds can specialise and import what they
// don't produce. Shows capacity, this tick's trade volume, and what each world
// is importing.
export function TradePanel() {
  const countryId = usePlayerStore((s) => s.selectedCountryId)
  const worlds = useEconomyStore((s) => s.worlds)
  const reports = useEconomyStore((s) => s.countryReports)
  const countries = useEconomyStore((s) => s.countries)

  if (!countryId) return <div className="nav-placeholder">No nation selected.</div>
  const f = reports[countryId]
  const country = countries.find((c) => c.id === countryId)
  const owned = worlds.filter((w) => w.ownerId === countryId)
  const capacity = f?.logisticsCapacity ?? country?.logisticsCapacity ?? 0
  const volume = f?.tradeVolume ?? 0
  const util = capacity > 0 ? Math.min(100, (volume / capacity) * 100) : 0

  return (
    <div className="econ-panel">
      <div className="econ-fiscal-headline">
        <span>
          Freight capacity <b>{Math.round(capacity).toLocaleString()}</b>
        </span>
        <span>
          Shipped / tick <b>{Math.round(volume).toLocaleString()}</b>
        </span>
        <span>
          Utilisation <b>{Math.round(util)}%</b>
        </span>
      </div>

      <div className="econ-subtitle">Imports by world</div>
      {owned.map((w) => {
        const imports = GOOD_IDS.filter((g) => (w.importStock[g] ?? 0) > 0.5)
        return (
          <div className="trade-world" key={w.id}>
            <div className="trade-world-name">
              {w.name} · <span className="trade-world-pop">{formatPop(w.pops.reduce((s, p) => s + p.populationSize, 0))}</span>
            </div>
            {imports.length === 0 ? (
              <div className="trade-world-none">self-sufficient (no imports)</div>
            ) : (
              <div className="trade-world-imports">
                {imports.map((g) => (
                  <span className="trade-import-chip" key={g} title={`Importing ${GOODS[g].label}`}>
                    {GOODS[g].label} {(w.importStock[g] ?? 0).toFixed(0)}
                  </span>
                ))}
              </div>
            )}
          </div>
        )
      })}
      <div className="ship-panel-hint">
        Goods flow from surplus worlds to those that fall short, within the freight capacity, losing {Math.round(0.12 * 100)}%
        in transit. Raise capacity (freighter fleets, coming) to trade more and let worlds specialise further.
      </div>
    </div>
  )
}
