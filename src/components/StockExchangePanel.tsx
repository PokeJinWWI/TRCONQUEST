import { useEconomyStore } from '../state/economyStore'
import { usePlayerStore } from '../state/playerStore'
import { sharePrice, corporationValue } from '../economy/economyTick'
import { formatMoney } from '../economy/format'

const BLOCK = 50 // shares traded per click

// The stock exchange: the state can buy and sell shares of corporations. Share
// price tracks each company's book value (cash + the capital in the buildings it
// owns). Buying a controlling block is the market route to influence a company;
// selling raises cash for the treasury.
export function StockExchangePanel() {
  const countryId = usePlayerStore((s) => s.selectedCountryId)
  const corporations = useEconomyStore((s) => s.corporations)
  const worlds = useEconomyStore((s) => s.worlds)
  const countries = useEconomyStore((s) => s.countries)
  const tradeShares = useEconomyStore((s) => s.tradeShares)

  if (!countryId) return <div className="nav-placeholder">No nation selected.</div>
  const treasury = countries.find((c) => c.id === countryId)?.treasury ?? 0
  // Listed: every corporation (you can invest across the board).
  const listed = corporations

  return (
    <div className="econ-panel">
      <div className="econ-summary">
        <span>
          <span className="econ-summary-label">Stock Exchange</span> · Treasury {formatMoney(treasury)}
        </span>
      </div>
      {listed.length === 0 ? (
        <div className="nav-placeholder">No corporations are listed.</div>
      ) : (
        <table className="econ-table">
          <thead>
            <tr>
              <th>Corporation</th>
              <th>Share</th>
              <th>Value</th>
              <th>State</th>
              <th>Float</th>
              <th>Trade</th>
            </tr>
          </thead>
          <tbody>
            {listed.map((c) => {
              const price = sharePrice(c, worlds)
              const stateStake = c.shares.find((s) => s.holder.kind === 'state')?.shares ?? 0
              const float = c.shares.find((s) => s.holder.kind === 'public')?.shares ?? 0
              const buyCost = price * Math.min(BLOCK, float)
              const canBuy = float > 0 && buyCost <= treasury
              const canSell = stateStake > 0
              return (
                <tr key={c.id}>
                  <td title={`${c.kind === 'state' ? 'State' : 'Private'} · ${c.sector}`}>{c.name}</td>
                  <td>{formatMoney(price)}</td>
                  <td>{formatMoney(corporationValue(c, worlds))}</td>
                  <td>{Math.round((stateStake / c.totalShares) * 100)}%</td>
                  <td>{Math.round((float / c.totalShares) * 100)}%</td>
                  <td>
                    <span className="stock-trade">
                      <button
                        type="button"
                        className="stock-btn stock-buy"
                        disabled={!canBuy}
                        title={canBuy ? `Buy ${Math.min(BLOCK, float)} shares for ${formatMoney(buyCost)}` : 'No float available or treasury too low'}
                        onClick={() => tradeShares(countryId, c.id, BLOCK)}
                      >
                        Buy
                      </button>
                      <button
                        type="button"
                        className="stock-btn stock-sell"
                        disabled={!canSell}
                        title={canSell ? `Sell ${Math.min(BLOCK, stateStake)} shares` : 'The state holds no shares to sell'}
                        onClick={() => tradeShares(countryId, c.id, -BLOCK)}
                      >
                        Sell
                      </button>
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      <div className="ship-panel-hint">
        Share price = company value ÷ shares. Buying uses the treasury; selling raises cash. A block is {BLOCK} shares.
      </div>
    </div>
  )
}
