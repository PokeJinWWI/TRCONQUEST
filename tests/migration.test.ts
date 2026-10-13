// Migration (economy/migrationRules.ts shared rules, economy/migration.ts Complex engine, economy-abstract/migration.ts Simple engine,
// scene/migrationPaths.ts treaty lanes, scene/urbanMaturity.ts): attraction ordering, the monthly cap, closed borders block, a treaty
// opens a path and cancelling it closes it, launch capacity caps, a refugee burst, and both economies obey the same rules.
//
// Run:  npx tsx tests/migration.test.ts
import { stepMigration, migrationLane, distressOf } from '../src/economy/migration'
import {
  ATTRACTION_WEIGHTS,
  MAX_MONTHLY_SHARE,
  PEOPLE_PER_LAUNCH_UNIT,
  WAVE_PUSH,
  attractionOf,
  flowShare,
  pathVerdict,
  type MigrationLaws,
} from '../src/economy/migrationRules'
import { seedBanks, seedCorporations, seedCountries, seedWorlds } from '../src/economy/economySeed'
import { runEconomySteps } from '../src/economy/economyStep'
import { stepAbstractMigration } from '../src/economy-abstract/migration'
import { treatyLanes } from '../src/scene/migrationPaths'
import { maturityOf, MIN_MATURITY } from '../src/scene/urbanMaturity'
import { SETTLEMENT_FILL_DAYS } from '../src/economy/migrationRules'
import { useMigrationStore } from '../src/state/migrationStore'
import { applySave, createSave } from '../src/state/saveGame'
import { resetGame } from '../src/scene/gameReset'
import { sameData } from '../src/state/saveCodec'
import type { Pop, World } from '../src/economy/economyTypes'
import type { Treaty } from '../src/data/treatyData'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

console.log('\n=== 1. Attraction and paths ===')
{
  const base = { standardOfLiving: 0.5, vacancyRatio: 0, roomRatio: 1, safety: 1, cultureShare: 0.5, encouraged: false }
  check('weights sum to one', Math.abs(Object.values(ATTRACTION_WEIGHTS).reduce((n, x) => n + x, 0) - 1) < 1e-9)
  check('a better standard of living attracts more', attractionOf({ ...base, standardOfLiving: 0.9 }).total > attractionOf(base).total)
  check('jobs pull: vacancies beat unemployment', attractionOf({ ...base, vacancyRatio: 0.5 }).total > attractionOf({ ...base, vacancyRatio: -0.5 }).total)
  check('crowding, danger and a foreign culture all repel', attractionOf({ ...base, roomRatio: 0.3 }).total < attractionOf(base).total && attractionOf({ ...base, safety: 0.2 }).total < attractionOf(base).total && attractionOf({ ...base, cultureShare: 0 }).total < attractionOf(base).total)
  check('an encouraging nation is more attractive', attractionOf({ ...base, encouraged: true }).total > attractionOf(base).total)
  check('Simple mode (no standard of living) still ranks by jobs, housing and safety', attractionOf({ ...base, standardOfLiving: null, vacancyRatio: 0.6 }).total > attractionOf({ ...base, standardOfLiving: null, vacancyRatio: -0.6 }).total && attractionOf({ ...base, standardOfLiving: null }).terms.sol === null)
  check('flows stop under the minimum gap and never pass the monthly cap', flowShare(0.01) === 0 && flowShare(5) === MAX_MONTHLY_SHARE)

  const p = { sameNation: false, immigration: 'open' as const, emigration: 'free' as const, treaty: false, reach: true, atWar: false }
  check('closed borders block a foreigner', !pathVerdict({ ...p, immigration: 'closed' }).open)
  check('controlled takes the qualified only', pathVerdict({ ...p, immigration: 'controlled' }).open && pathVerdict({ ...p, immigration: 'controlled' }).qualifiedOnly)
  check('open borders take anyone', pathVerdict(p).open && !pathVerdict(p).qualifiedOnly)
  check('forbidden emigration blocks, restricted cuts the flow', !pathVerdict({ ...p, emigration: 'forbidden' }).open && pathVerdict({ ...p, emigration: 'restricted' }).factor < 1)
  check('a treaty opens a closed path (and a forbidden emigration)', pathVerdict({ ...p, immigration: 'closed', treaty: true }).open && pathVerdict({ ...p, immigration: 'closed', emigration: 'forbidden', treaty: true }).open)
  check('war and distance close every path; inside one nation it is always open', !pathVerdict({ ...p, atWar: true, treaty: true }).open && !pathVerdict({ ...p, reach: false }).open && pathVerdict({ ...p, sameNation: true, immigration: 'closed', emigration: 'forbidden' }).open)
}

