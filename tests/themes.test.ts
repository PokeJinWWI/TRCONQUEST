// UI themes: Default stays the original look (every theme token resolves to the old literal),
// NERV only overrides tokens under html[data-theme='nerv'], the saved theme parses safely, the
// scene chrome keeps its old colours in Default, and the bilingual labels: three dictionaries
// with the same keys, the composer for numbered / compound names, built-in place subscripts per
// script, per-script player subscripts and their save migration. See state/themeStore.ts,
// themes/nerv.css, i18n/native.ts, components/Bi.tsx, components/NativeAnnotator.tsx.
//
// Run:  npx tsx tests/themes.test.ts

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { THEME_IDS, THEME_LABELS, parseThemePrefs } from '../src/state/themeStore'
import { SCENE_COLORS } from '../src/scene/themeColors'
import { NATIVE_DICTS, dictionaryGaps, nativeOf } from '../src/i18n/native'
import { TRADITIONAL_ONLY, forScript } from '../src/i18n/hanzi'
import { labelKey } from '../src/i18n/labelText'
import { CITY_NAMES } from '../src/data/cityNames'
import { NATIVE_BY_NAME } from '../src/data/nativeNames'
import { migratePlaceNames, nativeFor, usePlaceNameStore } from '../src/state/placeNameStore'
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
check('nothing saved = Default, Japanese, full motion', JSON.stringify(parseThemePrefs(null)) === JSON.stringify({ theme: 'default', script: 'ja', reduceMotion: false }))
check('a saved NERV / Simplified / reduced loads', JSON.stringify(parseThemePrefs('{"theme":"nerv","script":"zh-Hans","reduceMotion":true}')) === JSON.stringify({ theme: 'nerv', script: 'zh-Hans', reduceMotion: true }))
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

// The English-only themes share one set of checks: parse, token completeness, scoping, fonts, cursors,
// scene colours. (NERV has its own above: it is the one with native-script labels.)
const ENGLISH_THEMES = [
  { id: 'ichor', label: 'Ichor', families: ['Cinzel', 'Cormorant Garamond', 'Pirata One'], title: ["--font-blackletter:\\s*'Pirata One'", "--font-display:\\s*'Cinzel'", "--font-body:\\s*'Cormorant Garamond'"], orbit: '#c9a24a', cursors: [['--cursor-default', 'ichor-dagger'], ['--cursor-pointer', 'ichor-tracery'], ['--cursor-blocked', 'ichor-sealed']] },
  { id: 'yesteryear', label: 'Yesteryear', families: ['Playfair Display', 'Old Standard TT', 'Rye'], title: ["--font-saloon:\\s*'Rye'", "--font-display:\\s*'Playfair Display'", "--font-body:\\s*'Old Standard TT'"], orbit: '#b8445e', cursors: [['--cursor-default', 'yesteryear-spade'], ['--cursor-pointer', 'yesteryear-chip'], ['--cursor-blocked', 'yesteryear-folded']] },
] as const

