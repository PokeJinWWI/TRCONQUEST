// UI themes: Default stays the original look (every theme token resolves to the old literal),
// NERV only overrides tokens under html[data-theme='nerv'], the saved theme parses safely, the
// scene chrome keeps its old colours in Default, and the bilingual labels: three dictionaries
// with the same keys, the composer for numbered / compound names, built-in place subscripts per
// script, per-script player subscripts and their save migration. See state/themeStore.ts,
// themes/nerv.css, i18n/native.ts, components/Bi.tsx, components/NativeAnnotator.tsx.
//
// Run:  npx tsx tests/themes.test.ts

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { parseThemePrefs } from '../src/state/themeStore'
import { SCENE_COLORS } from '../src/scene/themeColors'
import { NATIVE_DICTS, dictionaryGaps, nativeOf } from '../src/i18n/native'
import { TRADITIONAL_ONLY, forScript } from '../src/i18n/hanzi'
import { labelKey } from '../src/i18n/labelText'
import { CITY_NAMES } from '../src/data/cityNames'
import { NATIVE_BY_NAME } from '../src/data/nativeNames'
import { migratePlaceNames, nativeFor, usePlaceNameStore } from '../src/state/placeNameStore'
import { PHOSPHORS, customPhosphor, hslToRgb, phosphorOf, phosphorSceneColors, phosphorTokens } from '../src/scene/phosphor'
import { STORE_REGISTRY } from '../src/state/gameStores'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

console.log('\n=== 1. Theme preference ===')
check('nothing saved = Default, Japanese, full motion', JSON.stringify(parseThemePrefs(null)) === JSON.stringify({ theme: 'default', script: 'ja', reduceMotion: false, phosphor: 'green', phosphorHue: 300, crt: { curve: true, scanlines: true, glow: true, noise: false, flicker: false }, nervCrt: { curve: false, scanlines: false, glow: false, noise: false, flicker: false } }))
check('a saved NERV / Simplified / reduced loads', JSON.stringify(parseThemePrefs('{"theme":"nerv","script":"zh-Hans","reduceMotion":true}')) === JSON.stringify({ theme: 'nerv', script: 'zh-Hans', reduceMotion: true, phosphor: 'green', phosphorHue: 300, crt: { curve: true, scanlines: true, glow: true, noise: false, flicker: false }, nervCrt: { curve: false, scanlines: false, glow: false, noise: false, flicker: false } }))
check('junk gives the defaults', parseThemePrefs('{{').theme === 'default' && parseThemePrefs('{"theme":"pink","script":"xx"}').script === 'ja')

