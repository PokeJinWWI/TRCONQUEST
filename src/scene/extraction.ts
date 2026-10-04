// Drawing hyperium and exotic matter from natural deposits (data/deposits.ts), and
// refining exotic matter into hyperium (Hyperium Synthesis). Pure steps first, the
// store I/O after, run once a month from hooks/useStrategicResources.ts for every
// nation alike (the AI takes part too, it just chooses nothing).
import { depositBodies, EXTRACTION_PER_MONTH, type Deposits } from '../data/deposits'
import { MATERIALS, type MaterialId } from '../data/materials'
import { COMPLEX_REFINERY_LEVELS, EXOTIC_PER_HYPERIUM, HYPERIUM_PER_REFINERY, HYPERIUM_SYNTHESIS_TECH_ID } from '../data/synthesisData'
import { useDepositStore } from '../state/depositStore'
import { useResourceStore } from '../state/resourceStore'
import { useTechStore } from '../state/techStore'
import { useTerritoryStore } from '../state/territoryStore'
import { controllerOf } from './territory'

export type Yield = Partial<Record<MaterialId, number>>

// What `months` of extraction yields from the deposits of the bodies a nation holds
// (owns AND controls), and what is left. A material needs its Extraction tech.
// Months batch exactly: n at once is n one at a time.
export function stepExtraction(
  remaining: Deposits,
  held: readonly string[],
  techs: ReadonlySet<string>,
  months: number,
  perMonth: number = EXTRACTION_PER_MONTH,
): { yielded: Yield; remaining: Deposits } {
  const yielded: Yield = {}
  const next: Deposits = { hyperium: { ...remaining.hyperium }, exoticMatter: { ...remaining.exoticMatter } }
  if (months <= 0) return { yielded, remaining: next }
  for (const m of MATERIALS) {
    if (!techs.has(m.extractionTechId)) continue
    for (const body of held) {
      const left = next[m.id][body] ?? 0
      if (left <= 0) continue
      const take = Math.min(left, perMonth * months)
      next[m.id][body] = left - take
      yielded[m.id] = (yielded[m.id] ?? 0) + take
    }
  }
  return { yielded, remaining: next }
}

// What a nation draws a month right now, per material (for the HUD's "/mo").
export function extractionRatePerMonth(remaining: Deposits, held: readonly string[], techs: ReadonlySet<string>, perMonth: number = EXTRACTION_PER_MONTH): Yield {
  const out: Yield = {}
  for (const m of MATERIALS) {
    if (!techs.has(m.extractionTechId)) continue
    for (const body of held) {
      const left = remaining[m.id][body] ?? 0
      if (left > 0) out[m.id] = (out[m.id] ?? 0) + Math.min(left, perMonth)
    }
  }
  return out
}

// The deposit bodies a nation holds: it owns them and nobody occupies them.
export function heldDepositBodies(nationId: string, owners: Record<string, string>, controllers: Record<string, string>): string[] {
  return depositBodies().filter((b) => owners[b] === nationId && controllerOf(b, owners, controllers) === nationId)
}

// One month of extraction for a nation, applied to the stores.
export function applyExtraction(nationId: string, months: number): Yield {
  if (months <= 0) return {}
  const { bodyOwner, bodyController } = useTerritoryStore.getState()
  const held = heldDepositBodies(nationId, bodyOwner, bodyController)
  if (held.length === 0) return {}
  const techs = useTechStore.getState().stateFor(nationId).researched
  const { yielded, remaining } = stepExtraction(useDepositStore.getState().remaining, held, techs, months)
  const store = useDepositStore.getState()
  for (const m of MATERIALS) {
    for (const body of held) {
      const spent = (store.remaining[m.id][body] ?? 0) - (remaining[m.id][body] ?? 0)
      if (spent > 0) store.draw(m.id, body, spent)
    }
    const got = yielded[m.id] ?? 0
    if (got > 0) useResourceStore.getState().addAmount(nationId, m.id, got)
  }
  return yielded
}

// What `months` of Complex-mode synthesis turns `exotic` exotic matter into: the
// hyperium made and the exotic matter burned. Capped by what the nation's
// COMPLEX_REFINERY_LEVELS can do and by the exotic matter it holds.
export function stepSynthesis(exotic: number, months: number, levels: number = COMPLEX_REFINERY_LEVELS): { hyperium: number; exoticUsed: number } {
  if (months <= 0 || exotic <= 0) return { hyperium: 0, exoticUsed: 0 }
  const hyperium = Math.min(levels * HYPERIUM_PER_REFINERY * months, exotic / EXOTIC_PER_HYPERIUM)
  return { hyperium, exoticUsed: hyperium * EXOTIC_PER_HYPERIUM }
}

// Why a Complex-mode nation is not refining now, or null while it is.
export function synthesisBlock(researched: ReadonlySet<string>, exotic: number): string | null {
  if (!researched.has(HYPERIUM_SYNTHESIS_TECH_ID)) return 'Needs Hyperium Synthesis researched'
  if (exotic <= 0) return 'No exotic matter to refine'
  return null
}

// One month of Complex-mode synthesis (the Simple economy has the Hyperium Refinery
// building instead, which does the same inside its own monthly tick).
export function applySynthesis(nationId: string, months: number): void {
  const researched = useTechStore.getState().stateFor(nationId).researched
  if (!researched.has(HYPERIUM_SYNTHESIS_TECH_ID)) return
  const res = useResourceStore.getState()
  const { hyperium, exoticUsed } = stepSynthesis(res.stateFor(nationId).amounts.exoticMatter ?? 0, months)
  if (hyperium <= 0) return
  res.addAmount(nationId, 'exoticMatter', -exoticUsed)
  res.addAmount(nationId, 'hyperium', hyperium)
}
