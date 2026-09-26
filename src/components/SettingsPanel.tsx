import { LINE_THICKNESS_LABELS, LINE_THICKNESS_OPTIONS, useSettingsStore, type LineThickness } from '../state/settingsStore'

// Player display preferences — shown in the Escape menu (see EscapeMenu.tsx).
// More display prefs belong here as they show up, rather than each growing its
// own entry point.
function ThicknessRow({
  label,
  value,
  onChange,
}: {
  label: string
  value: LineThickness
  onChange: (thickness: LineThickness) => void
}) {
  return (
    <div className="inspect-row">
      <span className="inspect-label">{label}</span>
      <span className="inspect-value combat-density-row">
        {LINE_THICKNESS_OPTIONS.map((option) => (
          <button
            key={option}
            type="button"
            className={`combat-density-btn${value === option ? ' active' : ''}`}
            onClick={() => onChange(option)}
          >
            {LINE_THICKNESS_LABELS[option]}
          </button>
        ))}
      </span>
    </div>
  )
}

export function SettingsPanel() {
  const navigationLineThickness = useSettingsStore((s) => s.navigationLineThickness)
  const setNavigationLineThickness = useSettingsStore((s) => s.setNavigationLineThickness)
  const armyLineThickness = useSettingsStore((s) => s.armyLineThickness)
  const setArmyLineThickness = useSettingsStore((s) => s.setArmyLineThickness)

  return (
    <>
      <ThicknessRow label="Navigation Line Thickness" value={navigationLineThickness} onChange={setNavigationLineThickness} />
      <ThicknessRow label="Army Line Thickness" value={armyLineThickness} onChange={setArmyLineThickness} />
    </>
  )
}
