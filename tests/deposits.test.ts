// Natural hyperium and exotic matter deposits, the Extraction techs, the Hyperium
// Synthesis hold requirement and refineries, material discovery and the research
// UI's "???" (data/deposits.ts, scene/extraction.ts, data/materials.ts,
// hooks/useMaterialDiscovery.ts, data/techData.ts).
//
// Run:  npx tsx tests/deposits.test.ts

import { COUNTRIES } from '../src/data/countryData'
import {
  DEPOSIT_RADIUS_KLY,
  DEPOSIT_RICH,
  EXOTIC_DEPOSIT_COUNT,
  EXOTIC_DEPOSIT_MAX,
  EXOTIC_DEPOSIT_MIN,
  EXTRACTION_PER_MONTH,
  HYPERIUM_DEPOSIT_MAX,
  RICH_NATION_DEPOSIT,
  HYPERIUM_DEPOSIT_MIN,
  bodyHasDeposit,
  depositBodies,
  depositTable,
  freshDeposits,
} from '../src/data/deposits'
import { generatedStarsFor } from '../src/data/galaxyGen'
import { distanceFromSolKly } from '../src/data/hyperium'
import { MATERIALS, discoveredMaterials, materialDiscovered, obfuscateMaterials, type MaterialId } from '../src/data/materials'
import { NEIGHBORHOODS } from '../src/data/neighborhoodData'
import { STARS } from '../src/data/starData'
import { COMPLEX_REFINERY_LEVELS, EXOTIC_PER_HYPERIUM, HYPERIUM_PER_REFINERY, HYPERIUM_SYNTHESIS_HOLD, HYPERIUM_SYNTHESIS_TECH_ID } from '../src/data/synthesisData'
import { SIMPLE_BUILDING_DEFS, SIMPLE_WORLD_SEEDS } from '../src/data/simplisticEconomyData'
import { ALL_TECHS, findTech, prerequisitesMet, queuedResearchNow, resourceShortfall } from '../src/data/techData'
import { WARP_DRIVE_TECH_IDS, WARP_MK_RP_BASE, WARP_MK_RP_COST, WARP_MK_RP_SCALE } from '../src/data/warpData'
import { abstractReport, emptyStockpile, type AbstractEconomyState, type WorldState } from '../src/economy-abstract/abstractEconomy'
import { resolveMaterialDiscovery } from '../src/hooks/useMaterialDiscovery'
import { applyExtraction, applySynthesis, extractionRatePerMonth, heldDepositBodies, stepExtraction, stepSynthesis, synthesisBlock } from '../src/scene/extraction'
import { getPlanetsForStar } from '../src/scene/planetData'
import { buildingTechBlock, useAbstractEconomyStore } from '../src/state/abstractEconomyStore'
import { useDepositStore } from '../src/state/depositStore'
import { useMaterialStore } from '../src/state/materialStore'
import { usePlayerStore } from '../src/state/playerStore'
import { useResourceStore } from '../src/state/resourceStore'
import { useSurveyStore } from '../src/state/surveyStore'
import { DEFAULT_RESEARCHED, useTechStore } from '../src/state/techStore'
import { useTerritoryStore } from '../src/state/territoryStore'

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
const HYP: MaterialId = 'hyperium'
const EXO: MaterialId = 'exoticMatter'
const hyper = depositTable(HYP)
const exotic = depositTable(EXO)
const stock = (id: string, r: 'hyperium' | 'exoticMatter') => useResourceStore.getState().stateFor(id).amounts[r]

function fresh() {
  usePlayerStore.setState({ selectedCountryId: MARS, sandbox: false, economyModel: 'abstract' })
  useTerritoryStore.getState().reset()
  useDepositStore.setState({ remaining: freshDeposits() })
  useResourceStore.setState({ byCountry: {} })
  useTechStore.setState({ byCountry: {}, freeResearchMode: false })
  useSurveyStore.setState({ discovered: {}, known: {}, reports: [] })
  useMaterialStore.setState({ discovered: {} })
}

