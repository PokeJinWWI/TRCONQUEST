// Orbital zones, facilities and who holds an orbit (docs/territorial-design.md M8). Pure.
// Three things stay apart:
//   JURISDICTION  who has the right to govern a zone: its own claim, else the body's sovereign
//                 (the default), else the system's (scene/jurisdiction, scope kind 'orbit').
//   OWNERSHIP     who owns a facility: a station is its builder's property whoever governs the zone.
//                 A foreign station never makes its owner sovereign of anything.
//   CONTROL       who holds the orbit BY FORCE right now: derived from armed ships and defense
//                 platforms present, never from title. It changes as the forces do.
import { FACILITY_SPECS, ORBITAL_ZONE_KINDS, ORBIT_DOMINANCE_RATIO, ZONE_SLOTS, type FacilityKind, type OrbitalZoneKind } from '../data/orbitalData'

export interface OrbitalZone {
  id: string
  bodyName: string
  kind: OrbitalZoneKind
  slots: number
}

export const zoneId = (bodyName: string, kind: OrbitalZoneKind): string => `${bodyName}~${kind}`
export const bodyOfZone = (id: string): string => id.slice(0, id.lastIndexOf('~'))

export function orbitalZonesOf(bodyName: string): OrbitalZone[] {
  return ORBITAL_ZONE_KINDS.map((kind) => ({ id: zoneId(bodyName, kind), bodyName, kind, slots: ZONE_SLOTS[kind] }))
}

export function zoneById(id: string): OrbitalZone | undefined {
  const i = id.lastIndexOf('~')
  if (i < 0) return undefined
  const kind = id.slice(i + 1) as OrbitalZoneKind
  return ORBITAL_ZONE_KINDS.includes(kind) ? { id, bodyName: id.slice(0, i), kind, slots: ZONE_SLOTS[kind] } : undefined
}

export interface OrbitalFacility {
  id: string
  zone: string
  kind: FacilityKind
  ownerId: string
  builtSimDays: number
  // Working from this simDays (absolute deadline).
  readySimDays: number
}

export const facilityWorking = (f: OrbitalFacility, simDays: number): boolean => simDays >= f.readySimDays

export function zoneSlotsUsed(facilities: readonly OrbitalFacility[], zone: string): number {
  return facilities.filter((f) => f.zone === zone).reduce((n, f) => n + FACILITY_SPECS[f.kind].slots, 0)
}

// Can a facility of this kind physically go in this zone?
export function facilityFits(zone: OrbitalZone | undefined, kind: FacilityKind, used: number): { ok: true } | { ok: false; reason: string } {
  if (!zone) return { ok: false, reason: 'there is no such orbital zone' }
  const spec = FACILITY_SPECS[kind]
  if (!spec.zones.includes(zone.kind)) return { ok: false, reason: `a ${spec.name.toLowerCase()} cannot stand in ${zone.kind} orbit` }
  if (used + spec.slots > zone.slots) return { ok: false, reason: `${zone.kind} orbit is full` }
  return { ok: true }
}

export interface OrbitalControl {
  // Armed strength of each nation present.
  forces: Record<string, number>
  // The nation that holds the orbit by force, if one dominates.
  controller?: string
  // Rival armed forces are present and none dominates.
  contested: boolean
}

// Who holds a body's orbit. Strength = armed ships' weapons plus working defense platforms.
// A nation dominates when it is armed and its strength is at least ORBIT_DOMINANCE_RATIO times that of the
// nations at war with it; with nobody armed there is no controller at all (the orbit is open).
export function orbitalControl(forces: Record<string, number>, atWar: (a: string, b: string) => boolean): OrbitalControl {
  const present = Object.keys(forces).filter((n) => forces[n] > 0).sort()
  const out: OrbitalControl = { forces: Object.fromEntries(present.map((n) => [n, forces[n]])), contested: false }
  const dominant = present.filter((n) => {
    const opposed = present.filter((m) => atWar(n, m)).reduce((sum, m) => sum + forces[m], 0)
    return opposed === 0 || forces[n] >= ORBIT_DOMINANCE_RATIO * opposed
  })
  if (dominant.length > 0) out.controller = [...dominant].sort((a, b) => forces[b] - forces[a] || (a < b ? -1 : 1))[0]
  else out.contested = present.length > 1
  return out
}

export type OrbitalAction = 'supply' | 'land'

// What the force on the orbit allows a nation to do at a body, whatever the law says: a nation at war with
// whoever holds the orbit cannot reinforce, resupply, evacuate or land there. (Docking and transit
// RIGHTS are agreements: M9.)
export function orbitalAccess(nationId: string, control: OrbitalControl, atWar: (a: string, b: string) => boolean): { ok: true } | { ok: false; reason: string } {
  if (control.controller && control.controller !== nationId && atWar(control.controller, nationId)) return { ok: false, reason: 'an enemy holds the orbit' }
  return { ok: true }
}
