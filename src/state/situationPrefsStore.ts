import { create } from 'zustand'

// How the player likes the Situations panel and notifications: which alert types are hidden,
// which pause the game when a new one appears (absent = the type's default), and which toasts
// pop up. Preferences, kept across games in localStorage (not in save files).
export type ToastFilter = 'relevant' | 'mine' | 'all'

export const SITUATION_PREFS_STORAGE_KEY = 'trc.situationPrefs.v1'

export interface SituationPrefsData {
  hidden: Record<string, boolean>
  pause: Record<string, boolean>
  toastFilter: ToastFilter
}

const DEFAULTS: SituationPrefsData = { hidden: {}, pause: {}, toastFilter: 'relevant' }

const bools = (v: unknown): Record<string, boolean> =>
  v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, b]) => typeof b === 'boolean')) as Record<string, boolean> : {}

// Tolerant of anything localStorage may hold (old, hand-edited, garbage).
export function parseSituationPrefs(raw: string | null): SituationPrefsData {
  if (!raw) return { ...DEFAULTS }
  try {
    const v = JSON.parse(raw) as Partial<SituationPrefsData>
    const toastFilter = v.toastFilter === 'mine' || v.toastFilter === 'all' || v.toastFilter === 'relevant' ? v.toastFilter : DEFAULTS.toastFilter
    return { hidden: bools(v.hidden), pause: bools(v.pause), toastFilter }
  } catch {
    return { ...DEFAULTS }
  }
}

function readSaved(): string | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(SITUATION_PREFS_STORAGE_KEY)
  } catch {
    return null
  }
}

interface SituationPrefsState extends SituationPrefsData {
  setHidden: (typeId: string, hidden: boolean) => void
  setPause: (typeId: string, pause: boolean) => void
  setToastFilter: (f: ToastFilter) => void
  showAll: () => void
}

export const useSituationPrefsStore = create<SituationPrefsState>((set) => ({
  ...parseSituationPrefs(readSaved()),
  setHidden: (typeId, hidden) => set((s) => ({ hidden: { ...s.hidden, [typeId]: hidden } })),
  setPause: (typeId, pause) => set((s) => ({ pause: { ...s.pause, [typeId]: pause } })),
  setToastFilter: (toastFilter) => set({ toastFilter }),
  showAll: () => set({ hidden: {} }),
}))

useSituationPrefsStore.subscribe((state, before) => {
  if (state.hidden === before.hidden && state.pause === before.pause && state.toastFilter === before.toastFilter) return
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(SITUATION_PREFS_STORAGE_KEY, JSON.stringify({ hidden: state.hidden, pause: state.pause, toastFilter: state.toastFilter }))
  } catch {
    // Storage blocked or full: the preferences last for the session.
  }
})
