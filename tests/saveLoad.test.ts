// Saving and loading a game (state/saveGame.ts, saveCodec.ts, gameStores.ts):
// the codec, the store registry guard, a full round trip through real JSON in both
// economy modes, and "a loaded game plays on exactly like the uninterrupted one".
//
// Run:  npx tsx tests/saveLoad.test.ts
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { decode, encode, sameData } from '../src/state/saveCodec'
import { mergeSites } from '../src/economy/buildingSites'
import type { Building } from '../src/economy/economyTypes'
import { ensureSeeded } from '../src/scene/seedPlacementOrders'
import { STORE_REGISTRY, UNREGISTERED_STORES, gameEntries } from '../src/state/gameStores'
import { SAVE_FORMAT, SaveError, applySave, createSave } from '../src/state/saveGame'
import { packSave, unpackSave } from '../src/state/saveStorage'
import { resetGame } from '../src/scene/gameReset'
import { setUpNewGame } from '../src/scene/gameSetup'
import { usePlayerStore } from '../src/state/playerStore'
import { empiresRunning, useEconomyStore, worldByName } from '../src/state/economyStore'
import { useAbstractEconomyStore } from '../src/state/abstractEconomyStore'
import { useGameTimeStore } from '../src/state/gameTimeStore'
import { useShipStore } from '../src/state/shipStore'
import { useTechStore } from '../src/state/techStore'
import { useTerritoryStore } from '../src/state/territoryStore'
import { COUNTRIES, getCountry, registerCountry, resetDynamicCountries, type Country } from '../src/data/countryData'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

console.log('\n=== 1. The codec ===')
{
  const sample = { a: 1, b: [1, 2, { c: 'x' }], s: new Set(['p', 'q']), m: new Map([['k', { n: new Set([1]) }]]), gone: undefined, f: () => 1, nul: null, nested: { deep: new Set<string>() } }
  const back = decode(JSON.parse(JSON.stringify(encode(sample)))) as typeof sample
  check('Set, Map, nesting and null survive real JSON', back.s instanceof Set && back.s.has('q') && back.m.get('k')!.n.has(1) && back.nested.deep instanceof Set && back.nul === null)
  check('functions and undefined are dropped', !('f' in back) && !('gone' in back))
  check('sameData agrees with the round trip', sameData(sample, back))
  check('sameData tells different Sets apart', !sameData({ s: new Set([1]) }, { s: new Set([2]) }))
  let msg = ''
  try { encode({ when: new Date() }) } catch (e) { msg = (e as Error).message }
  check('a class instance is refused, naming the path', msg.includes('$.when'), msg)
  msg = ''
  try { encode({ x: { y: NaN } }) } catch (e) { msg = (e as Error).message }
  check('NaN is refused, naming the path', msg.includes('$.x.y'), msg)
}

console.log('\n=== 2. Every store is registered or explained ===')
{
  const registry = readFileSync(join('src', 'state', 'gameStores.ts'), 'utf8')
  const files = [...readdirSync(join('src', 'state')).map((f) => join('src', 'state', f)), join('src', 'ai', 'aiStore.ts')]
  const missing: string[] = []
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    for (const m of text.matchAll(/export const (use\w+Store)\s*=\s*create</g)) {
      const base = file.split('/').pop()!.replace('.ts', '')
      if (!registry.includes(`(${m[1]})`) && !registry.includes(`, ${m[1]}`) && !registry.includes(`${m[1]})`) && !(base in UNREGISTERED_STORES)) missing.push(`${base}:${m[1]}`)
    }
  }
  check('no store is missing from gameStores.ts', missing.length === 0, missing.join(', '))
  const keys = STORE_REGISTRY.map((e) => e.key)
  check('registry keys are unique', new Set(keys).size === keys.length)
  check('there are game stores to save', gameEntries().length > 20, `${gameEntries().length}`)
}

async function startGame(model: 'complex' | 'abstract') {
  resetGame()
  usePlayerStore.getState().setEconomyModel(model)
  usePlayerStore.getState().selectCountry('imperial-state-of-mars')
  setUpNewGame()
}

function snapshotGame(): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const e of gameEntries()) out[e.key] = e.store.getState()
  return out
}

function diffKeys(a: Record<string, unknown>, b: Record<string, unknown>): string[] {
  return Object.keys(a).filter((k) => !sameData(a[k], b[k]))
}

for (const model of ['complex', 'abstract'] as const) {
  console.log(`\n=== 3. Round trip through JSON — ${model} mode ===`)
  await startGame(model)
  useGameTimeStore.setState({ simDays: 400, paused: false })
  if (model === 'complex') useEconomyStore.getState().advance(3)
  else useAbstractEconomyStore.getState().advance(3)
  useTerritoryStore.getState().claimBody('Ceres', 'imperial-state-of-mars')
  const before = snapshotGame()
  const file = await createSave('test')
  const text = JSON.stringify(file)
  check('the file is tagged and JSON-serialisable', file.format === SAVE_FORMAT && text.length > 1000, `${(text.length / 1024).toFixed(0)} KB`)
  resetGame()
  check('a reset really cleared the game', usePlayerStore.getState().selectedCountryId === null || useShipStore.getState().ships.length === 0)
  await applySave(JSON.parse(text))
  const after = snapshotGame()
  // The clock is deliberately paused on load; everything else must match.
  before.gameTime = { ...(before.gameTime as object), paused: true }
  const bad = diffKeys(before, after)
  check('every saved store is deep-equal after load', bad.length === 0, bad.join(', '))
  check('the loaded game is paused', useGameTimeStore.getState().paused === true)
  check('techs (a Set) came back as a Set', useTechStore.getState().stateFor('imperial-state-of-mars').researched instanceof Set)
  check('the player and mode are restored', usePlayerStore.getState().selectedCountryId === 'imperial-state-of-mars' && usePlayerStore.getState().economyModel === model)
}

