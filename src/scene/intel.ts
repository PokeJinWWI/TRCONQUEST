// What the PLAYER is allowed to see of the map. Stars always show, but a
// star's information (owner, borders, bodies, an "Enter System" door) only
// appears once a science ship has explored it and the report has reached the
// capital — the survey store's `known` layer. Your own systems always count
// (any system where you own a body, or hold a Starbase). A Starbase in a system
// you haven't explored is visible but unidentified: no owner, colour, border
// or name. A nation is identified simply by its borders showing up: once you
// have explored a system it holds, its name and colour attach to it.
//
// Pure functions plus one hook; every view that draws borders or opens a system
// goes through these so the rule is the same everywhere. The sandbox has no
// nations to hide, so nothing is gated there.
import { useStarbaseActivityKey } from '../hooks/useStarbaseActivity'
import { useCallback } from 'react'
import { usePlayerStore } from '../state/playerStore'
import { useStarbaseStore } from '../state/starbaseStore'
import { useSurveyStore } from '../state/surveyStore'
import { useTerritoryStore } from '../state/territoryStore'
import { useGameTimeStore } from '../state/gameTimeStore'
import type { Starbase } from './starbaseLogic'
import { starbaseOwnersOf } from './starbaseLogic'
import { isBodySurveyed, isExplored, type NationIntel } from './surveyLogic'
import type { OwnerMap, SystemClaim } from './territory'

const UNCLAIMED: SystemClaim = { kind: 'unclaimed' }

// Whether the player knows this system: explored (by report), or their own.
export function systemKnownToPlayer(
  starId: string,
  playerId: string,
  known: NationIntel | undefined,
  owners: OwnerMap,
  starbases: Starbase[],
  simDays: number,
): boolean {
  if (isExplored(known, playerId, starId, owners)) return true
  return starbaseOwnersOf(starId, starbases, simDays).includes(playerId)
}

// The claims the player can see: an unexplored system reads as unclaimed
// (its owners are not known to them).
export function visibleClaims(claims: Map<string, SystemClaim>, knownStar: (starId: string) => boolean): Map<string, SystemClaim> {
  return new Map([...claims].map(([id, claim]) => [id, knownStar(id) ? claim : UNCLAIMED]))
}

// Stars that hold a live Starbase the player can't identify: the system is
// unexplored to them. (Own Starbases make their system known, so never appear.)
export function unidentifiedStarbaseStars(starbases: Starbase[], knownStar: (starId: string) => boolean, simDays: number): string[] {
  const out = new Set<string>()
  for (const sb of starbases) {
    if (knownStar(sb.starId)) continue
    if (starbaseOwnersOf(sb.starId, [sb], simDays).length > 0) out.add(sb.starId)
  }
  return [...out]
}

export interface PlayerIntel {
  // False in the sandbox / with no nation: everything is known.
  gated: boolean
  known: (starId: string) => boolean
}

// The player's view of the map, as a hook (re-renders when a report arrives,
// a body changes hands, or a Starbase is built/lost).
export function usePlayerIntel(): PlayerIntel {
  const playerId = usePlayerStore((s) => s.selectedCountryId)
  const sandbox = usePlayerStore((s) => s.sandbox)
  const knownIntel = useSurveyStore((s) => (playerId ? s.known[playerId] : undefined))
  const owners = useTerritoryStore((s) => s.bodyOwner)
  const starbases = useStarbaseStore((s) => s.starbases)
  // Re-derive only when a Starbase finishes, not every day (see useStarbaseActivityKey).
  const activity = useStarbaseActivityKey()
  const gated = !!playerId && !sandbox
  const known = useCallback(
    (starId: string) => !gated || systemKnownToPlayer(starId, playerId!, knownIntel, owners, starbases, useGameTimeStore.getState().simDays),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [gated, playerId, knownIntel, owners, starbases, activity],
  )
  return { gated, known }
}

// Whether the player has a survey of this body (by report, or it is in one of
// their own systems): what a world is like — class, size, habitability — shows
// only then. Always true in the sandbox.
export function usePlayerBodySurveyed(bodyName: string): boolean {
  const playerId = usePlayerStore((s) => s.selectedCountryId)
  const sandbox = usePlayerStore((s) => s.sandbox)
  const knownIntel = useSurveyStore((s) => (playerId ? s.known[playerId] : undefined))
  const owners = useTerritoryStore((s) => s.bodyOwner)
  if (!playerId || sandbox) return true
  return isBodySurveyed(knownIntel, playerId, bodyName, owners)
}
