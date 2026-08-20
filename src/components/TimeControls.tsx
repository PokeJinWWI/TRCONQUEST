import { SPEED_MULTIPLIERS, simDaysToDate, useGameTimeStore } from '../state/gameTimeStore'

const MONTHS = [
  'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
  'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC',
]

function formatDate(date: Date): string {
  const day = date.getUTCDate()
  const month = MONTHS[date.getUTCMonth()]
  const year = date.getUTCFullYear()
  return `${day} ${month} ${year}`
}

export function TimeControls() {
  const simDays = useGameTimeStore((s) => s.simDays)
  const paused = useGameTimeStore((s) => s.paused)
  const speedIndex = useGameTimeStore((s) => s.speedIndex)
  const togglePause = useGameTimeStore((s) => s.togglePause)
  const speedUp = useGameTimeStore((s) => s.speedUp)
  const slowDown = useGameTimeStore((s) => s.slowDown)

  const date = simDaysToDate(simDays)

  return (
    <div className="time-controls">
      <span className="time-date">{formatDate(date)}</span>
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
        disabled={!paused && speedIndex === SPEED_MULTIPLIERS.length - 1}
        aria-label="Speed up"
      >
        »
      </button>
      <span className="speed-pips">
        {SPEED_MULTIPLIERS.map((_, i) => (
          <span key={i} className={`pip${!paused && i <= speedIndex ? ' filled' : ''}`} />
        ))}
      </span>
    </div>
  )
}
