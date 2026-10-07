// Research in Complex mode. The deep economy has no "research" good; instead a
// nation's monthly research points (per tech tree) are a SIDE metric derived
// from its worlds — the educated workforce doing science, plus the research
// buildings it runs. economyStore grants these to techStore after every tick,
// exactly as Simple mode hands over its own researchByTree (abstractEconomyStore).
// Pure and testable; no store access.
import type { World } from './economyTypes'
import type { TechCategory } from '../data/techData'

export const TECH_TREES: TechCategory[] = ['physics', 'society', 'engineering']

// Per-LEVEL research a building contributes, by tree (scaled by how much of the
// building is actually running, 1 - idle). The University is the single biggest
// source and feeds all three trees; the others are narrower.
export const RESEARCH_BY_BUILDING: Record<string, Partial<Record<TechCategory, number>>> = {
  // The University feeds all three trees (broad). The three dedicated laboratories
  // each feed one tree harder than the University does per tree (focused). Other
  // buildings spill a little research over as a side effect.
  university: { physics: 2.4, society: 2.4, engineering: 2.4 },
  physicsLab: { physics: 4 },
  engineeringLab: { engineering: 4 },
  socialInstitute: { society: 4 },
  dataCenter: { physics: 1.0, engineering: 1.4 },
  semiconductorFab: { engineering: 0.8 },
  school: { society: 0.9 },
  financialCenter: { society: 0.7 },
}

// The educated-workforce base: skilled pops (the rungs that do real research)
// weighted by their education level. A small, broad contribution split across
// the trees, so even a nation with no research buildings inches forward.
export const SKILLED_CLASSES = ['technical', 'professional', 'investor'] as const
export const RESEARCH_PER_SKILLED_MILLION = 0.012 // × educationLevel, per million skilled pops
export const POP_RESEARCH_SPLIT: Record<TechCategory, number> = { physics: 0.35, society: 0.3, engineering: 0.35 }

function zero(): Record<TechCategory, number> {
  return { physics: 0, society: 0, engineering: 0 }
}

// One nation's research points PER MONTH, per tree, from its worlds.
export function nationResearch(worlds: readonly World[]): Record<TechCategory, number> {
  const out = zero()
  for (const w of worlds) {
    // Educated-workforce base.
    let skilled = 0
    for (const p of w.pops) if ((SKILLED_CLASSES as readonly string[]).includes(p.class)) skilled += p.populationSize * p.educationLevel
    const base = skilled * RESEARCH_PER_SKILLED_MILLION
    for (const t of TECH_TREES) out[t] += base * POP_RESEARCH_SPLIT[t]
    // Research buildings.
    for (const b of w.buildings) {
      const contrib = RESEARCH_BY_BUILDING[b.recipeId]
      if (!contrib) continue
      const active = b.level * (1 - (b.idle ?? 0))
      if (active <= 0) continue
      for (const t of TECH_TREES) if (contrib[t]) out[t] += contrib[t]! * active
    }
  }
  return out
}

// Research per month for every nation that owns a world in `worlds`, keyed by
// nation id. (The 20 generated empires live in the worker and are not here.)
export function researchByNation(worlds: readonly World[]): Record<string, Record<TechCategory, number>> {
  const byNation: Record<string, World[]> = {}
  for (const w of worlds) (byNation[w.ownerId] ??= []).push(w)
  const out: Record<string, Record<TechCategory, number>> = {}
  for (const [id, ws] of Object.entries(byNation)) out[id] = nationResearch(ws)
  return out
}
