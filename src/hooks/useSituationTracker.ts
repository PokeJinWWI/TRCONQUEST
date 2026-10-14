import { useEffect } from 'react'
import { buildSituationSnapshot } from '../scene/situationSnapshot'
import { lineId, newPauseLines, prunedSnoozes, situationsFor, type SituationLine } from '../scene/situations'
import { useSituationStore } from '../state/situationStore'
import { useSituationSnoozeStore } from '../state/situationSnoozeStore'
import { useSituationPrefsStore } from '../state/situationPrefsStore'
import { useGameTimeStore } from '../state/gameTimeStore'
import { usePlayerStore } from '../state/playerStore'
import { useArmyStore } from '../state/armyStore'
import { useTechStore } from '../state/techStore'
import { useDepositStore } from '../state/depositStore'
import { useTerritoryStore } from '../state/territoryStore'
import { ARMY_KINDS } from '../data/armyData'
import { notifyOwner } from '../scene/notify'

const idsOf = (lines: readonly SituationLine[]) => lines.map((l) => `${lineId(l)}=${l.text}`).join('\n')

// Rebuilds the Situations lines (state/situationStore.ts) from the game. Runs once per sim day
// and when the player or game changes, never per frame; writes only when something changed.
// A NEW line of a type the player pauses on pauses the game.
export function refreshSituations(): void {
  const snap = buildSituationSnapshot()
  const next = snap ? situationsFor(snap) : []
  const store = useSituationStore.getState()
  const prev = store.lines
  const owner = snap?.playerId ?? null
  const primed = !!owner && store.primedFor === owner
  if (primed && idsOf(next) === idsOf(prev)) return
  const snooze = useSituationSnoozeStore.getState()
  const kept = prunedSnoozes(snooze.snoozed, next)
  if (kept.length !== snooze.snoozed.length) snooze.setSnoozed(kept)
  const alarms = !primed ? [] : newPauseLines(prev, next, useSituationPrefsStore.getState(), new Set(kept))
  store.setLines(next, owner)
  if (alarms.length > 0) {
    store.raiseAlarm()
    useGameTimeStore.setState({ paused: true })
  }
}

// Notifications for changes no resolver announces itself: an army finished recruiting, the
// research queue ran out, a deposit ran dry. Watches the stores; the player's own only.
export function watchForNotifications(): () => void {
  const player = () => usePlayerStore.getState().selectedCountryId
  return [
    useArmyStore.subscribe((state, prev) => {
      const pid = player()
      if (!pid || state.armies === prev.armies) return
      const was = new Map(prev.armies.map((a) => [a.id, a.location.kind]))
      for (const a of state.armies) {
        if (a.ownerId !== pid || was.get(a.id) !== 'recruiting' || a.location.kind !== 'body') continue
        notifyOwner(pid, 'army-ready', `A new ${ARMY_KINDS[a.kind]?.name ?? a.kind} army is ready on ${a.location.bodyName}`, { bodyName: a.location.bodyName })
      }
    }),
    useTechStore.subscribe((state, prev) => {
      const pid = player()
      if (!pid || usePlayerStore.getState().economyModel !== 'abstract') return
      const before = prev.byCountry[pid]?.queue?.length ?? 0
      const now = state.byCountry[pid]?.queue?.length ?? 0
      if (before > 0 && now === 0) notifyOwner(pid, 'research-queue-empty', 'The research queue is empty', { nav: { category: 'Technology', subcategory: 'Physics' } })
    }),
    useDepositStore.subscribe((state, prev) => {
      const pid = player()
      if (!pid || state.remaining === prev.remaining) return
      const owners = useTerritoryStore.getState().bodyOwner
      for (const [material, table] of Object.entries(state.remaining)) {
        const old = (prev.remaining as Record<string, Record<string, number>>)[material] ?? {}
        for (const [bodyName, left] of Object.entries(table as Record<string, number>)) {
          if (left <= 0 && (old[bodyName] ?? 0) > 0 && owners[bodyName] === pid) {
            notifyOwner(pid, 'deposit-exhausted', `${bodyName}'s ${material === 'exoticMatter' ? 'exotic matter' : material} deposit is exhausted`, { bodyName })
          }
        }
      }
    }),
  ].reduce((all, u) => () => (all(), u()), () => {})
}

export function useSituationTracker() {
  useEffect(() => watchForNotifications(), [])
  useEffect(() => {
    refreshSituations()
    const unsubs = [
      useGameTimeStore.subscribe((state, prev) => {
        if (Math.floor(state.simDays) !== Math.floor(prev.simDays)) refreshSituations()
      }),
      usePlayerStore.subscribe(refreshSituations),
    ]
    return () => unsubs.forEach((u) => u())
  }, [])
}
