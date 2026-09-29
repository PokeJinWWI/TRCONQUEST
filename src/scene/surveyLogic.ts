// Exploration and survey, as pure functions over plain sets. Any ship EXPLORES
// a star simply by entering its system (revealing the system's information:
// owner, borders, its bodies by name). A science ship SURVEYS bodies by flying
// to each one in turn and spending SURVEY_DAYS_PER_BODY in its orbit (what a
// world is like: class, size, habitability, and whether it can be settled). A
// system is "fully surveyed" once every body in it is — which is what a
// Construction Ship needs before it can build a Starbase there. Live state is
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

// A science ship's survey job: the bodies still to survey, in visiting order
// (`bodies[0]` is the one it is flying to or working on), and since when it
// has been at work in that body's orbit (null until it gets there). `starId`
// is the system the job was given for.
export interface SurveyJob {
  starId: string
  bodies: string[]
  workingSinceSimDays: number | null
}

// The system a ship is in, if any: resting in it (orbiting a body, at a
// point, or beside a star), or flying inside it. Null in interstellar transit.
export function systemOfShip(ship: { order: { space: string; systemId?: string } | null; location: ShipLocation }): string | null {
  if (ship.order) return ship.order.space === 'system' ? ship.order.systemId ?? null : null
  const loc = ship.location
  if (loc.kind === 'orbiting' || loc.kind === 'system-point') return loc.systemId
  if (loc.kind === 'star') return loc.starId
  return null
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

// The bodies a survey job visits, in order: every unsurveyed body of the
// system (planets outward, each followed by its moons), or just `onlyBody`.
export function surveyJobBodies(intel: NationIntel | undefined, nationId: string, starId: string, owners: OwnerMap, onlyBody?: string): string[] {
  const todo = unsurveyedBodies(intel, nationId, starId, owners)
  return onlyBody ? todo.filter((b) => b === onlyBody) : todo
}

// Where a science ship is, as far as its job cares.
export interface SurveyPlace {
  // The body it is resting in orbit of, if any.
  orbiting: string | null
  // The body it is flying to, if any.
  headingTo: string | null
}

export type SurveyStep =
  // Nothing left to survey: the job ends.
  | { kind: 'done' }
  // Fly to this body (the job carries on when it gets there).
  | { kind: 'fly'; bodyName: string; job: SurveyJob }
  // Under way to the body, or at work on it.
  | { kind: 'wait'; job: SurveyJob }
  // Finished this body at `atSimDays`; `job` is what is left (null: all done).
  | { kind: 'surveyed'; bodyName: string; atSimDays: number; job: SurveyJob | null }

// One step of a survey job. `remaining` is the job's bodies still unsurveyed
// (the caller filters them, since someone else may have surveyed one). Pure:
// nothing is written.
export function stepSurveyJob(job: SurveyJob, remaining: string[], place: SurveyPlace, simDays: number, daysPerBody = SURVEY_DAYS_PER_BODY): SurveyStep {
  if (remaining.length === 0) return { kind: 'done' }
  const target = remaining[0]
  // Work already started only counts if it was on this same body.
  const since = job.bodies[0] === target ? job.workingSinceSimDays : null
  const base: SurveyJob = { ...job, bodies: remaining, workingSinceSimDays: since }
  if (place.orbiting !== target) {
    const idle = { ...base, workingSinceSimDays: null }
    return place.headingTo === target ? { kind: 'wait', job: idle } : { kind: 'fly', bodyName: target, job: idle }
  }
  if (since === null) return { kind: 'wait', job: { ...base, workingSinceSimDays: simDays } }
  if (simDays - since < daysPerBody) return { kind: 'wait', job: base }
  const rest = remaining.slice(1)
  return { kind: 'surveyed', bodyName: target, atSimDays: since + daysPerBody, job: rest.length > 0 ? { ...job, bodies: rest, workingSinceSimDays: null } : null }
}
