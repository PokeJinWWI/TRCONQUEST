// Research in Complex mode (src/economy/research.ts, economyStore grant): a
// nation's monthly research per tree comes from its educated workforce + research
// buildings (the University is the biggest), is handed to techStore after every
// tick, and a queued tech researches to completion over time.
//
// Run:  npx tsx tests/research.test.ts

import { nationResearch, researchByNation, RESEARCH_BY_BUILDING, TECH_TREES } from '../src/economy/research'
import { seedWorlds } from '../src/economy/economySeed'
import type { World } from '../src/economy/economyTypes'
import { usePlayerStore } from '../src/state/playerStore'
import { useEconomyStore } from '../src/state/economyStore'
import { useTechStore } from '../src/state/techStore'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}
const total = (r: Record<string, number>) => (Object.values(r) as number[]).reduce((a, b) => a + b, 0)

console.log('\n=== 1. Research from the seed: every nation, every tree ===')
{
  const r = researchByNation(seedWorlds())
  const ids = Object.keys(r)
  check('every nation that owns a world gets a research rate', ids.length >= 4 && ids.includes('republic-of-venus'))
  check('each rate covers all three trees', Object.values(r).every((t) => TECH_TREES.every((k) => k in t)))
  check('every nation does some research (educated workforce + seeded schools)', Object.values(r).every((t) => total(t) > 0), `Venus ${total(r['republic-of-venus']).toFixed(1)}/mo`)
  check('research is in a sane range (not runaway) — under 60/mo each', Object.values(r).every((t) => total(t) < 60))
}

console.log('\n=== 2. The University is the biggest single source ===')
{
  check('university feeds all three trees', TECH_TREES.every((t) => (RESEARCH_BY_BUILDING.university[t] ?? 0) > 0))
  check('university out-researches a school per level', (RESEARCH_BY_BUILDING.university.society ?? 0) > (RESEARCH_BY_BUILDING.school?.society ?? 0))
  // Same world, with and without a university level.
  const base: World = { ...seedWorlds().find((w) => w.id === 'Venus')! }
  const withUni: World = { ...base, buildings: [...base.buildings, { id: 'test-uni', recipeId: 'university', methodId: 'standard', methodLocked: false, level: 1, owner: { kind: 'state' }, inventory: {}, throughput: 1, lastProfit: 0, employed: 0, jobsPosted: 0 }] }
  const before = total(nationResearch([base]))
  const after = total(nationResearch([withUni]))
  check('building a university raises the world’s research', after > before, `${before.toFixed(1)} → ${after.toFixed(1)}/mo`)
  // Mothballed (idle) building contributes nothing.
  const idleUni: World = { ...withUni, buildings: withUni.buildings.map((b) => (b.recipeId === 'university' ? { ...b, idle: 1 } : b)) }
  check('a fully mothballed university adds no research', Math.abs(total(nationResearch([idleUni])) - before) < 1e-6)
}

console.log('\n=== 2b. A dedicated lab is the strongest single-tree source ===')
{
  check('each tree has its own lab', ['physicsLab', 'engineeringLab', 'socialInstitute'].every((id) => id in RESEARCH_BY_BUILDING))
  check('a physics lab out-researches the University in physics (per level)', (RESEARCH_BY_BUILDING.physicsLab.physics ?? 0) > (RESEARCH_BY_BUILDING.university.physics ?? 0))
  const base: World = { ...seedWorlds().find((w) => w.id === 'Venus')! }
  const lab = (recipeId: string): World => ({ ...base, buildings: [...base.buildings, { id: `t-${recipeId}`, recipeId, methodId: 'standard', methodLocked: false, level: 1, owner: { kind: 'state' }, inventory: {}, throughput: 1, lastProfit: 0, employed: 0, jobsPosted: 0 }] })
  const b = nationResearch([base])
  const phys = nationResearch([lab('physicsLab')])
  check('a physics lab raises physics most of the three trees', phys.physics - b.physics > phys.society - b.society && phys.physics - b.physics > phys.engineering - b.engineering, `+${(phys.physics - b.physics).toFixed(1)} physics`)
}

console.log('\n=== 3. End to end: Complex grants research and a queued tech completes ===')
{
  usePlayerStore.getState().setEconomyModel('complex')
  usePlayerStore.getState().selectCountry('republic-of-venus')
  const V = 'republic-of-venus'
  const before = useTechStore.getState().stateFor(V).researchPoints
  check('research starts at zero', total(before) === 0)
  useEconomyStore.getState().advance(6)
  const after = useTechStore.getState().stateFor(V).researchPoints
  check('six months of Complex ticks accumulate research points', total(after) > 0, JSON.stringify(Object.fromEntries(Object.entries(after).map(([k, v]) => [k, Math.round(v as number)]))))
  check('economyStore.researchRate is populated for the panel', total(useEconomyStore.getState().researchRate[V] ?? {}) > 0)

  useTechStore.getState().queueTech(V, 'orbital-construction')
  check('orbital-construction is not researched yet', !useTechStore.getState().stateFor(V).researched.has('orbital-construction'))
  useEconomyStore.getState().advance(60)
  check('after five more years the queued tech (and its prereqs) are researched', useTechStore.getState().stateFor(V).researched.has('orbital-construction'))
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
