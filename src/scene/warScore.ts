// War score, exhaustion and peace acceptance. Pure functions over a War and
// the territory maps; state/diplomacyStore.ts holds the wars and
// scene/peace.ts applies a peace. Tuning is in data/diplomacyData.ts.
//
// Score is from the ATTACKER's point of view, -100..+100:
//   occupation  100 × (share of the defender's territory value the attacker
//               holds) − 100 × (share of the attacker's the defender holds)
//   battles     ±BATTLE_SCORE_MAX, from ship/army losses (battleBalance)
// Use scoreFor() to read it from either side.
import {
  BATTLE_SCORE_MAX,
  BATTLE_SCORE_SCALE_HP,
  CEDE_EXHAUSTION,
  EXHAUSTION_LOSS_HP_PER_POINT,
  EXHAUSTION_PER_YEAR,
  WHITE_PEACE_EXHAUSTED_MAX_SCORE,
  WHITE_PEACE_EXHAUSTION,
  WHITE_PEACE_MAX_SCORE,
  type PeaceTerms,
  type War,
} from '../data/diplomacyData'
import { bodiesOwnedBy, controllerOf, type OwnerMap } from './territory'

export type BodyValueFn = (bodyName: string) => number

const DAYS_PER_YEAR = 365.25

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x))
}

// Bodies `ownerId` owns that `holderId` currently controls.
export function bodiesHeldFrom(ownerId: string, holderId: string, owners: OwnerMap, controllers: OwnerMap): string[] {
  return bodiesOwnedBy(ownerId, owners).filter((b) => controllerOf(b, owners, controllers) === holderId)
}

function territoryValue(countryId: string, owners: OwnerMap, valueOf: BodyValueFn): number {
  return bodiesOwnedBy(countryId, owners).reduce((s, b) => s + valueOf(b), 0)
}

// Share (0..100) of `ownerId`'s territory value that `holderId` occupies.
export function occupiedShare(ownerId: string, holderId: string, owners: OwnerMap, controllers: OwnerMap, valueOf: BodyValueFn): number {
  const total = territoryValue(ownerId, owners, valueOf)
  if (total <= 0) return 0
  const held = bodiesHeldFrom(ownerId, holderId, owners, controllers).reduce((s, b) => s + valueOf(b), 0)
  return (100 * held) / total
}

export function battleScore(war: War): number {
  return BATTLE_SCORE_MAX * Math.tanh(war.battleBalance / BATTLE_SCORE_SCALE_HP)
}

export function warScore(war: War, owners: OwnerMap, controllers: OwnerMap, valueOf: BodyValueFn): number {
  const occupation =
    occupiedShare(war.defenderId, war.attackerId, owners, controllers, valueOf) -
    occupiedShare(war.attackerId, war.defenderId, owners, controllers, valueOf)
  return clamp(occupation + battleScore(war), -100, 100)
}

// The same score from `countryId`'s side of the war.
export function scoreFor(war: War, countryId: string, owners: OwnerMap, controllers: OwnerMap, valueOf: BodyValueFn): number {
  const score = warScore(war, owners, controllers, valueOf)
  return countryId === war.attackerId ? score : -score
}

// 0..100: time at war plus losses suffered.
export function warExhaustion(war: War, countryId: string, simDays: number): number {
  const years = Math.max(0, simDays - war.startedSimDays) / DAYS_PER_YEAR
  const losses = (war.exhaustion[countryId] ?? 0) / EXHAUSTION_LOSS_HP_PER_POINT
  return clamp(years * EXHAUSTION_PER_YEAR + losses, 0, 100)
}

// What demanding these bodies costs in war score: their share of the loser's
// total territory value.
export function cessionCost(bodies: string[], loserId: string, owners: OwnerMap, valueOf: BodyValueFn): number {
  const total = territoryValue(loserId, owners, valueOf)
  if (total <= 0) return 0
  return (100 * bodies.reduce((s, b) => s + valueOf(b), 0)) / total
}

export interface PeaceEvaluation {
  accept: boolean
  reason: string
}

// Would the OTHER side of the war accept `terms` proposed by `proposerId`?
// The same rule decides for the AI and is what the player's proposals are
// judged by. A cession is always the receiver giving bodies to the proposer,
// and only bodies the proposer currently occupies can be demanded.
export function evaluatePeace(
  war: War,
  proposerId: string,
  terms: PeaceTerms,
  owners: OwnerMap,
  controllers: OwnerMap,
  valueOf: BodyValueFn,
  simDays: number,
): PeaceEvaluation {
  const receiverId = proposerId === war.attackerId ? war.defenderId : war.attackerId
  const receiverScore = scoreFor(war, receiverId, owners, controllers, valueOf)
  const receiverExhaustion = warExhaustion(war, receiverId, simDays)

  if (terms.kind === 'white') {
    const cap = receiverExhaustion >= WHITE_PEACE_EXHAUSTION ? WHITE_PEACE_EXHAUSTED_MAX_SCORE : WHITE_PEACE_MAX_SCORE
    if (receiverScore > cap) return { accept: false, reason: `They are winning (war score ${Math.round(receiverScore)})` }
    return { accept: true, reason: 'White peace accepted' }
  }

  if (terms.bodies.length === 0) return { accept: false, reason: 'No bodies demanded' }
  const held = new Set(bodiesHeldFrom(receiverId, proposerId, owners, controllers))
  const notHeld = terms.bodies.filter((b) => !held.has(b))
  if (notHeld.length > 0) return { accept: false, reason: `You don't occupy ${notHeld.join(', ')}` }
  const cost = cessionCost(terms.bodies, receiverId, owners, valueOf)
  const proposerScore = -receiverScore
  const needed = receiverExhaustion >= CEDE_EXHAUSTION ? cost / 2 : cost
  if (proposerScore < needed) {
    return { accept: false, reason: `Needs war score ${Math.ceil(needed)} (have ${Math.floor(proposerScore)})` }
  }
  return { accept: true, reason: 'Cession accepted' }
}
