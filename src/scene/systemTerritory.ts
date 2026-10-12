// A system's territorial picture in separate layers, so nothing mistakes one for another
// (docs/territorial-design.md M7):
//   sovereign     the recognized system-wide claimant, if any (scene/claims). Nobody gets it from a
//                 Starbase, a colony or a survey.
//   claimants     everyone with a live provisional claim on the whole system
//   bodySovereigns who governs each body that has a recognized owner: bodies keep their own
//                 sovereign whatever the system's
//   presence      whose finished Starbases stand there: a logistical and military foothold
//   drawn         what the MAP shows (the old border rule: body owners plus Starbases): a drawing,
//                 never an answer to "who governs?"
// `relation` is the legal summary: one sovereign, a split of several (each body its own), contested
// (rival claims), or open frontier.
import { useStarbaseStore } from '../state/starbaseStore'
import { useGameTimeStore } from '../state/gameTimeStore'
import { jurisdictionOf, type JurisdictionState } from './jurisdiction'
import { starbaseOwnersOf } from './starbaseLogic'
import { jurisdictionState } from './sovereignty'
import { systemBodies, systemClaim, type SystemClaim } from './territory'

export type SystemRelation = 'sovereign' | 'split' | 'contested' | 'frontier'

export interface SystemTerritory {
  starId: string
  sovereign?: string
  claimants: string[]
  bodySovereigns: Record<string, string>
  presence: string[]
  drawn: SystemClaim
  relation: SystemRelation
}

export function systemTerritory(starId: string, state: JurisdictionState, presence: string[]): SystemTerritory {
  const whole = jurisdictionOf({ kind: 'system', id: starId }, state)
  const bodySovereigns: Record<string, string> = {}
  for (const body of systemBodies(starId)) {
    const j = jurisdictionOf({ kind: 'body', id: body }, state)
    if (j.sovereign) bodySovereigns[body] = j.sovereign
  }
  const claimants = whole.disputants.filter((id) => id !== whole.sovereign)
  const owners = new Set(Object.values(bodySovereigns))
  const relation: SystemRelation = whole.sovereign ? 'sovereign' : claimants.length >= 2 || (claimants.length === 1 && owners.size > 0 && !(owners.size === 1 && owners.has(claimants[0]))) ? 'contested' : owners.size >= 2 ? 'split' : 'frontier'
  return { starId, sovereign: whole.sovereign, claimants, bodySovereigns, presence, drawn: systemClaim(starId, state.bodyOwner, presence), relation }
}

export function systemTerritoryNow(starId: string): SystemTerritory {
  return systemTerritory(starId, jurisdictionState(), starbaseOwnersOf(starId, useStarbaseStore.getState().starbases, useGameTimeStore.getState().simDays))
}
