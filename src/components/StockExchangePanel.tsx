import { useEconomyStore } from '../state/economyStore'
import { usePlayerStore } from '../state/playerStore'
import { sharePrice, corporationValue } from '../economy/economyTick'
import { formatMoney } from '../economy/format'
import { getCountry } from '../data/countryData'

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
  const investAbroad = useEconomyStore((s) => s.investAbroad)

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
              const foreign = c.countryId !== countryId
              const host = countries.find((x) => x.id === c.countryId)
              const hostClosed = foreign && host?.foreignInvestmentPolicy === 'closed'
              // Domestic: the home-state stake, traded via tradeShares. Foreign:
              // OUR government's stake in it, traded via investAbroad.
              const myStake = foreign
                ? c.shares.filter((s) => s.holder.kind === 'state' && (s.holder as { countryId?: string }).countryId === countryId).reduce((n, s) => n + s.shares, 0)
                : c.shares.filter((s) => s.holder.kind === 'state' && (s.holder as { countryId?: string }).countryId === undefined).reduce((n, s) => n + s.shares, 0)
              const float = c.shares.find((s) => s.holder.kind === 'public')?.shares ?? 0
              const buyCost = price * Math.min(BLOCK, float)
              const canBuy = float > 0 && buyCost <= treasury && !hostClosed
              const canSell = myStake > 0
              const buy = () => (foreign ? investAbroad(countryId, c.id, BLOCK) : tradeShares(countryId, c.id, BLOCK))
              const sell = () => (foreign ? investAbroad(countryId, c.id, -BLOCK) : tradeShares(countryId, c.id, -BLOCK))
              return (
                <tr key={c.id}>
                  <td title={`${c.kind === 'state' ? 'State' : 'Private'} · ${c.sector}${foreign ? ` · ${getCountry(c.countryId)?.name ?? 'foreign'}` : ''}`}>
                    {c.name}
                    {foreign && <span className="econ-owner-tag econ-owner-corporation" style={{ marginLeft: 5, fontSize: 9 }} title={`Foreign — based in ${getCountry(c.countryId)?.name ?? c.countryId}${hostClosed ? '; closed to foreign capital' : ''}`}>foreign</span>}
                  </td>
                  <td>{formatMoney(price)}</td>
                  <td>{formatMoney(corporationValue(c, worlds))}</td>
                  <td title={foreign ? 'Your government’s stake' : 'Home-state stake'}>{Math.round((myStake / c.totalShares) * 100)}%</td>
                  <td>{Math.round((float / c.totalShares) * 100)}%</td>
                  <td>
                    <span className="stock-trade">
                      <button
                        type="button"
                        className="stock-btn stock-buy"
                        disabled={!canBuy}
                        title={hostClosed ? `${getCountry(c.countryId)?.name ?? 'This country'} is closed to foreign capital` : canBuy ? `Buy ${Math.min(BLOCK, float)} shares for ${formatMoney(buyCost)}${foreign ? ' (foreign investment)' : ''}` : 'No float available or treasury too low'}
                        onClick={buy}
                      >
                        Buy
                      </button>
                      <button
                        type="button"
                        className="stock-btn stock-sell"
                        disabled={!canSell}
                        title={canSell ? `Sell ${Math.min(BLOCK, myStake)} shares` : 'You hold no shares to sell'}
                        onClick={sell}
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
        Companies tagged <b>foreign</b> are based in another nation — buying them is cross-border investment (their dividends come home to your treasury), allowed unless that nation is closed to foreign capital (set in Government → Laws).
      </div>
    </div>
  )
}
