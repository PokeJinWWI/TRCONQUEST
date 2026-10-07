// The Debug Console's cheats, kept apart from the component: the pure rules (where a spawned ship goes,
// how a time jump is cut into steps) and the few store writes (resources, the clock, ending a war).
// Cheats only: no game rule is changed, they use the same stores and actions the game does.
import { SOLAR_NEIGHBORHOOD_ID } from '../data/galaxyGen'
import type { ResourceId } from '../data/resourceData'
import { useDiplomacyStore } from '../state/diplomacyStore'
import { useGameTimeStore } from '../state/gameTimeStore'
import { useResourceStore } from '../state/resourceStore'
import type { ShipLocation } from '../state/shipStore'
import { ownerDisplay } from '../data/countryRoster'
import { getPlanetsForStar } from './planetData'
import { getSystemStars } from '../data/starData'
import { makePeace } from './peace'
import { DEFAULT_SHIP_ORBIT_PERIOD_DAYS } from './shipPhysics'

// --- Spawning a ship anywhere --------------------------------------------------------------

// The values the "spawn near" list adds to the system's bodies: the cluster's entry point (where a ship
// arrives on reaching the cluster, no system needed) and the star itself (a star with no planets has
// nothing else to be near).
export const NEAR_CLUSTER_ENTRY = '@entry'
export const NEAR_STAR = '@star'

export interface NearOption {
  value: string
  label: string
}

// Everything a ship can be put beside in a star's system: its stars and planets, then the star as a bare
// point, then the cluster's entry point.
export function nearOptions(starId: string): NearOption[] {
  return [
    ...getSystemStars(starId).map((c) => ({ value: c.name, label: c.name })),
    ...getPlanetsForStar(starId).map((p) => ({ value: p.name, label: p.name })),
    { value: NEAR_STAR, label: 'At the star (open space)' },
    { value: NEAR_CLUSTER_ENTRY, label: 'Cluster entry point' },
  ]
}

// The default pick for a system: its primary star's name, or (a system with none to orbit) the star itself.
export function defaultNear(starId: string): string {
  return getSystemStars(starId)[0]?.name ?? NEAR_STAR
}

// Where a spawned ship rests: orbiting a body, at the star, or at the cluster's entry point. The Solar
// Neighbourhood's map is the one with no `clusterId` on its points.
export function spawnLocation(clusterId: string, starId: string, near: string, phaseDeg = 0): ShipLocation {
  if (near === NEAR_CLUSTER_ENTRY) {
    return clusterId === SOLAR_NEIGHBORHOOD_ID ? { kind: 'interstellar-point', position: [0, 0, 0] } : { kind: 'interstellar-point', position: [0, 0, 0], clusterId }
  }
  if (near === NEAR_STAR) return { kind: 'star', starId, offset: [0, 0, 0] }
  return { kind: 'orbiting', systemId: starId, bodyName: near, periodDays: DEFAULT_SHIP_ORBIT_PERIOD_DAYS, phaseDeg, inclinationDeg: 0 }
}

// --- Game time ---------------------------------------------------------------------------------

// The largest step a time jump advances at once, in days: the monthly economy and the resolvers each see
// the days go by in pieces they already handle (the economy batches whole months), not one leap.
export const TIME_JUMP_STEP_DAYS = 10

// `days` cut into steps of at most `step`, summing to exactly `days` (nothing for a non-positive count).
export function jumpPlan(days: number, step = TIME_JUMP_STEP_DAYS): number[] {
  if (!(days > 0)) return []
  const out: number[] = []
  let left = days
  while (left > 1e-9) {
    const next = Math.min(step, left)
    out.push(next)
    left -= next
  }
  return out
}

let jumpTimer: ReturnType<typeof setTimeout> | null = null

// Advances the clock by `days`, a step at a time (whether or not the game is paused: a cheat, not the clock).
// A second jump while one runs adds to it. Returns the number of steps.
export function cheatJumpDays(days: number, intervalMs = 40): number {
  const steps = jumpPlan(days)
  if (jumpTimer) clearTimeout(jumpTimer)
  const run = () => {
    const next = steps.shift()
    if (next === undefined) {
      jumpTimer = null
      return
    }
    useGameTimeStore.setState((s) => ({ simDays: s.simDays + next }))
    jumpTimer = setTimeout(run, intervalMs)
  }
  run()
  return steps.length + 1
}

// --- Resources and influence ------------------------------------------------------------

// Adds (or, negative, takes) an amount of a resource for a nation, never below zero.
export function cheatAddResource(countryId: string, id: ResourceId, amount: number): void {
  const store = useResourceStore.getState()
  const have = store.stateFor(countryId).amounts[id] ?? 0
  store.setAmount(countryId, id, Math.max(0, have + amount))
}

// --- Wars --------------------------------------------------------------------------------------

export function warLabel(war: { attackerId: string; defenderId: string; tier?: string }): string {
  return `${ownerDisplay(war.attackerId).name} vs ${ownerDisplay(war.defenderId).name}${war.tier ? ` (${war.tier})` : ''}`
}

// Ends a war with a white peace through the real peace code (occupations lifted, stranded armies sent home,
// a truce, the usual notification). Returns whether there was such a war.
export function cheatEndWar(warId: string): boolean {
  const war = useDiplomacyStore.getState().wars.find((w) => w.id === warId)
  if (!war) return false
  makePeace(warId, { kind: 'white' }, war.attackerId, useGameTimeStore.getState().simDays)
  return true
}

export function cheatEndAllWars(): number {
  const ids = useDiplomacyStore.getState().wars.map((w) => w.id)
  for (const id of ids) cheatEndWar(id)
  return ids.length
}
