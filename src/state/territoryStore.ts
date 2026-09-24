import { create } from 'zustand'
import { seedBodyOwners, type OwnerMap } from '../scene/territory'
import type { NodeHolderMap } from '../scene/groundLogic'
import { useEconomyStore, worldByName } from './economyStore'

// Live territory — the single runtime source of truth for who owns and who
// controls every body. Seeded from the authored planet/moon data; changed only
// by war (occupation) and peace (cession). See scene/territory.ts for the pure
// logic over these maps (controllerOf, systemClaim, …).
interface TerritoryState {
  // Body name → owning nation. Changes only by treaty.
  bodyOwner: OwnerMap
  // Body name → occupying nation, for a body held by someone other than its
  // owner. Absent means its owner controls it.
  bodyController: OwnerMap
  // The planetary map's front lines: per body, surface node → the nation
  // holding it, only where that differs from the body's owner (see
  // scene/groundResolution.ts). Changes as units take ground; never decides
  // the body's controller by itself (that's the key-node rule).
  nodeHolders: NodeHolderMap
  // Applies a ground step's node changes: a country id takes the node, null
  // hands it back to the owner.
  paintNodes: (bodyName: string, changes: Record<number, string | null>) => void
  // Peace between two nations: every node either holds on the other's worlds
  // goes back to its owner.
  clearPaintBetween: (a: string, b: string) => void
  // A successful invasion: `countryId` now controls the body. Occupying your
  // own body back (liberation) simply clears the occupation.
  occupyBody: (bodyName: string, countryId: string) => void
  // Ends an occupation, handing control back to the owner.
  liberateBody: (bodyName: string) => void
  // A peace treaty's cession: the body — and, if it's an inhabited world, its
  // whole economy — now belongs to `countryId`, and any occupation ends.
  cedeBody: (bodyName: string, countryId: string) => void
  reset: () => void
}

export const useTerritoryStore = create<TerritoryState>((set) => ({
  bodyOwner: seedBodyOwners(),
  bodyController: {},
  nodeHolders: {},

  paintNodes: (bodyName, changes) =>
    set((s) => {
      const next = { ...(s.nodeHolders[bodyName] ?? {}) }
      for (const [node, holder] of Object.entries(changes)) {
        if (holder === null) delete next[Number(node)]
        else next[Number(node)] = holder
      }
      const nodeHolders = { ...s.nodeHolders }
      if (Object.keys(next).length === 0) delete nodeHolders[bodyName]
      else nodeHolders[bodyName] = next
      return { nodeHolders }
    }),

  clearPaintBetween: (a, b) =>
    set((s) => {
      let changed = false
      const nodeHolders: NodeHolderMap = {}
      for (const [body, nodes] of Object.entries(s.nodeHolders)) {
        const owner = s.bodyOwner[body]
        const kept: Record<number, string> = {}
        for (const [node, holder] of Object.entries(nodes)) {
          const between = (owner === a && holder === b) || (owner === b && holder === a)
          if (between) changed = true
          else kept[Number(node)] = holder
        }
        if (Object.keys(kept).length > 0) nodeHolders[body] = kept
      }
      return changed ? { nodeHolders } : s
    }),

  occupyBody: (bodyName, countryId) =>
    set((s) => {
      const controllers = { ...s.bodyController }
      if (s.bodyOwner[bodyName] === countryId) delete controllers[bodyName]
      else controllers[bodyName] = countryId
      return { bodyController: controllers }
    }),

  liberateBody: (bodyName) =>
    set((s) => {
      if (!(bodyName in s.bodyController) && !(bodyName in s.nodeHolders)) return s
      const controllers = { ...s.bodyController }
      delete controllers[bodyName]
      // Handed back whole: the front lines on it go too.
      const nodeHolders = { ...s.nodeHolders }
      delete nodeHolders[bodyName]
      return { bodyController: controllers, nodeHolders }
    }),

  cedeBody: (bodyName, countryId) => {
    set((s) => {
      const controllers = { ...s.bodyController }
      delete controllers[bodyName]
      const nodeHolders = { ...s.nodeHolders }
      delete nodeHolders[bodyName]
      return { bodyOwner: { ...s.bodyOwner, [bodyName]: countryId }, bodyController: controllers, nodeHolders }
    })
    // An inhabited world's pops, buildings and taxes follow the flag.
    const economy = useEconomyStore.getState()
    if (worldByName(economy.worlds, bodyName)) economy.setWorldOwner(bodyName, countryId)
  },

  reset: () => set({ bodyOwner: seedBodyOwners(), bodyController: {}, nodeHolders: {} }),
}))
