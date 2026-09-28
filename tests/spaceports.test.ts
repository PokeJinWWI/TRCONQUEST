// Verification of spaceports as a world's economy runs them (both modes) and on
// its ground map (scene/spaceportSites.ts, state/defenseStore.groundKeySurface):
// about two per billion people, placed near the equator on a fast-spinning
// world and by the cities on a locked one, a few strategic outliers, every one
// a full key node, each with its operator named.
// Run:  npx tsx tests/spaceports.test.ts

import { seedWorlds } from '../src/economy/economySeed'
import { groundKeySurface } from '../src/state/defenseStore'
import { spaceportSitesOf } from '../src/state/nationEconomy'
import { useEconomyStore } from '../src/state/economyStore'
import { usePlayerStore } from '../src/state/playerStore'
import { extraSpaceportNodes } from '../src/scene/spaceportSites'
import { groundSurface } from '../src/scene/groundLogic'
import { seedBodyOwners } from '../src/scene/territory'
import { keyNameOf } from '../src/scene/keyNames'
import { lonLatOf } from '../src/scene/mapProjection'
import { arc, nodePoint, surfaceMesh } from '../src/scene/surfaceMesh'
import { equatorialPull } from '../src/data/bodyRotation'
import { useAbstractEconomyStore } from '../src/state/abstractEconomyStore'
import { matchTrade, type TradeNation } from '../src/economy-abstract/tradeMatching'
import { abstractReport, emptyStockpile } from '../src/economy-abstract/abstractEconomy'
import { GOOD_VALUE, SIMPLE_WORLD_SEEDS, TRADE_PER_SPACEPORT } from '../src/data/simplisticEconomyData'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

usePlayerStore.setState({ economyModel: 'complex' })
const owners = seedBodyOwners()
const pop = (id: string) => seedWorlds().find((w) => w.id === id)!.pops.reduce((n, p) => n + p.populationSize, 0)

console.log('=== 1. How many, and who runs them (Complex) ===')
{
  for (const w of seedWorlds()) {
    const n = w.buildings.filter((b) => b.recipeId === 'spaceport').length
    const want = Math.max(1, Math.round((2 * pop(w.id)) / 1000))
    check(`${w.name}: ${want} spaceports for ${Math.round(pop(w.id))}M people`, n === want, `${n}`)
  }
  const mars = spaceportSitesOf('Mars')
  check('Mars’s are split between the state and its private operator', mars.some((s) => s.operator === 'state') && mars.some((s) => s.operator === 'tenku-koro'), mars.map((s) => s.operatorName).join(', '))
}

console.log('\n=== 2. On the ground map, every one a key node ===')
{
  const surface = groundKeySurface('Mars', owners)!
  const ports = surface.keySlots.filter((k) => k.kind === 'spaceport')
  check('Mars’s ground map has a key node for each of its spaceports', ports.length === spaceportSitesOf('Mars').length, `${ports.length}`)
  const cell = surfaceMesh().fineSpacingRad
  const minSep = Math.min(...ports.flatMap((a, i) => ports.slice(i + 1).map((b) => arc(nodePoint(a.node), nodePoint(b.node)) / cell)))
  check('they stand apart (no two within 1.5 cells)', minSep >= 1.5, `${minSep.toFixed(1)} cells`)
  const labels = ports.map((p) => keyNameOf(surface, p).label)
  check('each has its own name', new Set(labels).size === labels.length, labels.join(' · '))
  check('each names its operator', ports.every((p) => !!p.operator), ports.map((p) => p.operator).join(', '))
  check('a strategic outlier among them', ports.some((p) => p.site === 'outlier'))
  check('outliers are named for their region, the rest for their city', labels.some((l) => / Launch Complex/.test(l)) || ports.every((p) => p.site !== 'outlier'))
}

console.log('\n=== 3. Near the equator where the world spins fast ===')
{
  const meanLat = (nodes: number[]) => nodes.reduce((n, i) => n + Math.abs(lonLatOf(nodePoint(i)).lat), 0) / nodes.length
  const base = groundSurface('Mars', owners)!
  const land = Array.from({ length: surfaceMesh().count.fine }, (_, i) => i).filter((i) => base.landComponent[i] === base.mainland)
  const regular = extraSpaceportNodes(base, 8).filter((e) => !e.outlier).map((e) => e.node)
  check('Mars (a 24.6-hour day): its spaceports lie nearer the equator than its land does on average', meanLat(regular) < meanLat(land), `${((meanLat(regular) * 180) / Math.PI).toFixed(0)}° vs ${((meanLat(land) * 180) / Math.PI).toFixed(0)}°`)
  check('a tidally locked world gets no equatorial pull, a fast one full', equatorialPull('Proxima b') === 0 && equatorialPull('Mars') === 1 && equatorialPull('Luna') === 0)
}

