import { useState } from 'react'
import { useMapModeStore, type MapMode } from '../state/mapModeStore'
import { BuildingsPanel } from './BuildingsPanel'

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
  { id: 'buildings', title: 'Buildings', icon: '⚙', mapMode: 'gdp', subtabs: ['Development', 'Agriculture', 'Resources', 'Urban'] },
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
  const setMapMode = useMapModeStore((s) => s.setMode)

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
            <span>{activePanel.title}</span>
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
              <BuildingsPanel subtab={activeSubtab} />
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
