// Planetary defense installations (both economy modes): built on a world from
// its planet screen's Defense tab, placed on the ground map, held by whoever
// holds their node — so armies can capture them — and destroyed when their
// integrity runs out (ground fire, orbital bombardment). Tuning lives here;
// rules in scene/defenseLogic.ts, state in state/defenseStore.ts.
import type { ResourceCost } from './shipyardData'

export type DefenseKind = 'fortress' | 'shieldGenerator' | 'defenseBattery'
export const DEFENSE_KINDS: DefenseKind[] = ['fortress', 'shieldGenerator', 'defenseBattery']

export interface DefenseDef {
  name: string
  description: string
  integrity: number // hit points
  armor: number // divides incoming damage
  cost: ResourceCost // paid from the builder's stockpile
  buildDays: number
  maxPerWorld: number
}

export const DEFENSE_DEFS: Record<DefenseKind, DefenseDef> = {
  fortress: {
    name: 'Fortress',
    description:
      'A fortified strongpoint. Its holder’s units within 1 cell fight 60% harder, and it counts as a key point — an invader must hold it to take the world. Can be captured.',
    integrity: 60,
    armor: 2,
    cost: { alloys: 150, energy: 80 },
    buildDays: 60,
    maxPerWorld: 2,
  },
  shieldGenerator: {
    name: 'Planetary Shield Generator',
    description:
      'Projects a shield over the surrounding land: no enemy landings within 2 cells, and orbital bombardment does 80% less damage anywhere on the world while it stands. Can be captured or destroyed.',
    integrity: 40,
    armor: 1.5,
    cost: { alloys: 200, energy: 200, exoticMatter: 10 },
    buildDays: 90,
    maxPerWorld: 1,
  },
  defenseBattery: {
    name: 'Defense Battery',
    description:
      'Surface-to-orbit guns. While it stands, enemies lack orbital superiority here (they can’t land), and it pounds hostile warships in orbit every day. Can be captured or destroyed.',
    integrity: 30,
    armor: 1.5,
    cost: { alloys: 180, energy: 100 },
    buildDays: 75,
    maxPerWorld: 3,
  },
}

export const FORTRESS_DEFENSE = 1.6 // defense multiplier for the holder's units nearby
export const FORTRESS_RADIUS_CELLS = 1.0
export const SHIELD_RADIUS_CELLS = 2.0
export const SHIELD_BOMBARD_REDUCTION = 0.8
export const BATTERY_DAMAGE_PER_DAY = 30 // hull points per battery per day, split over hostile armed ships in orbit
export const INSTALLATION_SPACING_CELLS = 0.6 // minimum distance between two installations

// --- Orbital bombardment (scene/bombardment.ts) -------------------------------------
export type BombardStance = 'off' | 'limited' | 'full'
export const BOMBARD_STANCES: BombardStance[] = ['off', 'limited', 'full']
export const BOMBARD_STANCE_LABELS: Record<BombardStance, string> = { off: 'Hold fire', limited: 'Limited', full: 'Full' }
export const BOMBARD_STANCE_DESCRIPTIONS: Record<BombardStance, string> = {
  off: 'No bombardment.',
  limited: 'Strike military targets: defenses and ground forces. Some devastation.',
  full: 'Level everything: double the firepower, heavy devastation, and the population dies. Enemies will not forget it.',
}
export const BOMBARD_POWER_PER_WEAPON = 1 // damage per weapon per day (limited)
export const BOMBARD_FULL_MULT = 2
export const BOMBARD_SHARE_INSTALLATIONS = 0.5 // of the day's damage, to enemy installations…
export const BOMBARD_SHARE_UNITS = 0.3 // …to enemy ground units, the rest to devastation
export const DEVASTATION_PER_DAMAGE = 0.004 // devastation (0–1) per point of damage landing on the world
export const DEVASTATION_DECAY_PER_DAY = 0.002 // recovery per day while not bombarded
export const DEVASTATION_OUTPUT_LOSS = 0.5 // output lost at full devastation (both economy modes)
export const FULL_POP_LOSS_PER_DAMAGE = 0.00005 // population share killed per point of full-stance damage…
export const FULL_POP_LOSS_MAX_PER_DAY = 0.002 // …capped per day
export const BOMBARD_OPINION_PER_DAY = -0.5 // the victim's opinion of the bomber
export const BOMBARD_EXHAUSTION_PER_DAMAGE = 0.02 // war exhaustion added to the victim
