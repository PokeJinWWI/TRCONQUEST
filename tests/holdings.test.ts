// Verification of foreign buildings — embassies and branch offices — in both
// economy modes: the rules, their money and opinion, seizure in war, the AI,
// and the Urban slots they take.
// Run:  npx tsx tests/holdings.test.ts

import { BRANCH_PROFIT_SHARE, BRANCH_TAX_SHARE, EMBASSY_OPINION_CAP } from '../src/data/holdingsData'
import { aiNextHolding, canOpen, monthlyFlows, seized, type Holding, type HoldingContext } from '../src/scene/holdings'
import { seedBodyOwners } from '../src/scene/territory'
import { atWar, useDiplomacyStore } from '../src/state/diplomacyStore'
import { usePlayerStore } from '../src/state/playerStore'
import { useHoldingsStore } from '../src/state/holdingsStore'
import { useAbstractEconomyStore } from '../src/state/abstractEconomyStore'
import { useEconomyStore, worldByName } from '../src/state/economyStore'
import { freeUrbanSlots, treasuryOf, holdingContext } from '../src/state/nationEconomy'
import { districtUsage } from '../src/economy/economyTick'
import { resolveHoldings } from '../src/hooks/useHoldingsResolver'

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
const ORION = 'orion-republic'
const owners = seedBodyOwners()
useDiplomacyStore.getState().reset()

// A hand-made context for the pure rules.
const ctx = (over: Partial<HoldingContext> = {}): HoldingContext => ({
  owners,
  capitalOf: (id) => ({ [MARS]: 'Mars', [VENUS]: 'Venus', [ORION]: 'Arcadia' })[id],
  atWar,
  freeUrbanSlots: () => 2,
  treasuryOf: () => 1e9,
  gdpYearOf: () => 10000,
  worldGdpYearOf: (b) => (b === 'Venus' ? 12000 : b === 'Arcadia' ? 5000 : 100),
  opinionOf: () => 0,
  ...over,
})
const h = (kind: Holding['kind'], ownerId: string, bodyName: string): Holding => ({ id: `${kind}-${ownerId}-${bodyName}`, kind, ownerId, bodyName, openedSimDays: 0 })

console.log('=== 1. Who may open what, where ===')
{
  check('an embassy at another nation’s capital', canOpen('embassy', MARS, 'Venus', [], ctx()).ok)
  check('not on your own world', !canOpen('branchOffice', MARS, 'Mars', [], ctx()).ok)
  check('an embassy only on a capital', !canOpen('embassy', MARS, 'Proxima b', [], ctx()).ok)
  check('one embassy per nation', !canOpen('embassy', MARS, 'Venus', [h('embassy', MARS, 'Venus')], ctx()).ok)
  check('one branch office per world', !canOpen('branchOffice', MARS, 'Venus', [h('branchOffice', MARS, 'Venus')], ctx()).ok)
  check('needs a free Urban slot', !canOpen('branchOffice', MARS, 'Venus', [], ctx({ freeUrbanSlots: () => 0 })).ok)
  check('needs the money', !canOpen('branchOffice', MARS, 'Venus', [], ctx({ treasuryOf: () => 1 })).ok)
  useDiplomacyStore.getState().forceWar(MARS, VENUS, 0)
  check('not with a nation you are at war with', !canOpen('embassy', MARS, 'Venus', [], ctx()).ok)
  useDiplomacyStore.getState().reset()
  const c = canOpen('branchOffice', MARS, 'Venus', [], ctx())
  check('setup costs a share of your GDP', c.ok && c.cost > 0 && c.cost < 100, c.ok ? c.cost.toFixed(1) : '')
}

