import { create } from 'zustand'
import { useDiplomacyStore } from './diplomacyStore'
import { usePlayerStore } from './playerStore'
import { useGameTimeStore } from './gameTimeStore'
import { allTechIds, canResearch, findTech, queuePlan, queueWithoutResearched, queuedResearchNow, researchPlan, researchTerms, resourceShortfall, unresearchPlan, type TechCategory } from '../data/techData'
import { SANDBOX_FACTION_IDS, SANDBOX_PLAYER_ID } from '../data/countryRoster'
import { useResourceStore } from './resourceStore'
import type { ResourceId } from '../data/resourceData'

export interface TechState {
  researchPoints: Record<TechCategory, number>
  researched: Set<string>
  // Research queued for later (techData.queuePlan / queuedResearchNow).
  queue?: string[]
}

// A fresh country starts with Warp Theory, Hyperspace Theory, Hyperdrive Mk I and
// the two Extraction techs (it can draw the deposits it owns), and everything they stand on, already researched — NOT an empty set: the Sol neighbourhood's humans fly
// hyperdrives from the start. It has NO warp drive tech: Warp Drive Mk I consumes
// more exotic matter than any of them starts with (data/exoticMatter.ts), so they
// cannot research it without cheats. Its starting comms follow its starting drive:
// a hyperdrive nation starts with Hyper Comms (entangled hyperspace relays, zero
// delay), and Warp Comms (days, not years) would only be the default of one that
// also starts with a warp drive (`startingCommsTech`). Without either, the
// first scout's report from the nearest star took six years to come home,
// which left exploring dead for the whole early game. Everything else starts
// unresearched; there is no other retroactive seeding anywhere else in the tree.
const STARTING_DRIVE_TECHS = ['hyperdrive-mk1']
const STARTING_BASE_TECHS = ['warp-theory', 'hyperspace-theory', 'hyperium-extraction', 'exotic-matter-extraction']
export function startingCommsTech(drives: readonly string[]): string[] {
  const out: string[] = []
  if (drives.includes('hyperdrive-mk1')) out.push('hyper-comms')
  if (drives.includes('warp-drive-mk1')) out.push('warp-comms')
  return out
}
// Every prerequisite of a starting tech starts researched too (a starter never
// sits on a tree branch the nation does not have).
function withPrerequisites(ids: string[]): string[] {
  const out = new Set<string>()
  const visit = (id: string) => {
    if (out.has(id)) return
    out.add(id)
    for (const set of findTech(id)?.prerequisites ?? []) for (const p of set) visit(p)
  }
  ids.forEach(visit)
  return [...out]
}
export const DEFAULT_RESEARCHED = withPrerequisites([...STARTING_BASE_TECHS.slice(0, 2), ...STARTING_DRIVE_TECHS, ...startingCommsTech(STARTING_DRIVE_TECHS), ...STARTING_BASE_TECHS.slice(2)])

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
  // `viaShortcut` takes the node's shortcut terms (TechNode.shortcut) where it has them.
  researchNode: (countryId: string, nodeId: string, viaShortcut?: boolean) => boolean
  // Why a tech cannot be researched for want of the resources it consumes (exotic
  // matter, hyperium), or null. Free Research waives them.
  researchBlock: (countryId: string, nodeId: string, viaShortcut?: boolean) => string | null
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
  // The Sandbox: every tech of the default tree researched for these owners (a new Sandbox game).
  grantAllTech: (countryIds: readonly string[]) => void
  // The Sandbox only (false anywhere else, nothing changes): a click on a tech flips it for every
  // sandbox faction at once. Researched -> un-researched, together with every researched tech that
  // then lacks its prerequisites (techData.unresearchPlan), always free. Not researched -> researched
  // with the prerequisites it is missing (techData.researchPlan); while Free Research is on that costs
  // nothing and ignores points, resources and the Anomalous gate, else it is the ordinary
  // `researchNode` for the player's faction (costs and prerequisites apply) and the others follow.
  // Returns whether anything changed.
  toggleTech: (nodeId: string) => boolean
}

