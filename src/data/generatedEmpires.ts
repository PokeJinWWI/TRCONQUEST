// The empires of the wider galaxy: twenty, scattered thinly over the generated
// neighbourhoods (data/galaxyGen.ts). DATA ONLY for now: nothing in the game
// reads this yet, and these are not nations (data/countryData.ts) — no ships,
// economy, diplomacy or AI.
//
// Each slot is generated from its own stream of the one seed, so slots do not
// depend on each other except to stay out of each other's systems. An entry in
// data/loreEmpires.ts replaces the generated empire in its slot.
import { ALL_TECHS, canResearch } from './techData'
import { INFLUENCE_CAP } from './colonyData'
import { DEFAULT_RESEARCHED } from '../state/techStore'
import { GALAXY_SEED, clusterOfGeneratedStar, findGeneratedStar, generatedClusterIds, generatedStarsFor, seededStream } from './galaxyGen'
import { LORE_EMPIRES, type LoreEmpire } from './loreEmpires'

export const EMPIRE_COUNT = 20
// The wider galaxy is sparse: most neighbourhoods have no empire, none has more.
export const MAX_EMPIRES_PER_CLUSTER = 2
// Systems an empire holds besides its home.
export const MAX_EXTRA_SYSTEMS = 3
// Techs researched beyond what every nation starts with.
export const MAX_EXTRA_TECHS = 12

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
  // Same shape as a nation's researched set (state/techStore.ts TechState).
  researched: Set<string>
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

    // Tech: what every nation starts with, then a random walk up the tree by
    // the game's own rule for what can be researched next.
    const researched = new Set<string>(DEFAULT_RESEARCHED)
    const steps = Math.floor(rng() * (MAX_EXTRA_TECHS + 1))
    for (let i = 0; i < steps; i++) {
      const open = ALL_TECHS.filter((t) => canResearch(t, researched, 0, true))
      if (open.length === 0) break
      researched.add(open[Math.floor(rng() * open.length)].id)
    }
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
        researched: entry.researched ? new Set(entry.researched) : researched,
        influence: entry.influence !== undefined ? Math.max(0, Math.min(INFLUENCE_CAP, entry.influence)) : influence,
        lore: true,
      })
    } else {
      empires.push({ slot, id: `empire-${slot}`, name, color, ...land, researched, influence })
    }
  }
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
