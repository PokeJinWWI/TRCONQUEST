// What the strategic AI sees of its development, and how it acts on it (docs/territorial-design.md M12).
// Both halves go through the SAME functions the player's orders do: the AI sees its sites, routes and orbits
// as the game computes them, and builds by `buildRoute`, `buildFacility`, `foundSettlement` (so every
// right, price and physical limit applies to it; nothing here has a shortcut).
import { FREIGHT_PER_SLOT, ROUTE_SPECS } from '../data/infrastructureData'
import { atWar } from '../state/diplomacyStore'
import { siteOwner } from '../state/locationStore'
import { useOrbitalStore } from '../state/orbitalStore'
import { useStarbaseStore } from '../state/starbaseStore'
import { useGameTimeStore } from '../state/gameTimeStore'
import { useTechStore } from '../state/techStore'
import { STARBASE_MODULES } from '../data/starbaseData'
import { freeModuleSlots, isStarbaseActive, starbaseFirepower, stationPower } from './starbaseLogic'
import { usePlacementStore } from '../state/placementStore'
import { useTerritoryStore } from '../state/territoryStore'
import { accessOnBody, buildRoute, planRoute } from './infrastructureOrders'
import { locationsOf } from './locations'
import { orbitalControlNow } from './orbitalState'
import { isArmed } from './armyLogic'
import { systemOfShip } from './surveyLogic'
import { bodyStarId } from './territory'
import { useShipStore } from '../state/shipStore'
import { bodyOfZone } from './orbits'
import { usedSlots } from './placementOrders'
import { defaultGeo } from './sovereignty'
import { foundSettlement, urbanNow } from './urbanState'

export interface IsolatedSite {
  bodyName: string
  siteId: string
  access: number
  demand: number
}

const bodiesWithPlacements = (countryId: string): string[] => {
  const owners = useTerritoryStore.getState().bodyOwner
  return [...new Set(Object.keys(usePlacementStore.getState().placed).map((id) => id.slice(0, id.lastIndexOf('#'))))].filter((b) => owners[b] === countryId)
}

// Placed sites of this nation whose freight does not all reach a hub.
export function isolatedSitesOf(countryId: string): IsolatedSite[] {
  const out: IsolatedSite[] = []
  for (const body of bodiesWithPlacements(countryId)) {
    const access = accessOnBody(body, countryId)
    for (const id of Object.keys(usePlacementStore.getState().placed).filter((s) => s.startsWith(`${body}#`))) {
      if (siteOwner(id) !== countryId || (access[id] ?? 1) >= 0.99) continue
      out.push({ bodyName: body, siteId: id, access: access[id] ?? 1, demand: usedSlots(id) * FREIGHT_PER_SLOT })
    }
  }
  return out.sort((a, b) => b.demand * (1 - b.access) - a.demand * (1 - a.access) || (a.siteId < b.siteId ? -1 : 1))
}

// Owned bodies with no defense platform whose system an enemy's armed ships are in (the war is at the door), while the orbit
// is not yet held by the enemy: once it is, nobody may build there (scene/orbits), so the time to build is before.
export function threatenedBodiesOf(countryId: string, enemies: (a: string, b: string) => boolean = atWar): string[] {
  const owners = useTerritoryStore.getState().bodyOwner
  const ships = useShipStore.getState().ships
  const out: string[] = []
  for (const body of Object.keys(owners).filter((b) => owners[b] === countryId)) {
    const star = bodyStarId(body)
    if (!star) continue
    const enemyNear = ships.some((s) => enemies(countryId, s.ownerId) && isArmed(s) && systemOfShip(s) === star)
    const armedStation = useStarbaseStore.getState().starbases.some((sb) => sb.ownerId === countryId && !!sb.zone && bodyOfZone(sb.zone) === body && starbaseFirepower(sb) > 0)
    if (!enemyNear || armedStation || useOrbitalStore.getState().facilities.some((f) => f.ownerId === countryId && f.kind === 'defense' && bodyOfZone(f.zone) === body)) continue
    const control = orbitalControlNow(body).controller
    if (control && enemies(countryId, control)) continue
    out.push(body)
  }
  return out.sort()
}

