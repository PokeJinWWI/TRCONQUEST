// The Republic of Jinshan: its country, its numbered place names, its peoples and faiths, and its place in both economies.
//
// Run:  npx tsx tests/jinshan.test.ts

import { COUNTRIES, getCountry } from '../src/data/countryData'
import { STRATEGIC_AI_COUNTRY_IDS } from '../src/data/countryRoster'
import { getPlanetsForStar } from '../src/scene/planetData'
import { CITY_NAMES } from '../src/data/cityNames'
import { CULTURES, RELIGIONS } from '../src/economy/demographics'
import { seedCountries, seedWorlds } from '../src/economy/economySeed'
import { SIMPLE_CURRENCIES } from '../src/data/simplisticEconomyData'
import { surfaceOf } from '../src/scene/planetTerrain'
import { keyNamesOf } from '../src/scene/keyNames'
import { useAbstractEconomyStore } from '../src/state/abstractEconomyStore'
import { nationCultureOf, PRIMARY_CULTURE_SHARE } from '../src/economy/acceptance'

let failures = 0
function check(label: string, ok: boolean, detail = '') {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`)
  if (!ok) failures++
}

const ID = 'republic-of-jinshan'
console.log('\n=== 1. The country ===')
{
  const c = getCountry(ID)
  check('Republic of Jinshan is a nation, capital on Jinshan at τ Ceti', c?.name === 'Republic of Jinshan' && c.capitalStarId === 'tau-ceti' && c.capitalBodyName === 'Jinshan')
  check('its colour is its own', COUNTRIES.filter((x) => x.color === c?.color).length === 1)
  check('the AI plays it when it is not the player', STRATEGIC_AI_COUNTRY_IDS.includes(ID))
  check('it owns the planet Jinshan, and nothing else in τ Ceti', getPlanetsForStar('tau-ceti').filter((p) => p.ownerId === ID).map((p) => p.name).join() === 'Jinshan')
  check('its capital is Gam Waan (金灣)', c?.capitalCityName === 'Gam Waan' && c.capitalCityNative === '金灣')
  check('its places are numbered placeholders (Settlement 1, 2, ...)', CITY_NAMES[ID]?.[0]?.name === 'Settlement 1')
}

console.log('\n=== 2. Its places on the ground map ===')
{
  const surface = surfaceOf('Jinshan', 'capital')
  const names = keyNamesOf(surface)
  const cap = surface.keySlots.find((k) => k.kind === 'capital')!
  check('the capital is Gam Waan', names.get(cap.node)?.name === 'Gam Waan' && names.get(cap.node)?.native === '金灣')
  const towns = surface.keySlots.filter((k) => k.kind === 'city')
  check('its other settlements carry numbered placeholder names for its people to rename', towns.length > 0 && towns.every((k) => /^Settlement \d+$/.test(names.get(k.node)?.name ?? '')), towns.map((k) => names.get(k.node)?.name).join(', '))
  const all = surface.keySlots.filter((k) => k.kind === 'city' || k.kind === 'capital').map((k) => names.get(k.node)!.name)
  check('no two of its settlements share a name', new Set(all).size === all.length, all.join(', '))
  check('the list has enough numbers for every site a world can hold', (CITY_NAMES[ID]?.length ?? 0) >= 40)
}

console.log('\n=== 3. Its peoples and faiths ===')
{
  const world = seedWorlds().find((w) => w.name === 'Jinshan')
  check('Jinshan is a seeded world owned by the Republic', world?.ownerId === ID)
  const byCulture = new Map<string, number>()
  const byReligion = new Map<string, number>()
  let total = 0
  for (const p of world?.pops ?? []) {
    total += p.populationSize
    byCulture.set(p.cultureId, (byCulture.get(p.cultureId) ?? 0) + p.populationSize)
    byReligion.set(p.religionId, (byReligion.get(p.religionId) ?? 0) + p.populationSize)
  }
  const share = (m: Map<string, number>, id: string) => (m.get(id) ?? 0) / Math.max(1, total)
  check('seven peoples live there', byCulture.size === 7 && [...byCulture.keys()].every((id) => !!CULTURES[id]), [...byCulture.keys()].join())
  check('Zhongyuan are the plurality, then Yue, Wu, Min', share(byCulture, 'zhongyuan') > share(byCulture, 'yue') && share(byCulture, 'yue') > share(byCulture, 'wu') && share(byCulture, 'wu') > share(byCulture, 'min') && share(byCulture, 'min') > share(byCulture, 'hakka'), [...byCulture].map(([k, v]) => `${k} ${(100 * v / total).toFixed(0)}%`).join(' '))
  check('no one group is a majority, the southern groups together hold most, and a colony-born blend exists', share(byCulture, 'zhongyuan') < 0.5 && ['yue', 'hakka', 'min', 'wu', 'gan-xiang'].reduce((n, id) => n + share(byCulture, id), 0) > 0.6 && share(byCulture, 'jinshanese') > 0.05)
  check('every faith is defined, and folk religion and atheism lead', [...byReligion.keys()].every((id) => !!RELIGIONS[id]) && share(byReligion, 'jinshan-folk') > 0.25 && share(byReligion, 'non-affiliated') > 0.2)
  check('Christianity, Islam, Daoism, Buddhism and Ruism are all present', ['jinshan-church', 'hui-islam-of-jinshan', 'jinshan-daoism', 'jinshan-chan', 'jinshan-ruism'].every((id) => share(byReligion, id) > 0.03))
  const primary = nationCultureOf(world?.pops ?? []).primary
  check(`a culture at ${PRIMARY_CULTURE_SHARE * 100}% or more is primary: the Zhongyuan, the Yue and the Wu are; the Min and the Hakka are not`, ['zhongyuan', 'yue', 'wu'].every((id) => primary.includes(id)) && !primary.includes('min') && !primary.includes('hakka'), primary.join())
  check('the world\'s own culture is the leading one', world?.cultureId === 'zhongyuan')
}

console.log('\n=== 4. In both economies ===')
{
  const c = seedCountries().find((x) => x.id === ID)
  check('Complex: it has a nation record with its own currency (Jinshan Yuan)', c?.currency.code === 'JSY' && c.currency.name === 'Jinshan Yuan')
  check('Simple: it has its own economy and currency', !!useAbstractEconomyStore.getState().byCountry[ID] && SIMPLE_CURRENCIES[ID]?.code === 'JSY')
  check('Simple: the planet is a world of the economy', !!useAbstractEconomyStore.getState().worlds.Jinshan)
}

console.log(failures === 0 ? '\nAll Jinshan checks passed.' : `\n${failures} check(s) FAILED.`)
process.exit(failures === 0 ? 0 : 1)
