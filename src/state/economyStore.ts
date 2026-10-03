import { create } from 'zustand'
import { useDiplomacyStore } from './diplomacyStore'
import { useTradePolicyStore, inSharedMarket } from './tradePolicyStore'
import { pairKey } from '../data/diplomacyData'
import { useStarbaseStore } from './starbaseStore'
import { isStarbaseActive, starbaseModulesOf, starbaseAnchorBody } from '../scene/starbaseLogic'
import { useGameTimeStore } from './gameTimeStore'
import { TRADE_HUB_INTERSTELLAR } from '../data/starbaseData'
import { advanceEmpiresInline, onEmpireUpdate, runOffThread, startEmpires, stopEmpires } from './economyEngine'
import type { EmpireSummary, EmpireUpdate } from '../economy/empireSim'
import { HISTORY_LENGTH, MAX_CATCH_UP_TICKS, runEconomySteps, unemploymentOf, type EconomyStepInput, type EconomyStepOutput, type FiscalSample } from '../economy/economyStep'
import { districtOrder, freeLandOfWorld } from '../economy/districts'
import type { DistrictType } from '../economy/recipes'
import { usePlayerStore } from './playerStore'
import { seedWorlds, seedCountries, seedCorporations, seedCharacters, seedFamilies, seedBanks } from '../economy/economySeed'
import { sharePrice, corporationValue, canBuild, BUILD_COST_PER_LEVEL } from '../economy/economyTick'
import { RETOOL_THROUGHPUT_FACTOR, type EconomicSystem } from '../economy/laws'
import {
  defaultCentralBank,
  debtFinancingRegimeDef,
  governmentControlsPolicy,
  governorAppointmentDef,
  hasCentralBank,
  type CentralBank,
  type CentralBankStatus,
  type BankStructure,
  type PolicyAuthority,
  type GovernorAppointment,
  type CentralBankMandate,
  type DebtFinancingRegime,
  type ExchangeRateRegime,
} from '../economy/centralBank'
import { convertBetween } from '../economy/fx'
import { RECIPES, constructionWork } from '../economy/recipes'
import { useTechStore } from './techStore'
import type { Building, BuildingOwner, Character, Corporation, Country, CountryFiscal, World, WorldReport } from '../economy/economyTypes'
import { SEZ_DEFAULT_TAX_DISCOUNT } from '../economy/economyTypes'
import type { GoodId } from '../economy/goods'
import { hasInvestmentRights } from './treatyStore'

// Shares held by the corporation's OWN (home) government — foreign-state stakes
// don't count toward domestic state ownership.
function homeStateShares(corp: Corporation): number {
  return corp.shares.filter((s) => s.holder.kind === 'state' && (s.holder.countryId === undefined || s.holder.countryId === corp.countryId)).reduce((n, s) => n + s.shares, 0)
}

// The kind a corporation should be given its HOME-state shareholding: a domestic
// state majority makes it state-owned, otherwise private. A financial district
// keeps its own kind regardless.
function derivedKind(corp: Corporation): Corporation['kind'] {
  if (corp.kind === 'financial') return 'financial'
  return corp.totalShares > 0 && homeStateShares(corp) / corp.totalShares >= 0.5 ? 'state' : 'private'
}

// Execute a foreign-equity buy/sell: a state (investorKind 'state', investorId a
// countryId) or a company (investorKind 'corporation', investorId a corp id)
// takes/sells `shares` of `targetCorpId` from its public float, paid from the
// investor's treasury/cash. Returns updated corporations + countries, or null if
// the trade can't happen (no float, can't afford, etc.). Shared by the direct
// invest actions and the approval flow.
function executeForeignBuy(
  corporations: Corporation[],
  countries: Country[],
  worlds: World[],
  investorKind: 'state' | 'corporation',
  investorId: string,
  targetCorpId: string,
  shares: number,
): { corporations: Corporation[]; countries: Country[] } | null {
  const target = corporations.find((c) => c.id === targetCorpId)
  if (!target) return null
  const match = (h: Corporation['shares'][number]['holder']) => (investorKind === 'state' ? h.kind === 'state' && h.countryId === investorId : h.kind === 'corporation' && h.id === investorId)
  const held = target.shares.filter((s) => match(s.holder)).reduce((n, s) => n + s.shares, 0)
  const publicHolding = target.shares.find((s) => s.holder.kind === 'public')?.shares ?? 0
  const delta = Math.max(-held, Math.min(publicHolding, Math.round(shares)))
  if (delta === 0) return null
  // The share price is in the HOST company's currency; the investor pays in its
  // OWN currency, so convert across the exchange rate (Stage 3 FX). A domestic
  // buy (same country) converts 1:1.
  const investorCountryId = investorKind === 'state' ? investorId : corporations.find((c) => c.id === investorId)?.countryId ?? investorId
  const costHost = delta * sharePrice(target, worlds)
  const cost = convertBetween(costHost, target.countryId, investorCountryId, countries)
  if (investorKind === 'state') {
    const inv = countries.find((c) => c.id === investorId)
    if (!inv || (delta > 0 && cost > inv.treasury)) return null
  } else {
    const inv = corporations.find((c) => c.id === investorId)
    if (!inv || (delta > 0 && cost > inv.cash)) return null
  }
  const nextShares: Corporation['shares'] = []
  for (const h of target.shares) {
    if (match(h.holder) || h.holder.kind === 'public') continue
    nextShares.push(h)
  }
  if (held + delta > 0) nextShares.push({ holder: investorKind === 'state' ? { kind: 'state', countryId: investorId } : { kind: 'corporation', id: investorId }, shares: held + delta })
  if (publicHolding - delta > 0) nextShares.push({ holder: { kind: 'public' }, shares: publicHolding - delta })
  const nextCorporations = corporations.map((c) => {
    if (c.id === targetCorpId) return { ...c, shares: nextShares }
    if (investorKind === 'corporation' && c.id === investorId) return { ...c, cash: c.cash - cost }
    return c
  })
  const nextCountries = investorKind === 'state' ? countries.map((c) => (c.id === investorId ? { ...c, treasury: c.treasury - cost } : c)) : countries
  return { corporations: nextCorporations, countries: nextCountries }
}

// A corporation's HQ grows with the assets it owns.
function hqLevel(assetCount: number): number {
  return Math.max(1, Math.round(assetCount / 3))
}
let hqCounter = 0
function makeHqBuilding(corporationId: string, level: number): Building {
  hqCounter += 1
  return {
    id: `hq-${corporationId}-${hqCounter}`,
    recipeId: 'corporateHq',
    methodId: 'standard',
    methodLocked: false,
    level,
    owner: { kind: 'corporation', corporationId },
    inventory: {},
    throughput: 1,
    lastProfit: 0,
    employed: 0,
    jobsPosted: 0,
  }
}

// A fresh level-1 building of a recipe for a given owner (used when
// nationalizing/privatizing a level into a type nobody owns yet on that world).
let levelBuildCounter = 0
function makeLevelBuilding(recipeId: string, owner: BuildingOwner): Building {
  levelBuildCounter += 1
  return {
    id: `lvl-${recipeId}-${levelBuildCounter}`,
    recipeId,
    methodId: RECIPES[recipeId]?.methods[0]?.id ?? 'standard',
    methodLocked: false,
    level: 1,
    owner,
    inventory: {},
    throughput: 0.1,
    lastProfit: 0,
    employed: 0,
    jobsPosted: 0,
  }
}

// In a world's building list, add `count` levels of `recipeId` for `owner`:
// grow an existing same-owner building of that type, or append a fresh one.
function addOwnerLevels(buildings: Building[], recipeId: string, owner: BuildingOwner, count: number): Building[] {
  if (count <= 0) return buildings
  const match = buildings.find(
    (b) => b.recipeId === recipeId && b.owner.kind === owner.kind && (owner.kind !== 'corporation' || (b.owner as { corporationId?: string }).corporationId === owner.corporationId),
  )
  if (match) return buildings.map((b) => (b.id === match.id ? { ...b, level: b.level + count } : b))
  return [...buildings, { ...makeLevelBuilding(recipeId, owner), level: count }]
}

// Remove `count` levels of a building (demolished when nothing is left).
function removeLevels(buildings: Building[], buildingId: string, count: number): Building[] {
  const b = buildings.find((x) => x.id === buildingId)
  if (!b) return buildings
  if (b.level - count <= 0) return buildings.filter((x) => x.id !== buildingId)
  return buildings.map((x) => (x.id === buildingId ? { ...x, level: x.level - count } : x))
}

