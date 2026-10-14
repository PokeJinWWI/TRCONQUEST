import { Bi } from './Bi'
import { useMemo, useState } from 'react'
import { ALERT_TYPES, ALERT_TYPE_BY_ID, SITUATION_GROUPS, lineId, pausesOn, visibleLines, type AlertType, type SituationLine } from '../scene/situations'
import { runSituationAction } from '../scene/situationNav'
import { eventReachesPlayer } from '../scene/notificationFilter'
import { goToEvent } from '../scene/eventNavigation'
import { useSituationStore } from '../state/situationStore'
import { useSituationSnoozeStore } from '../state/situationSnoozeStore'
import { useSituationPrefsStore, type ToastFilter } from '../state/situationPrefsStore'
import { useDiplomacyStore } from '../state/diplomacyStore'
import { usePlayerStore } from '../state/playerStore'
import { formatDate, simDaysToDate } from '../state/gameTimeStore'

const TOAST_FILTER_LABELS: Record<ToastFilter, string> = {
  relevant: 'Mine + world news',
  mine: 'Only mine',
  all: 'Everything',
}

const RECENT_LIMIT = 80

// Victoria 3's "Current Situation": every problem worth acting on, grouped by kind with a count,
// each line clickable (goes there), right-click to snooze it. The lines come from
// scene/situations.ts via state/situationStore.ts; nothing here decides what is a problem.
export function SituationsPanel() {
  const [tab, setTab] = useState<'current' | 'recent'>('current')
  const [editing, setEditing] = useState(false)
  return (
    <div className="situations">
      <div className="situations-tabs">
        <button type="button" className={`combat-density-btn${tab === 'current' ? ' active' : ''}`} onClick={() => setTab('current')}>
          Current situation
        </button>
        <button type="button" className={`combat-density-btn${tab === 'recent' ? ' active' : ''}`} onClick={() => setTab('recent')}>
          Recent
        </button>
        {tab === 'current' && (
          <button type="button" className={`combat-density-btn situations-edit${editing ? ' active' : ''}`} onClick={() => setEditing(!editing)} title="Choose which alerts show and which pause the game">
            {editing ? 'Done' : 'Edit'}
          </button>
        )}
      </div>
      {tab === 'current' ? editing ? <SituationEditor /> : <CurrentSituation /> : <RecentNotifications />}
    </div>
  )
}

