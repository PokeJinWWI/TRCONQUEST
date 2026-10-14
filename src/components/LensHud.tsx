import { Bi } from './Bi'
import { useEffect } from 'react'
import { useLensStore } from '../state/lensStore'

// The build lens's readout on the ground map: the tool in hand, what the pointer would do with it (and why not), the last click's
// outcome, and the brush size for painting. Esc puts the tool down.
export function LensHud() {
  const armed = useLensStore((s) => s.armed)
  const hover = useLensStore((s) => s.hover)
  const message = useLensStore((s) => s.message)
  const brush = useLensStore((s) => s.brush)
  const zoneSiteId = useLensStore((s) => s.zoneSiteId)
  const routeFrom = useLensStore((s) => s.routeFrom)

  // Esc puts the tool down instead of opening the menu (captured before the menu's own handler sees it).
  useEffect(() => {
    if (!armed) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopImmediatePropagation()
      e.preventDefault()
      useLensStore.getState().arm(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [armed])

  if (!armed) return null
  const painting = armed.kind === 'zone' || armed.kind === 'reserve'
  return (
    <div className="lens-hud" role="status">
      <div className="lens-hud-top">
        <span className="lens-hud-tool">⚙ {armed.name}</span>
        {armed.kind === 'zone' && <span className="abs-dim">{zoneSiteId ? 'painting a zone' : 'pick a district'}</span>}
        {armed.kind === 'route' && <span className="abs-dim">{routeFrom ? 'pick the other end' : 'pick the first end'}</span>}
        <button type="button" className="detail-view-btn" onClick={() => useLensStore.getState().arm(null)} title="Put the tool down (Esc)">
          <Bi en="Done" />
        </button>
      </div>
      {hover && <div className={`lens-hud-line ${hover.ok ? 'ok' : 'bad'}`}>{hover.text}</div>}
      {message && <div className={`lens-hud-line ${message.ok ? 'ok' : 'bad'}`}>{message.text}</div>}
      {painting && (
        <div className="lens-hud-brush">
          Brush
          <button type="button" className="detail-view-btn" onClick={() => useLensStore.getState().setBrush(brush - 1)} disabled={brush <= 0} title="Smaller brush">
            −
          </button>
          <span>{brush}</span>
          <button type="button" className="detail-view-btn" onClick={() => useLensStore.getState().setBrush(brush + 1)} disabled={brush >= 6} title="Bigger brush">
            +
          </button>
          <span className="abs-dim">left-click adds, right-click takes away</span>
        </div>
      )}
      {!painting && armed.kind !== 'route' && <div className="abs-dim">Left-click to place · right-click to cancel or take down · Esc to put it down</div>}
    </div>
  )
}
