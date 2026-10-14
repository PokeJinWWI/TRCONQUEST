// Claiming a whole planet. A nation spends a lot of Influence to claim a world nobody governs: the claim reserves it (a live claim by
// someone else refuses every other colony ship), and with enough of the nation's own people already living there it is recognized
// at once and the whole planet is the nation's (territoryStore.bodyOwner, through scene/sovereignty.recognizeClaim). Rules here;
// the Control tab (components/planet/ControlTab.tsx) is the player's entry.
import { CLAIM_PLANET_INFLUENCE_BASE, CLAIM_PLANET_INFLUENCE_PER_LAND, CLAIM_PLANET_MIN_POPULATION } from '../data/colonyData'
import { ownerDisplay } from '../data/countryRoster'
import { useJurisdictionStore } from '../state/jurisdictionStore'
import { useResourceStore } from '../state/resourceStore'
import { useSurveyStore } from '../state/surveyStore'
import { useTerritoryStore } from '../state/territoryStore'
import { isLive, type Claim } from './claims'
import { landForBody } from './bodyLand'
import { groundSurface } from './groundLogic'
import { fileClaimNow, recognizeClaim } from './sovereignty'
import { isBodySurveyed } from './surveyLogic'
import { bodyPopulation } from './urbanPopulation'

export const claimPlanetCost = (bodyName: string): number => Math.round(CLAIM_PLANET_INFLUENCE_BASE + CLAIM_PLANET_INFLUENCE_PER_LAND * landForBody(bodyName))

// The live whole-planet claim on a body by anyone but `exceptId`, if there is one.
export function rivalPlanetClaim(bodyName: string, exceptId?: string): Claim | undefined {
  return useJurisdictionStore.getState().claims.find((c) => isLive(c) && c.scope.kind === 'body' && c.scope.id === bodyName && c.claimantId !== exceptId)
}

// The nation's own people on the body, in millions (a body's economy belongs to its owner: one nation's people per body).
export function presencePopulation(nationId: string, bodyName: string): number {
  return useTerritoryStore.getState().bodyOwner[bodyName] === nationId ? bodyPopulation(bodyName) : 0
}

// Why `nationId` cannot claim `bodyName` now, or null.
export function claimPlanetBlock(nationId: string, bodyName: string): string | null {
  const owners = useTerritoryStore.getState().bodyOwner
  if (owners[bodyName] === nationId) return 'It is already yours'
  if (owners[bodyName]) return `${ownerDisplay(owners[bodyName]).name} already governs ${bodyName}`
  if ((groundSurface(bodyName, owners)?.mainland ?? -1) < 0) return `${bodyName} has no land to claim`
  if (!isBodySurveyed(useSurveyStore.getState().discovered[nationId], nationId, bodyName, owners)) return `Survey ${bodyName} first`
  const rival = rivalPlanetClaim(bodyName, nationId)
  if (rival) return `${ownerDisplay(rival.claimantId).name} has already claimed ${bodyName}`
  if (useJurisdictionStore.getState().claims.some((c) => isLive(c) && c.scope.kind === 'body' && c.scope.id === bodyName && c.claimantId === nationId)) return 'You have already claimed it'
  const have = useResourceStore.getState().stateFor(nationId).amounts.influence ?? 0
  const cost = claimPlanetCost(bodyName)
  if (have < cost) return `Needs ${cost} influence (you have ${Math.floor(have)})`
  return null
}

export type ClaimPlanetResult = { ok: true; sovereign: boolean; cost: number } | { ok: false; reason: string }

export function claimPlanetNow(nationId: string, bodyName: string, simDays: number): ClaimPlanetResult {
  const block = claimPlanetBlock(nationId, bodyName)
  if (block) return { ok: false, reason: block }
  const cost = claimPlanetCost(bodyName)
  const filed = fileClaimNow({ kind: 'body', id: bodyName }, nationId, 'founding', simDays)
  if (!filed.ok) return { ok: false, reason: filed.reason }
  useResourceStore.getState().addAmount(nationId, 'influence', -cost)
  // Enough of its own people on the world: the claim is recognized and the whole planet is the nation's.
  if (presencePopulation(nationId, bodyName) >= CLAIM_PLANET_MIN_POPULATION) {
    const r = recognizeClaim(filed.claim.id, { basis: 'recognition', byId: nationId, simDays })
    if (r.ok) return { ok: true, sovereign: true, cost }
  }
  return { ok: true, sovereign: false, cost }
}
