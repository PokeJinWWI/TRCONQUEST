import { useEffect, useMemo, useState } from 'react'
import { visibleLines, worstSeverity } from '../scene/situations'
import { useSituationStore } from '../state/situationStore'
import { useSituationSnoozeStore } from '../state/situationSnoozeStore'
import { useSituationPrefsStore } from '../state/situationPrefsStore'
import { useViewStore } from '../state/viewStore'
import { usePlayerStore } from '../state/playerStore'
import { SITUATIONS_CATEGORY } from './NavBar'

const ALARM_FLASH_MS = 2400

// The top bar's alert count (Victoria 3's "!" badge): how many Situations lines are showing,
// coloured by the worst; it flashes when a new alert paused the game. Click opens Situations.
export function SituationBadge() {
  const lines = useSituationStore((s) => s.lines)
  const alarmAt = useSituationStore((s) => s.alarmAt)
  const hidden = useSituationPrefsStore((s) => s.hidden)
  const snoozedList = useSituationSnoozeStore((s) => s.snoozed)
  const sandbox = usePlayerStore((s) => s.sandbox)
  const shown = useMemo(() => visibleLines(lines, { hidden }, new Set(snoozedList)), [lines, hidden, snoozedList])
  const [flashing, setFlashing] = useState(false)
  useEffect(() => {
    if (!alarmAt) return
    setFlashing(true)
    const t = setTimeout(() => setFlashing(false), ALARM_FLASH_MS)
    return () => clearTimeout(t)
  }, [alarmAt])
  if (sandbox) return null
  const worst = worstSeverity(shown) ?? 'none'
  const open = () => {
    const view = useViewStore.getState()
    if (view.activeNavCategory === SITUATIONS_CATEGORY) view.setNavCategory(null, null)
    else view.setNavCategory(SITUATIONS_CATEGORY, null)
  }
  return (
    <button type="button" className={`situation-badge sev-${worst}${flashing ? ' flashing' : ''}`} onClick={open} title={`${shown.length} situation${shown.length === 1 ? '' : 's'} need attention: click to see them`}>
      <span className="situation-badge-icon">!</span>
      <span className="situation-badge-count">{shown.length}</span>
    </button>
  )
}
