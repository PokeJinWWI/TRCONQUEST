import {
  BATTLESHIP_PROFILE,
  CIVILIAN_COMBAT_PROFILE,
  CORVETTE_PROFILE,
  CRUISER_PROFILE,
  DESTROYER_PROFILE,
  FRIGATE_PROFILE,
  TRANSPORT_COMBAT_PROFILE,
  type CombatProfile,
} from './combatData'
import { COLONY_SHIP_SETTLERS } from './colonyData'

// Every ship has sublight reaction thrusters regardless of what FTL drive(s)
// it also carries — warp/hyperdrives don't handle real-space maneuvering at
// all, that's what the reaction drive is for.
export interface WarpDrive {
  kind: 'warp'
  // No speed here: a ship warps at its OWNER's best Warp Drive Mk (data/warpData.ts),
  // fleet-wide, with no refit.
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
// Automated ships plan a route of several jumps (scene/jumpRoute.ts, scene/autoTravel.ts):
// the most jumps one trip may take (each costs the drive's cooldown)...
export const AUTO_ROUTE_MAX_JUMPS = 4
// ...and, with "Make unsafe jumps" ticked, the riskiest single jump a ship takes:
// what the slider starts at (1 = any jump, what automation did before the box
// existed), its lowest setting and its step.
export const AUTO_MAX_RISK_DEFAULT = 1
export const AUTO_MAX_RISK_MIN = 0.1
export const AUTO_MAX_RISK_STEP = 0.05
// Both rates are for an AVERAGE jump and scale with where the jump goes
// (scene/jumpRisk.ts): risk grows with the square root of the distance and the
// fourth root of the destination's mass, between these two multipliers. So an
// uncharted jump runs 25-80% and a charted one 5-16%, before damage or combat.
export const JUMP_RISK_DISTANCE_EXPONENT = 0.5
export const JUMP_RISK_MASS_EXPONENT = 0.25
export const JUMP_RISK_MIN_FACTOR = 0.5
export const JUMP_RISK_MAX_FACTOR = 1.6
// The distance between two neighbourhoods that counts as an average jump, in
// thousands of light-years (stars use their own neighbourhood's real average).
export const JUMP_RISK_CLUSTER_REF_KLY = 10

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
  // 'transport' is the exception that IS mechanical: only a transport hull
  // carries armies (see armyCapacity and scene/armyLogic.ts).
  //
  // 'science', 'construction' and 'cargo' are mechanical too: a science ship
  // explores and surveys (scene/surveyLogic.ts), a construction ship builds
  // Starbases out of the cargo it carries, and a cargo ship is the hauler
  // (scene/cargoLogic.ts).
  // 'colony' carries settlers and founds a colony (scene/colonies.ts).
  role: 'civilian' | 'warship' | 'transport' | 'science' | 'construction' | 'cargo' | 'colony'
  // How many armies this hull can carry. Absent/0 for everything but
  // transports.
  armyCapacity?: number
  // Total units of strategic goods (alloys, energy, exotic matter…) the hold
  // carries. Absent/0 = no hold. Loaded at an owned body, moved between ships
  // in the same place, and (construction ships) spent on a Starbase.
  cargoCapacity?: number
  // A tech the owning nation must have researched before it can BUILD this
  // hull at a shipyard (existing ships are unaffected).
  requiresTech?: string
  // A dev tool, not part of the game: never in the shipyard, the Ship Designer,
  // the sandbox's spawn list, a start fleet, a scenario or an AI build list.
  // Only the Debug Console spawns it (for testing hyperdrive/warp mechanics).
  devOnly?: boolean
  // The drive a ship of this class starts on (scene/driveChoice.ts); absent = 'auto'.
  defaultDrive?: 'reaction' | 'hyperdrive' | 'warp'
  // Offers the Auto-explore automation (scene/autoExplore.ts): only the Turing Scout.
  autoExplore?: boolean
  // The next level of this hull's upgrade line (a scout becomes this one by a
  // paid refit; the SAME ship, only its class changes: scene/shipRefit.ts).
  upgradesTo?: string
  // Scales the alloys and energy of the build cost (never the drive's hyperium
  // or special core): a cheaper (or dearer) hull than its hit points imply.
  buildCostFactor?: number
  // Settlers (millions) it takes from its capital when built (colony ships).
  settlerCapacity?: number
}

