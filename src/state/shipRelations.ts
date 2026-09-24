// How a ship relates to a viewing nation — derived, never stored. See
// shipData.ShipRelation: a ship's owner nation plus that nation's diplomacy
// with the viewer is the whole story. Hostility between two SHIPS is just
// hostility between their owners (see shipsHostile).
import { useDiplomacyStore, atWar, warsKeyOf, type AtWarFn } from './diplomacyStore'
import { usePlayerStore } from './playerStore'
import type { ShipRelation } from '../data/shipData'
import { FRIENDLY_ROGUE_ID } from '../data/countryRoster'

export function relationOfOwner(ownerId: string, viewerId: string | null, atWarFn: AtWarFn = atWar): ShipRelation {
  if (viewerId && ownerId === viewerId) return 'own'
  if (viewerId && atWarFn(ownerId, viewerId)) return 'enemy'
  if (ownerId === FRIENDLY_ROGUE_ID) return 'allied'
  return 'neutral'
}

// Whether two ships would fight — exactly whether their nations are at war.
export function shipsHostile(a: { ownerId: string }, b: { ownerId: string }, atWarFn: AtWarFn = atWar): boolean {
  return atWarFn(a.ownerId, b.ownerId)
}

// The player's own nation, or null at the main menu.
export function playerCountryId(): string | null {
  return usePlayerStore.getState().selectedCountryId
}

// Whether the player owns (and therefore commands) this ship.
export function isPlayerOwned(ship: { ownerId: string }): boolean {
  const player = playerCountryId()
  return !!player && ship.ownerId === player
}

// React hook: the player's relation to a ship's owner, re-rendering when the
// player's nation or any war starts/ends. Subscribes to a string key rather
// than the relations object itself, per this project's selector convention.
export function useRelationTo(ownerId: string): ShipRelation {
  const viewer = usePlayerStore((s) => s.selectedCountryId)
  // Subscribed only so a war starting/ending re-renders the caller.
  useDiplomacyStore((s) => warsKeyOf(s.wars))
  return relationOfOwner(ownerId, viewer)
}

// A string that changes exactly when any ship's relation to the player could
// change (the player's nation, or any war starting/ending) — for useMemo deps
// in components that group or color many ships at once.
export function useRelationKey(): string {
  const viewer = usePlayerStore((s) => s.selectedCountryId)
  const wars = useDiplomacyStore((s) => warsKeyOf(s.wars))
  return `${viewer ?? ''}|${wars}`
}

// React hook for components that color many ships at once — re-renders on the
// same triggers as useRelationTo, and returns a stable-per-render function.
export function useRelationFn(): (ownerId: string) => ShipRelation {
  const viewer = usePlayerStore((s) => s.selectedCountryId)
  useDiplomacyStore((s) => warsKeyOf(s.wars))
  return (ownerId: string) => relationOfOwner(ownerId, viewer)
}
