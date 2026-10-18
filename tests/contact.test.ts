// First contact (scene/contact.ts, state/contactStore.ts, hooks/useContactResolver.ts), the trade it gates, and the
// robotic production methods behind the automation unlock (economy/recipes.ts).
//
// Run:  npx tsx tests/contact.test.ts

import { pairKey } from '../src/data/diplomacyData'
import { COUNTRIES } from '../src/data/countryData'
import { UNCONTACTED_AT_START } from '../src/data/contactData'
import { inContact, newContacts, presenceBySystem, uncontactedPairs } from '../src/scene/contact'
import { inContactNow, useContactStore } from '../src/state/contactStore'
import { resolveContacts } from '../src/hooks/useContactResolver'
import { useDiplomacyStore } from '../src/state/diplomacyStore'
import { useShipStore } from '../src/state/shipStore'
import { resetGame } from '../src/scene/gameReset'
import { spawnOwnedShip } from '../src/scene/shipyardLogic'
import { runEconomySteps } from '../src/economy/economyStep'
import { seedBanks, seedCorporations, seedCountries, seedWorlds } from '../src/economy/economySeed'
import { AUTOMATION_UNLOCK, RECIPES, ROBOTIC_METHOD_ID, methodOpenTo, getMethod } from '../src/economy/recipes'
import { SIMPLE_CURRENCIES } from '../src/data/simplisticEconomyData'
import { STORE_REGISTRY } from '../src/state/gameStores'