// Float a fresh private company for a country (used when privatizing a level and
// no private company exists to receive it). Publicly held, with a leader.
function makePrivateCorp(countryId: string, name: string, sector: string, cultureId: string): { corp: Corporation; leader: Character } {
  corpCounter += 1
  charCounter += 1
  const corpId = `corp-${corpCounter}`
  const leaderId = `char-${charCounter}`
  const leader: Character = {
    id: leaderId,
    name: randomName(),
    age: 40 + Math.floor(Math.random() * 20),
    role: 'corp-leader',
    corporationId: corpId,
    cultureId,
    religionId: 'non-affiliated',
    speciesTemplateId: 'baseline-organic',
    traits: [randomTrait()],
    wealth: 300,
    skills: { administration: 4, finance: 4, diplomacy: 4 },
    log: [`Founded ${name}.`],
  }
  const corp: Corporation = {
    id: corpId,
    name,
    countryId,
    kind: 'private',
    cash: 2000,
    totalShares: 1000,
    shares: [
      { holder: { kind: 'character', id: leaderId }, shares: 500 },
      { holder: { kind: 'public' }, shares: 500 },
    ],
    leaderId,
    lastProfit: 0,
    sector,
  }
  return { corp, leader }
}

// Ensure every corporation has exactly one HQ building, on the world where it
// holds the most assets (or its country's first world if it owns nothing),
// sized to its asset count. Rebuilt whenever ownership changes.
function syncCorporateHqs(worlds: World[], corporations: Corporation[]): World[] {
  const info = new Map<string, { assets: number; homeIdx: number }>()
  for (const c of corporations) info.set(c.id, { assets: 0, homeIdx: -1 })
  worlds.forEach((w, idx) => {
    for (const b of w.buildings) {
      if (b.owner.kind !== 'corporation') continue
      const inf = info.get(b.owner.corporationId)
      if (!inf) continue
      if (RECIPES[b.recipeId]?.category !== 'corporate') {
        inf.assets++
        if (inf.homeIdx < 0) inf.homeIdx = idx
      }
    }
  })
  const next = worlds.map((w) => ({ ...w, buildings: w.buildings.filter((b) => RECIPES[b.recipeId]?.category !== 'corporate') }))
  for (const c of corporations) {
    const inf = info.get(c.id)!
    let homeIdx = inf.homeIdx
    if (homeIdx < 0) homeIdx = next.findIndex((w) => w.ownerId === c.countryId)
    if (homeIdx < 0) continue
    next[homeIdx] = { ...next[homeIdx], buildings: [...next[homeIdx].buildings, makeHqBuilding(c.id, hqLevel(inf.assets))] }
  }
  return next
}

// Fraction of a level's build cost recovered when a building is torn down a
// level (or demolished). Demolition is quick but you don't get it all back.
const DOWNGRADE_SALVAGE = 0.3

interface EconomyStore {
  countries: Country[]
  worlds: World[]
  corporations: Corporation[]
  characters: Character[]
  families: import('../economy/economyTypes').Family[]
  // Commercial banks (Stage 2 central banking). Ticked alongside the economy.
  banks: import('../economy/economyTypes').Bank[]
  tick: number
  worldReports: Record<string, WorldReport>
  countryReports: Record<string, CountryFiscal>
  // Per-country monetary aggregates from the last tick (money supply readout).
  moneyReports: Record<string, import('../economy/economyTypes').MonetaryAggregates>
  // Rolling log of central-banking events (Stage 5), newest last.
  centralBankEvents: import('../economy/economyTypes').CentralBankEvent[]
  // Per-country fiscal history, oldest first.
  history: Record<string, FiscalSample[]>
  // The 20 generated empires (economy/empireSim.ts) as the main thread knows them:
  // their headline numbers as of the last month and a fiscal history. The empires'
  // economies themselves live inside the worker and are never held here.
  empireSummaries: Record<string, EmpireSummary>
  empireHistory: Record<string, FiscalSample[]>
  // Months the empire simulation has run.
  empireTick: number
  advance: (ticks: number) => void
  // Starts the 20 generated empires' economies running alongside this game
  // (Complex mode; economy/empireSim.ts). A no-op once they are.
  seedEmpires: () => void
  setTaxRate: (countryId: string, rate: number) => void
  setWelfare: (countryId: string, perCapita: number) => void
  // Transfers a whole world to a new owning country — its pops, buildings and
  // taxes now belong to that country. Called only when a peace treaty cedes
  // the world (see src/state/territoryStore.ts's cedeBody); the one hook the
  // diplomacy/war layer has into the economy. A no-op for an unknown world.
  setWorldOwner: (worldId: string, countryId: string) => void
  // Queue a building. `owner` decides who pays and who owns it: state (default,
  // government pool → treasury) or a corporation (private pool → its cash).
  // Refused if the target district on the world is full.
  queueConstruction: (worldId: string, recipeId: string, owner?: BuildingOwner) => void
  // Develop one more level of a district (a state project; uses one unit of land).
  queueDistrict: (worldId: string, district: DistrictType) => void
  // Orbital bombardment (scene/bombardment.ts), keyed by world NAME (body):
  // devastation 0–1, and the share of population killed.
  setDevastation: (byBody: Record<string, number>) => void
  killPopulation: (shareByBody: Record<string, number>) => void
  // Foreign buildings (scene/holdings.ts): urban slots taken, per world name,
  // and money in/out of a country's treasury.
  setForeignSlots: (byBody: Record<string, number>) => void
  setMilitarySlots: (byBody: Record<string, number>) => void
  adjustTreasury: (countryId: string, amount: number) => void
  cancelConstruction: (worldId: string, orderId: string) => void
  // State override: pin a building to a method. On a private building under a
  // market economy this is interference (see economyTick's malus).
  setProductionMethod: (worldId: string, buildingId: string, methodId: string) => void
  // Hand a private building's method back to its owner (stop interfering).
  releaseProductionMethod: (worldId: string, buildingId: string) => void
  setEconomicSystem: (countryId: string, system: EconomicSystem) => void
  // --- Corporations / ownership / stock exchange ---
  // Found a new corporation owned by the given world's country. `kind` state or
  // private; it starts with no buildings (transfer some via setBuildingOwner or
  // build under it later). Returns nothing; a leader is auto-generated.
  createCorporation: (countryId: string, name: string, kind: 'state' | 'private', sector: string) => void
  // Move a building to a new owner (nationalize → state, or assign to a corp /
  // worker co-op). Used by the privatize/nationalize flows.
  setBuildingOwner: (worldId: string, buildingId: string, owner: BuildingOwner) => void
  // Nationalize a whole corporation: all its buildings become state-owned and
  // the company is dissolved into the treasury.
  nationalizeCorporation: (corporationId: string) => void
  // Privatize a state corporation: float its shares publicly (state keeps a
  // minority stake) and credit the sale proceeds to the treasury.
  privatizeCorporation: (corporationId: string) => void
  // Nationalize ONE building regardless of its owning corporation's overall
  // status: it becomes state-owned. Unlike a full corporate nationalization
  // (no per-building compensation there — the whole company is bought out at
  // once), this pays the building's own owner a proportional compensation from
  // the treasury and costs a smaller bureaucracy hit (see economyStore).
  nationalizeBuilding: (worldId: string, buildingId: string) => void
  // Nationalize `levels` levels of a corporation- or worker-owned building into
  // a STATE building of the same type (the source loses them; a state building
  // gains them, created if none exists). Taking every level flips the whole
  // building to the state in place. Compensation scales with the level count
  // (60% of build cost for a company, 15% for a co-op), plus a bureaucracy cost.
  nationalizeBuildingLevels: (worldId: string, buildingId: string, levels: number) => void
  // Privatize `levels` levels of a state-owned building to a PRIVATE company
  // (the country's largest, or a newly floated one if none exists). Selling
  // every level flips the whole building to the company in place. Per-level sale
  // proceeds go to the treasury.
  privatizeBuildingLevels: (worldId: string, buildingId: string, levels: number) => void
  // Tear down one level of a building instantly (no construction time — unlike an
  // upgrade, which is queued via queueConstruction). At level 1 the building is
  // demolished outright. Recovers a fraction of a level's build cost as salvage,
  // paid to the owner's pool (state → treasury, corporation → its cash).
  downgradeBuilding: (worldId: string, buildingId: string) => void
  // --- Subsidies (a per-tick treasury → cash transfer; a real fiscal cost) ---
  // Set (or, at 0, clear) a standing per-tick subsidy paid to a corporation.
  setSubsidyForCorporation: (countryId: string, corporationId: string, amountPerTick: number) => void
  // Set (or, at 0, clear) a standing per-tick subsidy paid toward one specific
  // building — credited to its owning corporation's cash if corporation-owned,
  // otherwise simply spent (funds a state/worker building's upkeep).
  setSubsidyForBuilding: (countryId: string, worldId: string, buildingId: string, amountPerTick: number) => void
  // --- Stockpiles (batch 3): the player's target reserve level for a good on
  // one world. 0 (or below) clears the target — tickWorld then neither fills
  // nor releases against it, though any already-held reserve is left in place.
  setStockpileTarget: (worldId: string, good: GoodId, targetAmount: number) => void
  setSpecialEconomicZone: (worldId: string, active: boolean, taxDiscount?: number) => void
  // The state buys `shares` of a corporation on the exchange (costs treasury);
  // negative sells. Moves shares between the public float and the state.
  tradeShares: (countryId: string, corporationId: string, shares: number) => void
  // --- Foreign investment (cross-border capital) ---
  // Set this country's foreign-investment LAW (may foreign capital own equity in
  // its corporations).
  setForeignInvestmentPolicy: (countryId: string, policy: import('../economy/laws').ForeignInvestmentPolicy) => void
  // Under the 'approval' law, auto-approve incoming foreign investments instead
  // of queueing them for the player.
  setForeignInvestmentAutoApprove: (countryId: string, auto: boolean) => void
  // Approve / reject a pending foreign investment into this country's companies.
  approveForeignInvestment: (hostCountryId: string, offerId: string) => void
  rejectForeignInvestment: (hostCountryId: string, offerId: string) => void
  // The investor country's STATE buys (or, negative, sells) `shares` of a
  // FOREIGN corporation from its public float — cross-border state investment.
  // Blocked if the target company's country is closed to foreign capital. The
  // stake's dividends are repatriated to the investor's treasury.
  investAbroad: (investorCountryId: string, corporationId: string, shares: number) => void
  // A COMPANY (an SOE or a private firm, at home or abroad) buys/sells equity in
  // another company from its own cash — corporate/SOE foreign investment. Blocked
  // cross-border if the target's country is closed to foreign capital. Dividends
  // flow to the holding company's cash.
  corpInvest: (holdingCorpId: string, targetCorpId: string, shares: number) => void
  // A character interaction (grant funds, demand dividend, dismiss, etc.).
  characterAction: (characterId: string, action: string) => void
  // --- Laws / bonds / debt ---
  // Set the fraction of a public service good's price the state funds for pops
  // (welfare coverage), e.g. setPublicServiceCoverage(id, 'dental', 0.5).
  setPublicServiceCoverage: (countryId: string, good: GoodId, fraction: number) => void
  // Sell bonds to a class of buyer (raises treasury cash, adds to the debt).
  // Foreign sales are gated by the foreign-bond law.
  issueBonds: (countryId: string, amount: number, buyer: 'pops' | 'corporations' | 'foreign') => void
  // Buy back bonds (spends treasury, cuts the debt), drawn proportionally.
  redeemBonds: (countryId: string, amount: number) => void
  setForeignBondPolicy: (countryId: string, policy: import('../economy/laws').ForeignBondPolicy) => void
  setForeignApproval: (countryId: string, require: boolean) => void
  approveForeignOffer: (countryId: string, offerId: string) => void
  rejectForeignOffer: (countryId: string, offerId: string) => void
  // --- Central bank (monetary institution) ---
  // Found a central bank in a country that has none (status 'no-bank' → a basic
  // state bank). No-op if one already exists.
  establishCentralBank: (countryId: string) => void
  // Enact the central bank's institutional laws. Setting the status to 'no-bank'
  // abolishes it. Changing the appointment law resets the governor's term length.
  setCentralBankStatus: (countryId: string, status: CentralBankStatus) => void
  setBankStructure: (countryId: string, structure: BankStructure) => void
  setPolicyAuthority: (countryId: string, authority: PolicyAuthority) => void
  setGovernorAppointment: (countryId: string, appointment: GovernorAppointment) => void
  setCentralBankMandate: (countryId: string, mandate: CentralBankMandate) => void
  setDebtFinancingRegime: (countryId: string, regime: DebtFinancingRegime) => void
  setExchangeRateRegime: (countryId: string, regime: ExchangeRateRegime) => void
  // Set the policy interest rate / reserve requirement DIRECTLY. Only takes
  // effect when the government controls policy (a dependent bank); on an
  // independent bank it is a no-op — the player must pressure or reform instead.
  setPolicyRate: (countryId: string, rate: number) => void
  setReserveRequirement: (countryId: string, requirement: number) => void
  // Lean on an independent central bank for easier money — raises standing
  // government pressure (eroding effective independence and credibility). The
  // political lever a government has over a bank it cannot command directly.
  pressureCentralBank: (countryId: string, amount: number) => void
  // Appoint a new governor, resetting their term from the current tick.
  appointGovernor: (countryId: string, name: string) => void
  // Open-market operations (Stage 4): the central bank buys (amount > 0) or sells
  // (amount < 0) government securities, injecting or draining commercial-bank
  // reserves — the day-to-day lever for loosening/tightening. Requires a regime
  // that permits the secondary market; a buy creates base money, a sell is capped
  // by securities held and bank reserves available.
  openMarketOperation: (countryId: string, amount: number) => void
}

