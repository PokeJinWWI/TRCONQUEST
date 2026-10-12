import { create } from 'zustand'

// Buildings the player points at on the ground map: WHERE they stand and what they are called, as opposed to how many there are
// (the economies' own count). The ledger pattern again: the economy says a world runs three spaceports, this says which nodes.
//
// Spaceports (the economy's: Simple's building, Complex's recipe) are listed per body in the order they were founded. The first
// ones are the world's starting auto-placed ports, recorded as they were so nothing moves (scene/portStructures.seedPorts); later
// ones stand where the player clicked. A port with no `name` is called what the map would call it (the settlement it serves and
// the compass point); renaming gives it a name of its own. Defence installations already carry their own node and name
// (state/defenseStore), so they are not repeated here.
export interface PortStructure {
  id: string
  node: number
  // Own name; absent = the map's automatic one.
  name?: string
  ownerId: string
  // A port the player chose the place of (a seeded one is not).
  chosen?: boolean
  // A seeded port that was placed as a strategic outlier (named for its region, not for the settlement it serves).
  outlier?: boolean
}

interface StructureStore {
  ports: Record<string, PortStructure[]>
  setPorts: (bodyName: string, ports: PortStructure[]) => void
  addPort: (bodyName: string, port: PortStructure) => void
  removePort: (bodyName: string, id: string) => void
  renamePort: (bodyName: string, id: string, name: string | undefined) => void
}

export const useStructureStore = create<StructureStore>((set) => ({
  ports: {},
  setPorts: (bodyName, ports) => set((s) => ({ ports: { ...s.ports, [bodyName]: ports } })),
  addPort: (bodyName, port) => set((s) => ({ ports: { ...s.ports, [bodyName]: [...(s.ports[bodyName] ?? []), port] } })),
  removePort: (bodyName, id) => set((s) => ({ ports: { ...s.ports, [bodyName]: (s.ports[bodyName] ?? []).filter((p) => p.id !== id) } })),
  renamePort: (bodyName, id, name) =>
    set((s) => ({
      ports: { ...s.ports, [bodyName]: (s.ports[bodyName] ?? []).map((p) => (p.id === id ? { ...p, name: name?.trim() ? name.trim().slice(0, 40) : undefined } : p)) },
    })),
}))
