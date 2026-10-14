// The built-in place subscripts (Mars's city kanji, Earth's Chinese places) are written in
// traditional characters; these turn them into the other two scripts. Only the characters those
// names use are mapped (a test checks every one is covered); anything else passes through.
import type { ScriptId } from '../state/themeStore'

const TO_SIMPLIFIED: Record<string, string> = {
  揚: '扬', 涼: '凉', 濱: '滨', 熒: '荧', 爾: '尔', 發: '发', 臨: '临', 薩: '萨', 蘇: '苏', 衛: '卫', 釣: '钓', 長: '长', 開: '开', 陽: '阳', 雲: '云', 魚: '鱼',
}
// Japanese shinjitai where they differ from the traditional form.
const TO_JAPANESE: Record<string, string> = { 發: '発', 濱: '浜' }

export const TRADITIONAL_ONLY = Object.keys(TO_SIMPLIFIED)

export function forScript(traditional: string, script: ScriptId): string {
  const map = script === 'zh-Hans' ? TO_SIMPLIFIED : script === 'ja' ? TO_JAPANESE : null
  return map ? [...traditional].map((c) => map[c] ?? c).join('') : traditional
}
