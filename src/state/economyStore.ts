import { create } from 'zustand'
import { seedWorlds, seedCountries, seedCorporations, seedCharacters, seedFamilies } from '../economy/economySeed'
import { tickEconomy, constructionCost, sharePrice, corporationValue, canBuild, BUILD_COST_PER_LEVEL } from '../economy/economyTick'
import { RETOOL_THROUGHPUT_FACTOR, type EconomicSystem } from '../economy/laws'
import { RECIPES } from '../economy/recipes'
import type { Building, BuildingOwner, Character, Corporation, Country, CountryFiscal, World, WorldReport } from '../economy/economyTypes'

// The kind a corporation should be given its state shareholding: a state
// majority makes it state-owned, otherwise private. A financial district keeps
// its own kind regardless.
function derivedKind(corp: Corporation, stateShares: number): Corporation['kind'] {
  if (corp.kind === 'financial') return 'financial'
  return corp.totalShares > 0 && stateShares / corp.totalShares >= 0.5 ? 'state' : 'private'
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

// One sampled point of a country's headline fiscal metrics, appended each tick
// — the series the finance graphs plot.
export interface FiscalSample {
  gdp: number
  priceLevel: number
  inflation: number
  revenue: number
  expenditure: number
  debtToGdp: number
  treasury: number
}

const HISTORY_LENGTH = 104
const MAX_CATCH_UP_TICKS = 40

interface EconomyStore {
  countries: Country[]
  worlds: World[]
  corporations: Corporation[]
  characters: Character[]
  families: import('../economy/economyTypes').Family[]
  tick: number
  worldReports: Record<string, WorldReport>
  countryReports: Record<string, CountryFiscal>
  // Per-country fiscal history, oldest first.
  history: Record<string, FiscalSample[]>
  advance: (ticks: number) => void
  setTaxRate: (countryId: string, rate: number) => void
  setWelfare: (countryId: string, perCapita: number) => void
  // Queue a building. `owner` decides who pays and who owns it: state (default,
  // government pool → treasury) or a corporation (private pool → its cash).
  // Refused if the target district on the world is full.
  queueConstruction: (worldId: string, recipeId: string, owner?: BuildingOwner) => void
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
  // Move a building to a new owner (nationalise → state, or assign to a corp /
  // worker co-op). Used by the privatise/nationalise flows.
  setBuildingOwner: (worldId: string, buildingId: string, owner: BuildingOwner) => void
  // Nationalise a whole corporation: all its buildings become state-owned and
  // the company is dissolved into the treasury.
  nationaliseCorporation: (corporationId: string) => void
  // Privatise a state corporation: float its shares publicly (state keeps a
  // minority stake) and credit the sale proceeds to the treasury.
  privatiseCorporation: (corporationId: string) => void
  // Nationalise ONE building regardless of its owning corporation's overall
  // status: it becomes state-owned. Unlike a full corporate nationalisation
  // (no per-building compensation there — the whole company is bought out at
  // once), this pays the building's own owner a proportional compensation from
  // the treasury and costs a smaller bureaucracy hit (see economyStore).
  nationaliseBuilding: (worldId: string, buildingId: string) => void
  // --- Subsidies (a per-tick treasury → cash transfer; a real fiscal cost) ---
  // Set (or, at 0, clear) a standing per-tick subsidy paid to a corporation.
  setSubsidyForCorporation: (countryId: string, corporationId: string, amountPerTick: number) => void
  // Set (or, at 0, clear) a standing per-tick subsidy paid toward one specific
  // building — credited to its owning corporation's cash if corporation-owned,
  // otherwise simply spent (funds a state/worker building's upkeep).
  setSubsidyForBuilding: (countryId: string, worldId: string, buildingId: string, amountPerTick: number) => void
  // The state buys `shares` of a corporation on the exchange (costs treasury);
  // negative sells. Moves shares between the public float and the state.
  tradeShares: (countryId: string, corporationId: string, shares: number) => void
  // A character interaction (grant funds, demand dividend, dismiss, etc.).
  characterAction: (characterId: string, action: string) => void
  // --- Laws / bonds / debt ---
  setHealthcareSystem: (countryId: string, system: import('../economy/laws').HealthcareSystem) => void
  // Sell bonds to a class of buyer (raises treasury cash, adds to the debt).
  // Foreign sales are gated by the foreign-bond law.
  issueBonds: (countryId: string, amount: number, buyer: 'pops' | 'corporations' | 'foreign') => void
  // Buy back bonds (spends treasury, cuts the debt), drawn proportionally.
  redeemBonds: (countryId: string, amount: number) => void
  setForeignBondPolicy: (countryId: string, policy: import('../economy/laws').ForeignBondPolicy) => void
  setForeignApproval: (countryId: string, require: boolean) => void
  approveForeignOffer: (countryId: string, offerId: string) => void
  rejectForeignOffer: (countryId: string, offerId: string) => void
}

let constructionCounter = 0

function sampleOf(f: CountryFiscal): FiscalSample {
  return {
    gdp: f.gdp,
    priceLevel: f.priceLevel,
    inflation: f.inflation,
    revenue: f.revenue,
    expenditure: f.expenditure,
    debtToGdp: f.debtToGdp,
    treasury: f.treasury,
  }
}

export const useEconomyStore = create<EconomyStore>((set) => ({
  countries: seedCountries(),
  worlds: seedWorlds(),
  corporations: seedCorporations(),
  characters: seedCharacters(),
  families: seedFamilies(),
  tick: 0,
  worldReports: {},
  countryReports: {},
  history: {},
  advance: (ticks) =>
    set((state) => {
      const steps = Math.max(0, Math.min(MAX_CATCH_UP_TICKS, Math.floor(ticks)))
      if (steps === 0) return state
      let countries = state.countries
      let worlds = state.worlds
      let corporations = state.corporations
      let worldReports = state.worldReports
      let countryReports = state.countryReports
      const history: Record<string, FiscalSample[]> = { ...state.history }
      for (let i = 0; i < steps; i++) {
        const res = tickEconomy(countries, worlds, corporations)
        countries = res.countries
        worlds = res.worlds
        corporations = res.corporations
        worldReports = res.reports.worlds
        countryReports = res.reports.countries
        for (const c of countries) {
          const series = history[c.id] ? [...history[c.id]] : []
          series.push(sampleOf(countryReports[c.id]))
          if (series.length > HISTORY_LENGTH) series.splice(0, series.length - HISTORY_LENGTH)
          history[c.id] = series
        }
      }
      // Foreign bond demand: every so often, foreign investors offer to buy a
      // country's debt. Under the approval setting the offer waits for the
      // player; otherwise it is taken up automatically (open markets).
      const newTick = state.tick + steps
      if (Math.floor(newTick / 12) > Math.floor(state.tick / 12)) {
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
      return { countries, worlds, corporations, worldReports, countryReports, history, tick: newTick }
    }),
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
        if (!canBuild(w, recipeId)) return w // district full — no room
        constructionCounter += 1
        const order = { id: `con-${worldId}-${recipeId}-${constructionCounter}`, recipeId, cost: constructionCost(), progress: 0, owner }
        return { ...w, constructionQueue: [...w.constructionQueue, order] }
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

  nationaliseCorporation: (corporationId) =>
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

  privatiseCorporation: (corporationId) =>
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

  nationaliseBuilding: (worldId, buildingId) =>
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

  tradeShares: (countryId, corporationId, shares) =>
    set((state) => {
      const corp = state.corporations.find((c) => c.id === corporationId)
      const country = state.countries.find((c) => c.id === countryId)
      if (!corp || !country) return state
      const price = sharePrice(corp, state.worlds)
      const stateHolding = corp.shares.find((s) => s.holder.kind === 'state')?.shares ?? 0
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
        if (h.holder.kind === 'state') continue
        if (h.holder.kind === 'public') continue
        nextShares.push(h)
      }
      if (newState > 0) nextShares.push({ holder: { kind: 'state' }, shares: newState })
      if (newPublic > 0) nextShares.push({ holder: { kind: 'public' }, shares: newPublic })
      // Ownership decides the kind: if the state no longer holds a majority the
      // company is no longer state-owned (and vice-versa). This keeps the tab a
      // corporation shows up in congruent with who actually owns it — you can't
      // sell off all of a "state" corp yet have it still called state-owned.
      return {
        corporations: state.corporations.map((c) =>
          c.id === corporationId ? { ...c, shares: nextShares, kind: derivedKind(c, newState) } : c,
        ),
        countries: state.countries.map((c) => (c.id === countryId ? { ...c, treasury: c.treasury - cost } : c)),
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

  setHealthcareSystem: (countryId, system) =>
    set((state) => ({ countries: state.countries.map((c) => (c.id === countryId ? { ...c, healthcareSystem: system } : c)) })),

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
}))

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