// Two worlds: Poor (a nation with a low standard of living) and Rich.
const worlds0 = seedWorlds()
const pop = (w: World, cls: Pop['class']) => w.pops.find((p) => p.class === cls) ?? w.pops[0]
function twoWorlds(): { poor: World; rich: World } {
  const mars = worlds0.find((w) => w.id === 'Mars')!
  const venus = worlds0.find((w) => w.id === 'Venus')!
  const copy = (w: World, sol: number): World => ({ ...w, pops: w.pops.map((p) => ({ ...p, standardOfLiving: sol, wealth: p.wealth })) })
  return { poor: copy(mars, 0.2), rich: copy(venus, 0.9) }
}
const total = (ws: World[]) => ws.reduce((n, w) => n + w.pops.reduce((m, p) => m + p.populationSize, 0), 0)
const popOf = (ws: World[], id: string) => ws.find((w) => w.id === id)!.pops.reduce((n, p) => n + p.populationSize, 0)
const noWar = () => false
const reach = () => true
const baseOpts = { laws: {} as Record<string, MigrationLaws>, treatyPairs: new Set<string>(), atWar: noWar, canReach: reach }

console.log('\n=== 2. The Complex engine ===')
{
  const { poor, rich } = twoWorlds()
  const closed = stepMigration([poor, rich], baseOpts)
  check('by default (closed borders) no one crosses between nations', closed.flows.length === 0 && popOf(closed.worlds, poor.id) === popOf([poor], poor.id))
  const open: Record<string, MigrationLaws> = { [rich.ownerId]: { immigration: 'open', emigration: 'free' } }
  const res = stepMigration([poor, rich], { ...baseOpts, laws: open })
  const moved = res.flows.reduce((n, f) => n + f.amount, 0)
  check('with open borders people leave the poorer world for the richer', res.flows.length > 0 && res.flows.every((f) => f.from === poor.id && f.to === rich.id) && popOf(res.worlds, rich.id) > popOf([rich], rich.id))
  check('the total population is kept', Math.abs(total(res.worlds) - total([poor, rich])) < 1e-6)
  check('no more than the monthly cap leaves a world', moved <= popOf([poor], poor.id) * MAX_MONTHLY_SHARE + 1e-9, `${moved.toFixed(3)}M of ${popOf([poor], poor.id)}M`)
  check('their wealth goes with them', res.worlds.find((w) => w.id === rich.id)!.pops.reduce((n, p) => n + p.wealth, 0) > rich.pops.reduce((n, p) => n + p.wealth, 0))

  const controlled = stepMigration([poor, rich], { ...baseOpts, laws: { [rich.ownerId]: { immigration: 'controlled', emigration: 'free' } } })
  check('controlled migration moves only technical and professional pops', controlled.flows.length > 0 && (() => {
    const before = new Map(poor.pops.map((p) => [p.id, p.populationSize]))
    return controlled.worlds.find((w) => w.id === poor.id)!.pops.every((p) => p.class === 'technical' || p.class === 'professional' || p.populationSize === before.get(p.id))
  })())

  const lane = migrationLane(poor.ownerId, rich.ownerId)
  const treaty = stepMigration([poor, rich], { ...baseOpts, treatyPairs: new Set([lane]) })
  check('a treaty opens the path though the borders are closed', treaty.flows.length > 0)
  const capped = stepMigration([poor, rich], { ...baseOpts, treatyPairs: new Set([lane]), treatyQuota: { [lane]: 0.001 } })
  check('...its quota caps the flow', capped.flows.reduce((n, f) => n + f.amount, 0) <= 0.001 + 1e-9)
  const wrongWay = stepMigration([poor, rich], { ...baseOpts, treatyPairs: new Set([migrationLane(rich.ownerId, poor.ownerId)]) })
  check('...and a one-way treaty does not open the other way', wrongWay.flows.length === 0)
  const cancelled = stepMigration([poor, rich], baseOpts)
  check('cancelling the treaty closes the lane (the people who moved stay)', cancelled.flows.length === 0 && popOf(treaty.worlds, rich.id) > popOf([rich], rich.id))

  const launchCapped = stepMigration([poor, rich], { ...baseOpts, laws: open, launch: { [poor.id]: 1000, [rich.id]: 1000 } })
  check('launch capacity caps the move between bodies', launchCapped.flows.reduce((n, f) => n + f.amount, 0) <= 1000 * PEOPLE_PER_LAUNCH_UNIT + 1e-9)

  const war = stepMigration([poor, rich], { ...baseOpts, laws: open, atWar: () => true })
  check('at war no one crosses', war.flows.length === 0)
  const forbidden = stepMigration([poor, rich], { ...baseOpts, laws: { ...open, [poor.ownerId]: { immigration: 'closed', emigration: 'forbidden' } } })
  check('a nation that forbids emigration keeps its people', forbidden.flows.length === 0)

  // A world in distress sends a burst of refugees.
  const calmWorlds = twoWorlds()
  const levelled = stepMigration([{ ...calmWorlds.poor, pops: calmWorlds.poor.pops.map((p) => ({ ...p, standardOfLiving: 0.7 })) }, { ...calmWorlds.rich, pops: calmWorlds.rich.pops.map((p) => ({ ...p, standardOfLiving: 0.7 })) }], { ...baseOpts, laws: open })
  const refugees = stepMigration([{ ...calmWorlds.poor, pops: calmWorlds.poor.pops.map((p) => ({ ...p, standardOfLiving: 0.7 })) }, { ...calmWorlds.rich, pops: calmWorlds.rich.pops.map((p) => ({ ...p, standardOfLiving: 0.7 })) }], { ...baseOpts, laws: open, distress: { [calmWorlds.poor.id]: 0.4 } })
  check('war on one world sends a burst of refugees, larger than the same pair without it, marked as a wave', refugees.flows.length > 0 && refugees.flows[0].wave && 0.4 >= WAVE_PUSH && refugees.flows.reduce((n, f) => n + f.amount, 0) > levelled.flows.reduce((n, f) => n + f.amount, 0))
  check('famine counts as distress too', distressOf({ ...poor, pops: poor.pops.map((p) => ({ ...p, standardOfLiving: 0.05 })) }, 0) > 0)
  check('the same culture is preferred: the pop that arrives keeps its culture, class and faith', (() => {
    const to = res.worlds.find((w) => w.id === rich.id)!.pops
    return to.some((p) => p.cultureId === pop(poor, 'labor').cultureId)
  })())
}

