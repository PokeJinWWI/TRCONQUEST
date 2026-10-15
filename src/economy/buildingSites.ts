// A building belongs to a PLACE: the same recipe built in two places is two buildings, each with its own level
// (docs/territorial-design.md section 14). A Complex `Building` is identified by (recipeId, owner, siteId); `level` is how many stand
// there. `siteId` absent = unplaced (the empires' sims, an AI build not yet placed, anything built before sites existed).
// Pure: no store, no React.
import type { Building, BuildingOwner } from './economyTypes'

export const sameBuildingOwner = (a: BuildingOwner, b: BuildingOwner): boolean =>
  a.kind === b.kind && (a.kind !== 'corporation' || a.corporationId === (b as { corporationId?: string }).corporationId)

// The key a building is merged under when a build order finishes or a level is added.
export const buildingKey = (recipeId: string, owner: BuildingOwner, siteId?: string): string =>
  `${recipeId}|${owner.kind}${owner.kind === 'corporation' ? `:${owner.corporationId}` : ''}|${siteId ?? ''}`

export const keyOfBuilding = (b: Pick<Building, 'recipeId' | 'owner' | 'siteId'>): string => buildingKey(b.recipeId, b.owner, b.siteId)

// The building of this recipe, owner and place, if any (siteId undefined = the unplaced one).
export function findBuilding(buildings: readonly Building[], recipeId: string, owner: BuildingOwner, siteId?: string): Building | undefined {
  return buildings.find((b) => b.recipeId === recipeId && sameBuildingOwner(b.owner, owner) && (b.siteId ?? '') === (siteId ?? ''))
}

// Every building of a recipe, wherever it stands.
export const buildingsOfRecipe = (buildings: readonly Building[], recipeId: string): Building[] => buildings.filter((b) => b.recipeId === recipeId)

// How much of a recipe a world has: levels summed over every place (and owner, unless one is given).
export function levelOf(buildings: readonly Building[], recipeId: string, owner?: BuildingOwner): number {
  let n = 0
  for (const b of buildings) if (b.recipeId === recipeId && (!owner || sameBuildingOwner(b.owner, owner))) n += b.level
  return n
}

// The levels of a recipe standing at one site.
export const levelAtSite = (buildings: readonly Building[], recipeId: string, siteId: string): number =>
  buildings.filter((b) => b.recipeId === recipeId && b.siteId === siteId).reduce((n, b) => n + b.level, 0)

const scaleInventory = (inv: Building['inventory'], f: number): Building['inventory'] => {
  const out: Building['inventory'] = {}
  for (const [k, v] of Object.entries(inv)) out[k as keyof Building['inventory']] = (v ?? 0) * f
  return out
}

// A building cut to `level` of its `from` levels: per-level quantities (throughput, idle, mothballing) stay, totals are shared out.
function share(b: Building, level: number, siteId: string | undefined): Building {
  const f = level / b.level
  const piece: Building = {
    ...b,
    id: siteId ? `${b.id}@${siteId}` : b.id,
    level,
    inventory: scaleInventory(b.inventory, f),
    lastProfit: b.lastProfit * f,
    employed: b.employed * f,
    jobsPosted: b.jobsPosted * f,
  }
  if (siteId) piece.siteId = siteId
  return piece
}

// Turns each unplaced aggregate Building into per-place Buildings by what the ledger says stands where (site -> recipe -> units).
// Units are dealt out to a recipe's unplaced buildings in order, the biggest first; whatever the ledger does not place stays
// unplaced. The total level per (recipe, owner) never changes.
export function splitBySites(buildings: readonly Building[], placed: Readonly<Record<string, Readonly<Record<string, number>>>>): Building[] {
  const bySite: Record<string, [string, number][]> = {}
  for (const siteId of Object.keys(placed).sort()) for (const [recipeId, n] of Object.entries(placed[siteId])) if (n > 0) (bySite[recipeId] ??= []).push([siteId, n])
  const out: Building[] = []
  const pool = new Map<string, Building[]>()
  for (const b of buildings) {
    if (b.siteId || b.level <= 0 || !bySite[b.recipeId]) out.push(b)
    else pool.set(b.recipeId, [...(pool.get(b.recipeId) ?? []), b])
  }
  for (const [recipeId, list] of pool) {
    const supply = [...list].sort((a, b) => b.level - a.level || (a.id < b.id ? -1 : 1))
    const left = new Map(supply.map((b) => [b.id, b.level]))
    for (const [siteId, ledgerN] of bySite[recipeId]) {
      // What already stands there as its own building is not dealt out again.
      let want = ledgerN - levelAtSite(buildings, recipeId, siteId)
      for (const b of supply) {
        if (want <= 0) break
        const have = left.get(b.id) ?? 0
        const take = Math.min(have, want)
        if (take <= 0) continue
        left.set(b.id, have - take)
        want -= take
        const existing = out.findIndex((x) => x.recipeId === recipeId && x.siteId === siteId && sameBuildingOwner(x.owner, b.owner) && x.methodId === b.methodId)
        if (existing >= 0) out[existing] = { ...out[existing], level: out[existing].level + take, inventory: sumInventory(out[existing].inventory, scaleInventory(b.inventory, take / b.level)), lastProfit: out[existing].lastProfit + (b.lastProfit * take) / b.level, employed: out[existing].employed + (b.employed * take) / b.level, jobsPosted: out[existing].jobsPosted + (b.jobsPosted * take) / b.level }
        else out.push(share(b, take, siteId))
      }
    }
    for (const b of supply) {
      const rest = left.get(b.id) ?? 0
      if (rest > 0) out.push(rest === b.level ? b : share(b, rest, undefined))
    }
  }
  return out
}

function sumInventory(a: Building['inventory'], b: Building['inventory']): Building['inventory'] {
  const out: Building['inventory'] = { ...a }
  for (const [k, v] of Object.entries(b)) out[k as keyof Building['inventory']] = (out[k as keyof Building['inventory']] ?? 0) + (v ?? 0)
  return out
}

// The inverse (tests, downsizing): the places of a (recipe, owner, method) folded back into one building, throughput weighted by level.
export function mergeSites(buildings: readonly Building[]): Building[] {
  const groups = new Map<string, Building[]>()
  const order: string[] = []
  for (const b of buildings) {
    const k = `${b.recipeId}|${b.owner.kind}:${b.owner.kind === 'corporation' ? b.owner.corporationId : ''}|${b.methodId}`
    if (!groups.has(k)) order.push(k)
    groups.set(k, [...(groups.get(k) ?? []), b])
  }
  return order.map((k) => {
    const g = groups.get(k)!
    if (g.length === 1 && !g[0].siteId) return g[0]
    const level = g.reduce((n, b) => n + b.level, 0)
    const head = g.find((b) => !b.siteId) ?? g[0]
    const merged: Building = {
      ...head,
      id: head.id.split('@')[0],
      level,
      inventory: g.reduce((inv, b) => sumInventory(inv, b.inventory), {} as Building['inventory']),
      throughput: g.reduce((n, b) => n + b.throughput * b.level, 0) / level,
      lastProfit: g.reduce((n, b) => n + b.lastProfit, 0),
      employed: g.reduce((n, b) => n + b.employed, 0),
      jobsPosted: g.reduce((n, b) => n + b.jobsPosted, 0),
    }
    delete merged.siteId
    if (g.some((b) => b.idle)) merged.idle = g.reduce((n, b) => n + (b.idle ?? 0) * b.level, 0) / level
    return merged
  })
}