console.log('\n=== 2. Money and opinion each month ===')
{
  const flows = monthlyFlows([h('branchOffice', MARS, 'Venus'), h('embassy', ORION, 'Venus')], ctx())
  check('a branch office pays its owner a share of the host world’s output', Math.abs(flows.treasury[MARS] - (12000 / 12) * BRANCH_PROFIT_SHARE) < 1e-9)
  check('...and the host a tax', Math.abs(flows.treasury[VENUS] - (12000 / 12) * BRANCH_TAX_SHARE) < 1e-9)
  check('an embassy warms the host’s opinion of its owner', flows.opinion.some((o) => o.from === VENUS && o.to === ORION && o.delta > 0))
  const capped = monthlyFlows([h('embassy', ORION, 'Venus')], ctx({ opinionOf: () => EMBASSY_OPINION_CAP }))
  check('...up to a cap', capped.opinion.length === 0)
}

console.log('\n=== 3. War seizes them ===')
{
  useDiplomacyStore.getState().forceWar(MARS, VENUS, 0)
  const lost = seized([h('branchOffice', MARS, 'Venus'), h('embassy', ORION, 'Venus')], owners, atWar)
  check('holdings between nations at war are seized, others stay', lost.length === 1 && lost[0].ownerId === MARS)
  useDiplomacyStore.getState().reset()
}

console.log('\n=== 4. The AI ===')
{
  const first = aiNextHolding(MARS, [MARS, VENUS, ORION], [], ctx())
  check('it opens embassies first', first?.kind === 'embassy')
  const next = aiNextHolding(MARS, [MARS, VENUS, ORION], [h('embassy', MARS, 'Venus'), h('embassy', MARS, 'Arcadia')], ctx())
  check('...then a branch office on the richest foreign world', next?.kind === 'branchOffice' && next.bodyName === 'Venus', JSON.stringify(next))
}

console.log('\n=== 5. Simple mode: slots, treasury, monthly income ===')
{
  usePlayerStore.getState().setEconomyModel('abstract')
  useHoldingsStore.getState().setHoldings([])
  const before = freeUrbanSlots('Venus')
  const cash0 = treasuryOf(MARS)
  const res = useHoldingsStore.getState().open(MARS, 'Venus', 'embassy', 0)
  check('opening works and is paid for', res.ok && treasuryOf(MARS) < cash0)
  check('it takes an Urban slot on the host world', freeUrbanSlots('Venus') === before - 1 && useAbstractEconomyStore.getState().worlds['Venus'].foreignSlots === 1)
  useHoldingsStore.getState().open(ORION, 'Venus', 'branchOffice', 0)
  const cash1 = treasuryOf(ORION)
  resolveHoldings(0, 30)
  check('a month later the branch office has paid its owner', treasuryOf(ORION) > cash1)
  check('...and the embassy warmed Venus to Mars', holdingContext().opinionOf(VENUS, MARS) > 0)
  useDiplomacyStore.getState().forceWar(MARS, VENUS, 30)
  resolveHoldings(30, 60)
  check('war closes Mars’s embassy and frees the slot', !useHoldingsStore.getState().holdings.some((x) => x.ownerId === MARS) && (useAbstractEconomyStore.getState().worlds['Venus'].foreignSlots ?? 0) === 1)
  useDiplomacyStore.getState().reset()
}

console.log('\n=== 6. Complex mode: the Urban district counts them ===')
{
  usePlayerStore.getState().setEconomyModel('complex')
  useHoldingsStore.getState().setHoldings([])
  const venus = () => worldByName(useEconomyStore.getState().worlds, 'Venus')!
  const used0 = districtUsage(venus()).urban
  const res = useHoldingsStore.getState().open(MARS, 'Venus', 'branchOffice', 0)
  check('opening works in Complex mode', res.ok, res.ok ? '' : (res as { reason: string }).reason)
  check('it uses a Venus Urban slot', districtUsage(venus()).urban === used0 + 1 && venus().foreignSlots === 1)
  useHoldingsStore.getState().setHoldings([])
  check('closing frees it', districtUsage(venus()).urban === used0)
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
