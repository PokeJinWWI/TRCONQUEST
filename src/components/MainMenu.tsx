import { COUNTRIES } from '../data/countryData'
import { STARS } from '../data/starData'
import { usePlayerStore } from '../state/playerStore'
import { useViewStore } from '../state/viewStore'

// The game's entry screen — picking a country is picking who you play as
// (see countryData.ts). Session-only (playerStore has no persistence), so a
// reload always returns here. Selecting seeds viewStore so the game opens
// already at that country's own capital system/body instead of always at
// Sol.
export function MainMenu() {
  const selectCountry = usePlayerStore((s) => s.selectCountry)
  const enterSystem = useViewStore((s) => s.enterSystem)

  const handleSelect = (countryId: string) => {
    const country = COUNTRIES.find((c) => c.id === countryId)
    if (country) enterSystem(country.capitalStarId, country.capitalBodyName)
    selectCountry(countryId)
  }

  return (
    <div className="main-menu">
      <div className="main-menu-title">TERRA RELICTA: CONQUEST</div>
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
    </div>
  )
}