let constructionCounter = 0

// The advance in flight (see EconomyStore.advance): whether one is running, the
// store updates made while it ran (replayed on its result), the months waiting
// behind it, and an epoch bumped when the game is reset so a late answer from the
// old game is dropped.
const flight = { active: false, log: [] as Parameters<typeof useEconomyStore.setState>[0][], pending: 0, epoch: 0 }

// Whether the generated empires' simulation is running beside this game (it lives
// in the worker: economy/empireSim.ts).
let empiresOn = false

// Quitting to the menu: whatever is in flight belongs to the old game.
export function cancelEconomyFlight(): void {
  flight.active = false
  flight.log = []
  flight.pending = 0
  flight.epoch += 1
  if (empiresOn) stopEmpires()
  empiresOn = false
}

// Whether the economy is working out a month right now (for tests and the UI).
export function economyBusy(): boolean {
  return flight.active
}

// The request for one advance, from the store's current state and the wars now.
function stepInputOf(state: Pick<EconomyStore, 'countries' | 'worlds' | 'corporations' | 'banks' | 'tick'>, steps: number): EconomyStepInput {
  const localPlayer = usePlayerStore.getState().selectedCountryId
  const wars: string[] = []
  for (const [key, relation] of Object.entries(useDiplomacyStore.getState().relations)) if (relation.status === 'war') wars.push(key)
  // Trade policy (state/tradePolicyStore.ts), serialized for the worker.
  const tp = useTradePolicyStore.getState()
  const embargoPairs = Object.entries(tp.embargoes).filter(([, on]) => on).map(([k]) => k)
  const ids = state.countries.map((c) => c.id)
  const sharedMarketPairs: string[] = []
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++) if (inSharedMarket(ids[i], ids[j])) sharedMarketPairs.push(pairKey(ids[i], ids[j]))
  // Starbase transport tie-ins: which bodies have an orbital space-elevator
  // tether, and each nation's interstellar bonus from trade-hub modules.
  const sim = useGameTimeStore.getState().simDays
  const tetheredBodyNames: string[] = []
  const interstellarBonusByCountry: Record<string, number> = {}
  for (const sb of useStarbaseStore.getState().starbases) {
    if (!isStarbaseActive(sb, sim)) continue
    const modules = starbaseModulesOf(sb)
    if (modules.includes('space-elevator-tether')) {
      const anchor = starbaseAnchorBody(sb.starId)
      if (anchor) tetheredBodyNames.push(anchor)
    }
    const hubs = modules.filter((m) => m === 'trade-hub').length
    if (hubs > 0) interstellarBonusByCountry[sb.ownerId] = (interstellarBonusByCountry[sb.ownerId] ?? 0) + hubs * TRADE_HUB_INTERSTELLAR
  }
  return {
    countries: state.countries,
    worlds: state.worlds,
    corporations: state.corporations,
    banks: state.banks,
    startTick: state.tick,
    steps,
    // Nations NOT controlled by a human player are run by the country AI (see
    // countryAI.ts). Multiplayer-ready: this local store knows only its own player.
    humanCountryIds: localPlayer ? [localPlayer] : [],
    warPairs: wars,
    tradePolicies: tp.policies,
    embargoPairs,
    sharedMarketPairs,
    tetheredBodyNames,
    interstellarBonusByCountry,
  }
}

