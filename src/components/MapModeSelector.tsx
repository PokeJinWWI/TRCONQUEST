import { useMapModeStore, MAP_MODE_LABELS, type MapMode } from '../state/mapModeStore'

const MAP_MODES: MapMode[] = ['none', 'gdp', 'political']

// The left-sidebar's direct entry point into the same map modes the bottom
// ActionBar's icons switch to as a side effect (see mapModeColor.ts) —
// picking one here works exactly the same way, and doesn't reset when this
// window closes (unlike ActionBar's panels, which are tied to a specific
// action). Real, not a placeholder: only 'GDP' and 'Political' exist right
// now, but both actually recolor the system view.
export function MapModeSelector() {
  const mode = useMapModeStore((s) => s.mode)
  const setMode = useMapModeStore((s) => s.setMode)

  return (
    <div className="nav-subtabs">
      {MAP_MODES.map((m) => (
        <button
          key={m}
          type="button"
          className={`nav-subtab${mode === m ? ' active' : ''}`}
          onClick={() => setMode(m)}
        >
          {MAP_MODE_LABELS[m]}
        </button>
      ))}
    </div>
  )
}
