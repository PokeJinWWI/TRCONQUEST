import { create } from 'zustand'
import type { ScriptId } from './themeStore'
import { forScript } from '../i18n/hanzi'

// What the player has called a place or thing, and the native-script subscript beside its name
// in the NERV theme (one per script: Japanese, Traditional, Simplified Chinese). Keyed by a stable
// id: a site ("Earth#settlement-3"), a key node ("<body>|<node>"), or "<kind>:<id>" for anything
// else the player can rename (fleet:, design:, station:, installation:, port:, rural:, tab:,
// corp:, org:). An absent entry keeps the generated name / the built-in subscript.
export type NativeNames = Partial<Record<ScriptId, string>>

interface PlaceNameStore {
  names: Record<string, string>
  natives: Record<string, NativeNames>
  // Empty text goes back to the default; an explicit empty subscript (hide it) is stored as a single space.
  setName: (key: string, name: string) => void
  setNative: (key: string, script: ScriptId, native: string) => void
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
  setNative: (key, script, native) =>
    set((s) => {
      const value = native.length > 0 && native.trim() === '' ? ' ' : native.trim().slice(0, 40)
      const entry: NativeNames = { ...(s.natives[key] ?? {}) }
      if (value) entry[script] = value
      else delete entry[script]
      const natives = { ...s.natives }
      if (Object.keys(entry).length > 0) natives[key] = entry
      else delete natives[key]
      return { natives }
    }),
}))

export const keyNodeId = (bodyName: string, node: number) => `${bodyName}|${node}`
// The subscript to show in `script`: the player's, else the built-in one (written in traditional
// characters, converted for the script); blank = hidden.
export const nativeFor = (key: string, script: ScriptId, builtIn?: string, natives = usePlaceNameStore.getState().natives): string | undefined => {
  const own = natives[key]?.[script]
  if (own !== undefined) return own.trim() || undefined
  return builtIn ? forScript(builtIn, script) : undefined
}

// Save version 3: a v2 subscript was one string for every script; it becomes the same text in each.
export function migratePlaceNames(saved: unknown): unknown {
  const s = saved as { names?: Record<string, string>; natives?: Record<string, unknown> }
  const natives: Record<string, NativeNames> = {}
  for (const [k, v] of Object.entries(s.natives ?? {})) {
    if (typeof v === 'string') natives[k] = { ja: forScript(v, 'ja'), 'zh-Hant': v, 'zh-Hans': forScript(v, 'zh-Hans') }
    else if (v && typeof v === 'object') natives[k] = v as NativeNames
  }
  return { names: s.names ?? {}, natives }
}