// Every ship is owned by a nation (ShipInstance.ownerId) — a class doesn't
// imply an owner, the same Corvette hull can fly for Mars or Venus. How a
// ship relates to whoever is LOOKING at it is never stored: it's derived from
// the owner and the viewer's diplomacy (see state/shipRelations.ts). 'own' is
// the viewer's nation, 'enemy' a nation at war with it, 'allied' a friendly
// no-nation faction (see countryRoster.ROGUE_FACTIONS; alliances between
// nations will use it too, later), 'neutral' anyone else. Drives every ship marker's
// color everywhere — viewport triangles, Outliner fleet icons, interstellar
// presence badges, route lines.
export type ShipRelation = 'own' | 'allied' | 'neutral' | 'enemy'

export const RELATION_COLORS: Record<ShipRelation, string> = {
  own: '#4ade80',
  allied: '#5ab0ff',
  neutral: '#ffd23f',
  enemy: '#ff3b3b',
}

export const RELATION_LABELS: Record<ShipRelation, string> = {
  own: 'Yours',
  allied: 'Allied',
  neutral: 'Neutral',
  enemy: 'Hostile',
}

// Warp speed tiers (Mk I-VII) live in data/warpData.ts: WARP_SPEED_TIERS_C.

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

// Hold sizes, in units of goods (picks, not balance). One Starbase costs 220
// alloys (data/starbaseData.ts), so a Construction Ship's own hold covers one.
export const CONSTRUCTION_SHIP_CARGO = 400
export const CARGO_SHIP_CARGO = 1500

// The scouts' alloys and energy cost, against a Science Ship's: a Hyperspace
// Scout is a cheap hull whose only job is charting lanes.
export const SCOUT_COST_FACTOR = 0.6

// The techs that unlock the scout line (data/techData.ts).
export const HYPERSPACE_SCOUT_TECH_ID = 'hyperspace-theory'
export const TURING_SCOUT_TECH_ID = 'autonomous-navigation'

// The techs that unlock the warship ladder, in order (data/techData.ts); the
// Corvette needs none.
export const FRIGATE_TECH_ID = 'frigate-hulls'
export const DESTROYER_TECH_ID = 'destroyer-hulls'
export const CRUISER_TECH_ID = 'cruiser-hulls'
export const BATTLESHIP_TECH_ID = 'battleship-hulls'

