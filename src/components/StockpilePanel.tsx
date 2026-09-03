import { useMemo, useState } from 'react'
import { useEconomyStore } from '../state/economyStore'
import { usePlayerStore } from '../state/playerStore'
import { GOODS, GOOD_IDS, type GoodId } from '../economy/goods'

// Economy → Stockpiles: a simple strategic reserve (batch 3) — per world,
// separate from the normal market inventory that clears every tick. The
// player sets a target level for a good; tickWorld drifts the held amount
// toward it a capped fraction per tick, buying from genuine market surplus
// (a real treasury cost) when below target and releasing to cushion a
// genuine shortage when demand outruns supply (economyTick's
// STOCKPILE_FILL_RATE/STOCKPILE_RELEASE_RATE). Deliberately minimal: a fixed
// per-tick rate, not a trading desk.
export function StockpilePanel() {
  const countryId = usePlayerStore((s) => s.selectedCountryId)
  const worlds = useEconomyStore((s) => s.worlds)
  const setStockpileTarget = useEconomyStore((s) => s.setStockpileTarget)
  const [selectedWorldId, setSelectedWorldId] = useState<string | null>(null)
  const [pendingGood, setPendingGood] = useState<GoodId>(GOOD_IDS[0])
  const [pendingAmount, setPendingAmount] = useState(100)

  const owned = useMemo(() => worlds.filter((w) => w.ownerId === countryId), [worlds, countryId])

  if (!countryId) return <div className="nav-placeholder">No nation selected.</div>
  if (owned.length === 0) return <div className="nav-placeholder">No worlds to hold a reserve on.</div>

  const worldId = selectedWorldId && owned.some((w) => w.id === selectedWorldId) ? selectedWorldId : owned[0].id
  const world = owned.find((w) => w.id === worldId)!
  const targetedGoods = GOOD_IDS.filter((g) => (world.stockpileTargets?.[g] ?? 0) > 0)

  return (
    <div className="econ-panel">
      <div className="econ-summary">
        <span className="econ-summary-label">Strategic Reserves</span>
        <div className="pops-meta">
          <span>
            World:{' '}
            <select className="econ-method-select" value={world.id} onChange={(e) => setSelectedWorldId(e.target.value)}>
              {owned.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </span>
        </div>
      </div>

      <div className="econ-subtitle">Reserve targets on {world.name}</div>
      {targetedGoods.length === 0 ? (
        <div className="nav-placeholder">No reserve targets set here yet — add one below.</div>
      ) : (
        targetedGoods.map((g) => {
          const target = world.stockpileTargets?.[g] ?? 0
          const amount = world.stockpiles?.[g] ?? 0
          const pct = target > 0 ? Math.min(100, (amount / target) * 100) : 0
          return (
            <div className="demo-bar-row" key={g}>
              <span className="demo-bar-label">{GOODS[g].label}</span>
              <span className="demo-bar-track">
                <span className="demo-bar-fill" style={{ width: `${pct}%`, background: pct >= 100 ? '#4ade80' : '#6fe3ff' }} />
              </span>
              <span className="demo-bar-val">
                {amount.toFixed(0)} / {target.toFixed(0)}
              </span>
              <button type="button" className="econ-release-btn" onClick={() => setStockpileTarget(world.id, g, 0)} title="Clear this reserve target">
                ×
              </button>
            </div>
          )
        })
      )}

      <div className="econ-subtitle" style={{ marginTop: 8 }}>
        Set a reserve target
      </div>
      <div className="corp-create">
        <select className="econ-method-select" value={pendingGood} onChange={(e) => setPendingGood(e.target.value as GoodId)}>
          {GOOD_IDS.map((g) => (
            <option key={g} value={g}>
              {GOODS[g].label}
            </option>
          ))}
        </select>
        <input
          className="corp-input"
          type="number"
          min={0}
          value={pendingAmount}
          onChange={(e) => setPendingAmount(Math.max(0, Number(e.target.value) || 0))}
        />
        <button type="button" className="corp-btn" onClick={() => setStockpileTarget(world.id, pendingGood, pendingAmount)}>
          Set target
        </button>
      </div>

      <div className="ship-panel-hint">
        A capped share of genuine market surplus is bought into the reserve each tick (a real treasury cost) until it
        reaches the target; a capped share is released automatically to cushion a genuine shortage. Set a target of 0 to
        clear it — any goods already held stay in reserve.
      </div>
    </div>
  )
}
