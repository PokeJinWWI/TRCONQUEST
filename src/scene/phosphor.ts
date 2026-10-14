// The Terminal theme's phosphor: ONE base colour (hue, saturation, lightness) from which every
// theme token is derived, so a player's choice (green / amber / white / cyan / a custom hue)
// recolours the whole interface and the 3D map's line work together. Pure: themeStore applies
// the result to <html> as inline custom properties, themes/terminal.css only reads them.
export type PhosphorId = 'green' | 'amber' | 'white' | 'cyan' | 'custom'

export interface Phosphor {
  h: number // hue 0-360
  s: number // saturation 0-100
  l: number // lightness of the main (accent) tone
}

export const PHOSPHOR_LABELS: Record<PhosphorId, string> = { green: 'Green', amber: 'Amber', white: 'White', cyan: 'Cyan', custom: 'Custom' }

// P1 green ~ #33ff66, P3 amber ~ #ffb000, P4 white (cool grey), a radar cyan. Lightness is tuned
// per colour: amber is bright at 50%, blue-ish tones need more to read on black.
export const PHOSPHORS: Record<Exclude<PhosphorId, 'custom'>, Phosphor> = {
  green: { h: 135, s: 100, l: 60 },
  amber: { h: 41.5, s: 100, l: 50 },
  white: { h: 160, s: 8, l: 82 },
  cyan: { h: 185, s: 100, l: 58 },
}

export const DEFAULT_PHOSPHOR: PhosphorId = 'green'
export const DEFAULT_CUSTOM_HUE = 300

export function clampHue(h: number): number {
  return Number.isFinite(h) ? ((Math.round(h) % 360) + 360) % 360 : DEFAULT_CUSTOM_HUE
}

// A custom hue is full saturation; lightness rises toward blue/violet, where the eye is least
// sensitive, so every hue stays readable on a near-black panel.
export function customPhosphor(hue: number): Phosphor {
  const h = clampHue(hue)
  const blueness = Math.max(0, 1 - Math.abs(h - 250) / 70)
  return { h, s: 100, l: Math.round(58 + 12 * blueness) }
}

export function phosphorOf(id: PhosphorId, customHue: number): Phosphor {
  return id === 'custom' ? customPhosphor(customHue) : PHOSPHORS[id]
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const S = Math.max(0, Math.min(100, s)) / 100
  const L = Math.max(0, Math.min(100, l)) / 100
  const k = (n: number) => (n + h / 30) % 12
  const a = S * Math.min(L, 1 - L)
  const f = (n: number) => L - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)]
}

const triplet = (c: [number, number, number]) => `${c[0]}, ${c[1]}, ${c[2]}`
const hex = (c: [number, number, number]) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('')

// Every token the Terminal theme sets from the phosphor (the names index.css :root defines).
export function phosphorTokens(p: Phosphor): Record<string, string> {
  const tone = (s: number, l: number) => hslToRgb(p.h, Math.min(p.s, s), l)
  const accent = hslToRgb(p.h, p.s, p.l)
  const soft = tone(p.s, Math.min(92, p.l + 12))
  const text = tone(p.s * 0.85, Math.min(80, p.l + 8))
  const bright = tone(p.s * 0.8, 88)
  const strong = tone(p.s * 0.6, 94)
  const panel = (l: number) => hslToRgb(p.h, Math.min(p.s, 70), l)
  return {
    '--accent-rgb': triplet(accent),
    '--accent-soft-rgb': triplet(soft),
    '--ink-rgb': triplet(text),
    '--panel-rgb': triplet(panel(2.2)),
    '--panel-deep-rgb': triplet(panel(1.2)),
    '--panel-raised-rgb': triplet(panel(4.5)),
    '--panel-hover-rgb': triplet(panel(10)),
    '--text-bright-rgb': triplet(bright),
    '--ok-rgb': triplet(accent),
    '--accent': hex(accent),
    '--accent-soft': hex(soft),
    '--text': hex(text),
    '--text-bright': hex(bright),
    '--text-cool': hex(text),
    '--text-toast': hex(bright),
    '--strong': hex(strong),
    '--ok': hex(accent),
    '--page-bg': hex(panel(0.8)),
    '--phosphor-dim-rgb': triplet(hslToRgb(p.h, p.s, Math.max(20, p.l - 28))),
  }
}

// The 3D maps' line work in the phosphor (see scene/themeColors.ts).
export function phosphorSceneColors(p: Phosphor) {
  const main = hex(hslToRgb(p.h, p.s, p.l))
  return {
    orbit: main,
    lane: main,
    grid: main,
    gridPoint: hex(hslToRgb(p.h, p.s, Math.min(90, p.l + 14))),
    frame: main,
    lattice: hex(hslToRgb(p.h, p.s, Math.max(14, p.l - 38))),
    latticeNode: main,
    toneMapped: false,
  }
}
