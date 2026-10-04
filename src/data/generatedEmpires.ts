// The empires of the wider galaxy: twenty, scattered thinly over the generated
// neighbourhoods (data/galaxyGen.ts). DATA ONLY for now: nothing in the game
// reads this yet, and these are not nations (data/countryData.ts) — no ships,
// economy, diplomacy or AI.
//
// Each slot is generated from its own stream of the one seed, so slots do not
// depend on each other except to stay out of each other's systems. An entry in
// data/loreEmpires.ts replaces the generated empire in its slot.
import { INFLUENCE_CAP } from './colonyData'
import { NEIGHBORHOODS } from './neighborhoodData'
import { HUMAN_BASELINE_TIER, MAX_TECH_TIER, techsForTier, tierOfTechs } from './techTiers'
import { WARP_DRIVE_TECH_IDS, WARP_MK1_RADIUS_KLY } from './warpData'
import { exoticMatterAtDistance } from './exoticMatter'
import { hyperiumAnomalyClusters, hyperiumInCluster } from './hyperium'
import { GALAXY_SEED, clusterOfGeneratedStar, findGeneratedStar, generatedClusterIds, generatedStarsFor, seededStream } from './galaxyGen'
import { LORE_EMPIRES, type LoreEmpire } from './loreEmpires'

export const EMPIRE_COUNT = 20
// The wider galaxy is sparse: most neighbourhoods have no empire, none has more.
export const MAX_EMPIRES_PER_CLUSTER = 2
// Systems an empire holds besides its home.
export const MAX_EXTRA_SYSTEMS = 3

// Tech tier (data/techTiers.ts; the human nations are HUMAN_BASELINE_TIER) follows
// closeness to the galactic core: a score falling linearly from TIER_AT_CORE at the
// core to TIER_AT_RIM at GALAXY_RADIUS_KLY, plus a seeded noise of up to +-TIER_NOISE
// so it is not a pure gradient, rounded and kept to 1..MAX_TECH_TIER. Most empires
// land above the baseline, the rim's at or below it.
export const TIER_AT_CORE = 6.0
export const TIER_AT_RIM = 2.2
export const TIER_NOISE = 1.2
export const GALAXY_RADIUS_KLY = 55
export const MIN_EMPIRE_TIER = 1

// How far a neighbourhood is from the galactic core, in thousands of light-years.
export function coreDistanceKly(clusterId: string): number {
  const n = NEIGHBORHOODS.find((x) => x.id === clusterId)
  return n ? Math.hypot(n.position[0], n.position[1]) : GALAXY_RADIUS_KLY
}

export function tierFor(coreDistance: number, noise: number): number {
  const closeness = 1 - Math.min(1, coreDistance / GALAXY_RADIUS_KLY)
  const score = TIER_AT_RIM + (TIER_AT_CORE - TIER_AT_RIM) * closeness + (noise * 2 - 1) * TIER_NOISE
  return Math.max(MIN_EMPIRE_TIER, Math.min(MAX_TECH_TIER, Math.round(score)))
}

export interface GalaxyEmpire {
  slot: number
  id: string
  name: string
  color: string
  // The neighbourhood it lives in.
  clusterId: string
  homeStarId: string
  // Every system it owns, home first. No system has two owners.
  ownedStarIds: string[]
  // Same shape as a nation's researched set (state/techStore.ts TechState): what
  // its tier gives (data/techTiers.ts), or a lore entry's own.
  researched: Set<string>
  // Tech tier against the human baseline (HUMAN_BASELINE_TIER); see tierFor.
  techTier: number
  // Its neighbourhood's distance from the galactic core, kly.
  coreDistanceKly: number
  // Starting exotic matter (falls with core distance) and hyperium (scarce, near Sol
  // only): what it could spend on Warp Drive Mks / hyperdrive ships. data/exoticMatter.ts, data/hyperium.ts.
  exoticMatter: number
  hyperium: number
  // Political power, on the nations' own Influence scale (0..INFLUENCE_CAP).
  influence: number
  // True for an entry from data/loreEmpires.ts.
  lore?: true
}

