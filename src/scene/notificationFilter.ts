// Which notifications reach the player as pop-ups (and the Situations panel's Recent list).
// Pure. 'relevant' (the default): anything involving the player's nation, plus big world news
// between others (wars, peace, treaties); 'mine': only the player's own; 'all': every event.
import type { DiplomacyEvent, DiplomacyEventKind } from '../data/diplomacyData'
import type { ToastFilter } from '../state/situationPrefsStore'

export const WORLD_NEWS_KINDS: ReadonlySet<DiplomacyEventKind> = new Set<DiplomacyEventKind>(['war-declared', 'peace-signed', 'treaty-signed', 'treaty-broken', 'first-contact'])

export function eventReachesPlayer(event: Pick<DiplomacyEvent, 'kind' | 'countryIds'>, playerId: string | null, filter: ToastFilter): boolean {
  if (filter === 'all') return true
  const mine = !!playerId && event.countryIds.includes(playerId)
  if (mine) return true
  return filter === 'relevant' && WORLD_NEWS_KINDS.has(event.kind)
}