// Open settlement sites on bodies where the nation's settlements are overcrowded.
export function settlementOpeningsOf(countryId: string): string[] {
  const out: string[] = []
  for (const body of bodiesWithPlacements(countryId)) {
    if (!urbanNow(body, countryId).some((s) => s.overcrowded)) continue
    const open = locationsOf(body).find((s) => s.kind === 'settlement' && !siteOwner(s.id))
    if (open) out.push(open.id)
  }
  return out
}

// Connects a cut-off site to the nearest hub the law and the ground let it reach: a road if that carries its
// freight, else a railway. The first that can be built is built.
export function connectSite(countryId: string, siteId: string): { ok: true } | { ok: false; reason: string } {
  const body = siteId.slice(0, siteId.lastIndexOf('#'))
  const sites = locationsOf(body)
  const from = sites.find((s) => s.id === siteId)
  if (!from || from.node === null) return { ok: false, reason: 'no such site' }
  const hubs = sites.filter((s) => s.node !== null && s.id !== siteId && siteOwner(s.id) && (s.kind === 'settlement' || (s.kind === 'infrastructure' && s.tags.includes('spaceport'))))
  const near = [...hubs].sort((a, b) => defaultGeo.cellsBetween(from.node!, a.node!) - defaultGeo.cellsBetween(from.node!, b.node!) || (a.id < b.id ? -1 : 1))
  const demand = usedSlots(siteId) * FREIGHT_PER_SLOT
  const kinds = demand > ROUTE_SPECS.road.capacity ? (['rail', 'road'] as const) : (['road', 'rail'] as const)
  const reasons: string[] = []
  for (const hub of near) {
    for (const kind of kinds) {
      const plan = planRoute(countryId, siteId, hub.id, kind)
      if (!plan.ok) {
        reasons.push(plan.reason)
        continue
      }
      const built = buildRoute(countryId, siteId, hub.id, kind)
      if (built.ok) return { ok: true }
      reasons.push(built.reason)
    }
  }
  // The most useful reason to give: what it cannot afford, then what the law forbids, then the lie of the land.
  return { ok: false, reason: reasons.find((r) => /^Not enough/.test(r)) ?? reasons.find((r) => !/^Cannot build there/.test(r)) ?? reasons[0] ?? 'no hub to reach' }
}

// Arms a threatened world from orbit: a station in its low orbit if the nation has none, then power for it, then guns (missiles once
// researched), then a bigger hull. One step a pass, by the same rules as the player's (starbaseStore).
export function buildDefensePlatform(countryId: string, bodyName: string): { ok: true } | { ok: false; reason: string } {
  const zone = `${bodyName}~low`
  const store = useStarbaseStore.getState()
  const now = useGameTimeStore.getState().simDays
  const mine = store.starbases.find((sb) => sb.zone === zone && sb.ownerId === countryId)
  if (!mine) return store.buildOrbitStation(countryId, zone, now)
  if (!isStarbaseActive(mine, now)) return { ok: false, reason: 'The station is still being built' }
  const mods = mine.modules ?? []
  const power = stationPower(mine)
  const researched = useTechStore.getState().stateFor(countryId).researched
  // Unpowered guns do nothing: add a solar array when the next module would not be covered.
  if (power.demand + 2 > power.supply && mods.filter((m) => m === 'solar-array').length < (STARBASE_MODULES['solar-array'].max ?? 1) && freeModuleSlots(mine) > 0) return store.buildModule(mine.id, 'solar-array', now)
  if (freeModuleSlots(mine) > 0) {
    const gun = researched.has('missile-platforms') && !mods.includes('missile-battery') ? 'missile-battery' : 'defense-battery'
    if (!mods.includes(gun)) return store.buildModule(mine.id, gun, now)
  }
  return store.upgradeTier(mine.id, now)
}

export function expandSettlement(countryId: string, siteId: string): { ok: true } | { ok: false; reason: string } {
  return foundSettlement(countryId, siteId)
}
