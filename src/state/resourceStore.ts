import { create } from 'zustand'
import type { ResourceId } from '../data/resourceData'
import { RESOURCE_TYPES } from '../data/resourceData'

// Each nation's strategic stockpile (alloys, exotic matter, hyperium…) — what
// ships and armies are paid for with. Per country, so an AI empire builds its
// navy out of its OWN resources under exactly the rules the player does (see
// scene/shipyardLogic.ts). Starts at zero; the placeholder supply in
// data/shipyardData.ts seeds and tops it up until a real production chain
// replaces it.
export interface CountryResources {
  amounts: Record<ResourceId, number>
  // Net monthly gain/deficit per resource — the number the HUD's "+"
  // indicator and the click-to-open info panel's "Monthly" row both read
  // (see ResourceBar.tsx). Its own field rather than derived from
  // consecutive `amounts` reads, since a future economy tick can set it
  // directly from real production minus consumption, and reverse-
  // engineering it from stockpile deltas would also count a one-off spend or
  // grant as "monthly income."
  monthlyDelta: Record<ResourceId, number>
}

const ZERO_AMOUNTS: Record<ResourceId, number> = Object.fromEntries(RESOURCE_TYPES.map((r) => [r.id, 0])) as Record<ResourceId, number>

// A single stable reference for any country not yet in `byCountry` — same
// reasoning as techStore's UNTOUCHED_COUNTRY_STATE: stateFor is read inside
// zustand selectors, and a fresh object on every call would look like a change
// every time. Only ever read, never mutated.
const UNTOUCHED: CountryResources = { amounts: ZERO_AMOUNTS, monthlyDelta: ZERO_AMOUNTS }

interface ResourceState {
  byCountry: Record<string, CountryResources>
  stateFor: (countryId: string) => CountryResources
  setAmount: (countryId: string, id: ResourceId, amount: number) => void
  addAmount: (countryId: string, id: ResourceId, delta: number) => void
  setMonthlyDelta: (countryId: string, id: ResourceId, delta: number) => void
}

function touched(state: ResourceState, countryId: string): CountryResources {
  return state.byCountry[countryId] ?? { amounts: { ...ZERO_AMOUNTS }, monthlyDelta: { ...ZERO_AMOUNTS } }
}

export const useResourceStore = create<ResourceState>((set, get) => ({
  byCountry: {},
  stateFor: (countryId) => get().byCountry[countryId] ?? UNTOUCHED,
  setAmount: (countryId, id, amount) =>
    set((s) => {
      const current = touched(s, countryId)
      return { byCountry: { ...s.byCountry, [countryId]: { ...current, amounts: { ...current.amounts, [id]: amount } } } }
    }),
  addAmount: (countryId, id, delta) =>
    set((s) => {
      const current = touched(s, countryId)
      return { byCountry: { ...s.byCountry, [countryId]: { ...current, amounts: { ...current.amounts, [id]: current.amounts[id] + delta } } } }
    }),
  setMonthlyDelta: (countryId, id, delta) =>
    set((s) => {
      const current = touched(s, countryId)
      return { byCountry: { ...s.byCountry, [countryId]: { ...current, monthlyDelta: { ...current.monthlyDelta, [id]: delta } } } }
    }),
}))
