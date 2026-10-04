// Transport capacities (Complex mode): Vic3-style infrastructure → market
// access, per-world launch (surface↔orbit), national interstellar freight, the
// spaceport production methods, and the paired space elevator.
// See src/economy/transport.ts and src/economy/recipes.ts (spaceport methods).
//
// Run:  npx tsx tests/transportEconomy.test.ts

import {
  worldInfrastructure,
  infrastructureUsage,
  marketAccess,
  launchCapacity,
  interstellarFromWorlds,
  LAUNCH_BASE,
  INTERSTELLAR_BASE,
  SPACEPORT_LAUNCH_BY_METHOD,
  ELEVATOR_LAUNCH_PAIRED,
  ELEVATOR_LAUNCH_UNPAIRED,
} from '../src/economy/transport'
import { RECIPES } from '../src/economy/recipes'
import type { World, Building } from '../src/economy/economyTypes'
import { abstractReport, emptyStockpile, type AbstractEconomyState } from '../src/economy-abstract/abstractEconomy'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const bld = (recipeId: string, level: number, methodId = 'standard'): Building =>
  ({ id: `${recipeId}-${level}`, recipeId, methodId, methodLocked: false, level, owner: { kind: 'state' }, inventory: {}, throughput: 1, lastProfit: 0 } as Building)

const world = (over: Partial<World> = {}): World =>
  ({
    id: 'W', name: 'W', ownerId: 'n', cultureId: 'c', populationCapacity: 0, districtCapacity: {} as never,
    pops: [{ populationSize: 1000 } as never], buildings: [], constructionQueue: [], market: { prices: {} } as never,
    labor: {} as never, importStock: {}, ...over,
  } as World)

console.log('=== 1. Infrastructure → market access ===')
{
  const w = world({ buildings: [bld('railway', 2), bld('spaceport', 1)] })
  check('infrastructure sums base + population + transport buildings', worldInfrastructure(w) > 0)
  check('a well-infrastructured, lightly-built world has full access', marketAccess(w) === 1, `${marketAccess(w)}`)

  // A small-population world packed with heavy industry and no transport →
  // usage outruns its meagre infrastructure.
  const overbuilt = world({ pops: [{ populationSize: 20 } as never], buildings: [bld('steelMill', 40), bld('mine', 40)] })
  check('an over-built world with no transport is below full access', marketAccess(overbuilt) < 1, `${marketAccess(overbuilt).toFixed(2)}`)
  check('usage rises with building levels', infrastructureUsage(overbuilt) > infrastructureUsage(w))

  // Devastation cuts infrastructure.
  const wrecked = world({ buildings: [bld('railway', 2)], devastation: 0.5 })
  check('devastation lowers infrastructure', worldInfrastructure(wrecked) < worldInfrastructure(world({ buildings: [bld('railway', 2)] })))
}

console.log('\n=== 2. Launch (surface↔orbit) ===')
{
  const bare = world()
  check('every world has a launch base', launchCapacity(bare, false) === LAUNCH_BASE)
  const port = world({ buildings: [bld('spaceport', 1, 'standard')] })
  check('a spaceport adds launch', launchCapacity(port, false) === LAUNCH_BASE + SPACEPORT_LAUNCH_BY_METHOD.standard)
  const liftPort = world({ buildings: [bld('spaceport', 1, 'launch-complex')] })
  check('the Launch Complex method gives the most launch', SPACEPORT_LAUNCH_BY_METHOD['launch-complex'] > SPACEPORT_LAUNCH_BY_METHOD.standard && launchCapacity(liftPort, false) > launchCapacity(port, false))
}

console.log('\n=== 3. Space elevator (paired ground + orbit) ===')
{
  const anchor = world({ buildings: [bld('spaceElevatorAnchor', 1)] })
  const unpaired = launchCapacity(anchor, false)
  const paired = launchCapacity(anchor, true)
  check('an anchor alone gives partial launch', unpaired === LAUNCH_BASE + ELEVATOR_LAUNCH_UNPAIRED)
  check('an anchor paired with an orbital tether gives far more', paired === LAUNCH_BASE + ELEVATOR_LAUNCH_PAIRED && paired > unpaired)
}

console.log('\n=== 4. Interstellar (national merchant marine) ===')
{
  check('a nation with no spaceport has the interstellar base', interstellarFromWorlds([world()]) === INTERSTELLAR_BASE)
  const withPort = interstellarFromWorlds([world({ buildings: [bld('spaceport', 2, 'interstellar-port')] })])
  const withHub = interstellarFromWorlds([world({ buildings: [bld('spaceport', 2, 'standard')] })])
  check('the Interstellar Port method gives the most interstellar freight', withPort > withHub && withHub > INTERSTELLAR_BASE)
}

console.log('\n=== 5. Spaceport production methods exist ===')
{
  const methods = RECIPES.spaceport.methods.map((m) => m.id)
  check('spaceport has the three methods', methods.includes('standard') && methods.includes('launch-complex') && methods.includes('interstellar-port'), methods.join(','))
  check('the space-elevator anchor is a real, tech-gated building', RECIPES.spaceElevatorAnchor?.requiresTech === 'orbital-tethers')
}

console.log('\n=== 6. Simple mode parity ===')
{
  const base: AbstractEconomyState = {
    countryId: 'n', population: 1000, gdp: 0, realGdp: 0, priceLevel: 1, inflation: 0, stability: 0.8,
    treasury: 0, reserves: 0, debt: 0, taxRate: 0.2, economyType: 'market', moneyCreation: 0, warTaxes: false, welfare: 0.3,
    queue: [], nextOrderId: 1, currency: { rate: 1, regime: 'float', peggedTo: null }, trade: {},
  }
  const stock = emptyStockpile()
  for (const k of Object.keys(stock)) (stock as Record<string, number>)[k] = 100000
  const w = (buildings: Record<string, number>) => [{ bodyName: 'W', population: 3000, buildings } as never] as never

  const connected = abstractReport(base, w({ spaceport: 4, railway: 3, farm: 4, powerPlant: 4 }), stock)
  check('a connected Simple nation has full market access', connected.marketAccess === 1, `${connected.marketAccess}`)
  check('it reports launch and interstellar capacity', connected.launch > 0 && connected.interstellarTransport > 0)

  const liftMethod = abstractReport({ ...base, spaceportMethod: 'launch-complex' }, w({ spaceport: 4 }), stock)
  const interMethod = abstractReport({ ...base, spaceportMethod: 'interstellar-port' }, w({ spaceport: 4 }), stock)
  check('the launch-complex method gives more launch than the interstellar port', liftMethod.launch > interMethod.launch)
  check('the interstellar-port method gives more interstellar than the launch complex', interMethod.interstellarTransport > liftMethod.interstellarTransport)

  // An over-built, tiny-population world with no transport is throttled.
  const overbuilt = abstractReport(base, [{ bodyName: 'W', population: 50, buildings: { mine: 30, alloyFoundry: 30 } } as never] as never, stock)
  check('an over-built Simple world is below full access', overbuilt.marketAccess < 1, `${overbuilt.marketAccess.toFixed(2)}`)
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
