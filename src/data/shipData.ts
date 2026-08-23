import {
  BATTLESHIP_PROFILE,
  CIVILIAN_COMBAT_PROFILE,
  CORVETTE_PROFILE,
  CRUISER_PROFILE,
  DESTROYER_PROFILE,
  FRIGATE_PROFILE,
  type CombatProfile,
} from './combatData'

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
  // Overrides the normal lane-dependent loss chance entirely (see
  // hyperdriveLossChance in shipPhysics.ts) — e.g. a Turing Scout's
  // navigational AI makes every jump safe (0), regardless of whether a lane
  // is already established. Undefined for every other hull: they use the
  // normal HYPERDRIVE_BASE_LOSS_CHANCE/HYPERDRIVE_ESTABLISHED_LANE_LOSS_CHANCE
  // pair below.
  lossChanceOverride?: number
}

// Chance (0..1) a hyperdrive jump stands a real risk of stranding and
// destroying the ship — not flavor text, see shipPhysics.planMove/
// hyperdriveLossChance. Exported as plain named constants (not inlined)
// specifically so a future tech system has one obvious place to read from —
// "framework for adjusting this later" means exactly this: nothing else
// hardcodes 0.5/0.1 anywhere, every caller goes through
// shipPhysics.hyperdriveLossChance, which reads these. No tech tree exists
// yet to actually move these, so today they're just fixed floors.
export const HYPERDRIVE_BASE_LOSS_CHANCE = 0.5
// Once a hyperlane already connects the two systems (see hyperlaneStore.ts —
// established by any hyperdrive ship successfully completing that exact
// jump before), the risk drops sharply — a charted route, not a blind jump.
export const HYPERDRIVE_ESTABLISHED_LANE_LOSS_CHANCE = 0.1

export type FtlDrive = WarpDrive | HyperDrive

