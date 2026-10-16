import { Bi } from './Bi'
import { ThemePicker } from './ThemePicker'
import { useMemo, useState } from 'react'
import { SaveSlots } from './SaveSlots'
import { COUNTRIES } from '../data/countryData'
import { STARS } from '../data/starData'
import { usePlayerStore } from '../state/playerStore'
import { useViewStore } from '../state/viewStore'
import { startSandbox } from '../scene/sandboxSetup'
import { MenuBackdrop } from '../scene/MenuBackdrop'
import { menuWorldOf, readLastWorld } from '../scene/menuWorld'

// The game's entry screen, laid out like a grand-strategy title screen: the title top left, a
// column of big plain choices under it, and behind it all the world of the nation last played
// (Earth for a new player) turning with its moons around it (scene/MenuBackdrop.tsx). A choice
// opens its panel beside the column. Picking a country is picking who you play as (see
// countryData.ts). Session-only (playerStore has no persistence), so a reload always returns
// here. Selecting seeds viewStore so the game opens already at that country's own capital
// system instead of always at Sol.
type Panel = 'new' | 'load' | 'settings'

export function MainMenu() {
  const [panel, setPanel] = useState<Panel | null>(null)
  const selectCountry = usePlayerStore((s) => s.selectCountry)
  const economyModel = usePlayerStore((s) => s.economyModel)
  const setEconomyModel = usePlayerStore((s) => s.setEconomyModel)
  const enterSystem = useViewStore((s) => s.enterSystem)
  const world = useMemo(() => menuWorldOf(readLastWorld()), [])

  const handleSelect = (countryId: string) => {
    const country = COUNTRIES.find((c) => c.id === countryId)
    // Enter the capital's system but DON'T pre-select the capital body — that
    // would auto-open its planet panel on game start, which the player didn't ask for.
    if (country) enterSystem(country.capitalStarId)
    selectCountry(countryId)
  }
  const toggle = (p: Panel) => setPanel((cur) => (cur === p ? null : p))
  const item = (p: Panel, label: string) => (
    <button type="button" className={`menu-item${panel === p ? ' active' : ''}`} onClick={() => toggle(p)}>
      {label}
    </button>
  )

  return (
    <div className="main-menu">
      <div className="menu-stage">
        <MenuBackdrop world={world} />
        <div className="menu-ui">
          <div className="main-menu-title menu-title">
            <Bi en="TERRA RELICTA: CONQUEST" />
          </div>

          <nav className="menu-list">
            {item('new', 'New Game')}
            {item('load', 'Load Game')}
            <button type="button" className="menu-item" onClick={startSandbox} title="No nations and no economy — set up fights and test ships and armies freely">
              Sandbox
            </button>
            {item('settings', 'Settings')}
          </nav>

          <div className="menu-world">{world.name}</div>

          {panel === 'new' && (
            <section className="menu-panel">
              <div className="main-menu-subtitle"><Bi en="Economic model" /></div>
              <div className="main-menu-econ-toggle">
                <button
                  type="button"
                  className={`main-menu-econ-option${economyModel === 'complex' ? ' active' : ''}`}
                  onClick={() => setEconomyModel('complex')}
                  title="A detailed economy: individual pops, markets with prices for dozens of goods, banks, a central bank, corporations and currencies. Deep but demanding."
                >
                  <span className="main-menu-econ-name">
                    <Bi en="Complex mode (mr1noobfatfish’s attempt at economic modeling)" native={null} />
                  </span>
                  <span className="main-menu-econ-desc">A weird mix-and-mash of game mechanics mr1noobfatfish has observed, to try and make a somewhat realistic and cool economic simulation.</span>
                </button>
                <button
                  type="button"
                  className={`main-menu-econ-option${economyModel === 'abstract' ? ' active' : ''}`}
                  onClick={() => setEconomyModel('abstract')}
                  title="A streamlined economy: eight goods, six kinds of building, factories as production units, Stellaris-style pops and happiness, and a simple budget. Easy to read and manage."
                >
                  <span className="main-menu-econ-name"><Bi en="Simple mode" /></span>
                  <span className="main-menu-econ-desc">Simpler and more macro. Lots of stuff was stripped away here, and it makes the game more clear-cut.</span>
                </button>
              </div>

              <div className="main-menu-subtitle"><Bi en="Choose your nation" /></div>
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
                      <span className="main-menu-country-name">
                        <Bi en={country.name} />
                      </span>
                      <span className="main-menu-country-capital">
                        Capital: {country.capitalBodyName} · {capitalStar?.name ?? country.capitalStarId}
                      </span>
                    </button>
                  )
                })}
              </div>
            </section>
          )}

          {panel === 'load' && (
            <section className="menu-panel">
              <div className="main-menu-subtitle"><Bi en="Saved games" /></div>
              <SaveSlots canSave={false} onLoaded={() => setPanel(null)} />
            </section>
          )}

          {panel === 'settings' && (
            <section className="menu-panel">
              <div className="main-menu-subtitle"><Bi en="Interface" /></div>
              <div className="main-menu-theme">
                <ThemePicker />
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
