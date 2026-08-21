// Every ship has sublight reaction thrusters regardless of what FTL drive(s)
// it also carries — warp/hyperdrives don't handle real-space maneuvering at
// all, that's what the reaction drive is for.
export interface WarpDrive {
  kind: 'warp'
  speedC: number
  // Days a warp drive needs to recharge after completing a jump before it
  // can be used again — mirrors HyperDrive's cooldownDays. During that
  // window an order still works, just at reaction-drive speed (see
  // shipPhysics.planMove) rather than being refused outright the way a
  // hyperdrive jump is; reaction drive is always available, so there's no
  // reason to fully block the ship.
  cooldownDays: number
}

export interface HyperDrive {
  kind: 'hyperdrive'
  cooldownDays: number
}

export type FtlDrive = WarpDrive | HyperDrive

export interface ShipClass {
  id: string
  name: string
  reactionDrive: true
  // Zero or more FTL drives — every ship today has at most one, but the
  // shape supports combining them (a future "HyperWarp Drive" hull with
  // both a warp and a hyperdrive) without changing later.
  ftlDrives: FtlDrive[]
}

// Who's flying a ship, not what hull it's flying — a class doesn't imply an
// owner (the same Swift Courier hull could be player-owned or hostile), so
// this lives on ShipInstance (see shipStore.ts) rather than ShipClass.
// Drives every fleet marker's color everywhere (viewport triangles, the
// Outliner's fleet icons, interstellar presence badges) — a single source of
// truth instead of the old per-class color that only meant "which hull."
export type FleetAllegiance = 'player' | 'friendly' | 'neutral' | 'hostile'

export const ALLEGIANCE_COLORS: Record<FleetAllegiance, string> = {
  player: '#4ade80',
  friendly: '#4da6ff',
  neutral: '#ffd23f',
  hostile: '#ff3b3b',
}

export const ALLEGIANCE_LABELS: Record<FleetAllegiance, string> = {
  player: 'Player',
  friendly: 'Friendly',
  neutral: 'Neutral',
  hostile: 'Hostile',
}

// Warp speed tiers a warp drive can be researched up to — order-of-magnitude
// jumps, capped at a deliberately non-round final tier (314c, a nod to π)
// rather than a clean 1000c. Not wired to an actual tech tree yet since this
// project doesn't have gameplay/research systems (see bodyStats.ts for the
// same "real data, no simulation behind it yet" caveat) — each step is
// meant to represent "a lot of technological progress," per the design
// brief, once research exists to gate it.
export const WARP_SPEED_TIERS_C = [0.5, 1, 10, 100, 314] as const

// Hyperdrive baseline cooldown (days) between jumps — reducible by future
// tech, not modeled yet.
export const HYPERDRIVE_BASE_COOLDOWN_DAYS = 27

// Warp drive baseline cooldown (days) after completing a jump — same
// "reducible by future tech, not modeled yet" caveat as hyperdrive's.
export const WARP_BASE_COOLDOWN_DAYS = 5

export const SHIP_CLASSES: ShipClass[] = [
  {
    id: 'swift-courier',
    name: 'Swift Courier',
    reactionDrive: true,
    ftlDrives: [{ kind: 'warp', speedC: 10, cooldownDays: WARP_BASE_COOLDOWN_DAYS }],
  },
  {
    id: 'star-jumper',
    name: 'Star Jumper',
    reactionDrive: true,
    ftlDrives: [{ kind: 'hyperdrive', cooldownDays: HYPERDRIVE_BASE_COOLDOWN_DAYS }],
  },
]

export function describeFtlDrive(drive: FtlDrive): string {
  return drive.kind === 'warp'
    ? `Warp Drive (${drive.speedC}c, ${drive.cooldownDays}-day cooldown)`
    : `Hyperdrive (${drive.cooldownDays}-day cooldown)`
}