console.log('\n=== 1. Where the deposits are ===')
{
  const near = NEIGHBORHOODS.filter((n) => distanceFromSolKly(n.id) <= DEPOSIT_RADIUS_KLY)
  check('only the Solar Neighbourhood and one other cluster lie within 3 kly of Sol', near.length === 2 && near.some((n) => n.id === 'solar-neighborhood'), near.map((n) => n.id).join(', '))
  const planetsOf = (clusterId: string) => (clusterId === 'solar-neighborhood' ? STARS : generatedStarsFor(clusterId)).flatMap((s) => getPlanetsForStar(s.id).map((p) => p.name))
  const allowed = new Set(near.flatMap((n) => planetsOf(n.id)))
  const bodies = depositBodies()
  check('every deposit is on a planet of those two clusters', bodies.length > 0 && bodies.every((b) => allowed.has(b)))
  const far = NEIGHBORHOODS.filter((n) => !near.some((x) => x.id === n.id))
  check('none is anywhere else', far.every((n) => (n.id === 'solar-neighborhood' ? [] : planetsOf(n.id)).every((b) => !bodies.includes(b))))
  const moons = new Set(near.flatMap((n) => (n.id === 'solar-neighborhood' ? STARS : generatedStarsFor(n.id)).flatMap((s) => getPlanetsForStar(s.id))).map((p) => p.name))
  check('...all of them planets (moons and belts hold none)', bodies.every((b) => moons.has(b)))
  check('the tables are the same every time', JSON.stringify(depositTable(HYP)) === JSON.stringify(freshDeposits().hyperium) && JSON.stringify(depositTable(EXO)) === JSON.stringify(freshDeposits().exoticMatter))

  const candidates = allowed.size
  const hyperCount = Object.keys(hyper).length
  check('about half the planets hold hyperium', hyperCount >= candidates * 0.35 && hyperCount <= candidates * 0.65, `${hyperCount} of ${candidates}`)
  check('every nation\'s capital world holds some (every human nation has access)', COUNTRIES.every((c) => (hyper[c.capitalBodyName] ?? 0) > 0))
  const base = Object.entries(hyper).filter(([, n]) => n <= HYPERIUM_DEPOSIT_MAX)
  check('amounts are in a similar band whatever the class', base.length > 0 && base.every(([, n]) => n >= HYPERIUM_DEPOSIT_MIN && n <= HYPERIUM_DEPOSIT_MAX))
  check('Mars holds the most, above every rich deposit', Math.max(...Object.values(hyper)) === hyper['Mars'] && hyper['Mars'] === RICH_NATION_DEPOSIT && Object.entries(hyper).every(([b, n]) => b === 'Mars' || n < hyper['Mars']) && RICH_NATION_DEPOSIT > Math.round(HYPERIUM_DEPOSIT_MAX * DEPOSIT_RICH))
  check('Venus\'s hyperium is an ordinary deposit', hyper['Venus'] >= HYPERIUM_DEPOSIT_MIN && hyper['Venus'] <= HYPERIUM_DEPOSIT_MAX)
  const richFar = Object.entries(hyper).filter(([b, n]) => !STARS.some((s) => getPlanetsForStar(s.id).some((p) => p.name === b)) && n > HYPERIUM_DEPOSIT_MAX)
  check('some planets outside the Solar Neighbourhood are richer too', richFar.length > 0 && richFar.length < Object.keys(hyper).filter((b) => !planetsOf('solar-neighborhood').includes(b)).length, `${richFar.length}`)

  check(`exactly ${EXOTIC_DEPOSIT_COUNT} exotic matter deposits, very scarce`, Object.keys(exotic).length === EXOTIC_DEPOSIT_COUNT && Object.values(exotic).reduce((a, b) => a + b, 0) < 30)
  check('...in band, Venus\'s the largest', Object.values(exotic).every((n) => n >= EXOTIC_DEPOSIT_MIN && n <= EXOTIC_DEPOSIT_MAX) && exotic['Venus'] === EXOTIC_DEPOSIT_MAX && Object.entries(exotic).every(([b, n]) => b === 'Venus' || n < exotic['Venus']))
  check('the registry knows where they are', bodyHasDeposit(HYP, 'Mars') && !bodyHasDeposit(EXO, 'Mars') && bodyHasDeposit(EXO, 'Venus') && !bodyHasDeposit(HYP, 'Pluto') === !(hyper['Pluto'] > 0))
}