let failures = 0
function check(label: string, ok: boolean, detail = '') {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`)
  if (!ok) failures++
}
const J = 'republic-of-jinshan'
const MARS = 'imperial-state-of-mars'
const VENUS = 'republic-of-venus'

console.log('\n=== 1. Who is in contact ===')
{
  const none = new Set<string>()
  check('only Jinshan starts uncontacted', UNCONTACTED_AT_START.join() === J)
  check('the other nations have always known each other', inContact(MARS, VENUS, none) && inContact('earth', 'orion-republic', none))
  check('Jinshan knows no one, and no one knows Jinshan', !inContact(J, MARS, none) && !inContact(VENUS, J, none))
  check('a nation always knows itself', inContact(J, J, none))
  check('once they have met they are in contact, either way round', inContact(J, MARS, new Set([pairKey(J, MARS)])) && inContact(MARS, J, new Set([pairKey(J, MARS)])))
  check('meeting Mars tells Jinshan nothing about Venus', !inContact(J, VENUS, new Set([pairKey(J, MARS)])))
  check('the pairs that cannot trade at the start are exactly Jinshan with each other nation', uncontactedPairs(COUNTRIES.map((c) => c.id), new Set()).length === COUNTRIES.length - 1)
}

console.log('\n=== 2. Meeting: a shared system ===')
{
  const presence = presenceBySystem([
    { starId: 'sol', nation: MARS },
    { starId: 'sol', nation: VENUS },
    { starId: 'tau-ceti', nation: J },
    { starId: 'tau-ceti', nation: VENUS },
  ])
  const made = newContacts(presence, new Set())
  check('two nations in one system who have not met make contact there', made.length === 1 && made[0].starId === 'tau-ceti' && [made[0].a, made[0].b].sort().join() === [J, VENUS].sort().join())
  check('nations who already know each other make none (Mars and Venus share Sol)', !made.some((c) => [c.a, c.b].includes(MARS)))
  check('a pair that has met makes no new contact', newContacts(presence, new Set([pairKey(J, VENUS)])).length === 0)
  check('nations in different systems do not meet', newContacts(presenceBySystem([{ starId: 'sol', nation: MARS }, { starId: 'tau-ceti', nation: J }]), new Set()).length === 0)
}

console.log('\n=== 3. In the game ===')
{
  resetGame()
  check('at the start Jinshan has met no one', !inContactNow(J, MARS) && inContactNow(MARS, VENUS))
  resolveContacts(1)
  check('nobody sharing Jinshan\'s system: still no contact', !inContactNow(J, MARS))
  const ship = spawnOwnedShip('corvette', MARS, 'tau-ceti', 'Jinshan')
  check('a Mars ship arrives in τ Ceti', !!ship)
  resolveContacts(2)
  check('first contact: Mars and Jinshan are now in contact', inContactNow(J, MARS))
  check('...and it is announced', useDiplomacyStore.getState().events.some((e) => e.kind === 'first-contact' && e.countryIds.includes(J) && e.countryIds.includes(MARS) && e.place?.starId === 'tau-ceti'))
  check('...Jinshan still does not know Venus', !inContactNow(J, VENUS))
  const events = useDiplomacyStore.getState().events.filter((e) => e.kind === 'first-contact').length
  resolveContacts(3)
  check('...and meeting again does not repeat it', useDiplomacyStore.getState().events.filter((e) => e.kind === 'first-contact').length === events)
  useShipStore.getState().ships.splice(0, useShipStore.getState().ships.length)
  check('contact is permanent: the ship leaving changes nothing', inContactNow(J, MARS))
  check('it is a saved store, reset with the game', STORE_REGISTRY.some((e) => e.kind === 'game' && e.store === useContactStore))
  resetGame()
  check('a new game forgets it', !inContactNow(J, MARS))
}

console.log('\n=== 4. Trade needs contact and a spaceport ===')
{
  const base = { countries: seedCountries(), worlds: seedWorlds(), corporations: seedCorporations(), banks: seedBanks(), startTick: 0, steps: 6, humanCountryIds: [] as string[], warPairs: [] as string[] }
  const ids = COUNTRIES.map((c) => c.id)
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
  const open = runEconomySteps({ ...base, uncontactedPairs: [], portTradeCountries: ids })
  const shut = runEconomySteps({ ...base, uncontactedPairs: uncontactedPairs(ids, new Set()), portTradeCountries: ids })
  check('with Jinshan uncontacted the economies run differently from with it trading', !same(open.worlds, shut.worlds))
  const nationsOnly = runEconomySteps({ ...base, uncontactedPairs: uncontactedPairs(ids, new Set()), portTradeCountries: ids, countries: base.countries.filter((c) => c.id !== J), worlds: base.worlds.filter((w) => w.ownerId !== J), corporations: base.corporations.filter((c) => c.countryId !== J), banks: base.banks.filter((b) => b.countryId !== J) })
  check('an uncontacted Jinshan is exactly as if it were not there to the others', same(shut.worlds.filter((w) => w.ownerId !== J).map((w) => w.market.prices), nationsOnly.worlds.map((w) => w.market.prices)))
  const noPorts = runEconomySteps({ ...base, uncontactedPairs: [], portTradeCountries: ids, worlds: base.worlds.map((w) => (w.ownerId === MARS ? { ...w, buildings: w.buildings.filter((b) => b.recipeId !== 'spaceport') } : w)) })
  const noPortsRule = runEconomySteps({ ...base, uncontactedPairs: [], portTradeCountries: [], worlds: base.worlds.map((w) => (w.ownerId === MARS ? { ...w, buildings: w.buildings.filter((b) => b.recipeId !== 'spaceport') } : w)) })
  check('a nation with no spaceport trades with no one (when the rule applies)', !same(noPorts.worlds, noPortsRule.worlds))
  check('every nation has a spaceport at the start, so the rule changes nothing for them', same(runEconomySteps({ ...base, uncontactedPairs: [], portTradeCountries: ids }).worlds, runEconomySteps({ ...base, uncontactedPairs: [], portTradeCountries: [] }).worlds))
}

console.log('\n=== 5. Robotic production: fewer hands, behind an unlock ===')
{
  const withRobotic = Object.values(RECIPES).filter((r) => r.methods.some((m) => m.id === ROBOTIC_METHOD_ID))
  check('many extraction, farming, energy and industry buildings have a robotic method', withRobotic.length > 30, `${withRobotic.length}`)
  check('services and government have none', ['clinic', 'school', 'governmentOffice', 'retailShop'].every((id) => !RECIPES[id].methods.some((m) => m.id === ROBOTIC_METHOD_ID)))
  const jobs = (m: { jobs: { class: string; count: number }[] }, cls: string[]) => m.jobs.filter((j) => cls.includes(j.class)).reduce((n, j) => n + j.count, 0)
  const rb = RECIPES.coalMine.methods.find((m) => m.id === ROBOTIC_METHOD_ID)!
  const before = RECIPES.coalMine.methods[RECIPES.coalMine.methods.length - 2]
  check('the same output for about a quarter of the labour', JSON.stringify(rb.outputs) === JSON.stringify(before.outputs) && jobs(rb, ['labor', 'subsistence']) < 0.3 * jobs(before, ['labor', 'subsistence']), `${jobs(before, ['labor'])} -> ${jobs(rb, ['labor'])}`)
  check('...for more power and machinery, and some engineers', (rb.inputs.find((i) => i.good === 'electricity')?.amount ?? 0) > (before.inputs.find((i) => i.good === 'electricity')?.amount ?? 0) && jobs(rb, ['professional']) > jobs(before, ['professional']))
  check('it needs the automation unlock', rb.requires === AUTOMATION_UNLOCK && !methodOpenTo(rb) && !methodOpenTo(rb, []) && methodOpenTo(rb, [AUTOMATION_UNLOCK]))
  check('an ordinary method is open to anyone', methodOpenTo(RECIPES.coalMine.methods[0]))
  check('its id never collides with a method a recipe already had', Object.values(RECIPES).every((r) => new Set(r.methods.map((m) => m.id)).size === r.methods.length))
  const countries = seedCountries()
  check('only Jinshan starts with the unlock', countries.filter((c) => c.unlocks?.includes(AUTOMATION_UNLOCK)).map((c) => c.id).join() === J)
  const worlds = seedWorlds()
  const robotic = (owner: string) => worlds.filter((w) => w.ownerId === owner).flatMap((w) => w.buildings).filter((b) => b.methodId === ROBOTIC_METHOD_ID).length
  check('Jinshan\'s plants run robotic where they can, and no other nation\'s do', robotic(J) > 10 && [MARS, VENUS, 'orion-republic', 'kingdom-of-lalande', 'earth'].every((id) => robotic(id) === 0), `${robotic(J)} robotic`)
  check('the method a seeded Jinshan plant runs exists', worlds.filter((w) => w.ownerId === J).flatMap((w) => w.buildings).every((b) => !!getMethod(b.recipeId, b.methodId)))
  const out = runEconomySteps({ countries, worlds, corporations: seedCorporations(), banks: seedBanks(), startTick: 0, steps: 24, humanCountryIds: [], warPairs: [], uncontactedPairs: uncontactedPairs(COUNTRIES.map((c) => c.id), new Set()), portTradeCountries: COUNTRIES.map((c) => c.id) })
  check('two years on, still no other nation has retooled to robotic', out.worlds.filter((w) => w.ownerId !== J).flatMap((w) => w.buildings).every((b) => b.methodId !== ROBOTIC_METHOD_ID))
}

console.log('\n=== 6. Simple mode ===')
{
  check('Jinshan has its own currency there too', SIMPLE_CURRENCIES[J]?.code === 'JSY')
}

console.log(failures === 0 ? '\nAll contact checks passed.' : `\n${failures} check(s) FAILED.`)
process.exit(failures === 0 ? 0 : 1)