export const SHIP_CLASSES: ShipClass[] = [
  {
    // Dev tool (see ShipClass.devOnly): spawned from the Debug Console only.
    id: 'swift-courier',
    name: 'Swift Courier',
    reactionDrive: true,
    ftlDrives: [{ kind: 'hyperdrive', cooldownDays: HYPERDRIVE_BASE_COOLDOWN_DAYS }],
    combat: CIVILIAN_COMBAT_PROFILE,
    role: 'civilian',
    devOnly: true,
  },
  {
    // Dev tool (see ShipClass.devOnly).
    id: 'star-jumper',
    name: 'Star Jumper',
    reactionDrive: true,
    ftlDrives: [{ kind: 'hyperdrive', cooldownDays: HYPERDRIVE_BASE_COOLDOWN_DAYS }],
    combat: CIVILIAN_COMBAT_PROFILE,
    role: 'civilian',
    devOnly: true,
  },
  {
    // The first level of the scout line: a cheap hull whose only job is
    // mapping hyperlanes. Refitted into a Turing Scout (same ship) once
    // Autonomous Navigation is researched.
    id: 'hyperspace-scout',
    name: 'Hyperspace Scout',
    reactionDrive: true,
    ftlDrives: [{ kind: 'hyperdrive', cooldownDays: HYPERDRIVE_BASE_COOLDOWN_DAYS }],
    combat: CIVILIAN_COMBAT_PROFILE,
    role: 'civilian',
    requiresTech: HYPERSPACE_SCOUT_TECH_ID,
    upgradesTo: 'turing-scout',
    buildCostFactor: SCOUT_COST_FACTOR,
  },
  {
    // The last level of the scout line — otherwise identical to Hyperspace
    // Scout, but its navigational AI makes every jump safe (see
    // HyperDrive.lossChanceOverride), charted lane or not.
    id: 'turing-scout',
    name: 'Turing Scout',
    reactionDrive: true,
    ftlDrives: [{ kind: 'hyperdrive', cooldownDays: TURING_HYPERDRIVE_COOLDOWN_DAYS, lossChanceOverride: 0 }],
    defaultDrive: 'hyperdrive',
    autoExplore: true,
    combat: CIVILIAN_COMBAT_PROFILE,
    role: 'civilian',
    requiresTech: TURING_SCOUT_TECH_ID,
    buildCostFactor: SCOUT_COST_FACTOR,
  },
  {
    // Carries ground armies to invade enemy worlds (see scene/armyLogic.ts).
    // Unarmed, fast and evasive — it needs an escort to clear the target's
    // orbit first, since invading requires orbital superiority.
    id: 'troop-transport',
    name: 'Troop Transport',
    reactionDrive: true,
    ftlDrives: [{ kind: 'hyperdrive', cooldownDays: HYPERDRIVE_BASE_COOLDOWN_DAYS }],
    combat: TRANSPORT_COMBAT_PROFILE,
    role: 'transport',
    armyCapacity: 2,
  },
  {
    // Explores unvisited systems and surveys their bodies one by one (see
    // scene/surveyLogic.ts). Unarmed; available from the start.
    id: 'science-ship',
    name: 'Science Ship',
    reactionDrive: true,
    ftlDrives: [{ kind: 'hyperdrive', cooldownDays: HYPERDRIVE_BASE_COOLDOWN_DAYS }],
    combat: CIVILIAN_COMBAT_PROFILE,
    role: 'science',
  },
  {
    // Builds Starbases at fully surveyed systems, paid out of what it carries
    // (it is not consumed). Needs Orbital Construction to be built.
    id: 'construction-ship',
    name: 'Construction Ship',
    reactionDrive: true,
    ftlDrives: [{ kind: 'hyperdrive', cooldownDays: HYPERDRIVE_BASE_COOLDOWN_DAYS }],
    combat: CIVILIAN_COMBAT_PROFILE,
    role: 'construction',
    cargoCapacity: CONSTRUCTION_SHIP_CARGO,
    requiresTech: 'orbital-construction',
  },
  {
    // The hauler: carries a large load of goods to wherever a construction
    // ship is working.
    id: 'cargo-ship',
    name: 'Cargo Ship',
    reactionDrive: true,
    ftlDrives: [{ kind: 'hyperdrive', cooldownDays: HYPERDRIVE_BASE_COOLDOWN_DAYS }],
    combat: CIVILIAN_COMBAT_PROFILE,
    role: 'cargo',
    cargoCapacity: CARGO_SHIP_CARGO,
  },
  {
    // Carries settlers from the capital to found a colony on an unowned,
    // surveyed world (scene/colonies.ts); used up in the founding.
    id: 'colony-ship',
    name: 'Colony Ship',
    reactionDrive: true,
    ftlDrives: [{ kind: 'hyperdrive', cooldownDays: HYPERDRIVE_BASE_COOLDOWN_DAYS }],
    combat: CIVILIAN_COMBAT_PROFILE,
    role: 'colony',
    settlerCapacity: COLONY_SHIP_SETTLERS,
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
    ftlDrives: [{ kind: 'hyperdrive', cooldownDays: HYPERDRIVE_BASE_COOLDOWN_DAYS }],
    combat: CORVETTE_PROFILE,
    role: 'warship',
  },
  {
    // Long-range missile boat with no point defense of its own — devastating
    // against shielded targets, badly exposed to anything that closes.
    id: 'frigate',
    name: 'Frigate',
    reactionDrive: true,
    ftlDrives: [{ kind: 'hyperdrive', cooldownDays: HYPERDRIVE_BASE_COOLDOWN_DAYS }],
    combat: FRIGATE_PROFILE,
    role: 'warship',
    requiresTech: FRIGATE_TECH_ID,
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
    requiresTech: DESTROYER_TECH_ID,
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
    requiresTech: CRUISER_TECH_ID,
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
    requiresTech: BATTLESHIP_TECH_ID,
  },
]

// The hulls that belong to the game (everything but the dev tools).
export const PLAYER_SHIP_CLASSES: ShipClass[] = SHIP_CLASSES.filter((c) => !c.devOnly)
export const DEV_SHIP_CLASSES: ShipClass[] = SHIP_CLASSES.filter((c) => c.devOnly)

export function describeFtlDrive(drive: FtlDrive): string {
  return drive.kind === 'warp'
    ? `Warp Drive (speed set by your Warp Drive Mk, ${drive.cooldownDays}-day cooldown)`
    : `Hyperdrive (range and safety set by your Hyperdrive Mk, ${drive.cooldownDays}-day cooldown)`
}

export const SHIP_ROLE_LABELS: Record<ShipClass['role'], string> = {
  civilian: 'Civilian',
  warship: 'Warship',
  transport: 'Transport',
  science: 'Science',
  construction: 'Construction',
  cargo: 'Cargo',
  colony: 'Colony',
}