console.log('\n=== 2. Extraction needs the tech, an owned and held body, and is finite ===')
{
  fresh()
  const remaining = freshDeposits()
  const withTech = new Set(DEFAULT_RESEARCHED)
  const none = new Set<string>()
  check('the human nations start with both Extraction techs', ['hyperium-extraction', 'exotic-matter-extraction'].every((t) => DEFAULT_RESEARCHED.includes(t)) && ['hyperium-extraction', 'exotic-matter-extraction'].every((t) => findTech(t)?.category === 'engineering'))
  check('without the tech a held deposit yields nothing', Object.keys(stepExtraction(remaining, ['Mars'], none, 1).yielded).length === 0)
  const one = stepExtraction(remaining, ['Mars', 'Venus'], withTech, 1)
  check('with it each held body gives EXTRACTION_PER_MONTH of each material it holds', one.yielded.hyperium === 2 * EXTRACTION_PER_MONTH && one.yielded.exoticMatter === EXTRACTION_PER_MONTH, JSON.stringify(one.yielded))
  check('...and its deposit is counted down', one.remaining.hyperium['Mars'] === hyper['Mars'] - EXTRACTION_PER_MONTH && remaining.hyperium['Mars'] === hyper['Mars'])
  check('only the matching tech draws a material', stepExtraction(remaining, ['Venus'], new Set(['hyperium-extraction']), 1).yielded.exoticMatter === undefined && stepExtraction(remaining, ['Venus'], new Set(['exotic-matter-extraction']), 1).yielded.hyperium === undefined)
  check('a body with no deposit gives nothing', Object.keys(stepExtraction(remaining, ['Pluto', 'Moon-less nowhere'], withTech, 12).yielded).filter((k) => k === 'hyperium' && hyper['Pluto'] === undefined).length === 0)
  const batched = stepExtraction(remaining, ['Mars'], withTech, 7)
  let seq = remaining
  let total = 0
  for (let i = 0; i < 7; i++) {
    const r = stepExtraction(seq, ['Mars'], withTech, 1)
    seq = r.remaining
    total += r.yielded.hyperium ?? 0
  }
  check('months batch exactly: 7 at once is 7 one at a time', batched.yielded.hyperium === total && batched.remaining.hyperium['Mars'] === seq.hyperium['Mars'])
  const nearlyDone = { hyperium: { Mars: 1.5 }, exoticMatter: {} } as ReturnType<typeof freshDeposits>
  const last = stepExtraction(nearlyDone, ['Mars'], withTech, 3)
  check('it is capped by what remains, then stops at 0', last.yielded.hyperium === 1.5 && last.remaining.hyperium['Mars'] === 0 && Object.keys(stepExtraction(last.remaining, ['Mars'], withTech, 3).yielded).length === 0)
  check('the HUD rate is the same draw', extractionRatePerMonth(remaining, ['Mars', 'Venus'], withTech).hyperium === 2 * EXTRACTION_PER_MONTH && (extractionRatePerMonth(nearlyDone, ['Mars'], withTech).hyperium ?? 0) === 1)

  // Through the stores: owned and held.
  const held = heldDepositBodies(MARS, useTerritoryStore.getState().bodyOwner, useTerritoryStore.getState().bodyController)
  check('Mars holds its capital\'s deposit from the start', held.includes('Mars') && !held.includes('Venus'), held.join(', '))
  const got = applyExtraction(MARS, 1)
  check('a month credits its stockpile and drains the deposit', stock(MARS, 'hyperium') === (got.hyperium ?? 0) && (got.hyperium ?? 0) > 0 && useDepositStore.getState().remaining.hyperium['Mars'] === hyper['Mars'] - (got.hyperium ?? 0))
  check('Mars has no exotic matter deposit, so none comes in', (got.exoticMatter ?? 0) === 0 && stock(MARS, 'exoticMatter') === 0)
  const v = applyExtraction(VENUS, 2)
  check('Venus draws both its deposits', (v.hyperium ?? 0) === 2 * EXTRACTION_PER_MONTH && (v.exoticMatter ?? 0) === 2 * EXTRACTION_PER_MONTH && stock(VENUS, 'exoticMatter') === 2)
  useTerritoryStore.setState((s) => ({ bodyController: { ...s.bodyController, Venus: MARS } }))
  const occupied = applyExtraction(VENUS, 1)
  check('an occupier gets nothing from it and neither does the owner', Object.keys(occupied).length === 0 && stock(VENUS, 'hyperium') === 2 * EXTRACTION_PER_MONTH)
  const marsWhileHolding = applyExtraction(MARS, 1)
  check('...and Mars does not mine it either (it owns its own deposit only)', (marsWhileHolding.hyperium ?? 0) === EXTRACTION_PER_MONTH)
  useTerritoryStore.getState().reset()
  const other = applyExtraction('kingdom-of-lalande', 1)
  check('a nation with no deposit on its worlds draws nothing', COUNTRIES.find((c) => c.id === 'kingdom-of-lalande')!.capitalBodyName in hyper ? (other.hyperium ?? 0) === EXTRACTION_PER_MONTH : Object.keys(other).length === 0)
}

