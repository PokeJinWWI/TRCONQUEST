// Natural deposits of hyperium and exotic matter: finite reserves on a few planets
// near Sol, and nowhere else. A nation draws them with its Extraction tech
// (scene/extraction.ts) from bodies it owns; a body's deposit is shown to the
// player once the body is surveyed.
//
// WHERE: planets (dwarf planets included, moons and belts not) of every cluster
// within DEPOSIT_RADIUS_KLY of Sol: the Solar Neighbourhood and the one other
// cluster that close. Each body decides from its OWN seeded stream, so a body's
// deposit never depends on iteration order or on any other body.
//
// HYPERIUM: about half the candidates hold some, in a narrow band regardless of
// class. Every nation's capital world is guaranteed one (so every human nation has
// access), Mars's is richer, and so are some bodies outside the Solar Neighbourhood.
// EXOTIC MATTER: very scarce, a handful of small deposits, Venus's the largest.
import { getPlanetsForStar } from '../scene/planetData'
import { COUNTRIES } from './countryData'
import { GALAXY_SEED, SOLAR_NEIGHBORHOOD_ID, seededStream } from './galaxyGen'
import { HYPERIUM_NEAR_SOL_KLY, distanceFromSolKly } from './hyperium'
import { NEIGHBORHOODS } from './neighborhoodData'
import { getStarsForNeighborhood } from './starData'
import type { MaterialId } from './materials'

// Clusters this close to Sol (kly) can hold deposits: the same radius as the
// starting hyperium (data/hyperium.ts).
export const DEPOSIT_RADIUS_KLY = HYPERIUM_NEAR_SOL_KLY

// Hyperium.
export const HYPERIUM_DEPOSIT_CHANCE = 0.5
export const HYPERIUM_DEPOSIT_MIN = 40
export const HYPERIUM_DEPOSIT_MAX = 60
// A rich deposit is this much bigger.
export const DEPOSIT_RICH = 1.5
// Of the hyperium deposits outside the Solar Neighbourhood, about this share are rich.
export const DEPOSIT_RICH_FAR_SHARE = 0.5
// Mars's capital deposit: the largest of all (a fixed amount, above every rich one).
export const RICH_HYPERIUM_NATION = 'imperial-state-of-mars'
export const RICH_NATION_DEPOSIT = 100

// Exotic matter.
export const EXOTIC_DEPOSIT_COUNT = 4
export const EXOTIC_DEPOSIT_MIN = 3
// The largest, and Venus's.
export const EXOTIC_DEPOSIT_MAX = 8
export const RICH_EXOTIC_NATION = 'republic-of-venus'

// What a nation with the Extraction tech draws a month from each deposit body it holds.
export const EXTRACTION_PER_MONTH = 1

export type DepositTable = Record<string, number>
export type Deposits = Record<MaterialId, DepositTable>

interface Candidate {
  name: string
  clusterId: string
}

let candidates: Candidate[] | null = null
function candidateBodies(): Candidate[] {
  if (candidates) return candidates
  const out: Candidate[] = []
  for (const n of NEIGHBORHOODS) {
    if (distanceFromSolKly(n.id) > DEPOSIT_RADIUS_KLY) continue
    for (const star of getStarsForNeighborhood(n.id)) for (const p of getPlanetsForStar(star.id)) out.push({ name: p.name, clusterId: n.id })
  }
  candidates = out
  return out
}

// The stream for one body and material. Names of one system share a prefix, which
// leaves the first draws of nearby keys correlated, so a couple are thrown away.
function bodyStream(material: MaterialId, bodyName: string): () => number {
  const rng = seededStream(GALAXY_SEED, `deposit:${material}:${bodyName}`)
  rng()
  rng()
  return rng
}

const capitalOf = (nationId: string): string | undefined => COUNTRIES.find((c) => c.id === nationId)?.capitalBodyName
const lerpRound = (lo: number, hi: number, u: number): number => Math.round(lo + (hi - lo) * u)

function hyperiumTable(): DepositTable {
  const table: DepositTable = {}
  const capitals = new Set(COUNTRIES.map((c) => c.capitalBodyName))
  const richBody = capitalOf(RICH_HYPERIUM_NATION)
  for (const c of candidateBodies()) {
    const rng = bodyStream('hyperium', c.name)
    const present = rng() < HYPERIUM_DEPOSIT_CHANCE
    const amount = lerpRound(HYPERIUM_DEPOSIT_MIN, HYPERIUM_DEPOSIT_MAX, rng())
    const richRoll = rng()
    if (!present && !capitals.has(c.name)) continue
    const rich = c.name === richBody || (c.clusterId !== SOLAR_NEIGHBORHOOD_ID && richRoll < DEPOSIT_RICH_FAR_SHARE)
    table[c.name] = c.name === richBody ? RICH_NATION_DEPOSIT : Math.round(amount * (rich ? DEPOSIT_RICH : 1))
  }
  return table
}

function exoticTable(): DepositTable {
  const table: DepositTable = {}
  const venus = capitalOf(RICH_EXOTIC_NATION)
  const ranked = candidateBodies()
    .filter((c) => c.name !== venus)
    .map((c) => {
      const rng = bodyStream('exoticMatter', c.name)
      return { name: c.name, roll: rng(), size: rng() }
    })
    // Lowest roll wins; the name settles a tie, so the order of the candidates never matters.
    .sort((a, b) => a.roll - b.roll || a.name.localeCompare(b.name))
  if (venus) table[venus] = EXOTIC_DEPOSIT_MAX
  const rest = EXOTIC_DEPOSIT_COUNT - (venus ? 1 : 0)
  for (const r of ranked.slice(0, rest)) table[r.name] = lerpRound(EXOTIC_DEPOSIT_MIN, EXOTIC_DEPOSIT_MAX - 1, r.size)
  return table
}

let tables: Deposits | null = null
// The starting deposits of every material, body -> amount. Deterministic.
export function depositTables(): Deposits {
  tables ??= { hyperium: hyperiumTable(), exoticMatter: exoticTable() }
  return tables
}

export function depositTable(material: MaterialId): DepositTable {
  return depositTables()[material]
}

export function bodyHasDeposit(material: MaterialId, bodyName: string): boolean {
  return bodyName in depositTable(material)
}

// A fresh, mutable copy for the store to count down.
export function freshDeposits(): Deposits {
  const t = depositTables()
  return { hyperium: { ...t.hyperium }, exoticMatter: { ...t.exoticMatter } }
}

// Every body that holds a deposit of anything.
export function depositBodies(): string[] {
  const t = depositTables()
  return [...new Set([...Object.keys(t.hyperium), ...Object.keys(t.exoticMatter)])]
}
