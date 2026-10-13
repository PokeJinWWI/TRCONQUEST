import { create } from 'zustand'

// What the player has called a place and the little subscript beside it (Chinese, or whatever they like). Keyed by a site id
// ("Earth#settlement-3") or, for a key node, "<body>|<node>". An absent entry keeps the generated name / the built-in subscript.
interface PlaceNameStore {
  names: Record<string, string>
  natives: Record<string, string>
  // Empty text goes back to the default; an explicit empty subscript (hide it) is stored as a single space.
  setName: (key: string, name: string) => void
  setNative: (key: string, native: string) => void
}

const put = (m: Record<string, string>, key: string, v: string): Record<string, string> => {
  const next = { ...m }
  if (v) next[key] = v
  else delete next[key]
  return next
}

export const usePlaceNameStore = create<PlaceNameStore>((set) => ({
  names: {},
  natives: {},
  setName: (key, name) => set((s) => ({ names: put(s.names, key, name.trim().slice(0, 40)) })),
  setNative: (key, native) => set((s) => ({ natives: put(s.natives, key, native.length > 0 && native.trim() === '' ? ' ' : native.trim().slice(0, 40)) })),
}))

export const keyNodeId = (bodyName: string, node: number) => `${bodyName}|${node}`
// The subscript to show: the player's, else the built-in one; blank = hidden.
export const nativeFor = (key: string, builtIn?: string, natives = usePlaceNameStore.getState().natives): string | undefined => {
  const own = natives[key]
  return own === undefined ? builtIn : own.trim() || undefined
}