console.log('\n=== 3. Synthesis needs hyperium HELD, not spent ===')
{
  fresh()
  const node = findTech(HYPERIUM_SYNTHESIS_TECH_ID)!
  check('Synthesis keeps its prerequisites (Hyperspace Theory AND Exotic Matter Theory) and holds a stock of hyperium', node.category === 'engineering' && node.prerequisites.length === 1 && node.prerequisites[0].join() === 'hyperspace-theory,exotic-matter-theory' && node.resourceHold?.hyperium === HYPERIUM_SYNTHESIS_HOLD && node.resourceCost === undefined)
  check('under the hold it is blocked, with the reason', /hold 5 hyperium \(you have 3\)/.test(resourceShortfall(node, { hyperium: 3 }) ?? ''), resourceShortfall(node, { hyperium: 3 }) ?? '')
  check('a nation with none can never research it', resourceShortfall(node, { hyperium: 0 }) !== null && resourceShortfall(node, {}) !== null)
  check('at the hold it is allowed', resourceShortfall(node, { hyperium: HYPERIUM_SYNTHESIS_HOLD }) === null)

  const prereqs = [...DEFAULT_RESEARCHED, 'exotic-matter-theory']
  const setup = (hyperium: number, rp = 1000) => {
    useTechStore.setState({ byCountry: { [MARS]: { researchPoints: { physics: rp, society: 0, engineering: rp }, researched: new Set(prereqs) } }, freeResearchMode: false })
    useResourceStore.setState({ byCountry: {} })
    useResourceStore.getState().setAmount(MARS, 'hyperium', hyperium)
  }
  setup(2)
  check('researching it fails with too little, nothing spent', !useTechStore.getState().researchNode(MARS, HYPERIUM_SYNTHESIS_TECH_ID) && stock(MARS, 'hyperium') === 2 && useTechStore.getState().researchBlock(MARS, HYPERIUM_SYNTHESIS_TECH_ID) !== null)
  setup(HYPERIUM_SYNTHESIS_HOLD)
  const ok = useTechStore.getState().researchNode(MARS, HYPERIUM_SYNTHESIS_TECH_ID)
  check('with enough it researches', ok && useTechStore.getState().stateFor(MARS).researched.has(HYPERIUM_SYNTHESIS_TECH_ID))
  check('...and the hyperium is HELD, not consumed', stock(MARS, 'hyperium') === HYPERIUM_SYNTHESIS_HOLD)
  check('...but its research points are spent', useTechStore.getState().stateFor(MARS).researchPoints.physics === 1000 || useTechStore.getState().stateFor(MARS).researchPoints.engineering === 1000 - node.cost)

  // A queue: a hyperdrive Mk II (consumes 3) ahead of it can leave too little to hold.
  const pts = { physics: 1000, society: 0, engineering: 1000 }
  const have = new Set(prereqs)
  const queue = ['hyperdrive-mk2', HYPERIUM_SYNTHESIS_TECH_ID]
  check('Mk II (spends 3) before it in one batch leaves 4 < 5 held: it waits', queuedResearchNow(queue, have, pts, false, { hyperium: 7 }).join() === 'hyperdrive-mk2')
  check('with 8 both go (Mk II spends 3, 5 are still held)', queuedResearchNow(queue, have, pts, false, { hyperium: 8 }).join() === 'hyperdrive-mk2,hyperium-synthesis')
  check('on its own it goes at 5 and spends nothing in the plan', queuedResearchNow([HYPERIUM_SYNTHESIS_TECH_ID], have, pts, false, { hyperium: 5 }).join() === HYPERIUM_SYNTHESIS_TECH_ID)
  check('a blocked one does not stall the queue behind it', queuedResearchNow([HYPERIUM_SYNTHESIS_TECH_ID, 'hyperdrive-mk2'], have, pts, false, { hyperium: 4 }).join() === 'hyperdrive-mk2')
  setup(0)
  useTechStore.getState().setFreeResearchMode(true)
  check('Free Research waives the hold too (a cheat)', useTechStore.getState().researchBlock(MARS, HYPERIUM_SYNTHESIS_TECH_ID) === null && useTechStore.getState().researchNode(MARS, HYPERIUM_SYNTHESIS_TECH_ID))
  useTechStore.getState().setFreeResearchMode(false)
}

