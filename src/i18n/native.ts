// The native-script label shown beside an English label in the NERV theme (components/Bi.tsx):
// Japanese, Traditional Chinese or Simplified Chinese, from hand-written dictionaries keyed by
// the exact English text. Names the dictionaries cannot know whole (a numbered ship, an ordinal
// fleet, a generated planet "Kepler-22 IV") are built from their parts; anything else has none.
// Pure: no store access (the theme/script comes in as an argument).
import type { ScriptId } from '../state/themeStore'
import { JA } from './ja'
import { ZH_HANT } from './zhHant'
import { ZH_HANS } from './zhHans'
import { forScript } from './hanzi'
import { CITY_NAMES } from '../data/cityNames'
import { NATIVE_BY_NAME } from '../data/nativeNames'

export type NativeDict = Record<string, string>

export const NATIVE_DICTS: Record<ScriptId, NativeDict> = { ja: JA, 'zh-Hant': ZH_HANT, 'zh-Hans': ZH_HANS }

const lowerCache = new Map<ScriptId, Map<string, string>>()
function lowerDict(script: ScriptId): Map<string, string> {
  let m = lowerCache.get(script)
  if (!m) {
    m = new Map(Object.entries(NATIVE_DICTS[script]).map(([k, v]) => [k.toLowerCase(), v]))
    lowerCache.set(script, m)
  }
  return m
}

const CJK_DIGITS = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九']
function cjkNumber(n: number): string {
  if (n <= 10) return n === 10 ? '十' : CJK_DIGITS[n]
  if (n < 20) return `十${CJK_DIGITS[n - 10]}`
  if (n < 100) return `${CJK_DIGITS[Math.floor(n / 10)]}十${n % 10 ? CJK_DIGITS[n % 10] : ''}`
  return String(n)
}
const FLEET: Record<ScriptId, string> = { ja: '艦隊', 'zh-Hant': '艦隊', 'zh-Hans': '舰队' }

// Place names that carry their own script in the game data (Mars's city kanji, Earth's Chinese
// places), in traditional characters: converted for the script.
const BUILT_IN_PLACES: Record<string, string> = {
  ...Object.fromEntries(Object.values(CITY_NAMES).flatMap((list) => list.filter((c) => c.native).map((c) => [c.name, c.native!]))),
  ...NATIVE_BY_NAME,
}

function exact(en: string, script: ScriptId): string | undefined {
  const own = NATIVE_DICTS[script][en] ?? lowerDict(script).get(en.toLowerCase())
  if (own) return own
  const place = BUILT_IN_PLACES[en]
  return place ? forScript(place, script) : undefined
}

// Words that end a place's or thing's name: "<X> Spaceport", "<X> Municipal Government Building".
const SUFFIXES: [RegExp, Record<ScriptId, string>][] = [
  [/^(.*\S) Municipal Government Building$/, { ja: '市庁舎', 'zh-Hant': '市政府', 'zh-Hans': '市政府' }],
  [/^(.*?\S) (?:(North|South|East|West|Northeast|Northwest|Southeast|Southwest) )?Spaceport$/, { ja: '宇宙港', 'zh-Hant': '太空港', 'zh-Hans': '太空港' }],
  [/^(.*\S) Anchor$/, { ja: '基部', 'zh-Hant': '錨座', 'zh-Hans': '锚座' }],
  [/^(.*\S) Industrial (?:Zone|Belt)$/, { ja: '工業地帯', 'zh-Hant': '工業區', 'zh-Hans': '工业区' }],
  [/^(.*\S) Farmlands$/, { ja: '農地', 'zh-Hant': '農田', 'zh-Hans': '农田' }],
  [/^(.*\S) Oil Fields$/, { ja: '油田', 'zh-Hant': '油田', 'zh-Hans': '油田' }],
  [/^(.*\S) Rare Metal Mines$/, { ja: '希少金属鉱山', 'zh-Hant': '稀有金屬礦', 'zh-Hans': '稀有金属矿' }],
  [/^(.*\S) Coal Mines$/, { ja: '炭鉱', 'zh-Hant': '煤礦', 'zh-Hans': '煤矿' }],
  [/^(.*\S) Launch Complex$/, { ja: '発射場', 'zh-Hant': '發射場', 'zh-Hans': '发射场' }],
  [/^(.*\S) Megalopolis$/, { ja: '都市圏', 'zh-Hant': '都會區', 'zh-Hans': '都会区' }],
  [/^(.*\S) Platform$/, { ja: '基台', 'zh-Hant': '平台', 'zh-Hans': '平台' }],
  [/^(.*\S) level$/, { ja: '段階', 'zh-Hant': '級', 'zh-Hans': '级' }],
  [/^(.*\S) areas$/, { ja: '地域', 'zh-Hant': '地區', 'zh-Hans': '地区' }],
  [/^(.*\S) Research$/, { ja: '研究', 'zh-Hant': '研究', 'zh-Hans': '研究' }],
  [/^(.*\S) Army$/, { ja: '軍', 'zh-Hant': '軍', 'zh-Hans': '军' }],
  [/^House (.*\S)$/, { ja: '家', 'zh-Hant': '家族', 'zh-Hans': '家族' }],
]
const DIRECTIONS: Record<string, string> = { North: '北', South: '南', East: '東', West: '西', Northeast: '東北', Northwest: '西北', Southeast: '東南', Southwest: '西南' }
// A value that stays as it is: a number, money, a percentage, a count.
const VALUE = /^[-+$€£¥]?[\d.,]+[%kKMBT]?(?:\/(?:mo|yr))?$|^\$[\d.,]+[kMBT]?(?:\/(?:mo|yr))?$/

