// Reads the game stores into the plain snapshot the Situations rules check
// (scene/situations.ts). Store I/O only; every judgement lives in the rules. Things
// foreign to the player go through what the player knows (a fight only once its
// news arrives, the `known` survey layer); its own ships, worlds and books are read
// live, as the AI reads its own.
import { SITUATION_LOW_SOL, SITUATION_RECENT_DAYS } from '../data/situationData'
import { RESOURCE_TYPES, type ResourceId } from '../data/resourceData'
import { INFLUENCE_CAP } from '../data/colonyData'
import { ARMY_KINDS } from '../data/armyData'
import { findStar } from '../data/starData'
import { getCountry } from '../data/countryData'
import { ownerDisplay } from '../data/countryRoster'
import { findTech } from '../data/techData'
import { GOODS, type GoodId } from '../economy/goods'
import { SEED_CALIBRATION } from '../economy/seedCalibration'
import { usePlayerStore } from '../state/playerStore'
import { useShipStore, type ShipInstance } from '../state/shipStore'
import { useFleetStore } from '../state/fleetStore'
import { useBattleStore } from '../state/battleStore'
import { useTerritoryStore } from '../state/territoryStore'
import { useArmyStore } from '../state/armyStore'
import { useShipyardStore } from '../state/shipyardStore'
import { useEconomyStore, worldByName } from '../state/economyStore'
import { useAbstractEconomyStore } from '../state/abstractEconomyStore'
import { useResourceStore } from '../state/resourceStore'
import { useUnrestStore, unrestNow } from '../state/unrestStore'
import { useDepositStore } from '../state/depositStore'
import { useInfrastructureStore } from '../state/infrastructureStore'
import { useTechStore } from '../state/techStore'
import { useSurveyStore } from '../state/surveyStore'
import { useStarbaseStore } from '../state/starbaseStore'
import { useDiplomacyStore, atWar } from '../state/diplomacyStore'
import { useJurisdictionStore } from '../state/jurisdictionStore'
import { useGameTimeStore } from '../state/gameTimeStore'
import { resolveShipClass } from '../state/shipClassResolver'
import { damageFraction } from './shipRepair'
import { hostileWarshipsAt, isBodyContested, armyStrength } from './armyLogic'
import { shipyardSlotsForWorld } from './shipyardLogic'
import { starbaseShipyardSlots } from './starbaseLogic'
import { unsurveyedBodies } from './surveyLogic'
import { scoreFor } from './warScore'
import { liveBodyValue } from './peace'
import { bodyStarId } from './territory'
import { isLive, scopeKey } from './claims'
import type { SituationSnapshot, SnapShip } from './situations'

const BATTLE_KIND_LABEL: Record<string, string> = { space: 'Space battle', ground: 'Ground battle', terrain: 'Ground battle', contest: 'Ground fighting' }

function whereOf(ship: ShipInstance): string {
  const loc = ship.location
  if (ship.order) return 'in transit'
  if (loc.kind === 'orbiting') return `in orbit of ${loc.bodyName}`
  if (loc.kind === 'star') return `at ${findStar(loc.starId)?.name ?? loc.starId}`
  if (loc.kind === 'system-point') return `in ${findStar(loc.systemId)?.name ?? loc.systemId}`
  return 'in deep space'
}

// Nothing to do: no order, queued leg, job, automation, command, follow or hold of any kind.
export function shipIsIdle(ship: ShipInstance): boolean {
  return (
    !ship.order &&
    !ship.pendingMoveOrder &&
    !(ship.pendingCommands?.length ?? 0) &&
    !(ship.orderQueue?.length ?? 0) &&
    !(ship.pendingQueueAdds?.length ?? 0) &&
    !(ship.automations?.length ?? 0) &&
    !ship.surveyJob &&
    !ship.arrivalCommand &&
    !ship.founding &&
    !ship.upgrading &&
    !ship.autoRoute &&
    !ship.followingShipId &&
    !ship.pendingHyperdriveJump &&
    !ship.patrol
  )
}