export interface ShipClass {
  id: string
  name: string
  reactionDrive: true
  // Zero or more FTL drives — every ship today has at most one, but the
  // shape supports combining them (a future "HyperWarp Drive" hull with
  // both a warp and a hyperdrive) without changing later.
  ftlDrives: FtlDrive[]
  // Required, not optional, even for unarmed civilian hulls (which take
  // CIVILIAN_COMBAT_PROFILE) — every ship in the game can be *shot at*, so
  // making this total means no damage path anywhere needs a null check. An
  // unarmed hull is expressed as a profile with an empty `weapons` array,
  // not as a missing profile.
  combat: CombatProfile
  // Whether this hull is built to fight. Purely descriptive — nothing
  // mechanical keys off it (an unarmed hull is already harmless by virtue of
  // its empty weapon list); it exists so the Fleet Manager / Ship Designer
  // UI can group hulls by role without inferring intent from stat lines.
  role: 'civilian' | 'warship'
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

// The Turing Scout's navigational AI doesn't just make its jumps safe (see
// its lossChanceOverride) — it also recycles the drive far faster than a
// crewed hull can. Named separately rather than inlined so the two Turing
// advantages are visibly one design idea in one place.
export const TURING_HYPERDRIVE_COOLDOWN_DAYS = 7

// Warp drive baseline cooldown (days) after completing a jump — same
// "reducible by future tech, not modeled yet" caveat as hyperdrive's.
export const WARP_BASE_COOLDOWN_DAYS = 5

export const SHIP_CLASSES: ShipClass[] = [
  {
    id: 'swift-courier',
    name: 'Swift Courier',
    reactionDrive: true,
    ftlDrives: [{ kind: 'warp', speedC: 10, cooldownDays: WARP_BASE_COOLDOWN_DAYS }],
    combat: CIVILIAN_COMBAT_PROFILE,
    role: 'civilian',
  },
  {
    id: 'star-jumper',
    name: 'Star Jumper',
    reactionDrive: true,
    ftlDrives: [{ kind: 'hyperdrive', cooldownDays: HYPERDRIVE_BASE_COOLDOWN_DAYS }],
    combat: CIVILIAN_COMBAT_PROFILE,
    role: 'civilian',
  },
  {
    // Mechanically identical to Star Jumper for now — the distinct class
    // exists so it's already in place for its intended future role (a cheap,
    // resource-light hull whose only job is mapping hyperlanes, with no
    // other capabilities) once resource costs exist to make that mean
    // anything.
    id: 'hyperspace-scout',
    name: 'Hyperspace Scout',
    reactionDrive: true,
    ftlDrives: [{ kind: 'hyperdrive', cooldownDays: HYPERDRIVE_BASE_COOLDOWN_DAYS }],
    combat: CIVILIAN_COMBAT_PROFILE,
    role: 'civilian',
  },
  {
    // Otherwise identical to Hyperspace Scout — its navigational AI makes
    // every jump safe (see HyperDrive.lossChanceOverride), charted lane or
    // not.
    id: 'turing-scout',
    name: 'Turing Scout',
    reactionDrive: true,
    ftlDrives: [{ kind: 'hyperdrive', cooldownDays: TURING_HYPERDRIVE_COOLDOWN_DAYS, lossChanceOverride: 0 }],
    combat: CIVILIAN_COMBAT_PROFILE,
    role: 'civilian',
  },
  // Warship hulls. Named after the conventional wet-navy ladder per the
  // design brief, and deliberately differentiated by *damage type matchup*
  // rather than by raw stat inflation — a Frigate's missiles ignore a
  // Corvette's shields but are eaten by a Destroyer's point defense, so
  // there's a real counter triangle to play with before any tech tree or
  // ship designer exists to customize loadouts. Every warship keeps a real
  // FTL drive, per the brief, which is also what makes the charge-and-escape
  // mechanic available to all of them.
  {
    // Cheap shield-heavy skirmisher — short-ranged autocannons mean it has to
    // close, and it dies fast to anything that ignores shields.
    id: 'corvette',
    name: 'Corvette',
    reactionDrive: true,
    ftlDrives: [{ kind: 'warp', speedC: 10, cooldownDays: WARP_BASE_COOLDOWN_DAYS }],
    combat: CORVETTE_PROFILE,
    role: 'warship',
  },
  {
    // Long-range missile boat with no point defense of its own — devastating
    // against shielded targets, badly exposed to anything that closes.
    id: 'frigate',
    name: 'Frigate',
    reactionDrive: true,
    ftlDrives: [{ kind: 'warp', speedC: 10, cooldownDays: WARP_BASE_COOLDOWN_DAYS }],
    combat: FRIGATE_PROFILE,
    role: 'warship',
  },
  {
    // The dedicated escort answer to missiles/torpedoes — the highest point
    // defense rating in the roster, with balanced energy/kinetic guns.
    id: 'destroyer',
    name: 'Destroyer',
    reactionDrive: true,
    ftlDrives: [{ kind: 'hyperdrive', cooldownDays: HYPERDRIVE_BASE_COOLDOWN_DAYS }],
    combat: DESTROYER_PROFILE,
    role: 'warship',
  },
  {
    // Generalist line ship — carries all three direct-fire types so it has no
    // hard counter, at the cost of excelling at nothing.
    id: 'cruiser',
    name: 'Cruiser',
    reactionDrive: true,
    ftlDrives: [{ kind: 'hyperdrive', cooldownDays: HYPERDRIVE_BASE_COOLDOWN_DAYS }],
    combat: CRUISER_PROFILE,
    role: 'warship',
  },
  {
    // Torpedo-armed capital hull — enormous burst against anything without
    // point defense, and slow enough to be kited by a Frigate.
    id: 'battleship',
    name: 'Battleship',
    reactionDrive: true,
    ftlDrives: [{ kind: 'hyperdrive', cooldownDays: HYPERDRIVE_BASE_COOLDOWN_DAYS }],
    combat: BATTLESHIP_PROFILE,
    role: 'warship',
  },
]

export function describeFtlDrive(drive: FtlDrive): string {
  return drive.kind === 'warp'
    ? `Warp Drive (${drive.speedC}c, ${drive.cooldownDays}-day cooldown)`
    : `Hyperdrive (${drive.cooldownDays}-day cooldown)`
}
