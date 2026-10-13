// Standard of living and quality of life (economy/habitability.ts, economyTick SOL_TIER_WEIGHT, scene/qualityOfLife.ts): the scoring
// treats basic + everyday needs as the floor (half the score), a hostile world carries a life-support need, and quality of life is
// computed beside the score, not inside it.
//
// Run:  npx tsx tests/standardOfLiving.test.ts
import { tickEconomy } from '../src/economy/economyTick'
import { seedBanks, seedCorporations, seedCountries, seedWorlds } from '../src/economy/economySeed'
import { HABITABILITY_BY_CLASS, LIFE_SUPPORT_GROUP_ID, HABITAT_SOL_PENALTY_CAP, habitatPenalty, lifeSupportScale } from '../src/economy/habitability'
import { BASELINE_ORGANIC, NEED_TIERS, TIDALIAN } from '../src/economy/species'
import { seedColonyWorld } from '../src/economy/colonySeed'
import { nationQualityOfLife, qualityOfLife } from '../src/scene/qualityOfLife'
import type { World } from '../src/economy/economyTypes'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

console.log('\n=== 1. Habitability and the life-support need ===')
{
  check('a fully habitable world needs no life support and pays no penalty', lifeSupportScale(1) === 0 && habitatPenalty(1) === 0 && lifeSupportScale(undefined) === 0)
  check('a hostile world needs most of it, and pays the capped penalty at the worst', lifeSupportScale(0.1) > 0.8 && habitatPenalty(0) === HABITAT_SOL_PENALTY_CAP)
  check('classes are ordered sensibly: a continental world is kindest, a lava world among the worst', HABITABILITY_BY_CLASS.continental === 1 && HABITABILITY_BY_CLASS.lava < HABITABILITY_BY_CLASS.barren)
  for (const species of [BASELINE_ORGANIC, TIDALIAN]) {
    const group = species.needs.basic.find((g) => g.id === LIFE_SUPPORT_GROUP_ID)
    check(`${species.name}: a life-support group in the BASIC tier, met by existing goods`, !!group && group.goods.every((g) => ['electricity', 'water', 'concrete'].includes(g.good)))
  }
}

console.log('\n=== 2. The scoring ===')
{
  // Read the weights out of a one-pop world: SoL moves toward sum(weight * satisfaction) = 0.5 when only basic + everyday are met.
  const countries = seedCountries()
  const worlds = seedWorlds()
  const corps = seedCorporations()
  const banks = seedBanks()
  const res = tickEconomy(countries, worlds, corps, { humanCountryIds: [], tick: 1, enableAI: true }, banks)
  const mars = res.worlds.find((w) => w.id === 'Mars')!
  const sat = mars.pops.reduce((acc, p) => NEED_TIERS.map((t, i) => acc[i] + p.needsSatisfaction[t] * p.populationSize), NEED_TIERS.map(() => 0))
  check('the start still meets basic needs entirely', sat[0] / mars.pops.reduce((n, p) => n + p.populationSize, 0) > 0.99)
  // After the first month a pop's SoL has moved from 0.5 toward the weighted score; it can reach 1 only by meeting comfort and luxury too.
  const sol = mars.pops.reduce((n, p) => n + p.standardOfLiving * p.populationSize, 0) / mars.pops.reduce((n, p) => n + p.populationSize, 0)
  check('a nation that eats and dresses well but has not met comfort and luxury does not top the scale', sol < 0.95, sol.toFixed(3))
}

console.log('\n=== 3. A hostile colony spends on life support; a kind one does not ===')
{
  const worlds = seedWorlds()
  const home = worlds.find((w) => w.id === 'Mars')!
  const kind = seedColonyWorld({ bodyName: 'Luna', ownerId: home.ownerId, settlers: 2, home })
  const hostile = seedColonyWorld({ bodyName: 'Ceres', ownerId: home.ownerId, settlers: 2, home })
  check('colonies carry the habitability of their planet class', !!hostile && (hostile.habitability ?? 1) < 1, `Ceres ${hostile?.habitability}`)
  void kind
  if (hostile) {
    const demand = (w: World): number => {
      const countries = seedCountries()
      const res = tickEconomy(countries, [...worlds.filter((x) => x.id !== w.id), w], seedCorporations(), { humanCountryIds: [], tick: 1, enableAI: false }, seedBanks())
      const out = res.worlds.find((x) => x.id === w.id)!
      return out.pops.reduce((n, p) => n + (p.needsDetail?.basic ?? []).filter((d) => d.good === 'concrete').reduce((m, d) => m + d.wanted, 0), 0)
    }
    const wanted = demand(hostile)
    const same = demand({ ...hostile, habitability: 1 })
    check('the hostile colony WANTS concrete for pressure housing that the same colony on a kind world does not', wanted > same, `${wanted.toFixed(3)} vs ${same.toFixed(3)}`)
  }
}

console.log('\n=== 4. Quality of life ===')
{
  const calm = qualityOfLife({ habitability: 1, housing: { population: 100, room: 150 }, access: [1, 0.8], unrest: 0, occupied: false, atWar: false, enemyInOrbit: false, services: { healthcare: 1, education: 0.5 } })
  const by = (rows: ReturnType<typeof qualityOfLife>, id: string) => rows.find((r) => r.id === id)!.value
  check('a roomy, connected, peaceful, kind world scores high', by(calm, 'housing') === 1 && by(calm, 'infrastructure')! > 0.85 && by(calm, 'safety') === 1 && by(calm, 'habitability') === 1 && by(calm, 'services') === 0.75)
  const bad = qualityOfLife({ habitability: 0.2, housing: { population: 200, room: 50 }, access: [0.3], unrest: 6, occupied: true, atWar: true, enemyInOrbit: true, services: null })
  check('a crowded, cut-off, occupied, hostile one scores low', by(bad, 'housing')! < 0.3 && by(bad, 'safety')! < 0.3 && by(bad, 'habitability')! < 0.3 && by(bad, 'services') === null)
  const nation = nationQualityOfLife([{ weight: 3, indicators: calm }, { weight: 1, indicators: bad }])
  check('a nation averages its worlds by population and carries the rights placeholder', nation.find((r) => r.id === 'housing')!.value! < 1 && nation.find((r) => r.id === 'rights')!.value === null && /government/i.test(nation.find((r) => r.id === 'rights')!.note))
}

console.log(failures ? `\n${failures} FAILED` : '\nAll standard-of-living checks passed')
process.exit(failures ? 1 : 0)
