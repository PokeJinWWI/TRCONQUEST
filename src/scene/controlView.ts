// The planet screen's Control tab, as data: who has a presence on a body and how much of it each nation controls, the player's colony
// progress there (the patrol clock, the outpost growing into a hall) and the decisions open to the player. Everything the old
// Territory tab showed (who governs, claims, agreements, orbit) stays in scene/territoryView.ts and is shown below this.
// Reads the stores, writes nothing: the tab's buttons call the same functions the rest of the game does.
import { COLONY_PATROL_DAYS, CLAIM_PLANET_MIN_POPULATION, OUTPOST_HALL_POPULATION } from '../data/colonyData'
import { STATION_ORBIT_FORCE } from '../data/territoryData'
import { ownerDisplay } from '../data/countryRoster'
import { atWar } from '../state/diplomacyStore'
import { useArmyStore } from '../state/armyStore'
import { useColonyStore } from '../state/colonyStore'
import { useGameTimeStore } from '../state/gameTimeStore'
import { useJurisdictionStore } from '../state/jurisdictionStore'
import { siteOwner } from '../state/locationStore'
import { useShipStore } from '../state/shipStore'
import { useStarbaseStore } from '../state/starbaseStore'
import { useTerritoryStore } from '../state/territoryStore'
import { armyStrength, hostileWarshipsAt, isArmed, orbitedBody } from './armyLogic'
import { isLive } from './claims'
import { orbitSecure } from './colonyLogic'
import { controlShares } from './controlShare'
import { locationsOf } from './locations'
import { claimPlanetBlock, claimPlanetCost, presencePopulation } from './planetClaim'

export interface PresenceRow {
  id: string
  name: string
  color: string
  isPlayer: boolean
  sovereign: boolean
  // Holds the ground by force (the body's controller).
  holdsGround: boolean
  population: number
  sites: number
  armies: number
  groundStrength: number
  armedShips: number
  stations: number
  // Fraction 0..1 of the world (scene/controlShare).
  share: number
}

export interface ColonyProgress {
  stage: 'micro' | 'planetary'
  // Patrol clock: days the orbit has been held, of COLONY_PATROL_DAYS (micro-colonies only).
  patrolDays: number
  patrolTarget: number
  // What is holding the promotion back, in the order a player can act on it.
  blockers: string[]
  // The settlement: an outpost until it holds `hallAt` millions, then a municipal hall.
  settlement: { kind: 'outpost' | 'hall'; population: number; hallAt: number }
}

export type DecisionId = 'claim-planet' | 'diplomacy'

export interface Decision {
  id: DecisionId
  label: string
  detail: string
  // Why it cannot be taken now (greyed), or null.
  block: string | null
  // The nation it is about (diplomacy).
  withId?: string
}

export interface ControlView {
  bodyName: string
  rows: PresenceRow[]
  colony: ColonyProgress | null
  decisions: Decision[]
}