export function buildSituationSnapshot(): SituationSnapshot | null {
  const player = usePlayerStore.getState()
  const pid = player.selectedCountryId
  if (!pid || player.sandbox) return null
  const simDays = useGameTimeStore.getState().simDays
  const abstract = player.economyModel === 'abstract'
  const country = getCountry(pid)

  const allShips = useShipStore.getState().ships
  const fleets = new Map(useFleetStore.getState().fleets.map((f) => [f.id, f.name]))
  const ships: SnapShip[] = allShips
    .filter((s) => s.ownerId === pid)
    .map((s) => {
      const cls = resolveShipClass(s.classId)
      return {
        id: s.id,
        name: s.name,
        className: cls?.name ?? s.classId,
        role: cls?.role ?? 'civilian',
        fleetName: fleets.get(s.fleetId) ?? '',
        damage: damageFraction(s),
        idle: shipIsIdle(s),
        where: whereOf(s),
        note: s.automationNote ?? null,
        jumpWaitingDays: s.pendingHyperdriveJump && s.hyperdriveReadySimDays > simDays ? s.hyperdriveReadySimDays - simDays : null,
      }
    })

  const { bodyOwner, bodyController } = useTerritoryStore.getState()
  const ownBodies = Object.keys(bodyOwner).filter((b) => bodyOwner[b] === pid)
  const armies = useArmyStore.getState().armies

  const hostilesAtOwnWorlds = ownBodies.flatMap((bodyName) => {
    const hostile = hostileWarshipsAt(pid, bodyName, allShips, atWar)
    if (hostile.length === 0) return []
    const owners = [...new Set(hostile.map((h) => ownerDisplay(h.ownerId).name))].join(', ')
    return [{ bodyName, count: hostile.length, owners }]
  })

  // The yard: the capital's slips plus Starbase shipyard modules, one pool.
  const worlds = useEconomyStore.getState().worlds
  const orders = useShipyardStore.getState().ordersFor(pid)
  const capitalWorld = country ? worldByName(worlds, country.capitalBodyName) : undefined
  const slots = shipyardSlotsForWorld(capitalWorld) + starbaseShipyardSlots(pid, useStarbaseStore.getState().starbases, simDays)
  const building = orders.filter((o) => o.startedSimDays !== null).length

  const abs = useAbstractEconomyStore.getState()
  const absState = abs.byCountry[pid]
  const absReport = abs.reports[pid]
  const econ = useEconomyStore.getState()
  const fiscal = econ.countryReports[pid]
  const ownWorlds = worlds.filter((w) => w.ownerId === pid)

  const constructionQueued = abstract ? absState?.queue.length ?? 0 : ownWorlds.reduce((n, w) => n + w.constructionQueue.length, 0)
  const treasury = abstract ? absState?.treasury ?? 0 : fiscal?.treasury ?? 0
  const balancePerMonth = abstract ? (absReport?.balance ?? 0) / 12 : fiscal?.balance ?? 0

  const res = useResourceStore.getState().stateFor(pid)
  const strategic: ResourceId[] = ['hyperium', 'exoticMatter']
  const tracked = abstract ? RESOURCE_TYPES.map((r) => r.id).filter((id) => id !== 'influence') : strategic
  const resources = tracked.map((id) => ({ id, label: RESOURCE_TYPES.find((r) => r.id === id)?.name ?? id, amount: res.amounts[id] ?? 0, monthlyDelta: res.monthlyDelta[id] ?? 0 }))

  // Complex mode: each world's people below the low-SoL line, its employment, and its traded goods' prices.
  const worldRows: SituationSnapshot['worlds'] = []
  const prices: SituationSnapshot['prices'] = []
  if (!abstract) {
    for (const w of ownWorlds) {
      let total = 0
      let low = 0
      for (const p of w.pops) {
        total += p.populationSize
        if (p.standardOfLiving < SITUATION_LOW_SOL) low += p.populationSize
      }
      const report = econ.worldReports[w.id]
      let workers = 0
      let employed = 0
      for (const l of Object.values(report?.labor ?? {})) {
        workers += l.workers
        employed += l.workers * l.employmentRate
      }
      worldRows.push({ bodyName: w.name, lowSolShare: total > 0 ? low / total : null, employment: workers > 0 ? employed / workers : null })
      for (const [good, g] of Object.entries(report?.goods ?? {})) {
        if (!(g.transacted > 0) || !(g.price > 0)) continue
        const normal = SEED_CALIBRATION[w.name]?.prices?.[good as GoodId] ?? GOODS[good as GoodId]?.basePrice
        if (!normal) continue
        prices.push({ bodyName: w.name, good, label: GOODS[good as GoodId]?.label ?? good, ratio: g.price / normal })
      }
    }
  } else if (absReport && country) {
    const pop = Object.values(absReport.strata).reduce((n, s) => n + s.population, 0)
    worldRows.push({ bodyName: country.capitalBodyName, lowSolShare: null, employment: pop > 0 ? 1 - absReport.strata.unemployed.population / pop : null })
  }
  // Goods piling up: made far beyond use. Simple: the nation's monthly report (sales abroad count as use).
  // Complex: each world's market (demand includes buyers elsewhere it ships to).
  const surpluses: SituationSnapshot['surpluses'] = []
  if (abstract && absReport) {
    for (const g of Object.keys(absReport.produced) as (keyof typeof absReport.produced)[]) {
      const made = absReport.produced[g] ?? 0
      const used = (absReport.used[g] ?? 0) + (absReport.consumed[g] ?? 0) + Math.max(0, -(absReport.traded[g] ?? 0))
      if ((absReport.net[g] ?? 0) > 0) surpluses.push({ key: g, label: RESOURCE_TYPES.find((r) => r.id === g)?.name ?? g, where: null, made, used })
    }
  } else if (!abstract) {
    for (const w of ownWorlds) {
      for (const [good, g] of Object.entries(econ.worldReports[w.id]?.goods ?? {})) {
        if (g.supply > 0 && g.demand > 0) surpluses.push({ key: `${good}@${w.name}`, label: GOODS[good as GoodId]?.label ?? good, where: w.name, made: g.supply, used: g.demand })
      }
    }
  }
  const inflation = abstract ? absState?.inflation ?? 0 : fiscal?.inflation ?? 0

  const remaining = useDepositStore.getState().remaining
  const deposits: SituationSnapshot['deposits'] = []
  for (const [material, table] of Object.entries(remaining)) {
    for (const [bodyName, left] of Object.entries(table as Record<string, number>)) {
      if (bodyOwner[bodyName] === pid && (bodyController[bodyName] ?? pid) === pid) deposits.push({ bodyName, material: material === 'exoticMatter' ? 'exotic matter' : material, remaining: left })
    }
  }

  const tech = useTechStore.getState()
  const techState = tech.byCountry[pid]
  const queue = techState?.queue ?? []
  const blocked = queue.flatMap((id) => {
    const reason = tech.researchBlock(pid, id)
    return reason ? [{ name: findTech(id)?.name ?? id, reason }] : []
  })

  const intel = useSurveyStore.getState().known[pid]
  const ownStars = [...new Set(ownBodies.map((b) => bodyStarId(b)).filter((s): s is string => !!s))]
  const unsurveyed = ownStars.flatMap((starId) => {
    const n = unsurveyedBodies(intel, pid, starId, bodyOwner).length
    return n > 0 ? [{ starId, starName: findStar(starId)?.name ?? starId, count: n }] : []
  })

  const dip = useDiplomacyStore.getState()
  const wars = dip.wars
    .filter((w) => w.attackerId === pid || w.defenderId === pid)
    .map((w) => ({ id: w.id, enemyName: ownerDisplay(w.attackerId === pid ? w.defenderId : w.attackerId).name, score: scoreFor(w, pid, bodyOwner, bodyController, liveBodyValue) }))
  const recent = (t: number) => simDays - t <= SITUATION_RECENT_DAYS
  const encroachmentsAgainst = dip.encroachments
    .filter((e) => e.againstId === pid && recent(e.simDays))
    .map((e) => ({ id: e.id, byName: ownerDisplay(e.byId).name, starId: e.starId, starName: findStar(e.starId)?.name ?? e.starId }))
  // An incident counts once its news has reached the player.
  const incidentsAgainst = dip.incidents
    .filter((i) => i.victimId === pid && i.newsArrivesSimDays !== null && i.newsArrivesSimDays <= simDays && recent(i.startedSimDays))
    .map((i) => ({ id: i.id, byName: ownerDisplay(i.aggressorId).name, text: `${ownerDisplay(i.aggressorId).name} attacked your ships` }))

  // A claim of the player's on a scope another nation also claims (both live).
  const claims = useJurisdictionStore.getState().claims.filter(isLive)
  const byScope = new Map<string, typeof claims>()
  for (const c of claims) byScope.set(scopeKey(c.scope), [...(byScope.get(scopeKey(c.scope)) ?? []), c])
  const contestedClaims: SituationSnapshot['contestedClaims'] = []
  for (const [key, list] of byScope) {
    const mine = list.find((c) => c.claimantId === pid)
    const rivals = [...new Set(list.filter((c) => c.claimantId !== pid).map((c) => ownerDisplay(c.claimantId).name))]
    if (!mine || rivals.length === 0) continue
    const sc = mine.scope
    const place = sc.kind === 'body' ? { bodyName: sc.id } : sc.kind === 'system' ? { starId: sc.id } : undefined
    const label = sc.kind === 'system' ? findStar(sc.id)?.name ?? sc.id : sc.id
    contestedClaims.push({ key, label, rivals: rivals.join(' and '), ...(place ? { place } : {}) })
  }

  return {
    playerId: pid,
    economyModel: player.economyModel,
    ships,
    battles: useBattleStore.getState().battles.map((b) => ({ key: b.key, label: `${BATTLE_KIND_LABEL[b.kind] ?? 'Battle'} at ${b.place}` })),
    hostilesAtOwnWorlds,
    occupied: ownBodies.filter((b) => bodyController[b] && bodyController[b] !== pid).map((b) => ({ bodyName: b, byName: ownerDisplay(bodyController[b]!).name })),
    groundWar: ownBodies.filter((b) => isBodyContested(b, armies, bodyOwner, bodyController, atWar)),
    armies: armies
      .filter((a) => a.ownerId === pid && a.location.kind !== 'recruiting')
      .map((a) => {
        const { strength, max } = armyStrength(a)
        return { id: a.id, label: `${ARMY_KINDS[a.kind]?.name ?? a.kind} army`, strength, max, bodyName: a.location.kind === 'body' ? a.location.bodyName : null }
      }),
    yard: { slots, building, waiting: orders.length - building },
    constructionQueued,
    treasury,
    balancePerMonth,
    resources,
    influence: { amount: res.amounts.influence ?? 0, cap: INFLUENCE_CAP },
    inputShortages: abstract ? absReport?.inputShortages ?? [] : [],
    prices,
    surpluses,
    inflation,
    worlds: worldRows,
    unrest: unrestNow(pid, simDays, useUnrestStore.getState().byNation),
    deposits,
    routesInDisrepair: useInfrastructureStore.getState().routes.filter((r) => r.ownerId === pid && r.disrepair).map((r) => ({ id: r.id, bodyName: r.bodyName })),
    research: { hasIncome: abstract, queueLength: queue.length, blocked },
    unsurveyed,
    foundings: allShips.filter((s) => s.ownerId === pid && s.founding).map((s) => ({ shipId: s.id, shipName: s.name, bodyName: s.founding!.bodyName })),
    starbasesBuilding: useStarbaseStore
      .getState()
      .starbases.filter((b) => b.ownerId === pid && b.readySimDays > simDays)
      .map((b) => ({ starId: b.starId, starName: findStar(b.starId)?.name ?? b.starId, readyInDays: b.readySimDays - simDays })),
    wars,
    encroachmentsAgainst,
    incidentsAgainst,
    contestedClaims,
  }
}
