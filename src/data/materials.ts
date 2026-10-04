// The registry of materials a nation can discover, and what discovering one means.
// A nation has discovered a material when it has surveyed a body that contains it
// OR holds any in its stockpile. Discovery is latched (state/materialStore.ts): it
// never un-discovers when the stockpile runs out. The player's research UI shows an
// undiscovered material's name as "???" (obfuscateMaterials); nothing else changes
// and the AI is unaffected.
//
// To add a material: a row here, a deposit table in data/deposits.ts if it lies in
// bodies, and an extraction tech in data/techData.ts.
import { bodyHasDeposit } from './deposits'
import type { ResourceId } from './resourceData'

export type MaterialId = Extract<ResourceId, 'exoticMatter' | 'hyperium'>

export interface MaterialDef {
  id: MaterialId
  name: string
  // The words that name it in text, matched whole and case-insensitively.
  terms: readonly string[]
  // The tech that lets a nation draw it from deposits (data/techData.ts).
  extractionTechId: string
}

export const MATERIALS: readonly MaterialDef[] = [
  { id: 'exoticMatter', name: 'Exotic Matter', terms: ['exotic matter'], extractionTechId: 'exotic-matter-extraction' },
  { id: 'hyperium', name: 'Hyperium', terms: ['hyperium'], extractionTechId: 'hyperium-extraction' },
]

export function materialDef(id: MaterialId): MaterialDef {
  return MATERIALS.find((m) => m.id === id)!
}

// Whether a nation that has surveyed the bodies `surveyed` says yes to, and holds
// `stock` of the material, has discovered it.
export function materialDiscovered(id: MaterialId, surveyed: (bodyName: string) => boolean, stock: number, candidateBodies: readonly string[]): boolean {
  if (stock > 0) return true
  return candidateBodies.some((body) => bodyHasDeposit(id, body) && surveyed(body))
}

// Every material `surveyed` and `stock` discover (the ids, in registry order).
export function discoveredMaterials(surveyed: (bodyName: string) => boolean, stockOf: (id: MaterialId) => number, candidateBodies: readonly string[]): MaterialId[] {
  return MATERIALS.filter((m) => materialDiscovered(m.id, surveyed, stockOf(m.id), candidateBodies)).map((m) => m.id)
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// `text` with every undiscovered material's name replaced by "???", e.g.
// "Hyperium Synthesis" -> "??? Synthesis", "Needs 15 exotic matter" -> "Needs 15 ???".
// Pure; text naming no undiscovered material comes back unchanged.
export function obfuscateMaterials(text: string, discovered: ReadonlySet<MaterialId>): string {
  let out = text
  for (const m of MATERIALS) {
    if (discovered.has(m.id)) continue
    // A space in a term also matches a hyphen ("exotic-matter handling").
    for (const term of m.terms) out = out.replace(new RegExp(`\\b${escapeRegExp(term).replace(/ /g, '[\\s-]')}\\b`, 'gi'), '???')
  }
  return out
}