export function controlView(bodyName: string, playerId: string | null): ControlView {
  const territory = useTerritoryStore.getState()
  const owner = territory.bodyOwner[bodyName]
  const controller = territory.bodyController[bodyName] ?? owner
  const ids = new Set<string>()
  if (owner) ids.add(owner)
  if (controller) ids.add(controller)
  const sites = new Map<string, number>()
  for (const s of locationsOf(bodyName)) {
    const o = siteOwner(s.id)
    if (!o) continue
    ids.add(o)
    sites.set(o, (sites.get(o) ?? 0) + 1)
  }
  const armies = useArmyStore.getState().armies.filter((a) => a.location.kind === 'body' && a.location.bodyName === bodyName)
  const ground = new Map<string, { armies: number; strength: number }>()
  for (const a of armies) {
    ids.add(a.ownerId)
    const g = ground.get(a.ownerId) ?? { armies: 0, strength: 0 }
    ground.set(a.ownerId, { armies: g.armies + 1, strength: g.strength + armyStrength(a).strength })
  }
  const ships = new Map<string, number>()
  for (const sh of useShipStore.getState().ships) {
    if (orbitedBody(sh) !== bodyName || !isArmed(sh)) continue
    ids.add(sh.ownerId)
    ships.set(sh.ownerId, (ships.get(sh.ownerId) ?? 0) + 1)
  }
  const stations = new Map<string, number>()
  for (const sb of useStarbaseStore.getState().starbases) {
    if (!sb.zone || !sb.zone.startsWith(`${bodyName}~`)) continue
    ids.add(sb.ownerId)
    stations.set(sb.ownerId, (stations.get(sb.ownerId) ?? 0) + 1)
  }
  const claims = useJurisdictionStore.getState().claims.filter((c) => isLive(c) && c.scope.kind === 'body' && c.scope.id === bodyName)
  for (const c of claims) ids.add(c.claimantId)

  const numbers = [...ids].map((id) => ({
    id,
    population: presencePopulation(id, bodyName),
    sites: sites.get(id) ?? 0,
    ground: ground.get(id)?.strength ?? 0,
    orbit: (ships.get(id) ?? 0) + (stations.get(id) ?? 0) * STATION_ORBIT_FORCE,
  }))
  const share = controlShares(numbers)
  const rows: PresenceRow[] = numbers
    .map((n) => ({
      id: n.id,
      name: ownerDisplay(n.id).name,
      color: ownerDisplay(n.id).color,
      isPlayer: n.id === playerId,
      sovereign: n.id === owner,
      holdsGround: n.id === controller,
      population: n.population,
      sites: n.sites,
      armies: ground.get(n.id)?.armies ?? 0,
      groundStrength: Math.round(n.ground),
      armedShips: ships.get(n.id) ?? 0,
      stations: stations.get(n.id) ?? 0,
      share: share[n.id] ?? 0,
    }))
    .sort((a, b) => b.share - a.share || a.name.localeCompare(b.name))

  const decisions: Decision[] = []
  if (playerId && !owner) {
    const cost = claimPlanetCost(bodyName)
    decisions.push({
      id: 'claim-planet',
      label: `Claim planet · ${cost} influence`,
      detail: `Reserves the whole world: nobody else may found a colony here. With ${CLAIM_PLANET_MIN_POPULATION} million of your people on it, the claim is recognized and the whole planet is yours.`,
      block: claimPlanetBlock(playerId, bodyName),
    })
  }
  for (const r of rows) {
    if (r.isPlayer) continue
    decisions.push({ id: 'diplomacy', label: `Open diplomacy with ${r.name}`, detail: `Treaties, rights of construction and access, recognition and war with ${r.name} are decided in Diplomacy.`, block: null, withId: r.id })
  }

  return { bodyName, rows, colony: playerId ? colonyProgress(bodyName, playerId) : null, decisions }
}

function colonyProgress(bodyName: string, playerId: string): ColonyProgress | null {
  const colony = useColonyStore.getState().colonies[bodyName]
  const owner = useTerritoryStore.getState().bodyOwner[bodyName]
  if (!colony || owner !== playerId) return null
  const now = useGameTimeStore.getState().simDays
  const blockers: string[] = []
  if (colony.stage === 'micro') {
    const ships = useShipStore.getState().ships
    if (hostileWarshipsAt(playerId, bodyName, ships, atWar).length > 0) blockers.push('Enemy warships hold the orbit')
    else if (!orbitSecure(playerId, bodyName, ships, atWar)) blockers.push('No armed ship is on patrol in orbit (ship panel: Patrol)')
    const holders = useTerritoryStore.getState().nodeHolders[bodyName] ?? {}
    if (Object.values(holders).some((h) => h !== playerId)) blockers.push('Another nation holds ground here')
  }
  const population = presencePopulation(playerId, bodyName)
  return {
    stage: colony.stage,
    patrolDays: colony.orbitSecureSinceSimDays === null ? 0 : Math.max(0, Math.min(COLONY_PATROL_DAYS, now - colony.orbitSecureSinceSimDays)),
    patrolTarget: COLONY_PATROL_DAYS,
    blockers,
    settlement: { kind: population >= OUTPOST_HALL_POPULATION ? 'hall' : 'outpost', population, hallAt: OUTPOST_HALL_POPULATION },
  }
}
