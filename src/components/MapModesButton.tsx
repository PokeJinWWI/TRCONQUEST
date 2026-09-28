import { useEffect, useRef, useState } from 'react'
import { useMapModeStore, MAP_MODE_LABELS, type MapMode } from '../state/mapModeStore'

const MAP_MODES: MapMode[] = ['none', 'gdp', 'political']

// Map Modes, bottom-right of the bottom bar: what the map's colours show, and
// whether borders carry nation names. A button that opens a small menu upwards.
export function MapModesButton() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const mode = useMapModeStore((s) => s.mode)
  const setMode = useMapModeStore((s) => s.setMode)
  const showNames = useMapModeStore((s) => s.showNationNames)
  const setShowNames = useMapModeStore((s) => s.setShowNationNames)

  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => {
      if (e.target instanceof Node && ref.current?.contains(e.target)) return
      setOpen(false)
    }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', close, true)
    document.addEventListener('keydown', key, true)
    return () => {
      document.removeEventListener('pointerdown', close, true)
      document.removeEventListener('keydown', key, true)
    }
  }, [open])

  return (
    <div className="map-modes" ref={ref}>
      <button type="button" className={`map-modes-btn${open ? ' active' : ''}`} onClick={() => setOpen((o) => !o)} title="Map modes — what the map's colours show">
        Map Modes{mode !== 'none' ? `: ${MAP_MODE_LABELS[mode]}` : ''}
      </button>
      {open && (
        <div className="map-modes-menu">
          <div className="map-modes-title">Colour the map by</div>
          {MAP_MODES.map((m) => (
            <button
              key={m}
              type="button"
              className={`nav-subtab${mode === m ? ' active' : ''}`}
              onClick={() => setMode(m)}
              title={`Colour the map by ${MAP_MODE_LABELS[m].toLowerCase()}`}
            >
              {MAP_MODE_LABELS[m]}
            </button>
          ))}
          <label className="map-modes-check" title="Write nation names over borders. Off, hover a border to see who owns it.">
            <input type="checkbox" checked={showNames} onChange={(e) => setShowNames(e.target.checked)} />
            Border &amp; nation names
          </label>
        </div>
      )}
    </div>
  )
}