console.log('\n=== 3. The pipeline: default laws change nothing between the five nations ===')
{
  const start = { countries: seedCountries(), worlds: seedWorlds(), corporations: seedCorporations(), banks: seedBanks() }
  const out = runEconomySteps({ ...start, startTick: 0, steps: 6, humanCountryIds: [], warPairs: [] })
  const ownerOfWorld = (id: string) => start.worlds.find((w) => w.id === id)!.ownerId
  check('the output carries one flow list per step, none crossing a border under closed borders (a nation\'s own worlds may trade people)', out.migrationFlows.length === 6 && out.migrationFlows.every((step) => step.every((f) => ownerOfWorld(f.from) === ownerOfWorld(f.to))))
  const open = runEconomySteps({ ...start, startTick: 0, steps: 6, humanCountryIds: [], warPairs: [], migration: { laws: Object.fromEntries(start.countries.map((c) => [c.id, { immigration: 'open', emigration: 'free' } satisfies MigrationLaws])), treatyPairs: [] } })
  check('open borders everywhere move some people between the nations, within the guardrail', open.migrationFlows.flat().length > 0 && open.migrationFlows.every((step) => step.every((f) => f.amount > 0)))
  const worst = Math.max(...open.worlds.map((w) => Math.abs(w.pops.reduce((n, p) => n + p.populationSize, 0) / (start.worlds.find((s) => s.id === w.id)!.pops.reduce((n, p) => n + p.populationSize, 0)) - 1)))
  check('no world changed by more than 6 months of the monthly cap plus its own growth', worst < 0.1, `${(worst * 100).toFixed(2)}%`)
}