const NAME_ROOTS = [
  'Kethar', 'Vossa', 'Ilmar', 'Thessa', 'Orrun', 'Qadir', 'Zenth', 'Aurel', 'Branoc', 'Cyra',
  'Dravik', 'Eshtar', 'Halcy', 'Jorun', 'Lumen', 'Myrr', 'Nadir', 'Ostra', 'Pell', 'Rhovan',
  'Sable', 'Tyrr', 'Ulm', 'Varga', 'Wend', 'Xanth', 'Yarrow', 'Zorya', 'Ammon', 'Belisar',
]
const NAME_FORMS = ['Republic', 'Hegemony', 'Concord', 'League', 'Dominion', 'Commonwealth', 'Directorate', 'Union', 'Compact', 'Sovereignty']

function hslToHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l)
  const channel = (n: number) => {
    const k = (n + h / 30) % 12
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))))
      .toString(16)
      .padStart(2, '0')
  }
  return `#${channel(0)}${channel(8)}${channel(4)}`
}

function distance(a: [number, number, number], b: [number, number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}

// What a lore entry says about where it lives, with the stars that don't exist
// dropped. Null when it names no (valid) home: it then takes the slot's
// generated territory.
function loreTerritory(lore: LoreEmpire): { clusterId: string; homeStarId: string; ownedStarIds: string[] } | null {
  const clusterId = lore.homeStarId ? clusterOfGeneratedStar(lore.homeStarId) : undefined
  if (!lore.homeStarId || !clusterId) return null
  const rest = (lore.ownedStarIds ?? []).filter((id) => id !== lore.homeStarId && findGeneratedStar(id))
  return { clusterId, homeStarId: lore.homeStarId, ownedStarIds: [lore.homeStarId, ...new Set(rest)] }
}

export function generateEmpires(seed: number, lore: LoreEmpire[] = []): GalaxyEmpire[] {
  const clusterIds = generatedClusterIds()
  const owned = new Set<string>()
  const perCluster = new Map<string, number>()
  // Each slot has its own name root (a shuffle of the list by the seed), so no
  // two generated empires share a name and none depends on another's.
  const shuffle = seededStream(seed, 'empire-names')
  const roots = [...NAME_ROOTS]
  for (let i = roots.length - 1; i > 0; i--) {
    const j = Math.floor(shuffle() * (i + 1))
    ;[roots[i], roots[j]] = [roots[j], roots[i]]
  }
  const claim = (clusterId: string, starIds: string[]) => {
    for (const id of starIds) owned.add(id)
    perCluster.set(clusterId, (perCluster.get(clusterId) ?? 0) + 1)
  }

  // Lore first: its systems are taken before any generated empire picks.
  const loreBySlot = new Map<number, LoreEmpire>()
  for (const entry of lore) {
    if (!Number.isInteger(entry.slot) || entry.slot < 0 || entry.slot >= EMPIRE_COUNT || loreBySlot.has(entry.slot)) continue
    loreBySlot.set(entry.slot, entry)
  }
  const loreLand = new Map<number, NonNullable<ReturnType<typeof loreTerritory>>>()
  for (const [slot, entry] of loreBySlot) {
    const land = loreTerritory(entry)
    if (!land) continue
    const free = land.ownedStarIds.filter((id) => !owned.has(id))
    if (free[0] !== land.homeStarId) continue
    loreLand.set(slot, { ...land, ownedStarIds: free })
    claim(land.clusterId, free)
  }

  const empires: GalaxyEmpire[] = []
  for (let slot = 0; slot < EMPIRE_COUNT; slot++) {
    const rng = seededStream(seed, `empire:${slot}`)
    const entry = loreBySlot.get(slot)

    // Where it lives: a neighbourhood with room, a free home system there, and
    // up to MAX_EXTRA_SYSTEMS of the nearest free systems around it.
    let land = loreLand.get(slot)
    if (!land) {
      for (let attempt = 0; attempt < 500 && !land; attempt++) {
        const clusterId = clusterIds[Math.floor(rng() * clusterIds.length)]
        if ((perCluster.get(clusterId) ?? 0) >= MAX_EMPIRES_PER_CLUSTER) continue
        const free = generatedStarsFor(clusterId).filter((s) => !owned.has(s.id))
        if (free.length === 0) continue
        const home = free[Math.floor(rng() * free.length)]
        const extras = Math.floor(rng() * (MAX_EXTRA_SYSTEMS + 1))
        const nearest = free
          .filter((s) => s.id !== home.id)
          .sort((a, b) => distance(a.position, home.position) - distance(b.position, home.position) || a.id.localeCompare(b.id))
          .slice(0, extras)
        land = { clusterId, homeStarId: home.id, ownedStarIds: [home.id, ...nearest.map((s) => s.id)] }
        claim(clusterId, land.ownedStarIds)
      }
    }
    if (!land) continue

    // Tech: a tier from closeness to the core plus seeded noise (its own stream, so
    // the tier does not move anything else the slot rolls), and what that tier
    // has researched.
    const coreDistance = coreDistanceKly(land.clusterId)
    // Near the core, where exotic matter is, it also has Warp Drive Mk I (and is at
    // least at the human baseline, so its prerequisites are there).
    const nearCore = coreDistance <= WARP_MK1_RADIUS_KLY
    const generatedTier = Math.max(nearCore ? HUMAN_BASELINE_TIER : 0, tierFor(coreDistance, seededStream(seed, `tier:${slot}`)()))
    const researched = techsForTier(generatedTier)
    if (nearCore) researched.add(WARP_DRIVE_TECH_IDS[0])
    const influence = Math.round(rng() * INFLUENCE_CAP)

    const name = `${roots[slot % roots.length]} ${NAME_FORMS[Math.floor(rng() * NAME_FORMS.length)]}`
    const color = hslToHex(Math.floor(rng() * 360), 0.55, 0.6)

    if (entry) {
      empires.push({
        slot,
        id: entry.id,
        name: entry.name,
        color: entry.color,
        ...land,
        // A lore empire states a tier, or its own techs (its tier is then the highest
        // the techs cover), or keeps what the slot generated.
        ...(() => {
          const own = entry.researched ? new Set(entry.researched) : entry.techTier !== undefined ? techsForTier(entry.techTier) : null
          return own ? { researched: own, techTier: entry.techTier ?? tierOfTechs(own) } : { researched, techTier: generatedTier }
        })(),
        coreDistanceKly: coreDistance,
        exoticMatter: Math.round(exoticMatterAtDistance(coreDistance)),
        hyperium: 0,
        influence: entry.influence !== undefined ? Math.max(0, Math.min(INFLUENCE_CAP, entry.influence)) : influence,
        lore: true,
      })
    } else {
      empires.push({ slot, id: `empire-${slot}`, name, color, ...land, researched, techTier: generatedTier, coreDistanceKly: coreDistance, exoticMatter: Math.round(exoticMatterAtDistance(coreDistance)), hyperium: 0, influence })
    }
  }
  // Hyperium: the modest stock near Sol, the tiny deposit in a few seeded clusters that
  // host an empire, nothing anywhere else (data/hyperium.ts).
  const anomalies = hyperiumAnomalyClusters(empires.map((e) => e.clusterId), seed)
  for (const e of empires) e.hyperium = hyperiumInCluster(e.clusterId, anomalies)
  return empires
}

let cached: GalaxyEmpire[] | null = null

// The galaxy's empires: generated from GALAXY_SEED, with data/loreEmpires.ts
// entries in their slots. Built on first use.
export function galaxyEmpires(): GalaxyEmpire[] {
  if (!cached) cached = generateEmpires(GALAXY_SEED, LORE_EMPIRES)
  return cached
}

// Who owns a generated system, if anyone.
export function empireOwningStar(starId: string): GalaxyEmpire | undefined {
  return galaxyEmpires().find((e) => e.ownedStarIds.includes(starId))
}
