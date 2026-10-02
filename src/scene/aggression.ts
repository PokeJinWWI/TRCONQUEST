// Attacking a ship of a nation you are NOT at war with. Pure rules; the store
// side is scene/aggressionOrders.ts.
//
// An attack order (ShipInstance.attackTargetShipId) makes the attacker and its
// target fight where they come to rest together, at war or not. That fight is
// LOCAL: combat is one side per nation, so every ship of the two nations at
// that one place joins, and nowhere else. It is recorded as an Incident, and
// the victim's nation reacts only when the news reaches its territory, at its
// own comms tier (resolveAggressionNews).
import type { ShipInstance, ShipLocation } from '../state/shipStore'
import type { AtWarFn } from '../state/diplomacyStore'
import type { Incident } from '../data/diplomacyData'
import type { CommsTier } from '../data/commsData'
import { FRIENDLY_ROGUE_ID } from '../data/countryRoster'
import { combatLocationKey } from '../state/combatStore'
import { commsDelayToLocation } from './commsVisual'
import { bodiesOwnedBy, bodyStarId } from './territory'
import { isStarbaseActive, type Starbase } from './starbaseLogic'

// The ship this one is under orders to attack, or null. The attack rides on the
// follow directive, so anything that cancels the follow cancels it.
export function attackTargetOf(ship: Pick<ShipInstance, 'attackTargetShipId' | 'followingShipId'>): string | null {
  return ship.attackTargetShipId && ship.attackTargetShipId === ship.followingShipId ? ship.attackTargetShipId : null
}

// What attacking a ship of `targetOwnerId` means for `viewerId`: 'hostile' is
// an ordinary act of war (no warning), 'allied' and 'neutral' are unprovoked
// (warn first), and nobody attacks their 'own'.
export type AttackPrompt = 'own' | 'hostile' | 'allied' | 'neutral'

export function attackPrompt(viewerId: string, targetOwnerId: string, atWar: AtWarFn, isAlly: (a: string, b: string) => boolean): AttackPrompt {
  if (viewerId === targetOwnerId) return 'own'
  if (atWar(viewerId, targetOwnerId)) return 'hostile'
  if (targetOwnerId === FRIENDLY_ROGUE_ID || isAlly(viewerId, targetOwnerId)) return 'allied'
  return 'neutral'
}

export interface LocalAggression {
  locationKey: string
  location: ShipLocation
  aggressorId: string
  victimId: string
}

// Every unprovoked attack making contact right now: an attacker resting in the
// same place as its resting target, their nations not at war. One entry per
// place and pair of nations.
export function localAggressions(ships: ShipInstance[], atWar: AtWarFn): LocalAggression[] {
  const byId = new Map(ships.map((s) => [s.id, s]))
  const seen = new Set<string>()
  const out: LocalAggression[] = []
  for (const ship of ships) {
    const targetId = attackTargetOf(ship)
    if (!targetId || ship.order) continue
    const target = byId.get(targetId)
    if (!target || target.order || target.ownerId === ship.ownerId || atWar(ship.ownerId, target.ownerId)) continue
    const key = combatLocationKey(ship.location)
    if (!key || key !== combatLocationKey(target.location)) continue
    const id = `${key}|${ship.ownerId}|${target.ownerId}`
    if (seen.has(id)) continue
    seen.add(id)
    out.push({ locationKey: key, location: ship.location, aggressorId: ship.ownerId, victimId: target.ownerId })
  }
  return out
}

// Who fights whom at one place: nations at war, plus the two sides of an
// unprovoked attack there — one making contact now, or one already recorded
// whose fight is still open (`openKeys`: places with an engagement).
export function hostileAtFn(atWar: AtWarFn, aggressions: LocalAggression[], incidents: Incident[], openKeys: Set<string>): (locationKey: string) => AtWarFn {
  const pairsAt = new Map<string, Set<string>>()
  const add = (key: string, a: string, b: string) => {
    const set = pairsAt.get(key) ?? new Set<string>()
    set.add(`${a}|${b}`).add(`${b}|${a}`)
    pairsAt.set(key, set)
  }
  for (const a of aggressions) add(a.locationKey, a.aggressorId, a.victimId)
  for (const i of incidents) if (openKeys.has(i.locationKey)) add(i.locationKey, i.aggressorId, i.victimId)
  return (locationKey) => {
    const pairs = pairsAt.get(locationKey)
    if (!pairs) return atWar
    return (a, b) => atWar(a, b) || pairs.has(`${a}|${b}`)
  }
}

// The attacks among `aggressions` not on record yet.
export function unrecordedAggressions(aggressions: LocalAggression[], incidents: Incident[]): LocalAggression[] {
  return aggressions.filter((a) => !incidents.some((i) => i.locationKey === a.locationKey && i.aggressorId === a.aggressorId && i.victimId === a.victimId))
}

// The hook for future espionage: news of a sabotaged incident never gets out.
export function isNewsSuppressed(incident: Pick<Incident, 'commsSabotaged'>): boolean {
  return incident.commsSabotaged === true
}

// Signal time, in days, for news from `location` to reach the NEAREST piece of
// the victim's territory — any body it owns (colonies included) or any finished
// Starbase — at the victim's own comms tier. Null when it holds none (a sandbox
// faction): the news has nowhere to arrive.
export function newsDelayDays(
  location: ShipLocation,
  victimId: string,
  bodyOwner: Record<string, string | undefined>,
  starbases: Starbase[],
  tier: CommsTier,
  simDays: number,
): number | null {
  let best: number | null = null
  const consider = (starId: string | undefined, bodyName: string) => {
    if (!starId) return
    const d = commsDelayToLocation(location, starId, bodyName, simDays, tier)
    if (best === null || d < best) best = d
  }
  for (const body of bodiesOwnedBy(victimId, bodyOwner as Record<string, string>)) consider(bodyStarId(body), body)
  // A Starbase sits at its star ('' resolves to the system's origin).
  for (const sb of starbases) if (sb.ownerId === victimId && isStarbaseActive(sb, simDays)) consider(sb.starId, '')
  return best
}

// Incidents whose news has arrived by `simDays`.
export function dueIncidents(incidents: Incident[], simDays: number): Incident[] {
  return incidents.filter((i) => !isNewsSuppressed(i) && i.newsArrivesSimDays !== null && simDays >= i.newsArrivesSimDays)
}
