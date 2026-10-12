// Diplomatic consequences of building where others govern or claim (docs/territorial-design.md M9).
// Uses the existing opinion and event framework: no reputation system of its own. A construction the law
// allows only as a dispute (`decision.incident`: a claimed frontier, a governed place with a rival claim) costs the
// builder the other disputants' opinion and is told to the parties; one the law refuses never happens (it is
// refused up front), so a second severity needs no second mechanism.
import { getCountry } from '../data/countryData'
import { OPINION_ON_DISPUTED_BUILD } from '../data/diplomacyData'
import { useDiplomacyStore } from '../state/diplomacyStore'
import { isPlayerOwned } from '../state/shipRelations'
import type { AssetKind } from './jurisdiction'
import type { Scope } from './claims'
import { decideConstructionNow } from './sovereignty'

const nameOf = (id: string) => getCountry(id)?.name ?? id

// Call after something is built. Returns the countries that were wronged.
export function recordTerritorialIncident(builderId: string, scope: Scope, asset: AssetKind, simDays: number): string[] {
  const decision = decideConstructionNow(builderId, scope, asset)
  if (!decision.incident) return []
  const diplomacy = useDiplomacyStore.getState()
  const against = decision.jurisdiction.disputants.filter((id) => id !== builderId && getCountry(id))
  for (const other of against) diplomacy.adjustOpinion(builderId, other, OPINION_ON_DISPUTED_BUILD)
  if (against.length > 0 && (isPlayerOwned({ ownerId: builderId }) || against.some((id) => isPlayerOwned({ ownerId: id })))) {
    diplomacy.pushEvent('territorial-incident', [builderId, ...against], `${nameOf(builderId)} built on ${scope.id}, which ${against.map(nameOf).join(' and ')} govern or claim. ${against.map(nameOf).join(' and ')}'s opinion of it falls by ${-OPINION_ON_DISPUTED_BUILD}.`, simDays)
  }
  return against
}