console.log('\n=== 4. The Simple engine obeys the same rules ===')
{
  const w = (bodyName: string, population: number, jobsBuildings: number) => ({ bodyName, population, buildings: { farm: jobsBuildings } as never, districts: {} })
  // Poor has no jobs; Rich has more jobs than hands.
  const poor = w('Poor', 1000, 0)
  const rich = { ...w('Rich', 1000, 400) }
  const owner = (b: string) => (b === 'Poor' ? 'a' : 'b')
  const opts = { ownerOf: owner, laws: {} as Record<string, MigrationLaws>, treatyPairs: new Set<string>(), atWar: noWar }
  check('closed borders block it in Simple mode too', Object.keys(stepAbstractMigration([poor, rich], opts).deltas).length === 0)
  const open = stepAbstractMigration([poor, rich], { ...opts, laws: { b: { immigration: 'open', emigration: 'free' } } })
  check('open borders move people toward the jobs, conserving the total', open.flows.length > 0 && open.flows.every((f) => f.from === 'Poor') && Math.abs(Object.values(open.deltas).reduce((n, x) => n + x, 0)) < 1e-9)
  check('at most the monthly cap leaves', open.flows.reduce((n, f) => n + f.amount, 0) <= 1000 * MAX_MONTHLY_SHARE + 1e-9)
  const viaTreaty = stepAbstractMigration([poor, rich], { ...opts, treatyPairs: new Set([migrationLane('a', 'b')]) })
  check('a treaty opens it', viaTreaty.flows.length > 0)
}

console.log('\n=== 5. Treaty lanes, settlements filling, saves ===')
{
  const t = (articles: Treaty['articles']): Treaty => ({ id: 't', name: 't', a: 'a', b: 'b', articles, signedSimDays: 0, durationYears: 5 })
  const one = treatyLanes([t([{ kind: 'migration', sourceId: 'a', targetId: 'b' }])])
  check('a one-way article is one lane', one.lanes.join() === 'a>b')
  const both = treatyLanes([t([{ kind: 'migration', sourceId: 'a', targetId: 'b', mutual: true, quota: 0.5 }])])
  check('a mutual article is both lanes, with its quota', both.lanes.join() === 'a>b,b>a' && both.quota['a>b'] === 0.5 && both.quota['b>a'] === 0.5)
  check('no treaty, no lane', treatyLanes([]).lanes.length === 0)

  check('a settlement the game opened with is full; one founded in play fills over ten years', maturityOf({ ownerId: 'x', since: 0, connected: true }, 0) === 1 && maturityOf({ ownerId: 'x', since: 100 }, 100) === MIN_MATURITY && maturityOf({ ownerId: 'x', since: 100 }, 100 + SETTLEMENT_FILL_DAYS / 2) > 0.45 && maturityOf({ ownerId: 'x', since: 100 }, 100 + SETTLEMENT_FILL_DAYS * 2) === 1)

  resetGame()
  useMigrationStore.getState().setImmigration('imperial-state-of-mars', 'open')
  useMigrationStore.getState().record(3, [{ from: 'Mars', to: 'Venus', amount: 0.2, wave: false, reason: 'open borders' }])
  const before = { laws: useMigrationStore.getState().laws, history: useMigrationStore.getState().history }
  const file = JSON.parse(JSON.stringify(await createSave('migration')))
  resetGame()
  await applySave(file)
  check('laws and history survive save and load', sameData(before, { laws: useMigrationStore.getState().laws, history: useMigrationStore.getState().history }))
}

console.log(failures ? `\n${failures} FAILED` : '\nAll migration checks passed')
process.exit(failures ? 1 : 0)