export { unemploymentOf }
export type { FiscalSample }

export const useEconomyStore = create<EconomyStore>((rawSet, get) => {
  // Every store action goes through this `set`: while a tick is in flight it also
  // logs the update, to replay it on the tick's result.
  const set = ((partial: unknown, replace?: boolean) => {
    rawSet(partial as never, replace as never)
    if (flight.active) flight.log.push(partial as Parameters<typeof rawSet>[0])
  }) as typeof rawSet

  // The advance's result lands: tick, reports and history, plus the yearly
  // foreign-bond offers.
  const commit = (out: EconomyStepOutput) =>
    rawSet((state) => {
      const history: Record<string, FiscalSample[]> = { ...state.history }
      for (const [id, samples] of Object.entries(out.samples)) {
        const series = [...(history[id] ?? []), ...samples]
        if (series.length > HISTORY_LENGTH) series.splice(0, series.length - HISTORY_LENGTH)
        history[id] = series
      }
      const cbEvents = out.events.length > 0 ? [...state.centralBankEvents, ...out.events].slice(-60) : state.centralBankEvents
      let countries = out.countries
      // Foreign bond demand: every so often, foreign investors offer to buy a
      // country's debt. Under the approval setting the offer waits for the
      // player; otherwise it is taken up automatically (open markets).
      if (Math.floor(out.tick / 12) > Math.floor(state.tick / 12)) {
        countries = countries.map((c) => {
          if (c.foreignBondPolicy === 'closed') return c
          const totalDebt = c.bonds.pops + c.bonds.corporations + c.bonds.foreign
          const amount = Math.round(totalDebt * 0.04)
          if (amount <= 0) return c
          if (c.requireForeignApproval) {
            offerCounter += 1
            return { ...c, pendingForeign: [...c.pendingForeign, { id: `fo-${offerCounter}`, amount, investor: randomInvestor() }].slice(-6) }
          }
          return { ...c, bonds: { ...c.bonds, foreign: c.bonds.foreign + amount }, treasury: c.treasury + amount }
        })
      }
      return { countries, worlds: out.worlds, corporations: out.corporations, banks: out.banks, worldReports: out.worldReports, countryReports: out.countryReports, moneyReports: out.moneyReports, centralBankEvents: cbEvents, history, tick: out.tick }
    })

  // Lands a finished advance, replays the edits made while it ran, and starts the
  // months that came due meanwhile.
  const land = (out: EconomyStepOutput, epoch: number) => {
    if (epoch !== flight.epoch) return
    commit(out)
    const log = flight.log
    flight.log = []
    flight.active = false
    for (const edit of log) rawSet(edit)
    const next = flight.pending
    flight.pending = 0
    if (next > 0) startRun(next)
  }

  // An empire update (a month or more of the empires' simulation) arrives: the
  // latest summaries, and their fiscal samples appended to the history.
  const applyEmpireUpdate = (update: EmpireUpdate | null) => {
    if (!update || !empiresOn) return
    rawSet((state) => {
      const empireHistory: Record<string, FiscalSample[]> = { ...state.empireHistory }
      for (const [id, samples] of Object.entries(update.samples)) {
        const series = [...(empireHistory[id] ?? []), ...samples]
        if (series.length > HISTORY_LENGTH) series.splice(0, series.length - HISTORY_LENGTH)
        empireHistory[id] = series
      }
      return { empireSummaries: update.summaries, empireHistory, empireTick: update.tick }
    })
  }
  onEmpireUpdate(applyEmpireUpdate)

  const startRun = (steps: number) => {
    const state = get()
    const input = stepInputOf(state, steps)
    const epoch = flight.epoch
    // The empires advance the same number of months, beside the nations (in the
    // worker; or in-process where there is none).
    const off = runOffThread(input, empiresOn ? steps : 0)
    if (!off) {
      // No Worker (tests, headless): the same function, inline.
      flight.active = true
      land(runEconomySteps(input), epoch)
      if (empiresOn) applyEmpireUpdate(advanceEmpiresInline(steps))
      return
    }
    flight.active = true
    flight.log = []
    off.then(
      (out) => land(out, epoch),
      // The worker failed (and the empires resident in it with it): run the same
      // request inline rather than lose the months.
      () => {
        empiresOn = false
        land(runEconomySteps(input), epoch)
      },
    )
  }

  return {
  countries: seedCountries(),
  worlds: seedWorlds(),
  corporations: seedCorporations(),
  characters: seedCharacters(),
  families: seedFamilies(),
  banks: seedBanks(),
  tick: 0,
  worldReports: {},
  countryReports: {},
  moneyReports: {},
  centralBankEvents: [],
  history: {},
  empireSummaries: {},
  empireHistory: {},
  empireTick: 0,
  // Advances `ticks` months. The tick itself is a pure function (economy/
  // economyStep.runEconomySteps) run on a Web Worker where there is one, so it
  // never blocks a frame; one request is in flight at a time and months that come
  // due meanwhile queue up. Player edits made during a flight apply at once and
  // are REPLAYED on the result when it lands (`set` below logs them).
  advance: (ticks) => {
    const steps = Math.max(0, Math.min(MAX_CATCH_UP_TICKS, Math.floor(ticks)))
    if (steps === 0) return
    if (flight.active) {
      flight.pending = Math.min(MAX_CATCH_UP_TICKS, flight.pending + steps)
      return
    }
    startRun(steps)
  },
  // The empires' economies run inside the worker (economy/empireSim.ts) and only
  // summaries come back (onEmpireUpdate below); starting them is all this does.
  seedEmpires: () => {
    if (empiresOn) return
    empiresOn = true
    startEmpires()
  },
  setWorldOwner: (worldId, countryId) =>
    set((state) => ({
      worlds: state.worlds.map((w) => (w.id === worldId ? { ...w, ownerId: countryId } : w)),
    })),
  setTaxRate: (countryId, rate) =>
    set((state) => ({
      countries: state.countries.map((c) => (c.id === countryId ? { ...c, taxRate: Math.max(0, Math.min(0.6, rate)) } : c)),
    })),
  setWelfare: (countryId, perCapita) =>
    set((state) => ({
      countries: state.countries.map((c) => (c.id === countryId ? { ...c, welfarePerCapita: Math.max(0, Math.min(10, perCapita)) } : c)),
    })),
  queueConstruction: (worldId, recipeId, owner = { kind: 'state' }) =>
    set((state) => ({
      worlds: state.worlds.map((w) => {
        if (w.id !== worldId) return w
        // Tech gate: a building requiring a tech (e.g. the space-elevator anchor)
        // can't be queued until the owning nation has researched it.
        const need = RECIPES[recipeId]?.requiresTech
        if (need && !useTechStore.getState().stateFor(w.ownerId).researched.has(need)) return w
        if (!canBuild(w, recipeId)) return w // district full — no room
        constructionCounter += 1
        const order = { id: `con-${worldId}-${recipeId}-${constructionCounter}`, recipeId, cost: constructionWork(recipeId), progress: 0, owner }
        return { ...w, constructionQueue: [...w.constructionQueue, order] }
      }),
    })),
  setDevastation: (byBody) =>
    set((state) => {
      let changed = false
      const worlds = state.worlds.map((w) => {
        const dev = byBody[w.name] ?? 0
        if ((w.devastation ?? 0) === dev) return w
        changed = true
        return { ...w, devastation: dev > 0 ? dev : undefined }
      })
      return changed ? { worlds } : state
    }),
  setForeignSlots: (byBody) =>
    set((state) => {
      let changed = false
      const worlds = state.worlds.map((w) => {
        const n = byBody[w.name] ?? 0
        if ((w.foreignSlots ?? 0) === n) return w
        changed = true
        return { ...w, foreignSlots: n > 0 ? n : undefined }
      })
      return changed ? { worlds } : state
    }),
  setMilitarySlots: (byBody) =>
    set((state) => {
      let changed = false
      const worlds = state.worlds.map((w) => {
        const n = byBody[w.name] ?? 0
        if ((w.militarySlots ?? 0) === n) return w
        changed = true
        return { ...w, militarySlots: n > 0 ? n : undefined }
      })
      return changed ? { worlds } : state
    }),
  adjustTreasury: (countryId, amount) =>
    set((state) => ({ countries: state.countries.map((c) => (c.id === countryId ? { ...c, treasury: c.treasury + amount } : c)) })),
  killPopulation: (shareByBody) =>
    set((state) => ({
      worlds: state.worlds.map((w) => {
        const share = shareByBody[w.name] ?? 0
        return share > 0 ? { ...w, pops: w.pops.map((p) => ({ ...p, populationSize: p.populationSize * (1 - share) })) } : w
      }),
    })),
  queueDistrict: (worldId, district) =>
    set((state) => ({
      worlds: state.worlds.map((w) => {
        if (w.id !== worldId || freeLandOfWorld(w) <= 0) return w
        constructionCounter += 1
        return { ...w, constructionQueue: [...w.constructionQueue, districtOrder(`dis-${worldId}-${district}-${constructionCounter}`, district)] }
      }),
    })),
  cancelConstruction: (worldId, orderId) =>
    set((state) => ({
      worlds: state.worlds.map((w) =>
        w.id === worldId ? { ...w, constructionQueue: w.constructionQueue.filter((o) => o.id !== orderId) } : w,
      ),
    })),
  setProductionMethod: (worldId, buildingId, methodId) =>
    set((state) => ({
      worlds: state.worlds.map((w) =>
        w.id === worldId
          ? {
              ...w,
              buildings: w.buildings.map((b) =>
                b.id === buildingId && b.methodId !== methodId
                  ? { ...b, methodId, methodLocked: true, throughput: b.throughput * RETOOL_THROUGHPUT_FACTOR }
                  : b.id === buildingId
                    ? { ...b, methodLocked: true }
                    : b,
              ),
            }
          : w,
      ),
    })),
  releaseProductionMethod: (worldId, buildingId) =>
    set((state) => ({
      worlds: state.worlds.map((w) =>
        w.id === worldId
          ? { ...w, buildings: w.buildings.map((b) => (b.id === buildingId ? { ...b, methodLocked: false } : b)) }
          : w,
      ),
    })),
  setEconomicSystem: (countryId, system) =>
    set((state) => ({
      countries: state.countries.map((c) => (c.id === countryId ? { ...c, economicSystem: system } : c)),
    })),

  createCorporation: (countryId, name, kind, sector) =>
    set((state) => {
      corpCounter += 1
      const corpId = `corp-${corpCounter}`
      charCounter += 1
      const leaderId = `char-${charCounter}`
      const country = state.countries.find((c) => c.id === countryId)
      const culture = state.worlds.find((w) => w.ownerId === countryId)?.cultureId ?? 'martian'
      const leader: Character = {
        id: leaderId,
        name: randomName(),
        age: 40 + Math.floor(Math.random() * 20),
        role: 'corp-leader',
        corporationId: corpId,
        cultureId: culture,
        religionId: 'non-affiliated',
        speciesTemplateId: 'baseline-organic',
        traits: [randomTrait()],
        wealth: kind === 'private' ? 300 : 80,
        skills: {
          administration: 3 + Math.floor(Math.random() * 6),
          finance: 3 + Math.floor(Math.random() * 6),
          diplomacy: 3 + Math.floor(Math.random() * 6),
        },
        log: [`Founded ${name}.`],
      }
      // State corps are wholly state-held; private corps float most shares.
      const shares: Corporation['shares'] =
        kind === 'state'
          ? [{ holder: { kind: 'state' }, shares: 1000 }]
          : [
              { holder: { kind: 'character', id: leaderId }, shares: 500 },
              { holder: { kind: 'public' }, shares: 500 },
            ]
      const seed = kind === 'state' ? 4000 : 2000
      const corp: Corporation = {
        id: corpId,
        name,
        countryId,
        kind,
        cash: seed,
        totalShares: 1000,
        shares,
        leaderId,
        lastProfit: 0,
        sector,
      }
      // Founding capital is drawn from the national treasury.
      const countries = country ? state.countries.map((c) => (c.id === countryId ? { ...c, treasury: c.treasury - seed } : c)) : state.countries
      const corporations = [...state.corporations, corp]
      return { corporations, characters: [...state.characters, leader], countries, worlds: syncCorporateHqs(state.worlds, corporations) }
    }),

  setBuildingOwner: (worldId, buildingId, owner) =>
    set((state) => {
      const worlds = state.worlds.map((w) =>
        w.id === worldId ? { ...w, buildings: w.buildings.map((b) => (b.id === buildingId ? { ...b, owner, methodLocked: false } : b)) } : w,
      )
      return { worlds: syncCorporateHqs(worlds, state.corporations) }
    }),

  nationalizeCorporation: (corporationId) =>
    set((state) => {
      const corp = state.corporations.find((c) => c.id === corporationId)
      if (!corp || corp.kind === 'state') return state
      // The company becomes a fully STATE-OWNED enterprise — it keeps its
      // buildings and its leader, but every share now belongs to the state. The
      // private shareholders are bought out at (partial) market value, which is
      // paid from the treasury.
      const compensation = corporationValue(corp, state.worlds) * 0.6
      // Seizing a company is administratively expensive — a one-off bureaucracy hit.
      const assets = state.worlds.reduce((n, w) => n + w.buildings.filter((b) => b.owner.kind === 'corporation' && b.owner.corporationId === corporationId).length, 0)
      const bureaucracyHit = 400 + assets * 300
      const corporations = state.corporations.map((c) =>
        c.id === corporationId ? { ...c, kind: 'state' as const, shares: [{ holder: { kind: 'state' as const }, shares: c.totalShares }] } : c,
      )
      const countries = state.countries.map((c) =>
        c.id === corp.countryId ? { ...c, treasury: c.treasury - compensation, bureaucracy: Math.max(0, c.bureaucracy - bureaucracyHit) } : c,
      )
      return { corporations, countries }
    }),

  privatizeCorporation: (corporationId) =>
    set((state) => {
      const corp = state.corporations.find((c) => c.id === corporationId)
      if (!corp || corp.kind !== 'state') return state
      // Sell 70% to the public float, keep 30% as a state stake; proceeds (the
      // floated value) go to the treasury.
      const value = sharePrice(corp, state.worlds) * corp.totalShares
      const proceeds = value * 0.7
      const shares: Corporation['shares'] = [
        { holder: { kind: 'state' }, shares: Math.round(corp.totalShares * 0.3) },
        { holder: { kind: 'public' }, shares: corp.totalShares - Math.round(corp.totalShares * 0.3) },
      ]
      return {
        corporations: state.corporations.map((c) => (c.id === corporationId ? { ...c, kind: 'private' as const, shares } : c)),
        countries: state.countries.map((c) => (c.id === corp.countryId ? { ...c, treasury: c.treasury + proceeds } : c)),
      }
    }),

  nationalizeBuilding: (worldId, buildingId) =>
    set((state) => {
      const world = state.worlds.find((w) => w.id === worldId)
      const building = world?.buildings.find((b) => b.id === buildingId)
      if (!world || !building || building.owner.kind === 'state') return state
      // Proportional to the corporate flow (60% of value), but scoped to just
      // this ONE building's estimated worth — not the whole company — since
      // only this asset changes hands. A worker co-op has no shareholders to
      // buy out, so its "compensation" is a smaller flat administrative/
      // disruption cost instead (seizing a co-op still isn't free).
      const value = building.level * BUILD_COST_PER_LEVEL
      const compensation = building.owner.kind === 'corporation' ? value * 0.6 : value * 0.15
      const bureaucracyHit = 50 + building.level * 30
      const worlds = state.worlds.map((w) =>
        w.id === worldId
          ? { ...w, buildings: w.buildings.map((b) => (b.id === buildingId ? { ...b, owner: { kind: 'state' as const }, methodLocked: false } : b)) }
          : w,
      )
      const countries = state.countries.map((c) =>
        c.id === world.ownerId ? { ...c, treasury: c.treasury - compensation, bureaucracy: Math.max(0, c.bureaucracy - bureaucracyHit) } : c,
      )
      return { countries, worlds: syncCorporateHqs(worlds, state.corporations) }
    }),

  nationalizeBuildingLevels: (worldId, buildingId, levels) =>
    set((state) => {
      const world = state.worlds.find((w) => w.id === worldId)
      const building = world?.buildings.find((b) => b.id === buildingId)
      if (!world || !building || building.owner.kind === 'state') return state
      const count = Math.max(1, Math.min(Math.floor(levels), building.level))
      // Per-level compensation at the same ratios as a full nationalization
      // (60% for a company, 15% for a co-op).
      const ratio = building.owner.kind === 'corporation' ? 0.6 : 0.15
      const compensation = count * BUILD_COST_PER_LEVEL * ratio
      const bureaucracyHit = 20 + count * 20
      let worlds: World[]
      if (count >= building.level) {
        // Taking the whole thing: flip the building to the state in place, so it
        // keeps its throughput/identity rather than being rebuilt from scratch.
        worlds = state.worlds.map((w) =>
          w.id === worldId ? { ...w, buildings: w.buildings.map((b) => (b.id === buildingId ? { ...b, owner: { kind: 'state' as const }, methodLocked: false } : b)) } : w,
        )
      } else {
        worlds = state.worlds.map((w) => {
          if (w.id !== worldId) return w
          const stripped = removeLevels(w.buildings, buildingId, count)
          return { ...w, buildings: addOwnerLevels(stripped, building.recipeId, { kind: 'state' }, count) }
        })
      }
      const countries = state.countries.map((c) =>
        c.id === world.ownerId ? { ...c, treasury: c.treasury - compensation, bureaucracy: Math.max(0, c.bureaucracy - bureaucracyHit) } : c,
      )
      return { countries, worlds: syncCorporateHqs(worlds, state.corporations) }
    }),

  privatizeBuildingLevels: (worldId, buildingId, levels) =>
    set((state) => {
      const world = state.worlds.find((w) => w.id === worldId)
      const building = world?.buildings.find((b) => b.id === buildingId)
      if (!world || !building || building.owner.kind !== 'state') return state
      const count = Math.max(1, Math.min(Math.floor(levels), building.level))
      // Route the levels to the country's largest private company; if none
      // exists, float a new one to receive them.
      let corporations = state.corporations
      let characters = state.characters
      let target = state.corporations.filter((c) => c.countryId === world.ownerId && c.kind === 'private').sort((a, b) => b.cash - a.cash)[0]
      if (!target) {
        const label = RECIPES[building.recipeId]?.label ?? 'New'
        const made = makePrivateCorp(world.ownerId, `${label} Ventures`, RECIPES[building.recipeId]?.category ?? 'industry', world.cultureId)
        target = made.corp
        corporations = [...corporations, made.corp]
        characters = [...characters, made.leader]
      }
      const owner: BuildingOwner = { kind: 'corporation', corporationId: target.id }
      const proceeds = count * BUILD_COST_PER_LEVEL * 0.7
      let worlds: World[]
      if (count >= building.level) {
        // Selling the whole building: flip its owner to the company in place.
        worlds = state.worlds.map((w) =>
          w.id === worldId ? { ...w, buildings: w.buildings.map((b) => (b.id === buildingId ? { ...b, owner } : b)) } : w,
        )
      } else {
        worlds = state.worlds.map((w) => {
          if (w.id !== worldId) return w
          const stripped = removeLevels(w.buildings, buildingId, count)
          return { ...w, buildings: addOwnerLevels(stripped, building.recipeId, owner, count) }
        })
      }
      const countries = state.countries.map((c) => (c.id === world.ownerId ? { ...c, treasury: c.treasury + proceeds } : c))
      return { countries, corporations, characters, worlds: syncCorporateHqs(worlds, corporations) }
    }),

  downgradeBuilding: (worldId, buildingId) =>
    set((state) => {
      const world = state.worlds.find((w) => w.id === worldId)
      const building = world?.buildings.find((b) => b.id === buildingId)
      if (!world || !building) return state
      const salvage = BUILD_COST_PER_LEVEL * DOWNGRADE_SALVAGE
      // Level 1 → demolished; otherwise drop a level (throughput carries over).
      const worlds = state.worlds.map((w) => {
        if (w.id !== worldId) return w
        if (building.level <= 1) return { ...w, buildings: w.buildings.filter((b) => b.id !== buildingId) }
        return { ...w, buildings: w.buildings.map((b) => (b.id === buildingId ? { ...b, level: b.level - 1 } : b)) }
      })
      // Salvage goes to the owner's pool.
      let countries = state.countries
      let corporations = state.corporations
      if (building.owner.kind === 'state') {
        countries = state.countries.map((c) => (c.id === world.ownerId ? { ...c, treasury: c.treasury + salvage } : c))
      } else if (building.owner.kind === 'corporation') {
        const corpId = building.owner.corporationId
        corporations = state.corporations.map((c) => (c.id === corpId ? { ...c, cash: c.cash + salvage } : c))
      }
      // A demolished corporate building can change HQ sizing.
      const synced = building.owner.kind === 'corporation' && building.level <= 1 ? syncCorporateHqs(worlds, corporations) : worlds
      return { worlds: synced, countries, corporations }
    }),

  setSubsidyForCorporation: (countryId, corporationId, amountPerTick) =>
    set((state) => ({
      countries: state.countries.map((c) => {
        if (c.id !== countryId) return c
        const amt = Math.max(0, Math.min(5000, amountPerTick))
        const corporations = { ...c.subsidies.corporations }
        if (amt <= 0) delete corporations[corporationId]
        else corporations[corporationId] = amt
        return { ...c, subsidies: { ...c.subsidies, corporations } }
      }),
    })),

  setSubsidyForBuilding: (countryId, worldId, buildingId, amountPerTick) =>
    set((state) => ({
      countries: state.countries.map((c) => {
        if (c.id !== countryId) return c
        const amt = Math.max(0, Math.min(2000, amountPerTick))
        const key = `${worldId}:${buildingId}`
        const buildings = { ...c.subsidies.buildings }
        if (amt <= 0) delete buildings[key]
        else buildings[key] = amt
        return { ...c, subsidies: { ...c.subsidies, buildings } }
      }),
    })),

  setStockpileTarget: (worldId, good, targetAmount) =>
    set((state) => ({
      worlds: state.worlds.map((w) => {
        if (w.id !== worldId) return w
        const amt = Math.max(0, targetAmount)
        const stockpileTargets = { ...w.stockpileTargets }
        if (amt <= 0) delete stockpileTargets[good]
        else stockpileTargets[good] = amt
        return { ...w, stockpileTargets }
      }),
    })),

  setSpecialEconomicZone: (worldId, active, taxDiscount = SEZ_DEFAULT_TAX_DISCOUNT) =>
    set((state) => ({
      worlds: state.worlds.map((w) =>
        w.id === worldId ? { ...w, specialEconomicZone: active ? { active: true, taxDiscount: Math.max(0, Math.min(1, taxDiscount)) } : undefined } : w,
      ),
    })),

  tradeShares: (countryId, corporationId, shares) =>
    set((state) => {
      const corp = state.corporations.find((c) => c.id === corporationId)
      const country = state.countries.find((c) => c.id === countryId)
      if (!corp || !country) return state
      const price = sharePrice(corp, state.worlds)
      // Only the corp's OWN government trades here (foreign stakes are separate).
      const isHomeState = (s: Corporation['shares'][number]) => s.holder.kind === 'state' && (s.holder.countryId === undefined || s.holder.countryId === corp.countryId)
      const stateHolding = corp.shares.filter(isHomeState).reduce((n, s) => n + s.shares, 0)
      const publicHolding = corp.shares.find((s) => s.holder.kind === 'public')?.shares ?? 0
      // Clamp: can't buy more than floats publicly, can't sell more than held.
      const delta = Math.max(-stateHolding, Math.min(publicHolding, Math.round(shares)))
      if (delta === 0) return state
      const cost = delta * price
      if (delta > 0 && cost > country.treasury) return state
      const nextShares: Corporation['shares'] = []
      const newState = stateHolding + delta
      const newPublic = publicHolding - delta
      for (const h of corp.shares) {
        if (isHomeState(h)) continue // rebuilt below
        if (h.holder.kind === 'public') continue
        nextShares.push(h) // keeps foreign-state, financial and character stakes intact
      }
      if (newState > 0) nextShares.push({ holder: { kind: 'state' }, shares: newState })
      if (newPublic > 0) nextShares.push({ holder: { kind: 'public' }, shares: newPublic })
      // Ownership decides the kind: if the home state no longer holds a majority
      // the company is no longer state-owned (and vice-versa).
      return {
        corporations: state.corporations.map((c) =>
          c.id === corporationId ? { ...c, shares: nextShares, kind: derivedKind({ ...c, shares: nextShares }) } : c,
        ),
        countries: state.countries.map((c) => (c.id === countryId ? { ...c, treasury: c.treasury - cost } : c)),
      }
    }),

  setForeignInvestmentPolicy: (countryId, policy) =>
    set((state) => ({
      countries: state.countries.map((c) => (c.id === countryId ? { ...c, foreignInvestmentPolicy: policy } : c)),
    })),

  setForeignInvestmentAutoApprove: (countryId, auto) =>
    set((state) => ({
      countries: state.countries.map((c) => (c.id === countryId ? { ...c, foreignInvestmentAutoApprove: auto } : c)),
    })),

  approveForeignInvestment: (hostCountryId, offerId) =>
    set((state) => {
      const host = state.countries.find((c) => c.id === hostCountryId)
      const offer = host?.pendingForeignInvestment.find((o) => o.id === offerId)
      if (!host || !offer) return state
      const res = executeForeignBuy(state.corporations, state.countries, state.worlds, offer.investorKind, offer.investorId, offer.targetCorpId, offer.shares)
      const baseCountries = res?.countries ?? state.countries
      return {
        corporations: res?.corporations ?? state.corporations,
        countries: baseCountries.map((c) => (c.id === hostCountryId ? { ...c, pendingForeignInvestment: c.pendingForeignInvestment.filter((o) => o.id !== offerId) } : c)),
      }
    }),

  rejectForeignInvestment: (hostCountryId, offerId) =>
    set((state) => ({
      countries: state.countries.map((c) => (c.id === hostCountryId ? { ...c, pendingForeignInvestment: c.pendingForeignInvestment.filter((o) => o.id !== offerId) } : c)),
    })),

  investAbroad: (investorCountryId, corporationId, shares) =>
    set((state) => {
      const corp = state.corporations.find((c) => c.id === corporationId)
      const investor = state.countries.find((c) => c.id === investorCountryId)
      const target = corp ? state.countries.find((c) => c.id === corp.countryId) : undefined
      if (!corp || !investor || !target) return state
      if (corp.countryId === investorCountryId) return state // this is domestic — use tradeShares
      if (target.foreignInvestmentPolicy === 'closed' && !hasInvestmentRights(target.id, investorCountryId)) return state // host bars foreign capital, unless a treaty grants an exception
      const price = sharePrice(corp, state.worlds)
      const held = corp.shares.filter((s) => s.holder.kind === 'state' && s.holder.countryId === investorCountryId).reduce((n, s) => n + s.shares, 0)
      const publicHolding = corp.shares.find((s) => s.holder.kind === 'public')?.shares ?? 0
      // Buy from the public float (positive) or sell back to it (negative).
      const delta = Math.max(-held, Math.min(publicHolding, Math.round(shares)))
      if (delta === 0) return state
      // Convert the host-currency price into the investing government's currency.
      const cost = convertBetween(delta * price, corp.countryId, investorCountryId, state.countries)
      if (delta > 0 && cost > investor.treasury) return state
      const newHeld = held + delta
      const newPublic = publicHolding - delta
      const nextShares: Corporation['shares'] = []
      for (const h of corp.shares) {
        if (h.holder.kind === 'state' && h.holder.countryId === investorCountryId) continue // rebuilt
        if (h.holder.kind === 'public') continue
        nextShares.push(h)
      }
      if (newHeld > 0) nextShares.push({ holder: { kind: 'state', countryId: investorCountryId }, shares: newHeld })
      if (newPublic > 0) nextShares.push({ holder: { kind: 'public' }, shares: newPublic })
      return {
        corporations: state.corporations.map((c) => (c.id === corporationId ? { ...c, shares: nextShares } : c)),
        countries: state.countries.map((c) => (c.id === investorCountryId ? { ...c, treasury: c.treasury - cost } : c)),
      }
    }),

  corpInvest: (holdingCorpId, targetCorpId, shares) =>
    set((state) => {
      const holder = state.corporations.find((c) => c.id === holdingCorpId)
      const target = state.corporations.find((c) => c.id === targetCorpId)
      if (!holder || !target || holder.id === target.id) return state
      const crossBorder = holder.countryId !== target.countryId
      if (crossBorder) {
        const host = state.countries.find((c) => c.id === target.countryId)
        if (host?.foreignInvestmentPolicy === 'closed' && !hasInvestmentRights(target.countryId, holder.countryId)) return state // host bars foreign capital, unless a treaty grants an exception
      }
      const price = sharePrice(target, state.worlds)
      const held = target.shares.filter((s) => s.holder.kind === 'corporation' && s.holder.id === holdingCorpId).reduce((n, s) => n + s.shares, 0)
      const publicHolding = target.shares.find((s) => s.holder.kind === 'public')?.shares ?? 0
      const delta = Math.max(-held, Math.min(publicHolding, Math.round(shares)))
      if (delta === 0) return state
      // Convert the host-currency price into the holding company's currency.
      const cost = convertBetween(delta * price, target.countryId, holder.countryId, state.countries)
      if (delta > 0 && cost > holder.cash) return state // must afford it from its own cash
      const newHeld = held + delta
      const newPublic = publicHolding - delta
      const nextShares: Corporation['shares'] = []
      for (const h of target.shares) {
        if (h.holder.kind === 'corporation' && h.holder.id === holdingCorpId) continue // rebuilt
        if (h.holder.kind === 'public') continue
        nextShares.push(h)
      }
      if (newHeld > 0) nextShares.push({ holder: { kind: 'corporation', id: holdingCorpId }, shares: newHeld })
      if (newPublic > 0) nextShares.push({ holder: { kind: 'public' }, shares: newPublic })
      return {
        corporations: state.corporations.map((c) => {
          if (c.id === targetCorpId) return { ...c, shares: nextShares }
          if (c.id === holdingCorpId) return { ...c, cash: c.cash - cost }
          return c
        }),
      }
    }),

  characterAction: (characterId, action) =>
    set((state) => {
      const char = state.characters.find((c) => c.id === characterId)
      if (!char) return state
      let characters = state.characters
      let corporations = state.corporations
      const note = (text: string) => {
        characters = characters.map((c) => (c.id === characterId ? { ...c, log: [...c.log, text].slice(-12) } : c))
      }
      if (action === 'grant-funds') {
        characters = characters.map((c) => (c.id === characterId ? { ...c, wealth: c.wealth + 100, log: [...c.log, 'Received a state grant of $100M.'].slice(-12) } : c))
      } else if (action === 'demand-dividend' && char.corporationId) {
        const corp = corporations.find((c) => c.id === char.corporationId)
        if (corp) {
          const take = Math.min(corp.cash, corp.cash * 0.3)
          corporations = corporations.map((c) => (c.id === corp.id ? { ...c, cash: c.cash - take } : c))
          characters = characters.map((c) => (c.id === characterId ? { ...c, log: [...c.log, `Paid the state a special dividend of ${(take).toFixed(0)} (internal).`].slice(-12) } : c))
        }
      } else if (action === 'mentor') {
        characters = characters.map((c) =>
          c.id === characterId ? { ...c, skills: { ...c.skills, administration: Math.min(10, c.skills.administration + 1) }, log: [...c.log, 'Mentored — administration improved.'].slice(-12) } : c,
        )
      } else if (action === 'honor') {
        characters = characters.map((c) => (c.id === characterId ? { ...c, log: [...c.log, 'Honored by the state; prestige rises.'].slice(-12) } : c))
      } else {
        note(`Took an action: ${action}.`)
      }
      return { characters, corporations }
    }),

  setPublicServiceCoverage: (countryId, good, fraction) =>
    set((state) => ({
      countries: state.countries.map((c) =>
        c.id === countryId ? { ...c, publicServices: { ...c.publicServices, [good]: Math.max(0, Math.min(1, fraction)) } } : c,
      ),
    })),

  issueBonds: (countryId, amount, buyer) =>
    set((state) => {
      const country = state.countries.find((c) => c.id === countryId)
      if (!country || amount <= 0) return state
      // Foreign sales are gated by the foreign-bond law.
      if (buyer === 'foreign' && country.foreignBondPolicy === 'closed') return state
      const bonds = { ...country.bonds, [buyer]: country.bonds[buyer] + amount }
      return {
        countries: state.countries.map((c) => (c.id === countryId ? { ...c, bonds, treasury: c.treasury + amount } : c)),
      }
    }),

  redeemBonds: (countryId, amount) =>
    set((state) => {
      const country = state.countries.find((c) => c.id === countryId)
      if (!country || amount <= 0) return state
      const total = country.bonds.pops + country.bonds.corporations + country.bonds.foreign
      const pay = Math.min(amount, total, Math.max(0, country.treasury))
      if (pay <= 0 || total <= 0) return state
      const frac = pay / total
      const bonds = {
        pops: country.bonds.pops * (1 - frac),
        corporations: country.bonds.corporations * (1 - frac),
        foreign: country.bonds.foreign * (1 - frac),
      }
      return { countries: state.countries.map((c) => (c.id === countryId ? { ...c, bonds, treasury: c.treasury - pay } : c)) }
    }),

  setForeignBondPolicy: (countryId, policy) =>
    set((state) => ({ countries: state.countries.map((c) => (c.id === countryId ? { ...c, foreignBondPolicy: policy } : c)) })),

  setForeignApproval: (countryId, require) =>
    set((state) => ({ countries: state.countries.map((c) => (c.id === countryId ? { ...c, requireForeignApproval: require } : c)) })),

  approveForeignOffer: (countryId, offerId) =>
    set((state) => {
      const country = state.countries.find((c) => c.id === countryId)
      const offer = country?.pendingForeign.find((o) => o.id === offerId)
      if (!country || !offer) return state
      return {
        countries: state.countries.map((c) =>
          c.id === countryId
            ? { ...c, treasury: c.treasury + offer.amount, bonds: { ...c.bonds, foreign: c.bonds.foreign + offer.amount }, pendingForeign: c.pendingForeign.filter((o) => o.id !== offerId) }
            : c,
        ),
      }
    }),

  rejectForeignOffer: (countryId, offerId) =>
    set((state) => ({
      countries: state.countries.map((c) => (c.id === countryId ? { ...c, pendingForeign: c.pendingForeign.filter((o) => o.id !== offerId) } : c)),
    })),

  // --- Central bank ---
  establishCentralBank: (countryId) =>
    set((state) => ({
      countries: state.countries.map((c) => {
        if (c.id !== countryId) return c
        const existing = c.centralBank
        if (hasCentralBank(existing)) return c // already has one
        const name = existing ? existing.name : 'Central Bank'
        return { ...c, centralBank: { ...defaultCentralBank(countryId, state.tick), name } }
      }),
    })),

  setCentralBankStatus: (countryId, status) =>
    set((state) => ({ countries: mapCentralBank(state.countries, countryId, state.tick, (cb) => ({ ...cb, status })) })),
  setBankStructure: (countryId, structure) =>
    set((state) => ({ countries: mapCentralBank(state.countries, countryId, state.tick, (cb) => ({ ...cb, structure })) })),
  setPolicyAuthority: (countryId, authority) =>
    set((state) => ({ countries: mapCentralBank(state.countries, countryId, state.tick, (cb) => ({ ...cb, policyAuthority: authority })) })),
  setGovernorAppointment: (countryId, appointment) =>
    set((state) => ({
      // Changing how the governor is appointed resets their term length (and
      // restarts the clock) per the new law.
      countries: mapCentralBank(state.countries, countryId, state.tick, (cb) => ({
        ...cb,
        appointment,
        governorTermLength: governorAppointmentDef(appointment).termTicks,
        governorTermStart: state.tick,
      })),
    })),
  setCentralBankMandate: (countryId, mandate) =>
    set((state) => ({ countries: mapCentralBank(state.countries, countryId, state.tick, (cb) => ({ ...cb, mandate })) })),
  setDebtFinancingRegime: (countryId, regime) =>
    set((state) => ({ countries: mapCentralBank(state.countries, countryId, state.tick, (cb) => ({ ...cb, debtFinancing: regime })) })),
  setExchangeRateRegime: (countryId, regime) =>
    set((state) => ({ countries: mapCentralBank(state.countries, countryId, state.tick, (cb) => ({ ...cb, exchangeRegime: regime })) })),

  setPolicyRate: (countryId, rate) =>
    set((state) => ({
      // The government may set the rate directly ONLY on a bank it controls. On
      // an independent bank this is a no-op — the whole point of independence.
      countries: mapCentralBank(state.countries, countryId, state.tick, (cb) =>
        governmentControlsPolicy(cb) ? { ...cb, policyRate: clampRate(rate) } : cb,
      ),
    })),
  setReserveRequirement: (countryId, requirement) =>
    set((state) => ({
      countries: mapCentralBank(state.countries, countryId, state.tick, (cb) =>
        governmentControlsPolicy(cb) ? { ...cb, reserveRequirement: clamp01(requirement) } : cb,
      ),
    })),

  pressureCentralBank: (countryId, amount) =>
    set((state) => ({
      // Leaning on the bank raises standing pressure (capped) and chips at its
      // credibility — the cost of politicizing monetary policy.
      countries: mapCentralBank(state.countries, countryId, state.tick, (cb) => ({
        ...cb,
        governmentPressure: clamp01(cb.governmentPressure + amount),
        credibility: clamp01(cb.credibility - amount * 0.15),
      })),
    })),

  appointGovernor: (countryId, name) =>
    set((state) => ({
      countries: mapCentralBank(state.countries, countryId, state.tick, (cb) => ({
        ...cb,
        governorName: name,
        governorTermStart: state.tick,
        governorTermLength: governorAppointmentDef(cb.appointment).termTicks,
      })),
    })),

  openMarketOperation: (countryId, amount) =>
    set((state) => {
      const country = state.countries.find((c) => c.id === countryId)
      const cb = country?.centralBank
      if (!country || !cb || !hasCentralBank(cb)) return state
      // OMO needs a regime that permits secondary-market operations at all.
      if (!debtFinancingRegimeDef(cb.debtFinancing).secondaryMarket) return state
      const mine = state.banks.filter((b) => b.countryId === countryId)
      const totalDeposits = mine.reduce((s, b) => s + b.deposits, 0)
      if (mine.length === 0 || totalDeposits <= 0) return state
      // A buy injects reserves (creates base money). A sell drains reserves, capped
      // by securities the CB holds and reserves the banks actually have.
      let inject = amount
      if (amount < 0) {
        const availReserves = mine.reduce((s, b) => s + b.reserves, 0)
        inject = -Math.min(-amount, cb.govSecurities, availReserves)
      }
      const banks = state.banks.map((b) =>
        b.countryId === countryId ? { ...b, reserves: Math.max(0, b.reserves + inject * (b.deposits / totalDeposits)) } : b,
      )
      const countries = state.countries.map((c) =>
        c.id === countryId ? { ...c, centralBank: { ...cb, govSecurities: Math.max(0, cb.govSecurities + inject) } } : c,
      )
      return { banks, countries }
    }),
  }
})

