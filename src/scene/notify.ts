// Operational notifications (a ship built, a survey done, a battle won...): raised only for the
// player's own nation, so the other nations' routine work never floods the event log. Big news
// between nations still goes through diplomacyStore.pushEvent directly.
import type { DiplomacyEventKind, EventPlace } from '../data/diplomacyData'
import { useDiplomacyStore } from '../state/diplomacyStore'
import { usePlayerStore } from '../state/playerStore'
import { useGameTimeStore } from '../state/gameTimeStore'

export function notifyOwner(ownerId: string, kind: DiplomacyEventKind, text: string, place?: EventPlace, simDays = useGameTimeStore.getState().simDays): void {
  const player = usePlayerStore.getState()
  if (player.sandbox || !player.selectedCountryId || player.selectedCountryId !== ownerId) return
  useDiplomacyStore.getState().pushEvent(kind, [ownerId], text, simDays, place)
}
