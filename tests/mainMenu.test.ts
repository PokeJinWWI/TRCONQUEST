// The main menu's backdrop world: the last nation's capital, Earth for a new player.
const store = new Map<string, string>()
;(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
}

let failures = 0
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const mw = await import('../src/scene/menuWorld')
const { usePlayerStore } = await import('../src/state/playerStore')
const { COUNTRIES } = await import('../src/data/countryData')
const { readFileSync } = await import('node:fs')

console.log('\n=== Backdrop world ===')
{
  check('a new player (nothing remembered) gets Earth', mw.menuWorldOf(mw.readLastWorld()).name === 'Earth')
  check('Earth has its moon to circle it', mw.menuWorldOf('Earth').moons.some((m) => m.name === 'Luna'))
  check('an unknown name falls back to Earth', mw.menuWorldOf('Nowhere').name === 'Earth' && mw.menuWorldOf(null).name === 'Earth')
  check('every nation capital resolves to its own world', COUNTRIES.every((c) => mw.menuWorldOf(c.capitalBodyName).name === c.capitalBodyName), COUNTRIES.filter((c) => mw.menuWorldOf(c.capitalBodyName).name !== c.capitalBodyName).map((c) => c.capitalBodyName).join(', '))
  check('a world carries a colour and a size', COUNTRIES.every((c) => { const w = mw.menuWorldOf(c.capitalBodyName); return /^#[0-9a-f]{6}$/i.test(w.color) && w.radiusKm > 0 }))
}

console.log('\n=== Remembering the last game ===')
{
  usePlayerStore.getState().selectCountry('imperial-state-of-mars')
  check('picking a nation remembers its capital', mw.readLastWorld() === 'Mars' && mw.menuWorldOf(mw.readLastWorld()).name === 'Mars')
  usePlayerStore.getState().startSandbox()
  check('the sandbox (no capital) leaves it as it was', mw.readLastWorld() === 'Mars')
  check('capitalBodyOf names no body for the sandbox faction', mw.capitalBodyOf(usePlayerStore.getState().selectedCountryId) === null)
}

console.log('\n=== The menu keeps every way in ===')
{
  const menu = readFileSync('src/components/MainMenu.tsx', 'utf8')
  check('New Game, Load Game, Sandbox and Settings are all offered', ['New Game', 'Load Game', 'Sandbox', 'Settings'].every((l) => menu.includes(`'${l}'`) || menu.includes(`>${l}<`) || new RegExp(`${l}\\s*\\n`).test(menu)))
  check('the economic model, nations, saves and themes are all still reachable', ['setEconomyModel', 'handleSelect', '<SaveSlots', '<ThemePicker', 'startSandbox'].every((s) => menu.includes(s)))
  const css = readFileSync('src/themes/bloomberg.css', 'utf8')
  check('Market Terminal uses the computer\'s own cursor', /--cursor-default:\s*default;/.test(css) && /--cursor-pointer:\s*pointer;/.test(css) && /--cursor-blocked:\s*not-allowed;/.test(css))
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`)
process.exit(failures === 0 ? 0 : 1)
