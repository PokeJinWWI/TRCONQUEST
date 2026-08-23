import { create } from 'zustand'
import type { ComponentKind } from '../data/combatData'
import type { FleetAllegiance } from '../data/shipData'
import { remapNode, type CombatObstacle, type GridDensity, type GridNode } from '../scene/combatArena'
import type { ShipLocation } from './shipStore'

// Live combat state — which fights are happening, and everything transient
// about them (arena positions, weapon timers, chosen targets).
//
// Deliberately split from ShipInstance.combat, which holds only *persistent*
// damage that outlives a battle (component HP, shields, armor). Anything that
// exists solely for the duration of a fight lives here instead, so a ship
// that disengages simply stops appearing in any engagement rather than having
// to have a pile of arena fields reset on it.

// Which side of an engagement a ship is on. Neutrals never fight at all (see
// areHostile), so every participant resolves to one of exactly two sides —
// which keeps the model honest for the eventual N-vs-N case without
// pretending to support free-for-alls it doesn't.
export type CombatSide = 0 | 1

// Who shoots at whom. Neutral is deliberately inert: it's a real allegiance a
// fleet can hold without that fleet being dragged into every passing
// firefight. Friendly counts as player-side, so an allied fleet parked at a
// contested body joins the fight rather than watching it.
export function areHostile(a: FleetAllegiance, b: FleetAllegiance): boolean {
  const isPlayerSide = (x: FleetAllegiance) => x === 'player' || x === 'friendly'
  const isEnemySide = (x: FleetAllegiance) => x === 'hostile'
  return (isPlayerSide(a) && isEnemySide(b)) || (isEnemySide(a) && isPlayerSide(b))
}

export function sideFor(allegiance: FleetAllegiance): CombatSide {
  return allegiance === 'hostile' ? 1 : 0
}

// The identity of a place two fleets can meet. Only *resting* locations
// produce a key — a ship mid-order is in transit across real interplanetary
// distance and simply isn't in the same place as anything else, so it can't
// be engaged. Bare system/interstellar points are excluded too: they're
// arbitrary coordinates that two ships would have to match exactly, which
// says "these ships happen to share a float" rather than "these fleets met."
export function combatLocationKey(location: ShipLocation): string | null {
  if (location.kind === 'orbiting') return `body:${location.systemId}:${location.bodyName}`
  if (location.kind === 'star') return `star:${location.starId}`
  return null
}

export function combatLocationLabel(location: ShipLocation): string {
  if (location.kind === 'orbiting') return location.bodyName
  if (location.kind === 'star') return location.starId
  return 'Deep space'
}

// One ship's transient presence in a fight. Its position is a lattice node
// (see combatArena.ts), and a move in progress is stored as the hop it's
// currently making plus the queued remainder — rather than an interpolated
// position — so the arena, like everything else in this project, renders as a
// pure function of simDays rather than from mutated per-frame state.
export interface CombatParticipant {
  shipId: string
  side: CombatSide
  node: GridNode
  // The hop currently underway. `hopFrom` equals `node` and hopArrivalSimDays
  // is in the past when the ship is stationary.
  hopFrom: GridNode
  hopStartSimDays: number
  hopArrivalSimDays: number
  // Remaining queued nodes after the current hop completes.
  path: GridNode[]
  // Per *mount index* (not mount id) — a hull carrying three identical
  // autocannons needs three independent timers, and they're distinguished
  // only by position in the class's weapons array.
  weaponReadySimDays: number[]
  // Player-assigned focus. Null means "auto-pick the nearest enemy", which is
  // also what every AI-controlled ship does, so an unmanaged fight still
  // resolves sensibly.
  targetShipId: string | null
  // Which of the target's three healthbars to concentrate on. Null spreads
  // damage across whatever's exposed — see combatResolution's pickComponent.
  targetComponent: ComponentKind | null
  // Latched the moment the player issues this ship a lattice move, and only
  // cleared by explicitly re-enabling auto-engage. Without the latch, the
  // resolver's default approach behavior would resume the instant a
  // player-ordered path finished and march the ship straight back at the
  // enemy — which makes deliberate kiting (the entire point of giving a
  // long-ranged hull a speed advantage) impossible to actually perform.
  holdPosition: boolean
}

export interface Engagement {
  id: string
  // The shared location key every participant is resting at.
  locationKey: string
  locationLabel: string
  startedSimDays: number
  density: GridDensity
  // The lattice node the visible window is centred on. The arena is a window
  // onto an unbounded lattice, not a box the fight is sealed inside — sliding
  // this is how a ship travels further than one window's width (see
  // combatArena's header).
  center: GridNode
  // Celestial bodies sharing the arena — blocking line of fire and barring
  // movement. Derived from where the fight is happening (see
  // combatResolution.obstaclesForLocation), not authored per engagement.
  obstacles: CombatObstacle[]
  participants: CombatParticipant[]
  // How far combat has actually been simulated. The resolver steps in fixed
  // sim-second increments from here up to the clock, rather than resolving a
  // variable-sized chunk per frame, so outcomes don't depend on framerate.
  resolvedThroughSimDays: number
}

