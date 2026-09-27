import { useState } from 'react'
import { useMapModeStore, type MapMode } from '../state/mapModeStore'
import { BuildingsPanel } from './BuildingsPanel'
import { useContextEconomy } from '../hooks/useContextEconomy'
import { useEconomyStore } from '../state/economyStore'
import { usePlayerStore } from '../state/playerStore'
import { useAbstractEconomyStore } from '../state/abstractEconomyStore'
import { useTerritoryStore } from '../state/territoryStore'
import { SimpleDistrictsTab } from './planet/SimplePlanetTabs'
import { SIMPLE_DISTRICTS, SIMPLE_DISTRICT_DEFS, type SimpleDistrictId } from '../data/simplisticEconomyData'
import { getCountry } from '../data/countryData'

type PanelId = 'buildings' | 'politics' | 'diplomacy'

interface PanelDef {
  id: PanelId
  title: string
  icon: string
  // Map mode this panel's icon switches the system view to while it's open
  // (see mapModeColor.ts) — reset to 'none' when the panel closes.
  mapMode: MapMode
  subtabs?: string[]
}

// Diplomacy shares the 'political' map mode with Politics rather than
// getting its own — both are fundamentally "who controls what" views, and
// there's no separate diplomatic-standing data to visualize yet that would
// justify a distinct overlay.
// Simple mode's Buildings lens shows Simple's own districts (its buildings are
// not Complex mode's recipes): one tab per district, plus All.
const SIMPLE_TAB_ALL = 'All'
const simpleTabName = (d: SimpleDistrictId) => SIMPLE_DISTRICT_DEFS[d].name.replace(' District', '')
const SIMPLE_SUBTABS = [SIMPLE_TAB_ALL, ...SIMPLE_DISTRICTS.map(simpleTabName)]

const PANELS: PanelDef[] = [
  { id: 'buildings', title: 'Buildings', icon: '⚙', mapMode: 'gdp', subtabs: ['Development', 'Agriculture', 'Resources', 'Industry', 'Services'] },
  { id: 'politics', title: 'Politics', icon: '⚖', mapMode: 'political', subtabs: ['Decrees', 'Government Actions'] },
  { id: 'diplomacy', title: 'Diplomacy', icon: '⚑', mapMode: 'political', subtabs: ['Diplomatic Actions', 'Diplomatic Demands'] },
]

