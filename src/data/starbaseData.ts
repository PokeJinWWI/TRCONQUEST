// Starbases (both economy modes): a nation's claim on a whole star system,
// standing at the system's own primary star rather than any one world — the
// piece that lets a nation hold territory with no colonized planet in it.
// Gated behind Orbital Construction (data/techData.ts). Tuning here; rules in
// scene/starbaseLogic.ts, state in state/starbaseStore.ts.
//
// Deliberately unarmed and produces nothing of its own (see the design
// discussion this was scoped from) — it does exactly one thing, claim the
// system it stands in, and can be fought down like a ground defense
// installation (see data/defenseData.ts, the closest existing analog): armor
// divides incoming damage, integrity is its hit points, destroyed at 0.
import type { ResourceCost } from './shipyardData'

export const STARBASE_COST: ResourceCost = { alloys: 220 }
export const STARBASE_BUILD_DAYS = 90
export const STARBASE_INTEGRITY = 50
export const STARBASE_ARMOR = 1.5
// Hostile warships in the system grind a Starbase down at this rate, split
// over however many are present — the same shape BATTERY_DAMAGE_PER_DAY uses
// for a ground defense battery, just aimed the other way (nothing here fires
// back).
export const STARBASE_DAMAGE_PER_DAY = 25
// What losing one is worth toward war score/exhaustion (scene/peace.recordLoss)
// — a war fought entirely over empty expansion space still has to mean
// something. Roughly a well-armed warship's worth, the same "picked, not
// derived" spirit as every other number here.
export const STARBASE_LOSS_VALUE = 40
