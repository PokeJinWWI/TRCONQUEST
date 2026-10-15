// The "where?" chooser's view model (scene/siteChoices.ts): every site of the kind, judged for the player with the law and the ground
// apart, best first; and the build menus really go through it (no menu queues a building without a site).
//
// Run:  npx tsx tests/siteChoices.test.ts
import { readFileSync } from 'node:fs'
import { siteChoicesForBuilding, siteChoicesForLevel, siteLabel } from '../src/scene/siteChoices'
import { ensureSeeded } from '../src/scene/seedPlacementOrders'
import { locationsOf } from '../src/scene/locations'
import { setUpNewGame } from '../src/scene/gameSetup'
import { resetGame } from '../src/scene/gameReset'
import { usePlayerStore } from '../src/state/playerStore'
import { useLocationStore } from '../src/state/locationStore'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}
const MARS = 'imperial-state-of-mars'
const VENUS = 'republic-of-venus'

for (const model of ['abstract', 'complex'] as const) {
  console.log(`\n=== ${model === 'complex' ? 'Complex' : 'Simple'} mode ===`)
  resetGame()
  usePlayerStore.setState({ selectedCountryId: MARS, sandbox: false, economyModel: model })
  setUpNewGame()
  ensureSeeded('Mars')
  const mode = model === 'abstract' ? ('simple' as const) : ('complex' as const)
  const factory = { mode, id: model === 'abstract' ? 'civilianFactory' : 'steelMill' }
  const choices = siteChoicesForBuilding(MARS, 'Mars', factory)
  check('every industrial site of Mars is offered, and its settlements (a city has factories too)', choices.filter((c) => c.kind === 'industrial').length === locationsOf('Mars').filter((s) => s.kind === 'industrial').length && choices.every((c) => c.kind === 'industrial' || c.kind === 'settlement'))
  check('the best allowed site is marked, and allowed sites come first', choices.filter((c) => c.best).length === (choices.some((c) => c.allowed) ? 1 : 0) && choices.findIndex((c) => !c.allowed) === -1 || choices.slice(0, choices.filter((c) => c.allowed).length).every((c) => c.allowed))
  check('each choice says what it offers: ground, access, room, owner', choices.every((c) => c.suitability >= 0 && c.access > 0 && /slot/.test(c.room) && c.label.length > 0))
  const asVenus = siteChoicesForBuilding(VENUS, 'Mars', factory)
  check('for another country every site is listed but blocked by the LAW, with its reason, not hidden', asVenus.length === choices.length && asVenus.every((c) => !c.allowed && c.legal === 'needs-permission' && /permission/.test(c.why)))
  const full = choices.filter((c) => !c.allowed)
  check('a site that is full or undeveloped says so as a ground reason', full.every((c) => c.physical === null || /develop|full|room/.test(c.physical)), full.map((c) => c.physical).join('; '))
  const levels = siteChoicesForLevel(MARS, 'Mars', 'industrial')
  check('a district level is offered at industrial sites with their room', levels.length === choices.length && levels.every((c) => /room for/.test(c.room)))
  const wrong = siteChoicesForLevel(MARS, 'Mars', 'core')
  check('a core level is offered at settlement sites only', wrong.length > 0 && wrong.every((c) => c.kind === 'settlement'))
  const settlement = locationsOf('Mars').find((s) => s.kind === 'settlement' && s.tags.includes('capital'))!
  check('a settlement is named for its place, not a code', !/settlement-0/.test(siteLabel(settlement)), siteLabel(settlement))
  useLocationStore.getState().establish(choices.find((c) => c.allowed)?.siteId ?? choices[0].siteId, MARS, 1)
}

console.log('\n=== Every build menu asks where ===')
{
  const strip = (f: string) => readFileSync(f, 'utf8').replace(/\/\/.*$/gm, '')
  const files: [string, RegExp][] = [
    ['src/components/planet/SimplePlanetTabs.tsx', /SiteChooser/],
    ['src/components/BuildingsPanel.tsx', /SiteChooser/],
    ['src/components/ConstructionPanel.tsx', /SiteChooser/],
  ]
  for (const [f, re] of files) check(`${f.split('/').pop()} uses the chooser`, re.test(strip(f)))
  // The Buildings tab is built place by place: the card is the place, so it passes its own site and needs no chooser.
  check('BuildingsTab builds at the place of its card', /s\.siteId/.test(strip('src/components/planet/BuildingsTab.tsx')) && !/queueConstruction\([^)]*\)/.test(strip('src/components/planet/BuildingsTab.tsx').replace(/queueConstruction\(bodyName, id, \{ kind: 'state' \}, s\.siteId\)/g, '')))
  const direct = (f: string) => (strip(f).match(/queueConstruction\([^)]*\)/g) ?? []).filter((c) => !/siteId/.test(c))
  const panel = direct('src/components/ConstructionPanel.tsx')
  const complex = direct('src/components/planet/ComplexPlanetTabs.tsx')
  check('no new-building order in the planet tab or the Construction panel is queued without a site', panel.length === 0 && complex.length === 0, [...panel, ...complex].join(' | '))
}

console.log(failures ? `\n${failures} FAILED` : '\nAll site choice checks passed')
process.exit(failures ? 1 : 0)
