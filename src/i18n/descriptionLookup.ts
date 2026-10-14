// Full translations of the game's descriptions (src/i18n/descriptions.ts, generated), shown under
// the English in the NERV theme. The table is large, so it is loaded only once NERV is on
// (`loadDescriptions`); until then, and in the Default theme, every lookup is undefined.
import type { ScriptId } from '../state/themeStore'

let table: Record<string, [string, string, string]> | null = null
let loading: Promise<void> | null = null
const COLUMN: Record<ScriptId, 0 | 1 | 2> = { ja: 0, 'zh-Hant': 1, 'zh-Hans': 2 }

export const normalizeDescription = (s: string): string => s.replace(/\s+/g, ' ').trim()

export function loadDescriptions(): Promise<void> {
  loading ??= import('./descriptions').then((m) => {
    table = m.DESCRIPTIONS
  })
  return loading
}

// For tests and tools: use a table directly.
export function setDescriptionTable(t: Record<string, [string, string, string]>): void {
  table = t
}

// Templates: table keys with {0}, {1}... placeholders match text whose dynamic parts (a body's
// name, a count) differ; the captured parts are put back into the translation.
interface Template { re: RegExp; tr: [string, string, string] }
let templates: Template[] | null = null
let templatesFor: unknown = null
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function templatesOf(t: Record<string, [string, string, string]>): Template[] {
  if (templates && templatesFor === t) return templates
  templatesFor = t
  templates = Object.entries(t)
    .filter(([en]) => /\{\d+\}/.test(en))
    .map(([en, tr]) => ({
      re: new RegExp('^' + en.split(/(\{\d+\})/).map((part) => (/^\{\d+\}$/.test(part) ? '(.+?)' : escapeRe(part))).join('') + '$'),
      tr,
    }))
  return templates
}

export function descriptionOf(text: string, script: ScriptId): string | undefined {
  if (!table) return undefined
  const key = normalizeDescription(text)
  const exact = table[key]?.[COLUMN[script]]
  if (exact !== undefined) return exact
  for (const tpl of templatesOf(table)) {
    const m = tpl.re.exec(key)
    if (m) return tpl.tr[COLUMN[script]].replace(/\{(\d+)\}/g, (_, i) => m[Number(i) + 1] ?? '')
  }
  return undefined
}
