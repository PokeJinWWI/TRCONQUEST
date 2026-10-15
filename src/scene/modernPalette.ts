// The Colorful Terminal theme's colour options. Unlike the CRT Terminal (one phosphor, everything
// tinted), this look is a neutral near-black screen with thin coloured rules and ONE highlight
// colour for the selected row, as in a modern text-mode strategy game. A palette is just two
// colours (the rule / heading colour and the selection colour); every theme token is derived from
// them, and a custom hue builds a palette of its own. Pure: themeStore applies the tokens to
// <html> as inline custom properties, themes/modernterminal.css only reads them.
export type ModernPaletteId = 'violet' | 'gold' | 'green' | 'cyan' | 'crimson' | 'mono' | 'black' | 'custom'

export interface ModernPalette {
  accent: string // rules, headings, button outlines
  select: string // the selected row / active button (dark text on it)
  pure?: boolean // true-black panels (the rest are near-black greys)
}

export const MODERN_PALETTE_LABELS: Record<ModernPaletteId, string> = { violet: 'Violet', gold: 'Gold', green: 'Green', cyan: 'Cyan', crimson: 'Crimson', mono: 'Mono', black: 'Black', custom: 'Custom' }
export const MODERN_PALETTE_IDS = Object.keys(MODERN_PALETTE_LABELS) as ModernPaletteId[]

export const MODERN_PALETTES: Record<Exclude<ModernPaletteId, 'custom'>, ModernPalette> = {
  violet: { accent: '#b394f2', select: '#c77dff' },
  gold: { accent: '#e3c466', select: '#ecb84a' },
  green: { accent: '#62d68e', select: '#4ade80' },
  cyan: { accent: '#5cc8e6', select: '#38bdf8' },
  crimson: { accent: '#e8727c', select: '#f43f5e' },
  mono: { accent: '#c9c9c9', select: '#e8e8e8' },
  // Pure black screen, white rules and a white selection bar: the colour comes only from the text.
  black: { accent: '#ffffff', select: '#ffffff', pure: true },
}

export const DEFAULT_MODERN_PALETTE: ModernPaletteId = 'violet'
export const DEFAULT_MODERN_HUE = 200

export function clampModernHue(h: number): number {
  return Number.isFinite(h) ? ((Math.round(h) % 360) + 360) % 360 : DEFAULT_MODERN_HUE
}

function hslToHex(h: number, s: number, l: number): string {
  const S = s / 100
  const L = l / 100
  const k = (n: number) => (n + h / 30) % 12
  const a = S * Math.min(L, 1 - L)
  const f = (n: number) => Math.round((L - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))) * 255)
  return '#' + [f(0), f(8), f(4)].map((v) => v.toString(16).padStart(2, '0')).join('')
}

// Blue and violet hues are less bright to the eye, so they get more lightness to stay readable.
export function customModernPalette(hue: number): ModernPalette {
  const h = clampModernHue(hue)
  const blueness = Math.max(0, 1 - Math.abs(h - 250) / 70)
  const lift = Math.round(8 * blueness)
  return { accent: hslToHex(h, 70, 66 + lift), select: hslToHex(h, 75, 60 + lift) }
}

export function modernPaletteOf(id: ModernPaletteId, customHue: number): ModernPalette {
  return id === 'custom' ? customModernPalette(customHue) : MODERN_PALETTES[id]
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const triplet = (c: [number, number, number]) => c.join(', ')
const mix = (a: string, b: string, t: number): string =>
  '#' +
  rgb(a)
    .map((v, i) => Math.round(v + (rgb(b)[i] - v) * t).toString(16).padStart(2, '0'))
    .join('')

// Every token the theme sets from the palette (the names index.css :root defines, plus the
// selection pair). Panels are neutral greys, not tinted: only rules and the selection are coloured.
export function modernTokens(p: ModernPalette): Record<string, string> {
  const soft = mix(p.accent, '#ffffff', 0.25)
  return {
    '--accent-rgb': triplet(rgb(p.accent)),
    '--accent-soft-rgb': triplet(rgb(soft)),
    '--ink-rgb': '208, 208, 208',
    '--panel-rgb': p.pure ? '0, 0, 0' : '19, 19, 20',
    '--panel-deep-rgb': p.pure ? '0, 0, 0' : '13, 13, 14',
    '--panel-raised-rgb': p.pure ? '10, 10, 10' : '27, 27, 29',
    '--panel-hover-rgb': p.pure ? '28, 28, 28' : '40, 40, 44',
    '--text-bright-rgb': '236, 236, 236',
    '--ok-rgb': '98, 214, 142',
    '--select-rgb': triplet(rgb(p.select)),
    '--accent': p.accent,
    '--accent-soft': soft,
    '--select': p.select,
    '--text': '#cfcfcf',
    '--text-bright': '#ececec',
    '--text-cool': '#cfcfcf',
    '--text-toast': '#ececec',
    '--strong': '#ffffff',
    '--ok': '#62d68e',
    '--page-bg': p.pure ? '#000000' : '#0a0a0b',
  }
}

// The 3D maps' line work: mostly grey, like the rest of the theme; only hyperlanes and frames take the palette.
export function modernSceneColors(p: ModernPalette) {
  return {
    orbit: '#7d7d82',
    lane: p.select,
    grid: '#4a4a4f',
    gridPoint: '#a0a0a5',
    frame: p.accent,
    lattice: '#3a3a3e',
    latticeNode: '#8a8a8f',
    toneMapped: false,
  }
}
