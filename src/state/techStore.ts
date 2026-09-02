import { create } from 'zustand'
import { canResearch, findTech, type TechCategory } from '../data/techData'

export interface TechState {
  researchPoints: Record<TechCategory, number>
  researched: Set<string>
}

// A fresh country starts with Warp Theory and Hyperspace Theory already
// researched — NOT an empty set. Both are genuinely gated now (see
// shipPhysics.ts's planMove), but every ship class in the game already has a
// warp or hyperdrive unconditionally, so a brand-new country has to start
// exactly as capable as one is today. Everything else starts unresearched;
// there is no other retroactive seeding anywhere else in the tree.
const DEFAULT_RESEARCHED = ['warp-theory', 'hyperspace-theory']

function freshTechState(): TechState {
  return {
    researchPoints: { physics: 0, society: 0, engineering: 0 },
    researched: new Set(DEFAULT_RESEARCHED),
  }
}

// A single stable reference returned for any country not yet in
// `byCountry` — `stateFor` must NOT construct a fresh object on every call
// (it's read inside zustand selectors, including from a combat-resolver
// hook that may run every tick), or every read of an untouched country's
// tech would look like a changed value and defeat memoization entirely.
// Only ever read, never mutated in place — grantResearch/researchNode both
// write a genuinely new per-country entry via freshTechState() the first
// time a country is actually touched, never this shared object.
const UNTOUCHED_COUNTRY_STATE: TechState = freshTechState()

interface TechStore {
  byCountry: Record<string, TechState>
  // Reads-through to a fresh default state for a country that hasn't been
  // touched yet, without writing anything — mirrors how usePlayerEconomy
  // reads countries that may not exist in useEconomyStore's list yet.
  stateFor: (countryId: string) => TechState
  // The dev-console hook — the only way to gain points beyond the default
  // seed until the real economy simulation produces research income.
  grantResearch: (countryId: string, category: TechCategory, amount: number) => void
  // Validates prerequisites, the Anomalous aggregate gate, and cost; deducts
  // points and adds the node on success. Returns whether it actually
  // unlocked anything, so a caller (the UI button) can tell a rejected click
  // from a successful one without re-deriving canResearch itself.
  researchNode: (countryId: string, nodeId: string) => boolean
  // Dev console toggle — "decrease all tech costs to 0" (see DebugConsole's
  // Free Research checkbox). Global, not per-country, same "this is a dev
  // cheat, not game state" scope as the console itself. Read by
  // researchNode (what actually gets deducted) and by TechPanel/
  // TechTreeGraph's own canResearch calls (so a 0-point country's buttons
  // actually light up instead of just silently succeeding once clicked).
  freeResearchMode: boolean
  setFreeResearchMode: (on: boolean) => void
}

export const useTechStore = create<TechStore>((set, get) => ({
  byCountry: {},
  freeResearchMode: false,
  setFreeResearchMode: (on) => set({ freeResearchMode: on }),

  stateFor: (countryId) => get().byCountry[countryId] ?? UNTOUCHED_COUNTRY_STATE,

  grantResearch: (countryId, category, amount) =>
    set((state) => {
      const current = state.byCountry[countryId] ?? freshTechState()
      return {
        byCountry: {
          ...state.byCountry,
          [countryId]: { ...current, researchPoints: { ...current.researchPoints, [category]: current.researchPoints[category] + amount } },
        },
      }
    }),

  researchNode: (countryId, nodeId) => {
    const node = findTech(nodeId)
    if (!node) return false
    const current = get().byCountry[countryId] ?? freshTechState()
    const freeResearchMode = get().freeResearchMode
    if (!canResearch(node, current.researched, current.researchPoints[node.category], freeResearchMode)) return false
    const cost = freeResearchMode ? 0 : node.cost
    set((state) => ({
      byCountry: {
        ...state.byCountry,
        [countryId]: {
          researchPoints: { ...current.researchPoints, [node.category]: current.researchPoints[node.category] - cost },
          researched: new Set(current.researched).add(nodeId),
        },
      },
    }))
    return true
  },
}))