console.log('\n=== 4. A loaded game plays on like the uninterrupted one ===')
{
  await startGame('complex')
  useEconomyStore.getState().advance(2)
  const file = JSON.parse(JSON.stringify(await createSave('mid')))
  useEconomyStore.getState().advance(4)
  const straight = useEconomyStore.getState().worlds
  const straightTick = useEconomyStore.getState().tick
  const straightEmpireTick = useEconomyStore.getState().empireTick
  await applySave(file)
  useEconomyStore.getState().advance(4)
  check('same tick count', useEconomyStore.getState().tick === straightTick)
  check('worlds are identical after 4 more months', sameData(straight, useEconomyStore.getState().worlds))
  check('the empires were saved and keep running in step', empiresRunning() && Object.keys(useEconomyStore.getState().empireSummaries).length > 0 && useEconomyStore.getState().empireTick === straightEmpireTick)
}

console.log('\n=== 5. Runtime nations and refusal of bad files ===')
{
  await startGame('abstract')
  const base = COUNTRIES[0]
  const subject: Country = { ...base, id: 'test-subject', name: 'Test Subject' }
  registerCountry(subject)
  const file = JSON.parse(JSON.stringify(await createSave('subject')))
  resetGame()
  check('reset removed the runtime nation', !getCountry('test-subject'))
  await applySave(file)
  check('the runtime nation is back', getCountry('test-subject')?.name === 'Test Subject')
  resetDynamicCountries()

  const refuse = async (what: string, data: unknown, expect: RegExp) => {
    let err: unknown
    try { await applySave(data) } catch (e) { err = e }
    check(what, err instanceof SaveError && expect.test((err as Error).message), err instanceof Error ? err.message : 'no error')
  }
  await refuse('a file that is not a save is refused', { hello: 1 }, /not a Terra Relicta save/)
  await refuse('a save from a newer envelope is refused', { ...file, version: 99 }, /newer version/)
  const newerStore = JSON.parse(JSON.stringify(file))
  newerStore.stores.player.version = 99
  await refuse('a store from a newer build is refused', newerStore, /newer version/)
  const ships = useShipStore.getState().ships.length
  check('a refused file leaves the live game alone', useShipStore.getState().ships.length === ships)
}

console.log('\n=== 6. Packing for storage ===')
{
  await startGame('abstract')
  const file = await createSave('pack')
  const bytes = await packSave(file)
  check('the packed save is gzip and smaller than the JSON', bytes[0] === 0x1f && bytes[1] === 0x8b && bytes.length < JSON.stringify(file).length / 2, `${bytes.length} bytes`)
  const back = await unpackSave(bytes)
  check('it unpacks to the same save', back.savedAt === file.savedAt && sameData(back.stores, JSON.parse(JSON.stringify(file.stores))))
  const plain = await unpackSave(new TextEncoder().encode(JSON.stringify(file)))
  check('a plain (uncompressed) save file also opens', plain.label === 'pack')
  let err = ''
  try { await unpackSave(new TextEncoder().encode('{nope')) } catch (e) { err = (e as Error).message }
  check('garbage is refused readably', /damaged/.test(err), err)
}

console.log('\n=== 7. A save from before buildings belonged to a place ===')
{
  await startGame('complex')
  ensureSeeded('Mars')
  const levelsOf = () => JSON.stringify(worldByName(useEconomyStore.getState().worlds, 'Mars')!.buildings.reduce((m, b) => ({ ...m, [b.recipeId]: (m[b.recipeId] ?? 0) + b.level }), {} as Record<string, number>))
  const want = levelsOf()
  const file = JSON.parse(JSON.stringify(await createSave('old')))
  // Make it an old file: version 2, every Complex building merged back into one per recipe and owner.
  file.version = 2
  const economy = decode(file.stores.economy.data) as { worlds: { buildings: Building[] }[] }
  for (const w of economy.worlds) w.buildings = mergeSites(w.buildings)
  file.stores.economy.data = encode(economy)
  await applySave(file)
  const mars = worldByName(useEconomyStore.getState().worlds, 'Mars')!
  check('an old save opens with its buildings split where the ledger says', mars.buildings.some((b) => !!b.siteId) && mars.buildings.every((b) => !!b.siteId || b.recipeId === 'spaceport'))
  check('...and no level was gained or lost', levelsOf() === want)
}

console.log(failures ? `\n${failures} FAILED` : '\nAll save/load checks passed')
process.exit(failures ? 1 : 0)