console.log('\n=== 4. Exotic matter refines into hyperium, monthly, in both modes ===')
{
  fresh()
  const def = SIMPLE_BUILDING_DEFS.exoticRefinery
  check('the Hyperium Refinery stays, behind Hyperium Synthesis', def.name === 'Hyperium Refinery' && def.requiresTech === HYPERIUM_SYNTHESIS_TECH_ID)
  check('it eats exotic matter and makes hyperium at the one rate', def.upkeep.exoticMatter === HYPERIUM_PER_REFINERY * EXOTIC_PER_HYPERIUM && def.outputs.hyperium === HYPERIUM_PER_REFINERY && (def.upkeep.exoticMatter ?? 0) / (def.outputs.hyperium ?? 1) === EXOTIC_PER_HYPERIUM)
  check('no nation starts with one built (a pre-built one could not be switched off until researched)', Object.values(SIMPLE_WORLD_SEEDS).every((w) => !w.buildings.exoticRefinery))
  check('Simple building: refused without the tech, with the reason', /Hyperium Synthesis/.test(buildingTechBlock(MARS, 'exoticRefinery') ?? '') && buildingTechBlock(MARS, 'farm') === null)
  const refused = useAbstractEconomyStore.getState().queueBuilding(MARS, 'Mars', 'exoticRefinery')
  check('...queueBuilding says so', !refused.ok && /Hyperium Synthesis/.test(refused.ok ? '' : refused.reason), refused.ok ? '' : refused.reason)
  useTechStore.setState({ byCountry: { [MARS]: { researchPoints: { physics: 0, society: 0, engineering: 0 }, researched: new Set([...DEFAULT_RESEARCHED, HYPERIUM_SYNTHESIS_TECH_ID]) } } })
  check('...and with the tech the tech is no longer what stops it', buildingTechBlock(MARS, 'exoticRefinery') === null)

  const state = { countryId: 'x', population: 0, gdp: 6000, realGdp: 6000, priceLevel: 1, inflation: 0.02, stability: 0.6, treasury: 100, reserves: 40, debt: 1000, taxRate: 0.1, economyType: 'corporatist', moneyCreation: 0, warTaxes: false, welfare: 0.3, queue: [], nextOrderId: 1, currency: { code: 'X', name: 'X', rate: 1, baseRate: 1 }, trade: {} } as AbstractEconomyState
  const world = (levels: number): WorldState => ({ bodyName: 'Home', population: 3000, slots: 80, buildings: { civilianFactory: 8, farm: 6, mine: 6, powerPlant: 6, exoticRefinery: levels } as WorldState['buildings'] })
  const st = (exoticMatter: number) => ({ ...emptyStockpile(), food: 500, minerals: 500, energy: 900, exoticMatter })
  const rich = abstractReport(state, [world(2)], st(100))
  // (a district's ecosystem bonus lifts the output a little, as it does for every building; the input is not lifted)
  check('Simple: two refinery levels turn 3 exotic matter into about 1 hyperium a month', rich.produced.hyperium >= 2 * HYPERIUM_PER_REFINERY - 1e-9 && rich.produced.hyperium < 2 * HYPERIUM_PER_REFINERY * 1.25 && Math.abs(rich.used.exoticMatter - 2 * HYPERIUM_PER_REFINERY * EXOTIC_PER_HYPERIUM) < 1e-9, `${rich.produced.hyperium} hyperium for ${rich.used.exoticMatter} exotic`)
  const dry = abstractReport(state, [world(2)], st(0))
  check('...and stops when the exotic matter runs out', dry.produced.hyperium < rich.produced.hyperium * 0.01, `${dry.produced.hyperium}`)
  const some = abstractReport(state, [world(2)], st(1.5))
  check('...partly when it runs short', some.produced.hyperium > 0 && some.produced.hyperium < rich.produced.hyperium)
  check('no refinery, no hyperium', abstractReport(state, [world(0)], st(100)).produced.hyperium === 0)

  // Complex: a nation-level step.
  const cap = COMPLEX_REFINERY_LEVELS * HYPERIUM_PER_REFINERY
  const p = stepSynthesis(100, 1)
  check('Complex: refines up to COMPLEX_REFINERY_LEVELS refineries\' worth a month, at the same rate', p.hyperium === cap && p.exoticUsed === cap * EXOTIC_PER_HYPERIUM)
  check('...capped by the exotic matter held', stepSynthesis(1.5, 1).hyperium === 1.5 / EXOTIC_PER_HYPERIUM && stepSynthesis(0, 1).hyperium === 0)
  check('...and months batch', Math.abs(stepSynthesis(100, 6).hyperium - 6 * cap) < 1e-9)
  useResourceStore.getState().setAmount(MARS, 'exoticMatter', 12)
  useTechStore.setState({ byCountry: { [MARS]: { researchPoints: { physics: 0, society: 0, engineering: 0 }, researched: new Set(DEFAULT_RESEARCHED) } } })
  applySynthesis(MARS, 1)
  check('Complex: nothing converts without Synthesis, and it says why', stock(MARS, 'hyperium') === 0 && stock(MARS, 'exoticMatter') === 12 && /Hyperium Synthesis/.test(synthesisBlock(new Set(DEFAULT_RESEARCHED), 12) ?? ''))
  useTechStore.setState({ byCountry: { [MARS]: { researchPoints: { physics: 0, society: 0, engineering: 0 }, researched: new Set([...DEFAULT_RESEARCHED, HYPERIUM_SYNTHESIS_TECH_ID]) } } })
  applySynthesis(MARS, 1)
  check('Complex: with it, a month converts exotic matter into hyperium', Math.abs(stock(MARS, 'hyperium') - cap) < 1e-9 && Math.abs(stock(MARS, 'exoticMatter') - (12 - cap * EXOTIC_PER_HYPERIUM)) < 1e-9)
  check('...and says "No exotic matter" when it is out', /No exotic matter/.test(synthesisBlock(new Set([HYPERIUM_SYNTHESIS_TECH_ID]), 0) ?? '') && synthesisBlock(new Set([HYPERIUM_SYNTHESIS_TECH_ID]), 5) === null)
}