// Bottom-center quick-action bar — each icon opens a category panel AND
// switches the system view's map mode for as long as that panel is open
// (see mapModeStore/mapModeColor.ts), same dual behavior Victoria 3's
// construction/politics/diplomacy buttons have. The panel itself docks to
// the bottom of the screen (between the nav sidebar and the outliner,
// sitting right above this bar) with a row of category tabs across the top,
// the same "slides up, tabbed" shape Victoria 3's build menu uses — rather
// than a small floating window. Closing the panel (or picking another icon)
// returns the map to its normal per-planet colors.
export function ActionBar() {
  const [activePanelId, setActivePanelId] = useState<PanelId | null>(null)
  const [activeSubtab, setActiveSubtab] = useState<string | null>(null)
  // A world the player has pinned via the dock's planet switcher. Null = follow
  // the in-scene focus (the default). Lets you switch planets straight from the
  // panel instead of hunting for the body in the 3D view.
  const [overrideWorldName, setOverrideWorldName] = useState<string | null>(null)
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const setMapMode = useMapModeStore((s) => s.setMode)
  // The panels follow whatever planet the player is focused on (falls back to
  // the capital when nothing is in focus) — look at Luna and it's about Luna,
  // not Mars.
  const context = useContextEconomy()
  const worlds = useEconomyStore((s) => s.worlds)
  const countries = useEconomyStore((s) => s.countries)
  const playerCountryId = usePlayerStore((s) => s.selectedCountryId)
  const sandbox = usePlayerStore((s) => s.sandbox)
  const simple = usePlayerStore((s) => s.economyModel) === 'abstract'
  const simpleWorlds = useAbstractEconomyStore((s) => s.worlds)
  const bodyOwner = useTerritoryStore((s) => s.bodyOwner)
  // Every inhabited world the player's nation owns — the switcher's options.
  const ownedNames = simple
    ? Object.values(simpleWorlds).filter((w) => bodyOwner[w.bodyName] === playerCountryId).sort((a, b) => b.population - a.population).map((w) => w.bodyName)
    : worlds.filter((w) => w.ownerId === playerCountryId).map((w) => w.name)

  // Resolve the world the panel is actually about: a pinned override wins,
  // otherwise the focus-following context.
  const overrideWorld = overrideWorldName ? worlds.find((w) => w.name === overrideWorldName) : undefined
  const scopeWorld = overrideWorld ?? context.world
  const capital = playerCountryId ? getCountry(playerCountryId)?.capitalBodyName : undefined
  const scopeName = simple
    ? overrideWorldName ?? (context.worldName && simpleWorlds[context.worldName] ? context.worldName : capital && simpleWorlds[capital] ? capital : ownedNames[0])
    : overrideWorld?.name ?? context.worldName
  const scopeCountry = overrideWorld ? countries.find((c) => c.id === overrideWorld.ownerId) : context.country

  const activePanel = PANELS.find((p) => p.id === activePanelId) ?? null

  const subtabsOf = (panel: PanelDef) => (simple && panel.id === 'buildings' ? SIMPLE_SUBTABS : panel.subtabs)
  const simpleDistrict = SIMPLE_DISTRICTS.find((d) => simpleTabName(d) === activeSubtab)

  // The sandbox has no economy, politics or diplomacy to open.
  if (sandbox) return null

  const handleClick = (panel: PanelDef) => {
    if (activePanelId === panel.id) {
      setActivePanelId(null)
      setActiveSubtab(null)
      setMapMode('none')
      return
    }
    setActivePanelId(panel.id)
    setActiveSubtab(subtabsOf(panel)?.[0] ?? null)
    setMapMode(panel.mapMode)
  }

  const handleClose = () => {
    setActivePanelId(null)
    setActiveSubtab(null)
    setMapMode('none')
  }

  return (
    <>
      {activePanel && (
        <div className="action-dock-panel">
          <div className="action-dock-header">
            <span className="action-dock-title-wrap">
              {activePanel.title}
              {ownedNames.length > 0 && (
                <span className="action-dock-switcher">
                  <button
                    type="button"
                    className="action-dock-scope-btn"
                    onClick={() => setSwitcherOpen((o) => !o)}
                    title="Switch planet"
                  >
                    · {scopeName ?? 'Select planet'} <span className="action-dock-caret">▾</span>
                  </button>
                  {switcherOpen && (
                    <div className="action-dock-scope-menu">
                      {overrideWorldName && (
                        <button
                          type="button"
                          className="action-dock-scope-item action-dock-scope-follow"
                          onClick={() => {
                            setOverrideWorldName(null)
                            setSwitcherOpen(false)
                          }}
                        >
                          ↺ Follow selection
                        </button>
                      )}
                      {ownedNames.map((name) => (
                        <button
                          key={name}
                          type="button"
                          className={`action-dock-scope-item${name === scopeName ? ' active' : ''}`}
                          onClick={() => {
                            setOverrideWorldName(name)
                            setSwitcherOpen(false)
                          }}
                        >
                          {name}
                        </button>
                      ))}
                    </div>
                  )}
                </span>
              )}
            </span>
            <button type="button" className="action-dock-close" onClick={handleClose} aria-label="Close">
              ×
            </button>
          </div>
          {subtabsOf(activePanel) && (
            <div className="action-dock-tabs">
              {subtabsOf(activePanel)!.map((sub) => (
                <button
                  key={sub}
                  type="button"
                  className={`action-dock-tab${activeSubtab === sub ? ' active' : ''}`}
                  onClick={() => setActiveSubtab(sub)}
                >
                  {sub}
                </button>
              ))}
            </div>
          )}
          <div className="action-dock-content">
            {activePanel.id === 'buildings' && simple ? (
              scopeName ? <SimpleDistrictsTab key={`${scopeName}-${activeSubtab}`} countryId={playerCountryId} bodyName={scopeName} only={simpleDistrict} /> : <div className="nav-placeholder">No world selected</div>
            ) : activePanel.id === 'buildings' ? (
              <BuildingsPanel subtab={activeSubtab} worldName={scopeName} world={scopeWorld} country={scopeCountry} />
            ) : (
              <div className="nav-placeholder">Not yet available</div>
            )}
          </div>
        </div>
      )}

      <div className="map-action-bar">
        {PANELS.map((panel) => (
          <button
            key={panel.id}
            type="button"
            className={`map-action-btn${activePanelId === panel.id ? ' active' : ''}`}
            onClick={() => handleClick(panel)}
            aria-label={panel.title}
            title={panel.title}
          >
            {panel.icon}
          </button>
        ))}
      </div>
    </>
  )
}
