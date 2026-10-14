// Colony settlers are real pops drawn from a chosen world (economy/settlerPicker.ts). Run:  npx tsx tests/settlers.test.ts
import { pickSettlers, mixOf, type SettlerPop } from '../src/economy/settlerPicker'
import { seededStream } from '../src/data/galaxyGen'
import { useEconomyStore } from '../src/state/economyStore'
import { COLONY_SHIP_SETTLERS } from '../src/data/colonyData'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const pops: SettlerPop[] = [
  { id: 'a', class: 'subsistence', populationSize: 300 },
  { id: 'b', class: 'labor', populationSize: 900 },
  { id: 'c', class: 'technical', populationSize: 500 },
  { id: 'd', class: 'professional', populationSize: 300 },
  { id: 'e', class: 'investor', populationSize: 60 },
  { id: 'f', class: 'political', populationSize: 40 },
]

console.log('\n=== 1. The draw ===')
{
  const r = pickSettlers(pops, 3, 50, seededStream(1, 'x'))
  const sum = Object.values(r.byPop).reduce((n, v) => n + v, 0)
  check('takes exactly what was asked', Math.abs(r.taken - 3) < 1e-6 && Math.abs(sum - 3) < 1e-6, `${r.taken}`)
  check('never more than a pop holds', pops.every((p) => (r.byPop[p.id] ?? 0) <= p.populationSize))
  const mix = mixOf(pops, r.byPop)
  check('drawn across several professions', Object.keys(mix).length >= 4, JSON.stringify(mix))
  // Over many ships the upper classes stay a small share.
  let upper = 0
  let all = 0
  for (let i = 0; i < 200; i++) {
    const m = mixOf(pops, pickSettlers(pops, 4, 50, seededStream(1, `s${i}`)).byPop)
    upper += (m.investor ?? 0) + (m.political ?? 0)
    all += Object.values(m).reduce((n, v) => n + v, 0)
  }
  check('investors and the political class are under 3% of settlers', upper / all < 0.03, `${((upper / all) * 100).toFixed(2)}%`)
  check('two ships do not carry the same mix', JSON.stringify(mixOf(pops, pickSettlers(pops, 3, 50, seededStream(1, 'p')).byPop)) !== JSON.stringify(mixOf(pops, pickSettlers(pops, 3, 50, seededStream(1, 'q')).byPop)))
}

console.log('\n=== 2. Limits ===')
{
  check('the floor holds: a world under it gives nothing', pickSettlers([{ id: 'a', class: 'labor', populationSize: 40 }], 3, 50, () => 0.5).taken === 0)
  const small = pickSettlers([{ id: 'a', class: 'labor', populationSize: 52 }], 3, 50, () => 0.5)
  check('...and never below it', Math.abs(small.taken - 2) < 1e-6, `${small.taken}`)
  check('a one-class world still fills the load', Math.abs(pickSettlers([{ id: 'a', class: 'labor', populationSize: 500 }], 3, 50, () => 0.5).taken - 3) < 1e-6)
}

console.log('\n=== 3. The store takes them out of the world ===')
{
  const world = useEconomyStore.getState().worlds.find((w) => w.pops.length > 1 && w.ownerId)!
  const before = world.pops.reduce((n, p) => n + p.populationSize, 0)
  const r = useEconomyStore.getState().takeSettlers(world.id, COLONY_SHIP_SETTLERS, 50, seededStream(1, 'store'))
  const after = useEconomyStore.getState().worlds.find((w) => w.id === world.id)!.pops.reduce((n, p) => n + p.populationSize, 0)
  check('the world loses exactly the settlers', Math.abs(before - after - r.taken) < 1e-6 && Math.abs(r.taken - COLONY_SHIP_SETTLERS) < 1e-6, `${world.id}: ${before.toFixed(1)} -> ${after.toFixed(1)}`)
  check('the mix adds up to what left', Math.abs(Object.values(r.mix).reduce((n, v) => n + (v ?? 0), 0) - r.taken) < 1e-6)
}

console.log(failures === 0 ? '\nAll settler checks passed.' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