for (const th of ENGLISH_THEMES) {
  console.log(`\n=== ${th.label} ===`)
  check(`a saved ${th.label} theme loads`, parseThemePrefs(`{"theme":"${th.id}"}`).theme === th.id)
  check('an unknown theme still falls back to Default', parseThemePrefs('{"theme":"gold"}').theme === 'default')
  check(`${th.label} is in the picker with a label`, THEME_LABELS[th.id as keyof typeof THEME_LABELS] === th.label && THEME_IDS.includes(th.id as never))

  const index = readFileSync('src/index.css', 'utf8')
  const root = index.match(/:root\s*{([^}]*)}/)?.[1] ?? ''
  const defaultTokens = new Set([...root.matchAll(/(--[a-z-]+):/g)].map((m) => m[1]))
  const sheet = readFileSync(`src/themes/${th.id}.css`, 'utf8')
  const block = sheet.match(new RegExp(`html\\[data-theme='${th.id}'\\]\\s*{([^}]*)}`))?.[1] ?? ''
  const redefined = new Set([...block.matchAll(/(--[a-z-]+):/g)].map((m) => m[1]))
  const colourTokens = [...defaultTokens].filter((t) => t !== '--shade-rgb' && (/rgb$/.test(t) || /^--(accent|accent-soft|text|text-bright|text-cool|text-toast|strong|danger|warn|caution|ok|page-bg|font-ui|font-body)$/.test(t)))
  const missing = colourTokens.filter((t) => !redefined.has(t))
  check(`${th.label} redefines every colour and font token Default defines (nothing falls back to cyan)`, missing.length === 0 && colourTokens.length > 20, missing.join(', ') || `${colourTokens.length} tokens`)
  check(`the ${th.label} stylesheet carries none of the Default cyan`, !/111,\s*227,\s*255/.test(sheet) && !/#6fe3ff/i.test(sheet))

  const rules = sheet.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@import[^;]*;/g, '').replace(/@keyframes[^{]*{(?:[^{}]*{[^}]*})*[^}]*}/g, '')
  const selectors = [...rules.matchAll(/([^{}]+)\{/g)].map((m) => m[1].trim()).filter((sel) => sel && !sel.startsWith('@media'))
  const unscoped = selectors.filter((sel) => !sel.split(/,(?![^(]*\))/).every((part) => part.includes(`[data-theme='${th.id}']`)))
  check(`every ${th.label} rule is scoped to html[data-theme=${th.id}] (the other themes untouched)`, unscoped.length === 0, unscoped.slice(0, 3).join(' | '))
  // The clock pace buttons (STRAT / OPS / TAC) carry their own colours in Default (accent / amber / red); a theme
  // restyles their shape and type but never recolours them, or the active one stops matching its button.
  const timeRules = [...sheet.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^}]*)\}/g)].filter((m) => m[1].includes('.time-mode-btn'))
  const recolours = timeRules.filter((m) => /(^|;|\s)(background|background-color|color|border-color|border)\s*:/.test(m[2]))
  check(`${th.label} never recolours the time-mode buttons (each keeps its own colour; the active one is ringed in it)`, timeRules.length > 0 && recolours.length === 0, recolours.map((m) => m[1].trim().slice(0, 60)).join(' | '))
  check('its entrance animation touches opacity only (a window is placed by an inline transform)', !new RegExp(`@keyframes ${th.id === 'ichor' ? 'ichor-rise' : 'yesteryear-deal'}[^}]*transform`).test(sheet.replace(/\s+/g, ' ')))

  const fonts = readFileSync(`src/themes/${th.id}Fonts.css`, 'utf8')
  const families = new Set([...fonts.matchAll(/font-family:\s*'([^']+)'/g)].map((m) => m[1]))
  check(`the three ${th.label} families are bundled`, th.families.every((f) => families.has(f)), [...families].join(', '))
  const files = [...fonts.matchAll(/url\(([^)]+\.woff2)\)/g)].map((m) => join('src/themes', m[1]))
  check('every font file the stylesheet names is installed', files.length >= 10 && files.every((f) => existsSync(f)), `${files.filter((f) => !existsSync(f)).length} missing of ${files.length}`)
  check('the title and headings use them', th.title.every((re) => new RegExp(re).test(sheet)))

  // The theme's own cursors: three pictures that are not the Default ones, each hotspot inside its picture.
  for (const [v, file] of th.cursors) {
    const m = block.match(new RegExp(`${v}:\\s*url\\('\\.\\./assets/cursors/([a-z-]+\\.svg)'\\)\\s+(\\d+)\\s+(\\d+),\\s*[a-z-]+;`))
    const path = m ? `src/assets/cursors/${m[1]}` : ''
    const svg = path && existsSync(path) ? readFileSync(path, 'utf8') : ''
    const size = Number(svg.match(/<svg[^>]*\swidth="(\d+)"/)?.[1] ?? 0)
    check(`${v} is ${file}.svg with a keyword fallback and a hotspot inside it`, !!m && m[1] === `${file}.svg` && size > 0 && size <= 32 && Number(m[2]) < size && Number(m[3]) < size, m ? `${m[1]} ${m[2]},${m[3]} in ${size}px` : 'not defined')
  }
  check('none of the three is a Default cursor picture', !/cursors\/(pointer|target|blocked)\.svg/.test(sheet))

  const sc = SCENE_COLORS[th.id as keyof typeof SCENE_COLORS]
  const others = Object.entries(SCENE_COLORS).filter(([k]) => k !== th.id).map(([, v]) => v.orbit)
  check('the maps are drawn in the theme\'s own line colour, untone-mapped', !!sc && sc.orbit === th.orbit && sc.toneMapped === false && !others.includes(sc.orbit))
}
check('Default scene colours are unchanged', SCENE_COLORS.default.orbit === '#7ce8ff')

console.log('\n=== Main menu stays reachable when it is taller than the window ===')
{
  const app = readFileSync('src/App.css', 'utf8')
  const menu = app.match(/\.main-menu\s*{([^}]*)}/)?.[1] ?? ''
  check('the menu is not centred with justify-content (a tall one lost its title above the screen)', /justify-content:\s*flex-start/.test(menu) && !/justify-content:\s*center/.test(menu))
  check('it is centred by auto margins on its first and last child instead (they collapse on overflow)', /\.main-menu\s*>\s*:first-child\s*{[^}]*margin-top:\s*auto/.test(app) && /\.main-menu\s*>\s*:last-child\s*{[^}]*margin-bottom:\s*auto/.test(app))
  check('the menu scrolls', /overflow-y:\s*auto/.test(menu))
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`)
process.exit(failures === 0 ? 0 : 1)
