// The 20 generated empires' economies as ONE RESIDENT SIMULATION: seeded once,
// then advanced month by month by the same tickEconomy the four nations run on
// (economyStep.runEconomySteps). Resident because it is big (~2 MB of state) and
// nobody watches it: it lives inside the Web Worker (economyWorker.ts) and never
// crosses to the main thread, which only gets small per-empire summaries and,
// when something observes one empire, a snapshot of just that one (`snapshot`).
//
// That is exact, not an approximation: the empires and the four nations are
// independent simulations (the empires deal only within their own neighbourhood
// and no corporation or fund reaches across), which tests/economyEmpires.test.ts
// proves by running them together and apart and comparing every field.
import { galaxyEmpires } from '../data/generatedEmpires'
import { seedEmpireEconomies, type EmpireEconomy } from './empireSeed'
import { runEconomySteps, unemploymentOf, type FiscalSample } from './economyStep'
import type { Bank, Corporation, Country, World } from './economyTypes'

// What the main thread knows of an empire between observations: its headline
// numbers as of the last month.
export interface EmpireSummary {
  id: string
  name: string
  clusterId: string
  worlds: number
  population: number
  gdp: number
  priceLevel: number
  inflation: number
  treasury: number
  balance: number
  debtToGdp: number
  unemployment: number
}

// Everything one empire is: what an observer asks for.
export interface EmpireSnapshot {
  country: Country
  worlds: World[]
  corporations: Corporation[]
  banks: Bank[]
}

export interface EmpireUpdate {
  // Months simulated so far.
  tick: number
  summaries: Record<string, EmpireSummary>
  // One fiscal sample per month advanced, per empire, oldest first.
  samples: Record<string, FiscalSample[]>
}

export class EmpireSim {
  private economy: EmpireEconomy | null = null
  private state: { countries: Country[]; worlds: World[]; corporations: Corporation[]; banks: Bank[] } | null = null
  tick = 0

  get running(): boolean {
    return this.state !== null
  }

  // Seeds the empires' economies (month 0). Starting twice does nothing.
  start(): void {
    if (this.state) return
    this.economy = seedEmpireEconomies(galaxyEmpires())
    this.state = { countries: this.economy.countries, worlds: this.economy.worlds, corporations: this.economy.corporations, banks: this.economy.banks }
    this.tick = 0
  }

  stop(): void {
    this.state = null
    this.economy = null
    this.tick = 0
  }

  advance(steps: number): EmpireUpdate | null {
    if (!this.state || !this.economy || steps <= 0) return null
    const out = runEconomySteps({ ...this.state, startTick: this.tick, steps, humanCountryIds: [], warPairs: [], tradeGroups: this.economy.tradeGroups })
    this.state = { countries: out.countries, worlds: out.worlds, corporations: out.corporations, banks: out.banks }
    this.tick = out.tick
    const empires = galaxyEmpires()
    const summaries: Record<string, EmpireSummary> = {}
    for (const c of out.countries) {
      const f = out.countryReports[c.id]
      const empire = empires.find((e) => e.id === c.id)
      summaries[c.id] = {
        id: c.id,
        name: empire?.name ?? c.id,
        clusterId: empire?.clusterId ?? '',
        worlds: this.economy.worldIdsByEmpire[c.id]?.length ?? 0,
        population: f.population,
        gdp: f.gdp,
        priceLevel: f.priceLevel,
        inflation: f.inflation,
        treasury: c.treasury,
        balance: f.balance,
        debtToGdp: f.debtToGdp,
        unemployment: unemploymentOf(c.id, out.worlds, out.worldReports),
      }
    }
    return { tick: this.tick, summaries, samples: out.samples }
  }

  // One empire in full (null if it has no economy): for whatever observes it.
  snapshot(empireId: string): EmpireSnapshot | null {
    if (!this.state) return null
    const country = this.state.countries.find((c) => c.id === empireId)
    if (!country) return null
    return {
      country,
      worlds: this.state.worlds.filter((w) => w.ownerId === empireId),
      corporations: this.state.corporations.filter((c) => c.countryId === empireId),
      banks: this.state.banks.filter((b) => b.countryId === empireId),
    }
  }
}
