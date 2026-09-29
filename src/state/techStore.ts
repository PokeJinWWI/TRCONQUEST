import { create } from 'zustand'
import { canResearch, findTech, queuePlan, queuedResearchNow, type TechCategory } from '../data/techData'

export interface TechState {
  researchPoints: Record<TechCategory, number>
  researched: Set<string>
  // Research queued for later (techData.queuePlan / queuedResearchNow).
  queue?: string[]
}

// A fresh country starts with Warp Theory and Hyperspace Theory already
// researched — NOT an empty set. Both are genuinely gated now (see
// shipPhysics.ts's planMove), but every ship class in the game already has a
// warp or hyperdrive unconditionally, so a brand-new country has to start
// exactly as capable as one is today. Warp Comms too: at light speed the
// first scout's report from the nearest star took six years to come home,
// which left exploring dead for the whole early game. Everything else starts
// unresearched; there is no other retroactive seeding anywhere else in the tree.
const DEFAULT_RESEARCHED = ['warp-theory', 'warp-drives', 'hyperspace-theory', 'warp-comms']

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
  // Queue a tech (and whatever it still needs) for later; researched as soon
  // as it can be (processQueue, run when research points come in).
  queueTech: (countryId: string, nodeId: string) => void
  unqueueTech: (countryId: string, nodeId: string) => void
  // Researches every queued tech that can be now, in queue order.
  processQueue: (countryId: string) => void
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
          ...current,
          researchPoints: { ...current.researchPoints, [node.category]: current.researchPoints[node.category] - cost },
          researched: new Set(current.researched).add(nodeId),
        },
      },
    }))
    return true
  },

  queueTech: (countryId, nodeId) => {
    const current = get().byCountry[countryId] ?? freshTechState()
    const queue = current.queue ?? []
    const add = queuePlan(nodeId, current.researched, queue)
    if (add.length === 0) return
    set((state) => ({ byCountry: { ...state.byCountry, [countryId]: { ...current, queue: [...queue, ...add] } } }))
    get().processQueue(countryId)
  },

  unqueueTech: (countryId, nodeId) => {
    const current = get().byCountry[countryId]
    if (!current?.queue) return
    // Anything queued only because it needed this goes too.
    const drop = new Set([nodeId])
    for (const id of current.queue) {
      const node = findTech(id)
      if (node && node.prerequisites.length > 0 && node.prerequisites.every((set) => set.some((p) => drop.has(p)))) drop.add(id)
    }
    set((state) => ({ byCountry: { ...state.byCountry, [countryId]: { ...current, queue: current.queue!.filter((id) => !drop.has(id)) } } }))
  },

  processQueue: (countryId) => {
    const current = get().byCountry[countryId]
    if (!current?.queue || current.queue.length === 0) return
    const now = queuedResearchNow(current.queue, current.researched, current.researchPoints, get().freeResearchMode)
    for (const id of now) get().researchNode(countryId, id)
    const after = get().byCountry[countryId]!
    const queue = (after.queue ?? []).filter((id) => !after.researched.has(id))
    if (queue.length !== (after.queue ?? []).length) set((state) => ({ byCountry: { ...state.byCountry, [countryId]: { ...after, queue } } }))
  },
}))