console.log('\n=== 4. Placement is stable ===')
{
  const s = groundSurface('Venus', owners)!
  const a = extraSpaceportNodes(s, 5).map((e) => e.node).join()
  const b = extraSpaceportNodes({ ...s }, 5).map((e) => e.node).join()
  check('the same world places its spaceports the same way every time', a === b && a.length > 0)
}

console.log('\n=== 5. Simple mode: spaceport levels are the sites, and trade runs through them ===')
{
  usePlayerStore.setState({ economyModel: 'abstract' })
  for (const [body, seed] of Object.entries(SIMPLE_WORLD_SEEDS)) {
    const want = Math.max(1, Math.round((2 * seed.population) / 1000))
    check(`${body}: ${want} spaceport levels for ${seed.population}M people`, seed.buildings.spaceport === want, `${seed.buildings.spaceport}`)
  }
  const sites = spaceportSitesOf('Mars')
  check('Mars’s spaceport levels are its ground-map sites', sites.length === SIMPLE_WORLD_SEEDS.Mars.buildings.spaceport, `${sites.length}`)
  const ports = groundKeySurface('Mars', owners)!.keySlots.filter((k) => k.kind === 'spaceport').length
  check('…and each is a key node', ports === sites.length, `${ports}`)

  const st = useAbstractEconomyStore.getState()
  const mars = st.byCountry['imperial-state-of-mars']
  const marsWorlds = Object.values(st.worlds).filter((w) => w.bodyName === 'Mars' || w.bodyName === 'Luna')
  const stock = { ...emptyStockpile(), rockets: 100, spaceships: 20 }
  const cap = abstractReport(mars, marsWorlds, stock).tradeCapacity
  check('a nation’s trade capacity follows its spaceports', cap > 0.8 * 7 * TRADE_PER_SPACEPORT && cap <= 7 * TRADE_PER_SPACEPORT + 1e-9, `${cap.toFixed(0)} TSC/mo`)
  const noPlants = marsWorlds.map((w) => ({ ...w, buildings: { ...w.buildings, rocketWorks: 0, spaceyard: 0 } }))
  const dry = abstractReport(mars, noPlants, emptyStockpile()).tradeCapacity
  check('short of rockets and spaceships, spaceports carry less', dry < cap, `${dry.toFixed(0)} vs ${cap.toFixed(0)}`)

  const peace = () => false
  const nation = (id: string, over: Partial<TradeNation> = {}): TradeNation => ({ id, orders: {}, stock: emptyStockpile(), monthlyUse: {}, cash: 1e9, unitCost: () => 1, ...over })
  const seller = nation('B', { orders: { alloys: -500 }, stock: { ...emptyStockpile(), alloys: 5000 } })
  const capped = matchTrade([nation('A', { orders: { alloys: 500 }, tradeCapacity: 100 * GOOD_VALUE.alloys }), seller], peace)
  check('an import stops at the buyer’s spaceport capacity', Math.abs((capped.A.alloys ?? 0) - 100) < 1e-6, `${capped.A.alloys}`)
  const sellerCapped = matchTrade([nation('A', { orders: { alloys: 500 } }), { ...seller, tradeCapacity: 40 * GOOD_VALUE.alloys }], peace)
  check('…and at the seller’s', Math.abs((sellerCapped.A.alloys ?? 0) - 40) < 1e-6, `${sellerCapped.A.alloys}`)
  const none = matchTrade([nation('A', { orders: { alloys: 500 }, tradeCapacity: 0 }), seller], peace)
  check('a nation without a spaceport trades nothing', (none.A.alloys ?? 0) === 0)
  const shared = matchTrade([nation('A', { orders: { alloys: 500, food: 500 }, tradeCapacity: 200 }), nation('B', { orders: { alloys: -500, food: -500 }, stock: { ...emptyStockpile(), alloys: 5000, food: 5000 } })], peace)
  const used = (shared.A.alloys ?? 0) * GOOD_VALUE.alloys + (shared.A.food ?? 0) * GOOD_VALUE.food
  check('capacity is shared across goods', Math.abs(used - 200) < 1e-6, `${used.toFixed(1)} TSC`)
  usePlayerStore.setState({ economyModel: 'complex' })
}

void useEconomyStore
console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