export const useTechStore = create<TechStore>((set, get) => ({
  byCountry: {},
  freeResearchMode: false,
  // Switching it on settles every nation's queue at once: what was queued while it cost something
  // is free now, so it completes (not at the next month, and not one click each).
  setFreeResearchMode: (on) => {
    set({ freeResearchMode: on })
    if (on) for (const countryId of Object.keys(get().byCountry)) get().processQueue(countryId)
  },

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

  researchNode: (countryId, nodeId, viaShortcut = false) => {
    const node = findTech(nodeId)
    if (!node) return false
    const current = get().byCountry[countryId] ?? freshTechState()
    const freeResearchMode = get().freeResearchMode
    if (!canResearch(node, current.researched, current.researchPoints[node.category], freeResearchMode, viaShortcut)) return false
    if (get().researchBlock(countryId, nodeId, viaShortcut)) return false
    const terms = researchTerms(node, viaShortcut)
    const cost = freeResearchMode ? 0 : terms.cost
    if (!freeResearchMode) for (const [id, n] of Object.entries(terms.resourceCost) as [ResourceId, number][]) useResourceStore.getState().addAmount(countryId, id, -n)
    set((state) => ({
      byCountry: {
        ...state.byCountry,
        [countryId]: {
          ...current,
          researchPoints: { ...current.researchPoints, [node.category]: current.researchPoints[node.category] - cost },
          researched: new Set(current.researched).add(nodeId),
          // A tech researched by hand leaves the queue too.
          ...(current.queue ? { queue: queueWithoutResearched(current.queue, new Set([nodeId])) } : {}),
        },
      },
    }))
    // Told to the player (a notification), not for every nation's research.
    if (countryId === usePlayerStore.getState().selectedCountryId) {
      const label = { physics: 'Physics', society: 'Society', engineering: 'Engineering' }[node.category]
      useDiplomacyStore.getState().pushEvent('tech-researched', [countryId], `Researched ${node.name} (${label})`, useGameTimeStore.getState().simDays, { nav: { category: 'Technology', subcategory: label } })
    }
    return true
  },

  researchBlock: (countryId, nodeId, viaShortcut = false) => {
    const node = findTech(nodeId)
    if (!node || get().freeResearchMode) return null
    return resourceShortfall({ resourceCost: researchTerms(node, viaShortcut).resourceCost, resourceHold: node.resourceHold }, useResourceStore.getState().stateFor(countryId).amounts)
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
    const now = queuedResearchNow(current.queue, current.researched, current.researchPoints, get().freeResearchMode, useResourceStore.getState().stateFor(countryId).amounts)
    for (const id of now) get().researchNode(countryId, id)
    const after = get().byCountry[countryId]!
    const queue = (after.queue ?? []).filter((id) => !after.researched.has(id))
    if (queue.length !== (after.queue ?? []).length) set((state) => ({ byCountry: { ...state.byCountry, [countryId]: { ...after, queue } } }))
  },
  grantAllTech: (countryIds) =>
    set((state) => {
      const byCountry = { ...state.byCountry }
      for (const id of countryIds) byCountry[id] = { ...(byCountry[id] ?? freshTechState()), researched: new Set(allTechIds()), queue: [] }
      return { byCountry }
    }),

  toggleTech: (nodeId) => {
    if (!usePlayerStore.getState().sandbox || !findTech(nodeId)) return false
    const setResearched = (countryId: string, change: (have: Set<string>) => void) =>
      set((state) => {
        const current = state.byCountry[countryId] ?? freshTechState()
        const researched = new Set(current.researched)
        change(researched)
        return { byCountry: { ...state.byCountry, [countryId]: { ...current, researched, queue: current.queue ? queueWithoutResearched(current.queue, researched) : current.queue } } }
      })
    const have = get().stateFor(SANDBOX_PLAYER_ID).researched
    if (have.has(nodeId)) {
      for (const id of SANDBOX_FACTION_IDS) {
        const gone = unresearchPlan(nodeId, get().stateFor(id).researched)
        setResearched(id, (h) => gone.forEach((g) => h.delete(g)))
      }
      return true
    }
    if (get().freeResearchMode) {
      for (const id of SANDBOX_FACTION_IDS) {
        const add = researchPlan(nodeId, get().stateFor(id).researched)
        setResearched(id, (h) => add.forEach((a) => h.add(a)))
      }
      return true
    }
    // Real costs: the player's faction pays and needs the prerequisites; the others get the same tech.
    if (!get().researchNode(SANDBOX_PLAYER_ID, nodeId)) return false
    for (const id of SANDBOX_FACTION_IDS) if (id !== SANDBOX_PLAYER_ID) setResearched(id, (h) => h.add(nodeId))
    return true
  },
}))