function CurrentSituation() {
  const lines = useSituationStore((s) => s.lines)
  const hidden = useSituationPrefsStore((s) => s.hidden)
  const snoozedList = useSituationSnoozeStore((s) => s.snoozed)
  const snoozed = useMemo(() => new Set(snoozedList), [snoozedList])
  const shown = useMemo(() => visibleLines(lines, { hidden }, snoozed), [lines, hidden, snoozed])
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const toggle = (id: string) =>
    setCollapsed((c) => {
      const next = new Set(c)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const hiddenCount = ALERT_TYPES.filter((t) => hidden[t.id]).length
  const snoozedHere = lines.filter((l) => snoozed.has(lineId(l))).length

  const byType = new Map<string, SituationLine[]>()
  for (const l of shown) byType.set(l.typeId, [...(byType.get(l.typeId) ?? []), l])

  return (
    <div className="situations-current">
      {shown.length === 0 && <div className="abs-dim situations-empty">Nothing needs your attention.</div>}
      {SITUATION_GROUPS.map((g) => {
        const types = ALERT_TYPES.filter((t) => t.group === g.id && byType.has(t.id))
        if (types.length === 0) return null
        return (
          <div key={g.id} className="situations-group">
            <div className="econ-subtitle">
              <Bi en={g.label} />
            </div>
            {types.map((t) => (
              <AlertTypeBlock key={t.id} type={t} lines={byType.get(t.id) ?? []} open={!collapsed.has(t.id)} onToggle={() => toggle(t.id)} />
            ))}
          </div>
        )
      })}
      {(hiddenCount > 0 || snoozedHere > 0) && (
        <div className="situations-footer abs-dim">
          {hiddenCount > 0 && (
            <span>
              {hiddenCount} alert type{hiddenCount === 1 ? '' : 's'} hidden ·{' '}
              <button type="button" className="situations-link" onClick={() => useSituationPrefsStore.getState().showAll()}>
                show all
              </button>
            </span>
          )}
          {snoozedHere > 0 && (
            <span>
              {snoozedHere} snoozed ·{' '}
              <button type="button" className="situations-link" onClick={() => useSituationSnoozeStore.getState().setSnoozed([])}>
                wake all
              </button>
            </span>
          )}
        </div>
      )}
    </div>
  )
}

function AlertTypeBlock({ type, lines, open, onToggle }: { type: AlertType; lines: SituationLine[]; open: boolean; onToggle: () => void }) {
  const pause = useSituationPrefsStore((s) => pausesOn(type.id, s))
  return (
    <div className={`situations-type sev-${type.severity}`}>
      <div className="situations-type-head">
        <button type="button" className="situations-type-toggle" onClick={onToggle} title={open ? 'Collapse' : 'Expand'}>
          <span className="situations-caret">{open ? '▾' : '▸'}</span>
          <span className="situations-type-label">
            <Bi en={type.label} />
          </span>
          <span className="situations-count">{lines.length}</span>
        </button>
        <button
          type="button"
          className={`situations-icon${pause ? ' on' : ''}`}
          title={pause ? 'Pauses the game when a new one appears (click to stop)' : 'Pause the game when a new one appears'}
          onClick={() => useSituationPrefsStore.getState().setPause(type.id, !pause)}
        >
          ⏸
        </button>
        <button type="button" className="situations-icon" title="Hide this kind of alert (Edit brings it back)" onClick={() => useSituationPrefsStore.getState().setHidden(type.id, true)}>
          ✕
        </button>
      </div>
      {open && (
        <ul className="situations-lines">
          {lines.map((l) => (
            <li
              key={lineId(l)}
              className={`situations-line${l.action ? ' clickable' : ''}`}
              title={`${l.text}${l.action ? '\nClick to go there' : ''}\nRight-click to snooze until it clears`}
              onClick={() => l.action && runSituationAction(l.action)}
              onContextMenu={(e) => {
                e.preventDefault()
                useSituationSnoozeStore.getState().snooze(lineId(l))
              }}
            >
              <span className="situations-line-text">{l.text}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function SituationEditor() {
  const hidden = useSituationPrefsStore((s) => s.hidden)
  const pause = useSituationPrefsStore((s) => s.pause)
  const toastFilter = useSituationPrefsStore((s) => s.toastFilter)
  const prefs = useSituationPrefsStore.getState()
  return (
    <div className="situations-editor">
      <div className="inspect-row">
        <span className="inspect-label"><Bi en="Pop-up notifications" /></span>
        <span className="inspect-value combat-density-row">
          {(Object.keys(TOAST_FILTER_LABELS) as ToastFilter[]).map((f) => (
            <button key={f} type="button" className={`combat-density-btn${toastFilter === f ? ' active' : ''}`} onClick={() => prefs.setToastFilter(f)}>
              {TOAST_FILTER_LABELS[f]}
            </button>
          ))}
        </span>
      </div>
      {SITUATION_GROUPS.map((g) => (
        <div key={g.id} className="situations-group">
          <div className="econ-subtitle">
              <Bi en={g.label} />
            </div>
          <div className="situations-edit-head abs-dim">
            <span><Bi en="Alert" /></span>
            <span><Bi en="Show" /></span>
            <span><Bi en="Pause" /></span>
          </div>
          {ALERT_TYPES.filter((t) => t.group === g.id).map((t) => (
            <label key={t.id} className={`situations-edit-row sev-${t.severity}`}>
              <span className="situations-type-label">
                <Bi en={t.label} />
              </span>
              <input type="checkbox" checked={!hidden[t.id]} onChange={(e) => prefs.setHidden(t.id, !e.target.checked)} />
              <input type="checkbox" checked={pause[t.id] ?? ALERT_TYPE_BY_ID[t.id]!.pauseByDefault} onChange={(e) => prefs.setPause(t.id, e.target.checked)} />
            </label>
          ))}
        </div>
      ))}
    </div>
  )
}

function RecentNotifications() {
  const events = useDiplomacyStore((s) => s.events)
  const playerId = usePlayerStore((s) => s.selectedCountryId)
  const filter = useSituationPrefsStore((s) => s.toastFilter)
  const shown = useMemo(() => events.filter((e) => eventReachesPlayer(e, playerId, filter)).slice(-RECENT_LIMIT).reverse(), [events, playerId, filter])
  if (shown.length === 0) return <div className="abs-dim situations-empty">No notifications yet.</div>
  return (
    <ul className="situations-lines situations-recent">
      {shown.map((e) => (
        <li key={e.id} className="situations-line clickable" onClick={() => goToEvent(e)} title="Click to go there">
          <span className="situations-date abs-dim">{formatDate(simDaysToDate(e.simDays))}</span>
          <span className="situations-line-text">{e.text}</span>
        </li>
      ))}
    </ul>
  )
}
