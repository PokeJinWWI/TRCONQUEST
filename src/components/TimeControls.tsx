import {
  formatClockTime,
  formatDate,
  simDaysToDate,
  speedMultipliersFor,
  useGameTimeStore,
  type TimeMode,
} from '../state/gameTimeStore'

const MODE_LABELS: Record<TimeMode, string> = {
  normal: 'STRAT',
  tactical: 'TAC',
}

export function TimeControls() {
  const simDays = useGameTimeStore((s) => s.simDays)
  const paused = useGameTimeStore((s) => s.paused)
  const speedIndex = useGameTimeStore((s) => s.speedIndex)
  const mode = useGameTimeStore((s) => s.mode)
  const togglePause = useGameTimeStore((s) => s.togglePause)
  const speedUp = useGameTimeStore((s) => s.speedUp)
  const slowDown = useGameTimeStore((s) => s.slowDown)
  const setMode = useGameTimeStore((s) => s.setMode)

  const date = simDaysToDate(simDays)
  const multipliers = speedMultipliersFor(mode)

  return (
    <div className="time-controls">
      {/* Tactical time advances the date so slowly it looks frozen (a whole
          in-game day takes 24 real minutes at 1x), so the wall clock is shown
          alongside it — otherwise the HUD gives no sign that time is moving
          at all during a battle. */}
      <span className="time-date">
        {formatDate(date)}
        {mode === 'tactical' && <span className="time-clock">{formatClockTime(simDays)}</span>}
      </span>
      <button
        type="button"
        className={`time-mode-btn${mode === 'tactical' ? ' tactical' : ''}`}
        onClick={() => setMode(mode === 'tactical' ? 'normal' : 'tactical')}
        title={
          mode === 'tactical'
            ? 'Tactical time — 1 second per second. Switch to strategic pace.'
            : 'Strategic time — 6 days per second. Switch to tactical pace for combat.'
        }
      >
        {MODE_LABELS[mode]}
      </button>
      <button
        type="button"
        className="time-btn"
        onClick={slowDown}
        disabled={paused || speedIndex === 0}
        aria-label="Slow down"
      >
        «
      </button>
      <button
        type="button"
        className={`time-btn time-pause${paused ? ' active' : ''}`}
        onClick={togglePause}
        aria-label={paused ? 'Play' : 'Pause'}
      >
        {paused ? '▶' : '❚❚'}
      </button>
      <button
        type="button"
        className="time-btn"
        onClick={speedUp}
        disabled={!paused && speedIndex === multipliers.length - 1}
        aria-label="Speed up"
      >
        »
      </button>
      <span className="speed-pips">
        {multipliers.map((_, i) => (
          <span key={i} className={`pip${!paused && i <= speedIndex ? ' filled' : ''}`} />
        ))}
      </span>
    </div>
  )
}