console.log('\n=== 5. Warp research is very expensive ===')
{
  check('the table is the base x WARP_MK_RP_SCALE, strictly rising', WARP_MK_RP_COST.length === WARP_MK_RP_BASE.length && WARP_MK_RP_COST.every((c, i) => c === WARP_MK_RP_BASE[i] * WARP_MK_RP_SCALE) && WARP_MK_RP_COST.every((c, i) => i === 0 || c > WARP_MK_RP_COST[i - 1]))
  check('each Warp Drive Mk costs exactly that', WARP_DRIVE_TECH_IDS.every((id, i) => findTech(id)!.cost === WARP_MK_RP_COST[i]))
  const monthsAtMarsRate = WARP_MK_RP_COST[0] / 2.6
  check('Mk I takes decades at the engineering research Mars starts with (~2.6 a month)', monthsAtMarsRate / 12 >= 25, `${(monthsAtMarsRate / 12).toFixed(0)} years`)
  check('...much more than any Extraction or hyperdrive Mk II-III tech', WARP_MK_RP_COST[0] > findTech('hyperdrive-mk3')!.cost && WARP_MK_RP_COST[0] > findTech('hyperium-extraction')!.cost * 10)
}

console.log('\n=== 6. Material discovery ===')
{
  fresh()
  const hyperBody = Object.keys(hyper)[0]
  const surveyedNone = () => false
  check('surveying a body that holds it discovers it', materialDiscovered(HYP, (b) => b === hyperBody, 0, depositBodies()))
  check('holding any in stock discovers it', materialDiscovered(HYP, surveyedNone, 0.5, depositBodies()) && materialDiscovered(EXO, surveyedNone, 3, depositBodies()))
  check('neither does not', !materialDiscovered(HYP, surveyedNone, 0, depositBodies()) && !materialDiscovered(EXO, surveyedNone, 0, depositBodies()))
  check('surveying a body that holds another material does not discover this one', !materialDiscovered(EXO, (b) => b === hyperBody && !bodyHasDeposit(EXO, b), 0, depositBodies()))
  check('the registry lists what a given state discovers', discoveredMaterials((b) => b === 'Venus', () => 0, depositBodies()).join() === 'exoticMatter,hyperium')
  check('the registry names both materials and their Extraction techs', MATERIALS.length >= 2 && MATERIALS.every((m) => !!findTech(m.extractionTechId) && m.terms.length > 0))

  // Through the stores, latched.
  useResourceStore.getState().setAmount(MARS, 'hyperium', 0)
  useResourceStore.getState().setAmount(MARS, 'exoticMatter', 0)
  resolveMaterialDiscovery(MARS)
  const owned = Object.keys(hyper).filter((b) => useTerritoryStore.getState().bodyOwner[b] === MARS)
  // Mars owns a system part: its own bodies count as surveyed, so Sol's deposits are known.
  check('a nation owning bodies in a system with a deposit has surveyed it, so has discovered the material', owned.length > 0 && useMaterialStore.getState().discovered[MARS]?.includes(HYP) === true)
  check('...exotic matter needs an exotic body, which Mars\'s own system holds (Venus)', useMaterialStore.getState().discovered[MARS]?.includes(EXO) === true)
  useMaterialStore.setState({ discovered: {} })
  const unowned = new Set(Object.keys(hyper))
  useTerritoryStore.setState({ bodyOwner: {}, bodyController: {} })
  resolveMaterialDiscovery(MARS)
  check('with no worlds, no survey and no stock, nothing is discovered', (useMaterialStore.getState().discovered[MARS] ?? []).length === 0 && unowned.size > 0)
  useResourceStore.getState().setAmount(MARS, 'exoticMatter', 4)
  resolveMaterialDiscovery(MARS)
  check('holding exotic matter discovers it', useMaterialStore.getState().discovered[MARS]?.join() === 'exoticMatter')
  useResourceStore.getState().setAmount(MARS, 'exoticMatter', 0)
  resolveMaterialDiscovery(MARS)
  check('...and it stays discovered when the stockpile runs out (latched)', useMaterialStore.getState().discovered[MARS]?.includes(EXO) === true)
  useSurveyStore.getState().discover(MARS, { kind: 'surveyed', bodyName: hyperBody }, 0, 0)
  resolveMaterialDiscovery(MARS)
  check('surveying a hyperium body (the player\'s known layer) discovers hyperium', useMaterialStore.getState().discovered[MARS]?.includes(HYP) === true)
  check('a nation\'s discovery is its own', (useMaterialStore.getState().discovered[VENUS] ?? []).length === 0)
}

