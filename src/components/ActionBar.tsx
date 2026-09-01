import { useState } from 'react'
import { DraggableWindow } from './DraggableWindow'
import { useMapModeStore, type MapMode } from '../state/mapModeStore'

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
  { id: 'buildings', title: 'Buildings', icon: '⚙', mapMode: 'gdp' },
  { id: 'politics', title: 'Politics', icon: '⚖', mapMode: 'political', subtabs: ['Decrees', 'Government Actions'] },
  { id: 'diplomacy', title: 'Diplomacy', icon: '⚑', mapMode: 'political', subtabs: ['Diplomatic Actions', 'Diplomatic Demands'] },
]

// Bottom-center quick-action bar — each icon opens a category panel AND
// switches the system view's map mode for as long as that panel is open
// (see mapModeStore/mapModeColor.ts), same dual behavior Victoria 3's
// construction/politics buttons have. Closing the panel (or picking another
// icon) returns the map to its normal per-planet colors.
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

      {activePanel && (
        <DraggableWindow title={activePanel.title} onClose={handleClose} initialOffset={{ x: 0, y: -180 }}>
          {activePanel.subtabs && (
            <div className="nav-subtabs">
              {activePanel.subtabs.map((sub) => (
                <button
                  key={sub}
                  type="button"
                  className={`nav-subtab${activeSubtab === sub ? ' active' : ''}`}
                  onClick={() => setActiveSubtab(sub)}
                >
                  {sub}
                </button>
              ))}
            </div>
          )}
          <div className="nav-placeholder">Not yet available</div>
        </DraggableWindow>
      )}
    </>
  )
}
