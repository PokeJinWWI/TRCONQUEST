// Building inside someone else's borders. A Starbase or a colony founded in a
// system another owner holds ALONE is allowed, makes the system contested (the
// ordinary claim rule: two owners present) and has a diplomatic cost. A system
// already shared by several owners has no borders to cross (`encroachedOwners`).
// One rule for every nation, at home and in other clusters.
//  - Against a NATION: its opinion of the builder drops by OPINION_ON_ENCROACHMENT
//    (the existing opinion mechanic), with a notification.
//  - Against a generated EMPIRE (data/generatedEmpires.ts: not a nation yet, no
//    diplomacy): the act is only recorded (`applied: false`), to be answered when
//    empires become nations. Until first contact the player is shown such an owner
//    as "Unknown empire" (UNKNOWN_EMPIRE_ID).
import { getCountry } from '../data/countryData'
import { OPINION_ON_ENCROACHMENT, type Encroachment } from '../data/diplomacyData'
import { empireOwningStar } from '../data/generatedEmpires'
import { findStar } from '../data/starData'
import { useDiplomacyStore } from '../state/diplomacyStore'
import { isPlayerOwned } from '../state/shipRelations'
import { useTerritoryStore } from '../state/territoryStore'
import { starbaseOwnersOf, type Starbase } from './starbaseLogic'
import { systemBodies, systemClaim, type OwnerMap, type SystemClaim } from './territory'
import { UNKNOWN_OWNER_ID } from '../data/ownerInfo'

// What the map calls an owner the player has not met (every empire, for now).
export const UNKNOWN_EMPIRE_ID = UNKNOWN_OWNER_ID

// A system's claim as a map shows it: body owners and live Starbases (the ordinary
// rule, scene/territory.systemClaim) plus the empire that owns the star, under its own
// id in Observer mode and as the unknown empire otherwise. Pure.
export function shownClaim(starId: string, owners: OwnerMap, starbaseOwnerIds: readonly string[], observer: boolean): SystemClaim {
  const empire = empireOwningStar(starId)
  return systemClaim(starId, owners, empire ? [...starbaseOwnerIds, observer ? empire.id : UNKNOWN_EMPIRE_ID] : [...starbaseOwnerIds])
}

// Pure: everyone who holds something in a system: owners of its bodies, nations
// with a live Starbase there, and the empire that owns the star, if any.
export function ownersPresent(starId: string, owners: OwnerMap, starbaseOwnerIds: readonly string[], empireId?: string): string[] {
  const present = new Set<string>()
  for (const body of systemBodies(starId)) if (owners[body]) present.add(owners[body])
  for (const id of starbaseOwnerIds) present.add(id)
  if (empireId) present.add(empireId)
  return [...present].sort()
}

// Pure: whose borders `builderId` builds inside at this system. Borders are a
// FULLY owned system (the map's own claim rule): exactly one owner present, and
// not the builder. A system several owners share (Sol) is nobody's borders, so
// building there encroaches on no one, and neither does building where the
// builder already stands.
export function encroachedOwners(builderId: string, present: readonly string[]): string[] {
  return present.length === 1 && present[0] !== builderId ? [...present] : []
}

// Everyone present in a system right now (`starbases` = the Starbase store's list).
export function ownersPresentNow(starId: string, starbases: Starbase[], simDays: number): string[] {
  return ownersPresent(starId, useTerritoryStore.getState().bodyOwner, starbaseOwnersOf(starId, starbases, simDays), empireOwningStar(starId)?.id)
}

// Called BEFORE the Starbase or colony is added (so the builder's new holding is
// not yet among those present): records an encroachment against the system's sole owner, if it has one.
export function recordEncroachments(builderId: string, starId: string, kind: Encroachment['kind'], simDays: number, starbases: Starbase[]): Encroachment[] {
  const diplomacy = useDiplomacyStore.getState()
  const out: Encroachment[] = []
  const systemName = findStar(starId)?.name ?? starId
  const builderName = getCountry(builderId)?.name ?? builderId
  for (const againstId of encroachedOwners(builderId, ownersPresentNow(starId, starbases, simDays))) {
    const nation = getCountry(againstId)
    if (nation) diplomacy.adjustOpinion(builderId, againstId, OPINION_ON_ENCROACHMENT)
    const record = diplomacy.addEncroachment({ byId: builderId, againstId, starId, kind, simDays, applied: !!nation })
    out.push(record)
    const what = kind === 'starbase' ? 'a Starbase' : 'a colony'
    const whose = nation ? `${nation.name}'s borders` : 'the borders of an unknown empire'
    const cost = nation ? `${nation.name}'s opinion of it falls by ${-OPINION_ON_ENCROACHMENT}.` : 'What that empire makes of it is not known yet.'
    if (isPlayerOwned({ ownerId: builderId }) || (nation && isPlayerOwned({ ownerId: againstId }))) {
      diplomacy.pushEvent('encroachment', nation ? [builderId, againstId] : [builderId], `${builderName} built ${what} inside ${whose} at ${systemName}. ${cost}`, simDays, { starId })
    }
  }
  return out
}