console.log('\n=== 7. Obfuscation ("???" in the research UI) ===')
{
  const none = new Set<MaterialId>()
  const both = new Set<MaterialId>(['exoticMatter', 'hyperium'])
  const names = ALL_TECHS.map((t) => t.name)
  check('an undiscovered material\'s name becomes ???', obfuscateMaterials('Hyperium Synthesis', none) === '??? Synthesis' && obfuscateMaterials('Exotic Matter Theory', none) === '??? Theory')
  check('...in a cost or requirement line', obfuscateMaterials('Needs 15 exotic matter (you have 4)', none) === 'Needs 15 ??? (you have 4)' && obfuscateMaterials('Needs to hold 5 hyperium (you have 3)', none) === 'Needs to hold 5 ??? (you have 3)')
  check('...case-insensitively, every time it appears', obfuscateMaterials('HYPERIUM, hyperium and Exotic matter', none) === '???, ??? and ???')
  check('a discovered one is left alone', obfuscateMaterials('Hyperium Synthesis', both) === 'Hyperium Synthesis' && obfuscateMaterials('Hyperium Synthesis', new Set<MaterialId>(['hyperium'])) === 'Hyperium Synthesis')
  check('...each material on its own', obfuscateMaterials('Hyperium and exotic matter', new Set<MaterialId>(['hyperium'])) === 'Hyperium and ???' && obfuscateMaterials('Hyperium and exotic matter', new Set<MaterialId>(['exoticMatter'])) === '??? and exotic matter')
  check('text naming no material comes back unchanged', obfuscateMaterials('Warp Drive Mk I builds on Warp Theory', none) === 'Warp Drive Mk I builds on Warp Theory' && obfuscateMaterials('', none) === '')
  check('...and a hyphenated form', obfuscateMaterials('exotic-matter handling and Exotic-Matter Theory', none) === '??? handling and ??? Theory')
  check('it does not eat a longer word', obfuscateMaterials('Hyperiums and hyperiumine', none) === 'Hyperiums and hyperiumine')
  const masked = names.filter((n) => obfuscateMaterials(n, none) !== n)
  check('the tech names it would change are the ones that name a material', masked.length >= 4 && masked.every((n) => /hyperium|exotic matter/i.test(n)) && masked.includes('Hyperium Synthesis') && masked.includes('Hyperium Extraction') && masked.includes('Exotic Matter Extraction'), masked.join(', '))
  check('every tech\'s prerequisites still resolve after the extraction techs were added', ALL_TECHS.every((t) => t.prerequisites.every((set) => set.every((id) => !!findTech(id)))) && prerequisitesMet(findTech('hyperium-extraction')!, new Set(DEFAULT_RESEARCHED)))
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`)
if (failures > 0) process.exit(1)
