// Orbital construction, store side: the same authorization as anything built on the ground, adapted to orbit
// (scene/jurisdiction.decideConstruction on an orbit scope), plus the physical fit of the zone and the
// payment. Whoever builds owns the facility; whoever governs the zone keeps governing it.
import { FACILITY_SPECS, type FacilityKind } from '../data/orbitalData'
import { useGameTimeStore } from '../state/gameTimeStore'
import { useOrbitalStore } from '../state/orbitalStore'
import { pay, paysFromEconomy, shortOf } from './economyPayment'
import { decideConstruction, type ConstructionDecision } from './jurisdiction'
import { facilityFits, zoneById, zoneSlotsUsed, type OrbitalFacility } from './orbits'
import { jurisdictionState } from './sovereignty'
import { recordTerritorialIncident } from './territorialIncidents'

// Days a facility takes to build.
const BUILD_DAYS: Record<FacilityKind, number> = { station: 60, shipyard: 120, defense: 90, hub: 80 }

export type FacilityPlan = { ok: true; decision: ConstructionDecision } | { ok: false; reason: string; decision?: ConstructionDecision }

export function planFacility(builderId: string, zone: string, kind: FacilityKind): FacilityPlan {
  const z = zoneById(zone)
  const used = zoneSlotsUsed(useOrbitalStore.getState().facilities, zone)
  const fit = facilityFits(z, kind, used)
  const decision = decideConstruction({ builderId, scope: { kind: 'orbit', id: zone }, asset: kind === 'defense' ? 'military' : 'orbital', physical: fit.ok ? { ok: true } : fit }, jurisdictionState())
  if (!decision.allowed) return { ok: false, reason: decision.reason, decision }
  const spec = FACILITY_SPECS[kind]
  const short = shortOf(builderId, spec.goods, spec.resources)
  if (short.length > 0) return { ok: false, reason: `Not enough ${short.join(', ')}${paysFromEconomy(builderId) ? ' in the capital stockpile' : ''}`, decision }
  return { ok: true, decision }
}

let counter = 0

export function buildFacility(builderId: string, zone: string, kind: FacilityKind): { ok: true; facility: OrbitalFacility } | { ok: false; reason: string } {
  const plan = planFacility(builderId, zone, kind)
  if (!plan.ok) return plan
  const spec = FACILITY_SPECS[kind]
  pay(builderId, spec.goods, spec.resources)
  const now = useGameTimeStore.getState().simDays
  counter += 1
  const facility: OrbitalFacility = { id: `orbital-${zone}-${kind}-${counter}`, zone, kind, ownerId: builderId, builtSimDays: now, readySimDays: now + BUILD_DAYS[kind] }
  recordTerritorialIncident(builderId, { kind: 'orbit', id: zone }, kind === 'defense' ? 'military' : 'orbital', now)
  useOrbitalStore.getState().add(facility)
  return { ok: true, facility }
}
