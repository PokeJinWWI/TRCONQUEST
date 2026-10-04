// A Vic3-style market view of one good: who produces it and who consumes it,
// by world and building, and its price across a nation's worlds. Pure — reads
// the economy's worlds + world reports, no store access. Used by the Good Detail
// panel (components/GoodDetailPanel.tsx).
import { getMethod, RECIPES } from './recipes'
import { SPECIES_TEMPLATES, NEED_TIERS } from './species'
import type { GoodId } from './goods'
import type { World, WorldReport } from './economyTypes'

export interface GoodFlowRow {
  worldId: string
  worldName: string
  buildingId: string
  recipeId: string
  label: string
  level: number
  perTick: number
}

export interface GoodWorldPrice {
  worldId: string
  worldName: string
  price: number
  supply: number
  demand: number
  transacted: number
}

export interface GoodMarketSummary {
  producers: GoodFlowRow[]
  consumers: GoodFlowRow[]
  // Worlds whose population needs this good (a household consumer), with the
  // world's population — exact per-pop demand is in the needs model; this shows
  // where the people who want it live.
  popConsumerWorlds: { worldId: string; worldName: string; population: number }[]
  perWorld: GoodWorldPrice[]
  avgPrice: number // transacted-weighted across the worlds that trade it
  totalProduced: number
  totalConsumed: number
  totalSupply: number
  totalDemand: number
}

function buildingFlow(good: GoodId, worlds: readonly World[], pick: 'outputs' | 'inputs'): GoodFlowRow[] {
  const rows: GoodFlowRow[] = []
  for (const w of worlds) {
    for (const b of w.buildings) {
      const m = getMethod(b.recipeId, b.methodId)
      if (!m) continue
      const entry = m[pick].find((x) => x.good === good)
      if (!entry) continue
      const perTick = entry.amount * b.level * (b.throughput ?? 1)
      if (perTick <= 0) continue
      rows.push({ worldId: w.id, worldName: w.name, buildingId: b.id, recipeId: b.recipeId, label: RECIPES[b.recipeId]?.label ?? b.recipeId, level: b.level, perTick })
    }
  }
  return rows.sort((a, b) => b.perTick - a.perTick)
}

function speciesNeeds(good: GoodId, speciesId: string): boolean {
  const sp = SPECIES_TEMPLATES[speciesId]
  return !!sp && NEED_TIERS.some((t) => sp.needs[t].some((group) => group.goods.some((g) => g.good === good)))
}

export function goodMarketSummary(good: GoodId, worlds: readonly World[], reports: Record<string, WorldReport>): GoodMarketSummary {
  const producers = buildingFlow(good, worlds, 'outputs')
  const consumers = buildingFlow(good, worlds, 'inputs')

  const popConsumerWorlds: GoodMarketSummary['popConsumerWorlds'] = []
  for (const w of worlds) {
    const speciesIds = [...new Set(w.pops.map((p) => p.speciesTemplateId))]
    if (speciesIds.some((id) => speciesNeeds(good, id))) {
      popConsumerWorlds.push({ worldId: w.id, worldName: w.name, population: w.pops.reduce((n, p) => n + p.populationSize, 0) })
    }
  }
  popConsumerWorlds.sort((a, b) => b.population - a.population)

  const perWorld: GoodWorldPrice[] = []
  let wSum = 0
  let wTransacted = 0
  let totalSupply = 0
  let totalDemand = 0
  for (const w of worlds) {
    const g = reports[w.id]?.goods?.[good]
    const price = g?.price ?? w.market.prices[good] ?? 0
    const supply = g?.supply ?? 0
    const demand = g?.demand ?? 0
    const transacted = g?.transacted ?? 0
    perWorld.push({ worldId: w.id, worldName: w.name, price, supply, demand, transacted })
    totalSupply += supply
    totalDemand += demand
    wSum += price * (transacted || 1)
    wTransacted += transacted || 1
  }
  perWorld.sort((a, b) => b.transacted - a.transacted)

  return {
    producers,
    consumers,
    popConsumerWorlds,
    perWorld,
    avgPrice: wTransacted > 0 ? wSum / wTransacted : 0,
    totalProduced: producers.reduce((n, r) => n + r.perTick, 0),
    totalConsumed: consumers.reduce((n, r) => n + r.perTick, 0),
    totalSupply,
    totalDemand,
  }
}