// Native labels the player typed for a label (Alt-click in the NERV theme), per script, keyed by
// the English text: they win over the dictionaries. Set by components/NativeAnnotator.tsx from
// placeNameStore (`label:<English>` keys); empty here in tests unless a test sets it.
let playerLabels: Record<string, Partial<Record<ScriptId, string>>> = {}
export function setPlayerLabels(labels: Record<string, Partial<Record<ScriptId, string>>>): void {
  playerLabels = labels
}

// A native label that just repeats the English (IED, GDP, NERV in Chinese) adds nothing: none.
export function nativeOf(en: string | null | undefined, script: ScriptId): string | undefined {
  const n = nativeOfRaw(en, script)
  if (!n || !en) return n
  const plain = (x: string) => x.replace(/[\s·・/]+/g, '').toLowerCase()
  return plain(en).startsWith(plain(n)) && /^[\x00-\x7F]+$/.test(n) ? undefined : n
}

function nativeOfRaw(en: string | null | undefined, script: ScriptId): string | undefined {
  if (!en) return undefined
  const text = en.trim()
  if (!text) return undefined
  const typed = playerLabels[text]?.[script]
  if (typed !== undefined) return typed.trim() || undefined
  const whole = exact(text, script)
  if (whole) return whole
  // "<name> Spaceport" and the other name endings.
  for (const [re, word] of SUFFIXES) {
    const m = text.match(re)
    if (!m) continue
    const head = nativeOfRaw(m[1], script)
    if (!head) continue
    const dir = m[2] ? (script === 'zh-Hans' ? DIRECTIONS[m[2]].replace('東', '东') : DIRECTIONS[m[2]]) : ''
    return `${head}${dir}${word[script]}`
  }
  // "Imperial State of Mars (you)", "Akakyō (capital)": the name, then its note if known.
  const paren = text.match(/^(.*\S)\s*\(([^()]+)\)$/)
  if (paren) {
    const head = nativeOfRaw(paren[1], script)
    if (head) {
      const note = nativeOfRaw(paren[2], script)
      return note ? `${head}（${note}）` : head
    }
  }
  // "1st Fleet", "12th Fleet": 第一艦隊.
  const fleet = text.match(/^(\d+)(?:st|nd|rd|th) Fleet$/)
  if (fleet) return `第${cjkNumber(Number(fleet[1]))}${FLEET[script]}`
  // "Corvette 12", "Kepler-22 IV", "Station 3": the known part, then the number as is.
  const numbered = text.match(/^(.*\S)\s+(\d+|[IVXLC]+)$/)
  if (numbered) {
    const head = nativeOfRaw(numbered[1], script)
    if (head) return `${head}${numbered[2]}`
  }
  // "Barnard's Star System": the star, then 星系.
  const system = text.match(/^(.*\S) System$/)
  if (system) {
    const head = nativeOfRaw(system[1], script)
    if (head) return `${head}星系`
  }
  // "Proxima b", "Luyten 726-8 Ab": a known star, then its planet's letter.
  const lettered = text.match(/^(.*\S)\s+([a-e]|[A-C][a-e]?)$/)
  if (lettered) {
    const head = nativeOfRaw(lettered[1], script)
    if (head) return `${head}${lettered[2]}`
  }
  // "Revenue $847.2M", "Prestige 48": the word's native only (the value is already on screen beside it).
  const valued = text.match(/^(.*?[A-Za-z].*?)\s+(\S+)$/)
  if (valued && VALUE.test(valued[2])) {
    const head = nativeOfRaw(valued[1], script)
    if (head) return head
  }
  // "Diligent, Reformer, Incorruptible": a list, every item known.
  if (text.includes(', ')) {
    const items = text.split(/,\s+/).map((p) => nativeOfRaw(p, script))
    if (items.every(Boolean)) return items.join('、')
  }
  // "Capital: Mars · Sol", "Queue · 130": every worded part known, values kept.
  const pieces = text.split(/\s*(?::|·|—|–|\|)\s+/).filter(Boolean)
  if (pieces.length > 1) {
    const each = pieces.map((p) => (VALUE.test(p) ? p : nativeOfRaw(p, script)))
    if (each.every(Boolean)) return each.join('・')
  }
  return undefined
}

// Every English key the three dictionaries share (the coverage test lists the gaps).
export function dictionaryGaps(): { script: ScriptId; missing: string[] }[] {
  const all = new Set(Object.values(NATIVE_DICTS).flatMap((d) => Object.keys(d)))
  return (Object.keys(NATIVE_DICTS) as ScriptId[]).map((script) => ({ script, missing: [...all].filter((k) => !(k in NATIVE_DICTS[script])) }))
}
