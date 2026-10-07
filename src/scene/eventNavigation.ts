// Where a notification (a diplomacy event) takes the player when clicked, and
// the notifications' own clock. Pure where it can be (eventDestination,
// tickToasts); goToEvent applies a destination to the view store.
import type { DiplomacyEvent } from '../data/diplomacyData'
import { useViewStore } from '../state/viewStore'
import { bodyInfoOf } from './territory'
import { findStar } from '../data/starData'
import { NEIGHBORHOODS } from '../data/neighborhoodData'

export type EventDestination =
  // A body: its planet panel in the system view (a moon's in its planet's satellite view).
  | { kind: 'body'; starId: string; bodyName: string; parentPlanet?: string }
  // A star system.
  | { kind: 'system'; starId: string }
  // A cluster, in the galactic view.
  | { kind: 'galaxy'; neighborhoodId: string }
  // A Diplomacy panel tab.
  | { kind: 'panel'; category: string; subcategory: string }

export function eventDestination(event: Pick<DiplomacyEvent, 'kind' | 'place'>): EventDestination {
  if (event.place?.nav) return { kind: 'panel', category: event.place.nav.category, subcategory: event.place.nav.subcategory }
  const body = event.place?.bodyName ? bodyInfoOf(event.place.bodyName) : undefined
  if (body) return { kind: 'body', starId: body.starId, bodyName: body.name, ...(body.kind === 'moon' && body.parentPlanet ? { parentPlanet: body.parentPlanet } : {}) }
  if (event.place?.neighborhoodId && NEIGHBORHOODS.some((n) => n.id === event.place!.neighborhoodId)) return { kind: 'galaxy', neighborhoodId: event.place.neighborhoodId }
  if (event.place?.starId && !!findStar(event.place.starId)) return { kind: 'system', starId: event.place.starId }
  switch (event.kind) {
    case 'war-declared':
    case 'peace-offered':
    case 'peace-signed':
    case 'peace-rejected':
      return { kind: 'panel', category: 'Diplomacy', subcategory: 'Wars' }
    case 'treaty-signed':
    case 'treaty-broken':
      return { kind: 'panel', category: 'Diplomacy', subcategory: 'Treaties' }
    default:
      return { kind: 'panel', category: 'Diplomacy', subcategory: 'Events' }
  }
}

// Open a world: its system view with its panel showing (a moon: in its
// planet's satellite view).
export function goToBody(bodyName: string): void {
  useViewStore.getState().setNavCategory(null, null)
  goToEvent({ kind: 'holding', place: { bodyName } })
}

export function goToEvent(event: Pick<DiplomacyEvent, 'kind' | 'place'>): void {
  const to = eventDestination(event)
  const view = useViewStore.getState()
  if (to.kind === 'panel') {
    view.setNavCategory(to.category, to.subcategory)
    return
  }
  if (to.kind === 'system') {
    view.enterSystem(to.starId)
    return
  }
  if (to.kind === 'galaxy') {
    view.enterGalactic()
    view.selectInView(to.neighborhoodId)
    return
  }
  if (to.parentPlanet) {
    useViewStore.setState({ level: 'satellite', selectedStarId: to.starId, selectedBodyName: to.parentPlanet, inViewSelection: to.bodyName })
    return
  }
  view.enterSystem(to.starId, to.bodyName)
}

// Notifications stay up for a fixed stretch of REAL time, whatever the game
// speed, but only while the game runs: paused, their clocks stand still.
export const TOAST_MS = 7000

export interface Toast {
  id: string
  remainingMs: number
}

// Advances every notification's clock by `elapsedMs` (unless paused) and drops
// the ones that ran out.
export function tickToasts<T extends Toast>(toasts: T[], elapsedMs: number, paused: boolean): T[] {
  if (paused || toasts.length === 0) return toasts
  return toasts.map((t) => ({ ...t, remainingMs: t.remainingMs - elapsedMs })).filter((t) => t.remainingMs > 0)
}
