import { LINE_THICKNESS_LABELS, LINE_THICKNESS_OPTIONS, useSettingsStore } from '../state/settingsStore'

// Player display preferences — reachable from the NavBar's own "Settings"
// category, same DraggableWindow treatment as every other nav panel. Only
// one control exists so far (route-line thickness); more display prefs
// belong here as they show up, rather than each growing its own nav entry.
export function SettingsPanel() {
  const navigationLineThickness = useSettingsStore((s) => s.navigationLineThickness)
  const setNavigationLineThickness = useSettingsStore((s) => s.setNavigationLineThickness)

  return (
    <div className="inspect-row">
      <span className="inspect-label">Navigation Line Thickness</span>
      <span className="inspect-value combat-density-row">
        {LINE_THICKNESS_OPTIONS.map((option) => (
          <button
            key={option}
            type="button"
            className={`combat-density-btn${navigationLineThickness === option ? ' active' : ''}`}
            onClick={() => setNavigationLineThickness(option)}
          >
            {LINE_THICKNESS_LABELS[option]}
          </button>
        ))}
      </span>
    </div>
  )
}