console.log('\n=== 2. Default is the original look ===')
{
  const index = readFileSync('src/index.css', 'utf8')
  const app = readFileSync('src/App.css', 'utf8')
  const root = index.match(/:root\s*{([^}]*)}/)?.[1] ?? ''
  const vals = Object.fromEntries([...root.matchAll(/(--[a-z-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]))
  check('the accent is the original cyan', vals['--accent'] === '#6fe3ff' && vals['--accent-rgb'] === '111, 227, 255')
  check('panels, text and alerts keep their original values', vals['--panel-rgb'] === '4, 10, 20' && vals['--text'] === '#cdeeff' && vals['--danger'] === '#ff6b4a' && vals['--font-ui'] === "'Courier New', monospace")
  const used = new Set([...app.matchAll(/var\((--[a-z-]+)/g)].map((m) => m[1]))
  const undefinedVars = [...used].filter((v) => !(v in vals) && !/^--(hud|ship|badge|sev|cursor|font-mono|nav-width|outliner-width)/.test(v))
  check('every token App.css uses is defined in :root', undefinedVars.length === 0, undefinedVars.join(', '))
  check('the original accent no longer appears as a literal in App.css', !/rgba\(\s*111,\s*227,\s*255/.test(app) && !/#6fe3ff/i.test(app))
  const nerv = readFileSync('src/themes/nerv.css', 'utf8')
  const rules = nerv.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@import[^;]*;/g, '').replace(/@keyframes[^{]*{(?:[^{}]*{[^}]*})*[^}]*}/g, '')
  const selectors = [...rules.matchAll(/([^{}]+)\{/g)].map((m) => m[1].trim()).filter((s) => s && !s.startsWith('@media') && !/^\d+%|^from|^to/.test(s))
  const topLevel = (sel: string) => sel.split(/,(?![^(]*\))/)
  const unscoped = selectors.filter((s) => !topLevel(s).every((part) => part.includes("[data-theme='nerv']") || ['.native', '.time-date-native', '.game-tooltip-native'].includes(part.trim())))
  check('every NERV rule is scoped to html[data-theme=nerv] (Default untouched)', unscoped.length === 0, unscoped.slice(0, 3).join(' | '))
  check('the scene chrome keeps its original colours in Default', SCENE_COLORS.default.orbit === '#7ce8ff' && SCENE_COLORS.default.grid === '#6fe3ff' && SCENE_COLORS.default.lattice === '#2b6b80')
}

console.log('\n=== 2a. Windows 95 theme ===')
{
  check('a saved Windows 95 theme loads', parseThemePrefs('{"theme":"win95"}').theme === 'win95')
  check('the Windows 95 scene colours exist', SCENE_COLORS.win95.toneMapped === false)
  const w95 = readFileSync('src/themes/win95.css', 'utf8')
  const rules = w95.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@font-face\s*{[^}]*}/g, '')
  const selectors = [...rules.matchAll(/([^{}]+)\{/g)].map((m) => m[1].trim()).filter(Boolean)
  const unscoped = selectors.filter((sel) => !sel.split(/,(?![^(]*\))/).every((part) => part.includes("[data-theme='win95']")))
  check('every Windows 95 rule is scoped to html[data-theme=win95]', unscoped.length === 0, unscoped.slice(0, 3).join(' | '))
}

check('NERV screen effects default off and load per switch', (() => { const n = parseThemePrefs('{"theme":"nerv","nervCrt":{"scanlines":true,"glow":"x"}}').nervCrt; return n.scanlines === true && n.glow === false && n.curve === false })())
check('the shared effect rules reach both Terminal and NERV', readFileSync('src/themes/terminal.css', 'utf8').includes("html:is([data-theme='terminal'], [data-theme='nerv'])[data-crt-scanlines='on']"))

console.log('\n=== 2b. Terminal theme ===')
{
  const saved = parseThemePrefs('{"theme":"terminal","phosphor":"amber","phosphorHue":725,"crt":{"curve":false,"noise":true,"glow":"x"}}')
  check('a saved Terminal / amber / hue wraps / switches load; a bad switch falls back', saved.theme === 'terminal' && saved.phosphor === 'amber' && saved.phosphorHue === 5 && saved.crt.curve === false && saved.crt.noise === true && saved.crt.glow === true)
  check('an unknown phosphor gives green', parseThemePrefs('{"phosphor":"pink"}').phosphor === 'green')
  check('green and amber are the real phosphors', JSON.stringify(hslToRgb(135, 100, 60)) === '[51,255,102]' && JSON.stringify(hslToRgb(41.5, 100, 50)) === '[255,176,0]')
  const g = phosphorTokens(PHOSPHORS.green)
  const a = phosphorTokens(PHOSPHORS.amber)
  check('the accent is the phosphor, as a triplet and a hex', g['--accent'] === '#33ff66' && g['--accent-rgb'] === '51, 255, 102' && a['--accent'] === '#ffb000')
  check('every token index.css defines for colour comes from the phosphor or terminal.css', ['--accent-rgb', '--panel-rgb', '--text', '--strong', '--page-bg', '--ok'].every((k) => k in g))
  check('panels are near-black', g['--panel-rgb'].split(', ').every((v) => Number(v) < 12) && g['--page-bg'] !== '#000000' && Number.parseInt(g['--page-bg'].slice(1, 3), 16) < 8)
  check('a custom hue stays readable (lighter toward blue)', customPhosphor(250).l > customPhosphor(30).l && customPhosphor(30).l >= 58)
  check('a custom phosphor is a hue slider', phosphorOf('custom', 200).h === 200 && phosphorOf('custom', -10).h === 350)
  check('the map line work follows it', phosphorSceneColors(PHOSPHORS.amber).orbit === '#ffb000' && phosphorSceneColors(PHOSPHORS.green).toneMapped === false)
  const term = readFileSync('src/themes/terminal.css', 'utf8')
  const rules = term.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@keyframes[^{]*{(?:[^{}]*{[^}]*})*[^}]*}/g, '').replace(/@media[^{]*{(?:[^{}]*{[^}]*})*[^}]*}/g, '')
  const selectors = [...rules.matchAll(/([^{}]+)\{/g)].map((m) => m[1].trim()).filter(Boolean)
  const unscoped = selectors.filter((sel) => !sel.split(/,(?![^(]*\))/).every((part) => part.includes("[data-theme='terminal']")))
  check('every Terminal rule is scoped to html[data-theme=terminal]', unscoped.length === 0, unscoped.slice(0, 3).join(' | '))
  check('Terminal names no accent colour of its own (only alerts)', !/#(33ff66|ffb000)\b/i.test(term.replace(/--(warn|caution)[^;]*;/g, '')))
  check('the effects are separate switches', ['curve', 'scanlines', 'glow', 'noise', 'flicker'].every((k) => term.includes(`data-crt-${k}='on'`)))
  check('the overlays never take clicks', (term.match(/pointer-events: none/g) ?? []).length >= 3)
}

console.log('\n=== 3. Dictionaries ===')
{
  const gaps = dictionaryGaps().filter((g) => g.missing.length > 0)
  check('the three dictionaries have the same keys', gaps.length === 0, gaps.map((g) => `${g.script}: ${g.missing.slice(0, 3).join(', ')}`).join(' | '))
  check('they are not empty', Object.keys(NATIVE_DICTS.ja).length > 1000, `${Object.keys(NATIVE_DICTS.ja).length} terms`)
  const tradInSimplified = Object.entries(NATIVE_DICTS['zh-Hans']).filter(([, v]) => [...v].some((c) => TRADITIONAL_ONLY.includes(c) || '艦隊國際經濟戰爭發電鐵輸區'.includes(c)))
  check('Simplified Chinese has no traditional-only characters', tradInSimplified.length === 0, tradInSimplified.slice(0, 5).map(([k, v]) => `${k}=${v}`).join(', '))
  check('core labels', nativeOf('Shipyard', 'ja') === '造船所' && nativeOf('Shipyard', 'zh-Hant') === '造船廠' && nativeOf('Shipyard', 'zh-Hans') === '造船厂')
}

console.log('\n=== 4. Names built from parts ===')
check('a numbered ship', nativeOf('Corvette 12', 'ja') === 'コルベット12')
check('a comma list', nativeOf('Diligent, Reformer', 'ja') === '勤勉、改革者')
check('an ordinal fleet', nativeOf('1st Fleet', 'ja') === '第一艦隊' && nativeOf('12th Fleet', 'zh-Hans') === '第十二舰队')
check('a lettered planet', nativeOf('Proxima b', 'zh-Hant') === '比鄰星b')
check('a Mk tech', nativeOf('Hyperdrive Mk II', 'ja') === '超空間航法II')
check('a system', nativeOf("Barnard's Star System", 'ja') === 'バーナード星星系' || nativeOf("Barnard's Star System", 'ja')?.startsWith('バーナード') === true)
check('a municipal building of a Mars city', nativeOf('Rakuyō Municipal Government Building', 'ja') === '洛陽市庁舎')
check('a directional spaceport', nativeOf('Tonkō East Spaceport', 'zh-Hans') === '敦煌东太空港')
check('a label with a value gives the word only', nativeOf('Revenue $847.2M', 'ja') === '歳入')
check('separated parts', nativeOf('Capital: Mars · Sol', 'ja') === '首都・火星・太陽')
check('unknown words give none', nativeOf('Zorblax Quux', 'ja') === undefined)
check('what counts as a label', labelKey('Clinic ×2') === 'Clinic' && labelKey('+ Build here') === 'Build here' && labelKey('This is a sentence. More.') === null && labelKey('42') === null)

console.log('\n=== 5. Built-in place subscripts per script ===')
{
  const all = [...Object.values(CITY_NAMES).flatMap((l) => l.map((c) => c.native ?? '')), ...Object.values(NATIVE_BY_NAME)].join('')
  const left = [...new Set([...forScript(all, 'zh-Hans')])].filter((c) => TRADITIONAL_ONLY.includes(c))
  check('every traditional character of the built-in names converts to Simplified', left.length === 0, left.join(''))
  check('Mars kanji per script', forScript('洛陽', 'zh-Hans') === '洛阳' && forScript('洛陽', 'ja') === '洛陽' && forScript('哈爾濱', 'ja') === '哈爾浜')
}

console.log('\n=== 6. Player subscripts ===')
{
  const st = usePlaceNameStore.getState()
  st.setNative('fleet:f1', 'ja', '第一艦隊改')
  check('one script is set, the others keep the default', nativeFor('fleet:f1', 'ja') === '第一艦隊改' && nativeFor('fleet:f1', 'zh-Hans') === undefined)
  st.setNative('fleet:f1', 'zh-Hans', ' ')
  check('a single space hides it', nativeFor('fleet:f1', 'zh-Hans', '洛陽') === undefined)
  st.setNative('fleet:f1', 'ja', '')
  check('empty goes back to the built-in', nativeFor('fleet:f1', 'ja', '洛陽') === '洛陽')
  const old = migratePlaceNames({ names: { a: 'X' }, natives: { 'Earth#settlement-1': '哈爾濱' } }) as { natives: Record<string, Record<string, string>> }
  check('an old save\'s single subscript becomes one per script', old.natives['Earth#settlement-1']['zh-Hant'] === '哈爾濱' && old.natives['Earth#settlement-1']['zh-Hans'] === '哈尔滨' && old.natives['Earth#settlement-1'].ja === '哈爾浜')
  check('the place-name store is saved at version 3 with the migration', STORE_REGISTRY.some((e) => e.key === 'placeNames' && e.version === 3 && !!e.migrate))
}

console.log('\n=== 7. No old-style subscripts left ===')
{
  const files: string[] = []
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f)
      if (statSync(p).isDirectory()) walk(p)
      else if (p.endsWith('.tsx')) files.push(p)
    }
  }
  walk('src')
  const offenders = files.filter((f) => /<sub\b/.test(readFileSync(f, 'utf8')))
  check('no component draws a <sub> subscript (they go through <Bi>/<NamedBi>)', offenders.length === 0, offenders.join(', '))
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`)
process.exit(failures === 0 ? 0 : 1)
