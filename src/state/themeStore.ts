import { create } from 'zustand'

// The UI theme: Default (the original look, English only) or NERV (Evangelion-styled, with a
// native-script label beside the English in Japanese, Traditional or Simplified Chinese).
// A preference, kept across games in localStorage; applied to <html> as data-theme /
// data-script / data-motion so the stylesheets (index.css, themes/nerv.css) follow it.
export type ThemeId = 'default' | 'nerv'
export type ScriptId = 'ja' | 'zh-Hant' | 'zh-Hans'

export const THEME_LABELS: Record<ThemeId, string> = { default: 'Default', nerv: 'NERV' }
export const SCRIPT_LABELS: Record<ScriptId, string> = { ja: '日本語', 'zh-Hant': '繁體中文', 'zh-Hans': '简体中文' }
export const THEME_STORAGE_KEY = 'trc.theme.v1'

export interface ThemePrefs {
  theme: ThemeId
  script: ScriptId
  reduceMotion: boolean
}

const DEFAULTS: ThemePrefs = { theme: 'default', script: 'ja', reduceMotion: false }

export function parseThemePrefs(raw: string | null): ThemePrefs {
  if (!raw) return { ...DEFAULTS }
  try {
    const v = JSON.parse(raw) as Partial<ThemePrefs>
    return {
      theme: v.theme === 'nerv' || v.theme === 'default' ? v.theme : DEFAULTS.theme,
      script: v.script === 'ja' || v.script === 'zh-Hant' || v.script === 'zh-Hans' ? v.script : DEFAULTS.script,
      reduceMotion: typeof v.reduceMotion === 'boolean' ? v.reduceMotion : DEFAULTS.reduceMotion,
    }
  } catch {
    return { ...DEFAULTS }
  }
}

function readSaved(): string | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(THEME_STORAGE_KEY)
  } catch {
    return null
  }
}

interface ThemeState extends ThemePrefs {
  setTheme: (theme: ThemeId) => void
  setScript: (script: ScriptId) => void
  setReduceMotion: (on: boolean) => void
}

export const useThemeStore = create<ThemeState>((set) => ({
  ...parseThemePrefs(readSaved()),
  setTheme: (theme) => set({ theme }),
  setScript: (script) => set({ script }),
  setReduceMotion: (reduceMotion) => set({ reduceMotion }),
}))

function apply(p: ThemePrefs): void {
  if (typeof document === 'undefined') return
  const el = document.documentElement
  el.dataset.theme = p.theme
  el.dataset.script = p.script
  el.dataset.motion = p.reduceMotion ? 'reduced' : 'full'
  el.lang = p.theme === 'nerv' ? `en-x-${p.script}` : 'en'
}
apply(useThemeStore.getState())
useThemeStore.subscribe((s, before) => {
  if (s.theme === before.theme && s.script === before.script && s.reduceMotion === before.reduceMotion) return
  apply(s)
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify({ theme: s.theme, script: s.script, reduceMotion: s.reduceMotion }))
  } catch {
    // Storage blocked or full: the theme lasts for the session.
  }
})