interface CombatState {
  engagements: Engagement[]
  // Which engagement the combat view is currently showing, if any.
  viewedEngagementId: string | null
  // Whether entering combat should yank the clock into tactical mode. On by
  // default because combat is otherwise literally unobservable: at normal 1x
  // a real second is ~518,400 sim-seconds, so an entire battle would resolve
  // between two frames. Exposed as a toggle rather than hardcoded so a player
  // who doesn't want to be interrupted can let fights auto-resolve.
  autoTacticalOnEngage: boolean
  setAutoTacticalOnEngage: (enabled: boolean) => void
  addEngagement: (engagement: Engagement) => void
  removeEngagement: (id: string) => void
  replaceEngagements: (engagements: Engagement[]) => void
  viewEngagement: (id: string | null) => void
  setParticipantTarget: (engagementId: string, shipId: string, targetShipId: string | null) => void
  setParticipantTargetComponent: (engagementId: string, shipId: string, component: ComponentKind | null) => void
  setDensity: (engagementId: string, density: GridDensity) => void
  setCenter: (engagementId: string, center: GridNode) => void
  // Writes back a participant the caller has already recomputed — the move
  // itself is planned by combatResolution.orderParticipantTo, keeping the
  // "physics computes, store applies" split every other order path in this
  // project follows (see shipStore.setShipOrder's comment).
  setParticipant: (engagementId: string, participant: CombatParticipant) => void
  setHoldPosition: (engagementId: string, shipId: string, hold: boolean) => void
}

export const useCombatStore = create<CombatState>((set) => ({
  engagements: [],
  viewedEngagementId: null,
  autoTacticalOnEngage: true,
  setAutoTacticalOnEngage: (enabled) => set({ autoTacticalOnEngage: enabled }),
  addEngagement: (engagement) => set((s) => ({ engagements: [...s.engagements, engagement] })),
  removeEngagement: (id) =>
    set((s) => ({
      engagements: s.engagements.filter((e) => e.id !== id),
      viewedEngagementId: s.viewedEngagementId === id ? null : s.viewedEngagementId,
    })),
  // The resolver computes a whole new engagement list per step (it's a pure
  // function of the previous list plus the ships), so it writes back through
  // one action rather than a pile of granular mutations.
  replaceEngagements: (engagements) =>
    set((s) => ({
      engagements,
      viewedEngagementId: engagements.some((e) => e.id === s.viewedEngagementId) ? s.viewedEngagementId : null,
    })),
  viewEngagement: (id) => set({ viewedEngagementId: id }),
  setParticipantTarget: (engagementId, shipId, targetShipId) =>
    set((s) => ({
      engagements: s.engagements.map((e) =>
        e.id === engagementId
          ? {
              ...e,
              participants: e.participants.map((p) => (p.shipId === shipId ? { ...p, targetShipId } : p)),
            }
          : e,
      ),
    })),
  setParticipantTargetComponent: (engagementId, shipId, targetComponent) =>
    set((s) => ({
      engagements: s.engagements.map((e) =>
        e.id === engagementId
          ? {
              ...e,
              participants: e.participants.map((p) => (p.shipId === shipId ? { ...p, targetComponent } : p)),
            }
          : e,
      ),
    })),
  // Changing density changes the physical spacing between nodes, so every
  // stored coordinate has to be remapped to preserve its *world position* —
  // otherwise the whole battle visibly jumps, since the same integer would
  // suddenly mean somewhere else. Remapping keeps a density switch what it
  // should be: a change of movement resolution and nothing else. (An earlier
  // cut left coordinates untouched and accepted the jump as a harmless snap;
  // once ships had to path around a body that sat at a fixed world position,
  // it stopped being harmless.) Queued paths are dropped rather than remapped
  // point-by-point, since a route planned at one resolution isn't
  // meaningfully the same route at another.
  setDensity: (engagementId, density) =>
    set((s) => ({
      engagements: s.engagements.map((e) => {
        if (e.id !== engagementId || e.density === density) return e
        const from = e.density
        return {
          ...e,
          density,
          center: remapNode(e.center, from, density),
          obstacles: e.obstacles.map((o) => ({ ...o, node: remapNode(o.node, from, density) })),
          participants: e.participants.map((p) => ({
            ...p,
            node: remapNode(p.node, from, density),
            hopFrom: remapNode(p.hopFrom, from, density),
            path: [],
          })),
        }
      }),
    })),
  // Slides the visible window. This is the answer to "movement shouldn't be
  // confined to one cube" — ships stay where they are in absolute lattice
  // terms, and the frame the player can issue orders within moves to include
  // new space.
  setCenter: (engagementId, center) =>
    set((s) => ({
      engagements: s.engagements.map((e) => (e.id === engagementId ? { ...e, center } : e)),
    })),
  setParticipant: (engagementId, participant) =>
    set((s) => ({
      engagements: s.engagements.map((e) =>
        e.id === engagementId
          ? { ...e, participants: e.participants.map((p) => (p.shipId === participant.shipId ? participant : p)) }
          : e,
      ),
    })),
  setHoldPosition: (engagementId, shipId, hold) =>
    set((s) => ({
      engagements: s.engagements.map((e) =>
        e.id === engagementId
          ? {
              ...e,
              participants: e.participants.map((p) =>
                p.shipId === shipId
                  ? // Releasing the latch also drops any queued path, so
                    // "resume auto-engage" takes effect immediately rather
                    // than after the ship finishes walking to wherever it was
                    // last sent.
                    hold ? { ...p, holdPosition: true } : { ...p, holdPosition: false, path: [] }
                  : p,
              ),
            }
          : e,
      ),
    })),
}))
