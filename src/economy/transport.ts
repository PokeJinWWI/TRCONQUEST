// Transport capacities (Complex mode) — Victoria 3-style, all pure.
//
// Three distinct capacities, none of them a stockpiled market good (the
// `transportation` GOOD is separate — that's the freight haulage the transport
// buildings sell; see goods.ts):
//
//   INFRASTRUCTURE  a per-world capacity that gates MARKET ACCESS. Produced by
//                   the world's transport buildings + its population, consumed
//                   by every building by category. access = min(1, infra/usage).
//                   A low-access world trades (and is supplied) less.
//   LAUNCH          per-world surface↔orbit throughput. Produced by spaceports
//                   (by production method) and a space elevator. Caps how much
//                   of a world's goods can leave/reach the planet per tick.
//   INTERSTELLAR    national merchant-marine throughput. Produced by spaceports
//                   (Interstellar Port method) and starbase trade-hub modules.
//                   Gates a nation's INTERNATIONAL trade volume.
//
// Constants are sized so a fully-built seed world sits at ~full market access
// and ample launch (the seed economy is unchanged); an under-built world (a
// poor nation like Earth) is throttled — that's the whole point.

import type { World } from './economyTypes'
import { RECIPES } from './recipes'

// --- Infrastructure (capacity → market access) ---------------------------------

// Every world starts with this much infrastructure (roads, a basic grid).
export const INFRA_BASE = 60
// Infrastructure per million people, capped — a populous world is better
// connected even before it builds rail.
export const INFRA_PER_POP = 0.02
export const INFRA_POP_CAP = 120
// What each transport building adds to its world's infrastructure, per level at
// full throughput (distinct from the `transportation` good it also produces and
// the national freight it adds in economyTick's LOGISTICS_OUTPUT).
export const INFRA_PER_BUILDING: Record<string, number> = {
  roadNetwork: 45,
  railway: 130,
  spaceport: 70,
  seaport: 60,
}
// Infrastructure each building LEVEL consumes, by recipe category (Vic3: mines
// and heavy industry lean on it hardest; services/government least).
const INFRA_USAGE_BY_CATEGORY: Record<string, number> = {
  extraction: 2,
  industry: 1.8,
  agriculture: 1,
  energy: 2,
  services: 1,
  government: 1,
  corporate: 1,
}

export function populationOf(world: World): number {
  return world.pops.reduce((s, p) => s + p.populationSize, 0)
}

export function worldInfrastructure(world: World): number {
  let infra = INFRA_BASE + Math.min(INFRA_POP_CAP, populationOf(world) * INFRA_PER_POP)
  for (const b of world.buildings) {
    const per = INFRA_PER_BUILDING[b.recipeId]
    if (per) infra += per * b.level * b.throughput
  }
  const devastation = world.devastation ?? 0
  return Math.max(0, infra * (1 - devastation))
}

export function infrastructureUsage(world: World): number {
  let usage = 0
  for (const b of world.buildings) {
    const cat = RECIPES[b.recipeId]?.category
    usage += (cat ? INFRA_USAGE_BY_CATEGORY[cat] ?? 1 : 1) * b.level
  }
  return usage
}

// 0..1. A world whose infrastructure covers its usage trades at full access;
// below that, access falls proportionally (the Vic3 rule).
export function marketAccess(world: World): number {
  const usage = infrastructureUsage(world)
  if (usage <= 1e-9) return 1
  return Math.max(0, Math.min(1, worldInfrastructure(world) / usage))
}

// --- Launch (per-world surface↔orbit throughput) -------------------------------

// Every inhabited world can move this much off-planet on its own (shuttles,
// small pads) before any spaceport — so a world with no spaceport still trades,
// and the capacity only bites a world that genuinely out-grows its lift.
export const LAUNCH_BASE = 3000
// Launch a spaceport provides per level at full throughput, by production method.
export const SPACEPORT_LAUNCH_BY_METHOD: Record<string, number> = {
  standard: 1400, // Orbital Freight Hub — balanced
  'launch-complex': 3200, // specialises in lift
  'interstellar-port': 500, // specialises the other way
}
// A space-elevator anchor's launch per level — large and fuel-free, but only
// when paired with an orbital tether over the same body (see paired below).
export const ELEVATOR_LAUNCH_PAIRED = 6000
export const ELEVATOR_LAUNCH_UNPAIRED = 1500 // anchor alone (no tether yet)

// Launch a world can move this tick. `tetheredBodies` are the body names that
// have a completed orbital space-elevator tether above them (starbase module).
export function launchCapacity(world: World, tethered: boolean): number {
  let launch = LAUNCH_BASE
  for (const b of world.buildings) {
    if (b.recipeId === 'spaceport') {
      launch += (SPACEPORT_LAUNCH_BY_METHOD[b.methodId] ?? SPACEPORT_LAUNCH_BY_METHOD.standard) * b.level * b.throughput
    } else if (b.recipeId === 'spaceElevatorAnchor') {
      launch += (tethered ? ELEVATOR_LAUNCH_PAIRED : ELEVATOR_LAUNCH_UNPAIRED) * b.level * b.throughput
    }
  }
  return launch
}

// --- Interstellar transport (national merchant marine) -------------------------

export const INTERSTELLAR_BASE = 1500
export const SPACEPORT_INTERSTELLAR_BY_METHOD: Record<string, number> = {
  standard: 1200,
  'launch-complex': 300,
  'interstellar-port': 3000,
}

// A nation's interstellar throughput from its spaceports (starbase trade-hub
// modules add more; folded in by economyTick, which knows the starbases).
export function interstellarFromWorlds(worlds: World[]): number {
  let cap = INTERSTELLAR_BASE
  for (const w of worlds) {
    for (const b of w.buildings) {
      if (b.recipeId === 'spaceport') {
        cap += (SPACEPORT_INTERSTELLAR_BY_METHOD[b.methodId] ?? SPACEPORT_INTERSTELLAR_BY_METHOD.standard) * b.level * b.throughput
      }
    }
  }
  return cap
}
