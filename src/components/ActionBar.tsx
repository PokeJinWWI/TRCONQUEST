import { useState } from 'react'
import { useMapModeStore, type MapMode } from '../state/mapModeStore'
import { BuildingsPanel } from './BuildingsPanel'
import { useContextEconomy } from '../hooks/useContextEconomy'
import { useEconomyStore } from '../state/economyStore'
import { usePlayerStore } from '../state/playerStore'

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
  // Every inhabited world the player's nation owns — the switcher's options.
  const ownedWorlds = worlds.filter((w) => w.ownerId === playerCountryId)

  // Resolve the world the panel is actually about: a pinned override wins,
  // otherwise the focus-following context.
  const overrideWorld = overrideWorldName ? worlds.find((w) => w.name === overrideWorldName) : undefined
  const scopeWorld = overrideWorld ?? context.world
  const scopeName = overrideWorld?.name ?? context.worldName
  const scopeCountry = overrideWorld ? countries.find((c) => c.id === overrideWorld.ownerId) : context.country

  const activePanel = PANELS.find((p) => p.id === activePanelId) ?? null

  const handleClick = (panel: PanelDef) => {
    if (activePanelId === panel.id) {
      setActivePanelId(null)
      setActiveSubtab(null)
      setMapMode('none')
      return
    }
    setActivePanelId(panel.id)
    setActiveSubtab(panel.subtabs?.[0] ?? null)
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
              {ownedWorlds.length > 0 && (
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
                      {ownedWorlds.map((w) => (
                        <button
                          key={w.id}
                          type="button"
                          className={`action-dock-scope-item${w.name === scopeName ? ' active' : ''}`}
                          onClick={() => {
                            setOverrideWorldName(w.name)
                            setSwitcherOpen(false)
                          }}
                        >
                          {w.name}
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
          {activePanel.subtabs && (
            <div className="action-dock-tabs">
              {activePanel.subtabs.map((sub) => (
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
            {activePanel.id === 'buildings' ? (
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
