// The research queue under Free Research: costs shown as free, queued techs complete, finished techs
// leave the queue (src/data/techData.ts, src/state/techStore.ts).
// Run:  npx tsx tests/techQueue.test.ts
import { ALL_TECHS, queuePlan, queueWithoutResearched, queuedResearchNow, researchEtas, shownCost } from '../src/data/techData'
import { useTechStore } from '../src/state/techStore'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const NATION = 'queue-test-nation'
const NO_POINTS = { physics: 0, society: 0, engineering: 0 }
const NO_INCOME = { physics: 0, society: 0, engineering: 0 }
const store = () => useTechStore.getState()
const state = () => store().stateFor(NATION)
const reset = () => {
  useTechStore.setState({ byCountry: {}, freeResearchMode: false })
}
// A researchable tech with a cost and nothing consumed.
const cheap = (id: string) => ALL_TECHS.find((t) => t.id === id)!

console.log('\n=== 1. What a waived cost shows as ===')
{
  const t = cheap('thermodynamics')
  check('a tech costs its points normally', shownCost(t, false) === t.cost && t.cost > 0)
  check('...and nothing while Free Research waives it', shownCost(t, true) === 0)
}

console.log('\n=== 2. ETAs: free means now ===')
{
  const have = new Set(useTechStore.getState().stateFor(NATION).researched)
  const queue = ['quantum-computing', 'biology', 'thermodynamics']
  const paid = researchEtas(queue, have, NO_POINTS, NO_INCOME, 24)
  check('paid, with no income: never', paid.get('biology') === null)
  const free = researchEtas(queue, have, NO_POINTS, NO_INCOME, 24, true)
  check('free: everything that can go is "now" (0 months), whatever the income', queue.every((id) => free.get(id) === 0), JSON.stringify([...free]))
  // A tech with unresearched prerequisites, queued in the order the queue puts them (prerequisites first).
  const deep = ALL_TECHS.map((t) => queuePlan(t.id, have, [])).find((plan) => plan.length >= 3)!
  const chain = researchEtas([...deep].reverse(), have, NO_POINTS, NO_INCOME, 24, true)
  check('free: a tech queued before its prerequisite still goes, within a month or two', deep.every((id) => chain.get(id) !== null && (chain.get(id) ?? 99) <= 3), JSON.stringify([...chain]))
  check('queuedResearchNow with freeCost takes the lot, points or none', queuedResearchNow(['biology', 'thermodynamics'], new Set(), NO_POINTS, true).length === 2)
}

console.log('\n=== 3. The queue without what is researched ===')
{
  check('researched ones leave, order kept', queueWithoutResearched(['a', 'b', 'c'], new Set(['b'])).join() === 'a,c')
  check('nothing researched: unchanged', queueWithoutResearched(['a', 'b'], new Set()).join() === 'a,b')
}

console.log('\n=== 4. The store: queued while it cost, then free ===')
{
  reset()
  store().queueTech(NATION, 'biology')
  store().queueTech(NATION, 'thermodynamics')
  check('queued with no points: nothing researched, both wait', (state().queue ?? []).length === 2 && !state().researched.has('biology'))
  store().setFreeResearchMode(true)
  check('switching Free Research on completes the queue at once', state().researched.has('biology') && state().researched.has('thermodynamics'))
  check('...and the queue is empty (it did not keep what it researched)', (state().queue ?? []).length === 0, JSON.stringify(state().queue))
}
{
  reset()
  store().queueTech(NATION, 'biology')
  store().queueTech(NATION, 'thermodynamics')
  useTechStore.setState({ freeResearchMode: true })
  check('researching a queued tech by hand takes it out of the queue (was: it stayed)', store().researchNode(NATION, 'thermodynamics') && !(state().queue ?? []).includes('thermodynamics'))
  check('the other one is still queued', (state().queue ?? []).join() === 'biology')
  store().processQueue(NATION)
  check('the next pass completes it and empties the queue', state().researched.has('biology') && (state().queue ?? []).length === 0)
}
{
  reset()
  store().setFreeResearchMode(true)
  store().queueTech(NATION, 'quantum-computing')
  check('queueing while it is free completes at once, with its prerequisites', state().researched.has('quantum-computing') && (state().queue ?? []).length === 0)
}
{
  reset()
  store().queueTech(NATION, 'biology')
  store().setFreeResearchMode(false)
  check('switching it off again leaves a queued tech queued (costs are real again)', (state().queue ?? []).join() === 'biology')
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`)
if (failures > 0) process.exit(1)
