import { COUNTRIES } from '../data/countryData'
import { STARS } from '../data/starData'
import { usePlayerStore } from '../state/playerStore'
import { useViewStore } from '../state/viewStore'
import { startSandbox } from '../scene/sandboxSetup'
import { SANDBOX_PLAYER } from '../data/countryRoster'

// The game's entry screen — picking a country is picking who you play as
// (see countryData.ts). Session-only (playerStore has no persistence), so a
// reload always returns here. Selecting seeds viewStore so the game opens
// already at that country's own capital system/body instead of always at
// Sol.
export function MainMenu() {
  const selectCountry = usePlayerStore((s) => s.selectCountry)
  const economyModel = usePlayerStore((s) => s.economyModel)
  const setEconomyModel = usePlayerStore((s) => s.setEconomyModel)
  const enterSystem = useViewStore((s) => s.enterSystem)

  const handleSelect = (countryId: string) => {
    const country = COUNTRIES.find((c) => c.id === countryId)
    if (country) enterSystem(country.capitalStarId, country.capitalBodyName)
    selectCountry(countryId)
  }

  return (
    <div className="main-menu">
      <div className="main-menu-title">TERRA RELICTA: CONQUEST</div>

      {/* Economic model — chosen before the nation, fixed for the game. */}
      <div className="main-menu-subtitle">Economic model</div>
      <div className="main-menu-econ-toggle">
        <button
          type="button"
          className={`main-menu-econ-option${economyModel === 'complex' ? ' active' : ''}`}
          onClick={() => setEconomyModel('complex')}
          title="A detailed economy: individual pops, markets with prices for dozens of goods, banks, a central bank, corporations and currencies. Deep but demanding."
        >
          <span className="main-menu-econ-name">Complex mode (mr1noobfatfish’s attempt at economic modeling)</span>
          <span className="main-menu-econ-desc">The deep simulation — pops, goods markets, banking, currencies. Detailed and emergent.</span>
        </button>
        <button
          type="button"
          className={`main-menu-econ-option${economyModel === 'abstract' ? ' active' : ''}`}
          onClick={() => setEconomyModel('abstract')}
          title="A streamlined economy: eight goods, six kinds of building, factories as production units, Stellaris-style pops and happiness, and a simple budget. Easy to read and manage."
        >
          <span className="main-menu-econ-name">Simple mode</span>
          <span className="main-menu-econ-desc">A macro national economy (Stellaris/HOI4/TNO-inspired) — a few goods, factories and buildings on your worlds, a budget and a currency. Legible and fast.</span>
        </button>
      </div>

      <div className="main-menu-subtitle">Choose your nation</div>
      <div className="main-menu-countries">
        {COUNTRIES.map((country) => {
          const capitalStar = STARS.find((s) => s.id === country.capitalStarId)
          return (
            <button
              key={country.id}
              type="button"
              className="main-menu-country-card"
              style={{ borderColor: country.color }}
              onClick={() => handleSelect(country.id)}
              title={`Play as ${country.name}`}
            >
              <span className="main-menu-country-swatch" style={{ backgroundColor: country.color }} />
              <span className="main-menu-country-name">{country.name}</span>
              <span className="main-menu-country-capital">
                Capital: {country.capitalBodyName} · {capitalStar?.name ?? country.capitalStarId}
              </span>
            </button>
          )
        })}
      </div>
      {/* No nation at all: you against whatever you put on the board. */}
      <div className="main-menu-sandbox">
        <button
          type="button"
          className="main-menu-country-card main-menu-sandbox-card"
          style={{ borderColor: SANDBOX_PLAYER.color }}
          onClick={startSandbox}
          title="No nations and no economy — set up fights and test ships and armies freely"
        >
          <span className="main-menu-country-swatch" style={{ backgroundColor: SANDBOX_PLAYER.color }} />
          <span className="main-menu-country-name">Sandbox</span>
          <span className="main-menu-country-capital">No nations, no economy. Place your own, friendly, neutral and hostile ships and armies.</span>
        </button>
      </div>
    </div>
  )
}
