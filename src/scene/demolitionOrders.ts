// Taking a building or a district level down at a chosen site, store side: the rules of who may (scene/demolition has the costs),
// the payment (the same dual payment as every state project: the capital's goods in Complex, the strategic pool in Simple), then
// the removal itself through each economy's own door. The placement ledger is cut at THIS site, so the footprint on the map shrinks
// where the player pointed, not wherever the books happen to have room.
//
// Simple mode keeps its deconstruction bar (a teardown that runs down over months); Complex takes the level or building away at once.
// Neither pays salvage: a state that tears something down pays for the work.
import { controllerOf } from './territory'
import { useAbstractEconomyStore } from '../state/abstractEconomyStore'
import { useEconomyStore, worldByName } from '../state/economyStore'
import { usePlacementStore } from '../state/placementStore'
import { isAbstractEconomy } from '../state/playerStore'
import { useTerritoryStore } from '../state/territoryStore'
import { useUnrestStore } from '../state/unrestStore'
import { useGameTimeStore } from '../state/gameTimeStore'
import type { SimpleBuildingId, SimpleDistrictId } from '../data/simplisticEconomyData'
import type { DistrictType } from '../economy/recipes'
import { demolitionQuote, type DemolitionQuote } from './demolition'
import { pay, paysFromEconomy, shortOf } from './economyPayment'
import { districtOfBuilding } from './districtSites'
import { placedOn, reconcileBody, refOf } from './placementOrders'
import { locationById } from './locations'
import { urbanNow } from './urbanState'

export type DemolitionPlan = { ok: true; quote: DemolitionQuote; bodyName: string } | { ok: false; reason: string }

function holds(builderId: string, bodyName: string): string | null {
  const { bodyOwner, bodyController } = useTerritoryStore.getState()
  if (bodyOwner[bodyName] !== builderId) return `You do not govern ${bodyName}.`
  if (controllerOf(bodyName, bodyOwner, bodyController) !== builderId) return `${bodyName} is occupied.`
  return null
}

function affordable(builderId: string, quote: DemolitionQuote): string | null {
  const short = shortOf(builderId, quote.goods, quote.resources)
  return short.length > 0 ? `Not enough ${short.join(', ')}${paysFromEconomy(builderId) ? ' in the capital stockpile' : ''} to take it down.` : null
}

const levelsHere = (siteId: string, district: string): number => usePlacementStore.getState().levels[siteId]?.[district] ?? 0

function peopleAt(builderId: string, bodyName: string, siteId: string): number {
  return urbanNow(bodyName, builderId).find((s) => s.id === siteId)?.population ?? 0
}

// ---- a building --------------------------------------------------------------------------------

export function planDemolishBuilding(builderId: string, siteId: string, buildingId: string): DemolitionPlan {
  const site = locationById(siteId)
  if (!site) return { ok: false, reason: 'No such site.' }
  const held = holds(builderId, site.bodyName)
  if (held) return { ok: false, reason: held }
  reconcileBody(site.bodyName)
  if ((placedOn(siteId)[buildingId] ?? 0) <= 0) return { ok: false, reason: 'That building does not stand there.' }
  const district = districtOfBuilding(refOf(buildingId))
  const quote = demolitionQuote({ district, what: 'building', levelsHere: levelsHere(siteId, district) })
  const poor = affordable(builderId, quote)
  if (poor) return { ok: false, reason: poor }
  return { ok: true, quote, bodyName: site.bodyName }
}

export function demolishBuilding(builderId: string, siteId: string, buildingId: string): DemolitionPlan {
  const plan = planDemolishBuilding(builderId, siteId, buildingId)
  if (!plan.ok) return plan
  if (isAbstractEconomy()) {
    const r = useAbstractEconomyStore.getState().queueDemolish(builderId, plan.bodyName, buildingId as SimpleBuildingId)
    if (!r.ok) return { ok: false, reason: r.reason }
  } else {
    const world = worldByName(useEconomyStore.getState().worlds, plan.bodyName)
    // Only the state's own buildings: a company's property is not the government's to knock down.
    const b = world?.buildings.find((x) => x.recipeId === buildingId && x.owner.kind === 'state')
    if (!world || !b) return { ok: false, reason: 'That building belongs to a company, not the state.' }
    useEconomyStore.getState().downgradeBuilding(world.id, b.id, { noSalvage: true })
  }
  pay(builderId, plan.quote.goods, plan.quote.resources)
  usePlacementStore.getState().unplace(siteId, buildingId)
  return plan
}

// ---- a district level ---------------------------------------------------------------------------

export function planDemolishLevel(builderId: string, siteId: string, district: string): DemolitionPlan {
  const site = locationById(siteId)
  if (!site) return { ok: false, reason: 'No such site.' }
  const held = holds(builderId, site.bodyName)
  if (held) return { ok: false, reason: held }
  reconcileBody(site.bodyName)
  const here = levelsHere(siteId, district)
  if (here <= 0) return { ok: false, reason: `No ${district} level is developed there.` }
  const people = district === 'urban' || district === 'core' ? peopleAt(builderId, site.bodyName, siteId) : 0
  const quote = demolitionQuote({ district, what: 'level', levelsHere: here, populationMillions: people })
  const poor = affordable(builderId, quote)
  if (poor) return { ok: false, reason: poor }
  return { ok: true, quote, bodyName: site.bodyName }
}

export function demolishLevel(builderId: string, siteId: string, district: string): DemolitionPlan {
  const plan = planDemolishLevel(builderId, siteId, district)
  if (!plan.ok) return plan
  if (isAbstractEconomy()) {
    const r = useAbstractEconomyStore.getState().queueDemolishDistrict(builderId, plan.bodyName, district as SimpleDistrictId)
    if (!r.ok) return { ok: false, reason: r.reason }
  } else {
    const world = worldByName(useEconomyStore.getState().worlds, plan.bodyName)
    if (!world) return { ok: false, reason: 'No economy on that world.' }
    const r = useEconomyStore.getState().removeDistrictLevel(world.id, district as DistrictType)
    if (!r.ok) return r
  }
  pay(builderId, plan.quote.goods, plan.quote.resources)
  usePlacementStore.getState().removeLevel(siteId, district)
  // The people a demolished city level sends away are unhappy about it for a while.
  if (plan.quote.displacedMillions > 0) useUnrestStore.getState().add(builderId, plan.quote.displacedMillions, useGameTimeStore.getState().simDays)
  return plan
}