// Apply `fn` to a country's central bank if it has one. A country with no
// central bank (undefined or status 'no-bank') is left untouched — callers use
// establishCentralBank first. `tick` is threaded for actions that need it.
function mapCentralBank(countries: Country[], countryId: string, _tick: number, fn: (cb: CentralBank) => CentralBank): Country[] {
  return countries.map((c) => {
    if (c.id !== countryId || !c.centralBank) return c
    return { ...c, centralBank: fn(c.centralBank) }
  })
}

function clamp01(x: number): number {
  return Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0
}
// Policy rate is an annual fraction; clamp to a sane 0..50% band.
function clampRate(x: number): number {
  return Number.isFinite(x) ? Math.max(0, Math.min(0.5, x)) : 0
}

let corpCounter = 0
let charCounter = 100
let offerCounter = 0

const FOREIGN_INVESTORS = ['Venusian Sovereign Fund', 'Orion Pension Bloc', 'Tidal Communion Endowment', 'Lalande Treasury', 'Centauri Capital', 'Sirius Holdings']
function randomInvestor(): string {
  return FOREIGN_INVESTORS[Math.floor(Math.random() * FOREIGN_INVESTORS.length)]
}

const FIRST_NAMES = ['Aria', 'Cato', 'Vesna', 'Idris', 'Mira', 'Rennick', 'Tamara', 'Osei', 'Lena', 'Corvin', 'Suri', 'Halden']
const SURNAMES = ['Voss', 'Ander', 'Quist', 'Marlowe', 'Okonkwo', 'Renn', 'Sable', 'Thorne', 'Vane', 'Bright']
const TRAITS = ['Diligent', 'Ambitious', 'Shrewd', 'Greedy', 'Charismatic', 'Cautious', 'Bold', 'Incorruptible']
function randomName(): string {
  return `${FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)]} ${SURNAMES[Math.floor(Math.random() * SURNAMES.length)]}`
}
function randomTrait(): string {
  return TRAITS[Math.floor(Math.random() * TRAITS.length)]
}

// The World for a given body name (e.g. 'Mars'), or undefined if uninhabited.
export function worldByName(worlds: World[], name: string | undefined): World | undefined {
  if (!name) return undefined
  return worlds.find((w) => w.id === name)
}
