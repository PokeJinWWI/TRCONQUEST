import { create } from 'zustand'
import { DEFAULT_CUSTOM_HUE, DEFAULT_PHOSPHOR, PHOSPHOR_LABELS, clampHue, phosphorOf, phosphorTokens, type PhosphorId } from '../scene/phosphor'

// The UI theme: Default (the original look, English only), NERV (Evangelion-styled, with a
// native-script label beside the English in Japanese, Traditional or Simplified Chinese),
// Ichor (a gothic court in black and gold), Yesteryear (a 1900s card room in wine red and
// black), Terminal (a phosphor CRT) or Windows 95. All but NERV are English only.
// A preference, kept across games in localStorage; applied to <html> as data-theme /
// data-script / data-motion so the stylesheets (index.css and themes/*.css) follow it.
export type ThemeId = 'default' | 'nerv' | 'ichor' | 'yesteryear' | 'terminal' | 'win95'
export type ScriptId = 'ja' | 'zh-Hant' | 'zh-Hans'

export const THEME_LABELS: Record<ThemeId, string> = { default: 'Default', nerv: 'NERV', ichor: 'Ichor', yesteryear: 'Yesteryear', terminal: 'Terminal', win95: 'Windows 95' }
export const THEME_IDS: ThemeId[] = ['default', 'nerv', 'ichor', 'yesteryear', 'terminal', 'win95']
export const SCRIPT_LABELS: Record<ScriptId, string> = { ja: '日本語', 'zh-Hant': '繁體中文', 'zh-Hans': '简体中文' }
export const THEME_STORAGE_KEY = 'trc.theme.v1'

// The Terminal theme's CRT effects, each its own switch (curve = rounded glass + vignette + bezel).
export interface CrtEffects {
  curve: boolean
  scanlines: boolean
  glow: boolean
  noise: boolean
  flicker: boolean
}
export const CRT_LABELS: Record<keyof CrtEffects, string> = { curve: 'Curved screen', scanlines: 'Scanlines', glow: 'Glow', noise: 'Noise', flicker: 'Flicker' }
export const CRT_KEYS = Object.keys(CRT_LABELS) as (keyof CrtEffects)[]
export const DEFAULT_CRT: CrtEffects = { curve: true, scanlines: true, glow: true, noise: false, flicker: false }
export const DEFAULT_NERV_CRT: CrtEffects = { curve: false, scanlines: false, glow: false, noise: false, flicker: false }

export interface ThemePrefs {
  theme: ThemeId
  script: ScriptId
  reduceMotion: boolean
  phosphor: PhosphorId
  phosphorHue: number
  crt: CrtEffects
  // NERV has the same screen effects as Terminal, all off until chosen.
  nervCrt: CrtEffects
}

const DEFAULTS: ThemePrefs = { theme: 'default', script: 'ja', reduceMotion: false, phosphor: DEFAULT_PHOSPHOR, phosphorHue: DEFAULT_CUSTOM_HUE, crt: { ...DEFAULT_CRT }, nervCrt: { ...DEFAULT_NERV_CRT } }
const PHOSPHOR_IDS = Object.keys(PHOSPHOR_LABELS)

export function parseThemePrefs(raw: string | null): ThemePrefs {
  if (!raw) return { ...DEFAULTS }
  try {
    const v = JSON.parse(raw) as Partial<ThemePrefs>
    return {
      theme: THEME_IDS.includes(v.theme as ThemeId) ? (v.theme as ThemeId) : DEFAULTS.theme,
      script: v.script === 'ja' || v.script === 'zh-Hant' || v.script === 'zh-Hans' ? v.script : DEFAULTS.script,
      reduceMotion: typeof v.reduceMotion === 'boolean' ? v.reduceMotion : DEFAULTS.reduceMotion,
      phosphor: PHOSPHOR_IDS.includes(v.phosphor as string) ? (v.phosphor as PhosphorId) : DEFAULTS.phosphor,
      phosphorHue: typeof v.phosphorHue === 'number' ? clampHue(v.phosphorHue) : DEFAULTS.phosphorHue,
      crt: Object.fromEntries(CRT_KEYS.map((k) => [k, typeof v.crt?.[k] === 'boolean' ? v.crt[k] : DEFAULT_CRT[k]])) as unknown as CrtEffects,
      nervCrt: Object.fromEntries(CRT_KEYS.map((k) => [k, typeof v.nervCrt?.[k] === 'boolean' ? v.nervCrt[k] : DEFAULT_NERV_CRT[k]])) as unknown as CrtEffects,
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
  setPhosphor: (phosphor: PhosphorId) => void
  setPhosphorHue: (hue: number) => void
  setCrt: (key: keyof CrtEffects, on: boolean) => void
  setNervCrt: (key: keyof CrtEffects, on: boolean) => void
}

export const useThemeStore = create<ThemeState>((set) => ({
  ...parseThemePrefs(readSaved()),
  setTheme: (theme) => set({ theme }),
  setScript: (script) => set({ script }),
  setReduceMotion: (reduceMotion) => set({ reduceMotion }),
  setPhosphor: (phosphor) => set({ phosphor }),
  setPhosphorHue: (hue) => set({ phosphorHue: clampHue(hue), phosphor: 'custom' }),
  setCrt: (key, on) => set((s) => ({ crt: { ...s.crt, [key]: on } })),
  setNervCrt: (key, on) => set((s) => ({ nervCrt: { ...s.nervCrt, [key]: on } })),
}))

const PHOSPHOR_PROPS = Object.keys(phosphorTokens(phosphorOf('green', 0))).concat('--phosphor-dim-rgb')

function apply(p: ThemePrefs): void {
  if (typeof document === 'undefined') return
  const el = document.documentElement
  el.dataset.theme = p.theme
  el.dataset.script = p.script
  el.dataset.motion = p.reduceMotion ? 'reduced' : 'full'
  el.lang = p.theme === 'nerv' ? `en-x-${p.script}` : 'en'
  // Terminal: the phosphor as inline tokens (beats the stylesheet), each CRT effect as a switch
  // (flicker also yields to Reduce motion).
  if (p.theme === 'terminal') {
    el.dataset.phosphor = p.phosphor
    for (const [k, v] of Object.entries(phosphorTokens(phosphorOf(p.phosphor, p.phosphorHue)))) el.style.setProperty(k, v)
  } else {
    delete el.dataset.phosphor
    for (const k of PHOSPHOR_PROPS) el.style.removeProperty(k)
  }
  // The screen effects belong to Terminal and NERV (each its own set of switches).
  const fx = p.theme === 'terminal' ? p.crt : p.theme === 'nerv' ? p.nervCrt : null
  for (const k of CRT_KEYS) {
    const name = `crt${k[0].toUpperCase()}${k.slice(1)}`
    if (fx) el.dataset[name] = fx[k] && !(k === 'flicker' && p.reduceMotion) ? 'on' : 'off'
    else delete el.dataset[name]
  }
}
function persist(s: ThemePrefs): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify({ theme: s.theme, script: s.script, reduceMotion: s.reduceMotion, phosphor: s.phosphor, phosphorHue: s.phosphorHue, crt: s.crt, nervCrt: s.nervCrt }))
  } catch {
    // Storage blocked or full: the theme lasts for the session.
  }
}
apply(useThemeStore.getState())
useThemeStore.subscribe((s, before) => {
  if (s.theme === before.theme && s.script === before.script && s.reduceMotion === before.reduceMotion && s.phosphor === before.phosphor && s.phosphorHue === before.phosphorHue && s.crt === before.crt && s.nervCrt === before.nervCrt) return
  apply(s)
  persist(s)
})
