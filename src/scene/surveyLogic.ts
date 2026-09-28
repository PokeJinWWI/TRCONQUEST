// Exploration and survey, as pure functions over plain sets. A science ship
// EXPLORES a star by resting at it (revealing the system's information), then
// SURVEYS its bodies one after another at SURVEY_DAYS_PER_BODY each. A system
// is "fully surveyed" once every body in it is — which is what a Construction
// Ship needs before it can build a Starbase there. Live state is
// state/surveyStore.ts; the daily step is hooks/useSurveyResolver.ts.
//
// Two layers of the same facts exist (see the store): `discovered` is what the
// ship has actually found, `known` is what has reached the nation's capital by
// signal. Everything here works on ONE layer at a time, passed in as a
// NationIntel. A nation always knows its own systems — any system where it
// owns a body counts as explored and fully surveyed for it, with no report
// needed.
import { SURVEY_DAYS_PER_BODY } from '../data/surveyData'
import type { ShipLocation } from '../state/shipStore'
import { starbaseAnchorBody } from './starbaseLogic'
import { systemBodies, bodyStarId, type OwnerMap } from './territory'

export interface NationIntel {
  explored: ReadonlySet<string>
  surveyed: ReadonlySet<string>
}

export const EMPTY_INTEL: NationIntel = { explored: new Set(), surveyed: new Set() }

// A science ship's standing survey job at one star. `done` is how many bodies
// this job has completed so far; `startedSimDays` is when it (re)started.
export interface SurveyJob {
  starId: string
  startedSimDays: number
  done: number
}

// The star a ship is resting AT, if any: beside it in interstellar space, or
// orbiting the system's own primary star (where an order to a star ends up).
export function restingStarId(ship: { order: unknown; location: ShipLocation }): string | null {
  if (ship.order) return null
  const loc = ship.location
  if (loc.kind === 'star') return loc.starId
  if (loc.kind === 'orbiting' && starbaseAnchorBody(loc.systemId) === loc.bodyName) return loc.systemId
  return null
}

function nationOwnsIn(nationId: string, starId: string, owners: OwnerMap): boolean {
  for (const body of systemBodies(starId)) if (owners[body] === nationId) return true
  return false
}

export function isExplored(intel: NationIntel | undefined, nationId: string, starId: string, owners: OwnerMap): boolean {
  return !!intel?.explored.has(starId) || nationOwnsIn(nationId, starId, owners)
}

export function isBodySurveyed(intel: NationIntel | undefined, nationId: string, bodyName: string, owners: OwnerMap): boolean {
  if (intel?.surveyed.has(bodyName)) return true
  const starId = bodyStarId(bodyName)
  return !!starId && nationOwnsIn(nationId, starId, owners)
}

export function surveyProgress(intel: NationIntel | undefined, nationId: string, starId: string, owners: OwnerMap): { done: number; total: number } {
  const bodies = systemBodies(starId)
  return { done: bodies.filter((b) => isBodySurveyed(intel, nationId, b, owners)).length, total: bodies.length }
}

export function isFullySurveyed(intel: NationIntel | undefined, nationId: string, starId: string, owners: OwnerMap): boolean {
  const { done, total } = surveyProgress(intel, nationId, starId, owners)
  return total > 0 && done === total
}

// What a nation would see of a system: not there at all, explored but not
// (fully) surveyed, or fully surveyed.
export type SystemIntelStatus = 'unexplored' | 'explored' | 'surveyed'
export function systemIntelStatus(intel: NationIntel | undefined, nationId: string, starId: string, owners: OwnerMap): SystemIntelStatus {
  if (!isExplored(intel, nationId, starId, owners)) return 'unexplored'
  return isFullySurveyed(intel, nationId, starId, owners) ? 'surveyed' : 'explored'
}

// Bodies of this system still to survey, in the order a ship works through them.
export function unsurveyedBodies(intel: NationIntel | undefined, nationId: string, starId: string, owners: OwnerMap): string[] {
  return systemBodies(starId).filter((b) => !isBodySurveyed(intel, nationId, b, owners))
}

// One step of a survey job: which bodies it has finished by `simDays` (with the
// sim-day each was completed, so the report can be dated), the new `done`
// count, and whether nothing is left to survey. Pure: nothing is written.
export function stepSurveyJob(
  job: SurveyJob,
  simDays: number,
  remaining: string[],
  daysPerBody = SURVEY_DAYS_PER_BODY,
): { completed: { bodyName: string; atSimDays: number }[]; done: number; finished: boolean } {
  const due = Math.max(0, Math.floor((simDays - job.startedSimDays) / daysPerBody))
  const fresh = Math.max(0, due - job.done)
  const take = remaining.slice(0, fresh)
  const completed = take.map((bodyName, i) => ({ bodyName, atSimDays: job.startedSimDays + (job.done + i + 1) * daysPerBody }))
  return { completed, done: job.done + take.length, finished: remaining.length - take.length === 0 }
}
