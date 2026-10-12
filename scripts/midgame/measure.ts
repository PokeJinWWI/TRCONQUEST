// Headless midgame measurement: fast-forwards a whole game (every nation's AI,
// economy, ships, wars) and reports, year by year, how far it is from "midgame"
// (scripts/midgame/metrics.ts) and when each benchmark is hit. Changes nothing in
// the game: it only drives the exported resolvers the app's hooks drive.
//
// Run:  npx tsx scripts/midgame/measure.ts [--years 20] [--seeds 1,2,3,4,5]
//                                          [--mode abstract|complex] [--idle-player] [--json out.json]
//
// What it is NOT:
//  - Mars is the player's nation, and nothing plays the player. By default the
//    script starts the game with no player picked, so Mars is run by the same
//    strategic and economy AI as everyone else: a stand-in for "normal play".
//    --idle-player picks Mars and leaves it idle instead.
//  - Space combat is not the real arena (that steps in seconds): ships at war
//    resting in one orbit are settled once a day, the weaker side removed (the same
//    stand-in tests/ai.test.ts uses). Ground war, sieges and bombardment are real.
//  - Seeds vary jump luck only. The galaxy has one seed (GALAXY_SEED).
//  - "Met" is computed here from who shares a system (no met state exists in the
//    game yet), with no signal delay: every nation starts on Hyper Comms.
import { writeFileSync } from 'node:fs'
import { COUNTRIES } from '../../src/data/countryData'
import { galaxyEmpires } from '../../src/data/generatedEmpires'
import { SOLAR_NEIGHBORHOOD_ID, seededStream } from '../../src/data/galaxyGen'
import { SIM_DAYS_PER_INCOME_TICK } from '../../src/data/shipyardData'
const TECH_TREES = ['physics', 'society', 'engineering'] as const
import { WARP_DRIVE_TECH_IDS, HYPERDRIVE_TECH_IDS } from '../../src/data/warpData'
import { pairKey } from '../../src/data/diplomacyData'
import { usePlayerStore, type EconomyModel } from '../../src/state/playerStore'
import { useGameTimeStore } from '../../src/state/gameTimeStore'
import { useShipStore } from '../../src/state/shipStore'
import { useTerritoryStore } from '../../src/state/territoryStore'
import { useDiplomacyStore, atWar } from '../../src/state/diplomacyStore'
import { useTreatyStore, isStillBinding } from '../../src/state/treatyStore'
import { useInternationalOrgStore } from '../../src/state/internationalOrgStore'
import { useSubjectStore } from '../../src/state/subjectStore'
import { useTradePolicyStore } from '../../src/state/tradePolicyStore'
import { useStarbaseStore } from '../../src/state/starbaseStore'
import { useResourceStore } from '../../src/state/resourceStore'
import { useTechStore } from '../../src/state/techStore'
import { useAbstractEconomyStore } from '../../src/state/abstractEconomyStore'
import { useEconomyStore } from '../../src/state/economyStore'
import { useConfirmStore } from '../../src/state/confirmStore'
import { useHyperlaneStore } from '../../src/state/hyperlaneStore'
import { resetGame } from '../../src/scene/gameReset'
import { setUpNewGame } from '../../src/scene/gameSetup'
import { applyStrategicIncome, seedSimplisticStock, seedStrategicResources } from '../../src/scene/shipyardLogic'
import { applyInfluenceIncome, seedInfluence } from '../../src/scene/colonies'
import { applyExtraction, applySynthesis } from '../../src/scene/extraction'
import { applyAbstractEconomyAI } from '../../src/economy-abstract/abstractEconomyAI'
import { setJumpRoll } from '../../src/scene/shipPhysics'
import { systemOfShip } from '../../src/scene/surveyLogic'
import { bodyStarId } from '../../src/scene/territory'
import { clusterOfStar } from '../../src/scene/clusters'
import { orbitedBody } from '../../src/scene/armyLogic'
import { shipPower } from '../../src/ai/blackboard'
import { runStrategicAI } from '../../src/ai/runStrategicAI'
import { resolveCommsSignals } from '../../src/hooks/useCommsResolver'
import { resolveShipyards } from '../../src/hooks/useShipyardResolver'
import { settleShips } from '../../src/hooks/useShipOrderSettler'
import { resolveSurvey } from '../../src/hooks/useSurveyResolver'
import { resolveAutomation } from '../../src/scene/automation'
import { resolveColonies } from '../../src/hooks/useColonyResolver'
import { resolveStarbaseSieges } from '../../src/hooks/useStarbaseResolver'
import { resolveGroundWar } from '../../src/hooks/useGroundCombatResolver'
import { resolveDefenses } from '../../src/hooks/useDefenseResolver'
import { resolveBombardment } from '../../src/hooks/useBombardmentResolver'
import { resolveShipDeconstructions } from '../../src/hooks/useShipDeconstructionResolver'
import { learnFromPresence, median, midgameCount, pairOf, startingKnowledge, type MidgameCount, type SystemPresence } from './metrics'

const MARS = 'imperial-state-of-mars'
const DAYS_PER_YEAR = 365
const HOME_IDS = COUNTRIES.map((c) => c.id)

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
const YEARS = Number(arg('years', '20'))
const SEEDS = arg('seeds', '1,2,3,4,5').split(',').map(Number)
const MODE = arg('mode', 'abstract') as EconomyModel
const IDLE_PLAYER = process.argv.includes('--idle-player')
const JSON_PATH = arg('json', '')

// --- The 25 nations and where each lives -----------------------------------------
const EMPIRES = galaxyEmpires()
const NATIONS = [...HOME_IDS, ...EMPIRES.map((e) => e.id)]
const EMPIRE_CLUSTER = new Map(EMPIRES.map((e) => [e.id, e.clusterId]))
const HOME_CLUSTER = new Map(COUNTRIES.map((c) => [c.id, clusterOfStar(c.capitalStarId)]))
const clusterOf = (id: string): string => EMPIRE_CLUSTER.get(id) ?? HOME_CLUSTER.get(id) ?? SOLAR_NEIGHBORHOOD_ID
const EMPIRE_OF_STAR = new Map(EMPIRES.flatMap((e) => e.ownedStarIds.map((s) => [s, e.id] as const)))

// Who is where today: ships by system, and everything a nation has in a system.
function presence(): SystemPresence[] {
  const shipOwners = new Map<string, Set<string>>()
  const present = new Map<string, Set<string>>()
  const add = (m: Map<string, Set<string>>, sys: string, id: string) => {
    let set = m.get(sys)
    if (!set) m.set(sys, (set = new Set()))
    set.add(id)
  }
  for (const s of useShipStore.getState().ships) {
    const sys = systemOfShip(s)
    if (!sys) continue
    add(shipOwners, sys, s.ownerId)
    add(present, sys, s.ownerId)
  }
  for (const sb of useStarbaseStore.getState().starbases) add(present, sb.starId, sb.ownerId)
  for (const [body, owner] of Object.entries(useTerritoryStore.getState().bodyOwner)) {
    const star = owner ? bodyStarId(body) : undefined
    if (star) add(present, star, owner)
  }
  // A generated empire's worlds are data only today: it is "there" in every system it owns.
  for (const sys of shipOwners.keys()) {
    const empire = EMPIRE_OF_STAR.get(sys)
    if (empire) add(present, sys, empire)
  }
  return [...shipOwners.keys()].map((sys) => ({ shipOwners: shipOwners.get(sys)!, present: present.get(sys) ?? [] }))
}

// Every pair with a standing tie, and how many ties of each kind.
function ties(simDays: number): { pairs: Set<string>; byKind: Record<string, number> } {
  const pairs = new Set<string>()
  const byKind = { war: 0, treaty: 0, org: 0, subject: 0, embargo: 0 }
  for (const w of useDiplomacyStore.getState().wars) {
    pairs.add(pairOf(w.attackerId, w.defenderId))
    byKind.war++
  }
  for (const t of useTreatyStore.getState().treaties) {
    if (!isStillBinding(t, simDays)) continue
    pairs.add(pairOf(t.a, t.b))
    byKind.treaty++
  }
  for (const o of useInternationalOrgStore.getState().orgs) {
    for (let i = 0; i < o.memberIds.length; i++) {
      for (let j = i + 1; j < o.memberIds.length; j++) {
        pairs.add(pairOf(o.memberIds[i], o.memberIds[j]))
        byKind.org++
      }
    }
  }
  for (const s of useSubjectStore.getState().subjections) {
    pairs.add(pairOf(s.suzerainId, s.subjectId))
    byKind.subject++
  }
  const { embargoes } = useTradePolicyStore.getState()
  for (let i = 0; i < NATIONS.length; i++) {
    for (let j = i + 1; j < NATIONS.length; j++) {
      if (embargoes[pairKey(NATIONS[i], NATIONS[j])] === true) {
        pairs.add(pairOf(NATIONS[i], NATIONS[j]))
        byKind.embargo++
      }
    }
  }
  return { pairs, byKind }
}

// Ships at war resting in one orbit: the weaker side is removed (tests/ai.test.ts).
function crudeSpaceCombat(): void {
  const ships = useShipStore.getState().ships
  const byBody = new Map<string, typeof ships>()
  for (const s of ships) {
    const b = orbitedBody(s)
    if (b && !s.order) byBody.set(b, [...(byBody.get(b) ?? []), s])
  }
  const doomed = new Set<string>()
  for (const here of byBody.values()) {
    const owners = [...new Set(here.map((s) => s.ownerId))]
    if (owners.length < 2) continue
    const power = (o: string) => here.filter((s) => s.ownerId === o).reduce((sum, s) => sum + shipPower(s), 0)
    for (const a of owners) {
      for (const b of owners) {
        if (a >= b || !atWar(a, b)) continue
        const pa = power(a)
        const pb = power(b)
        if (pa === pb) continue
        const loser = pa < pb ? a : b
        for (const s of here) if (s.ownerId === loser) doomed.add(s.id)
      }
    }
  }
  if (doomed.size > 0) useShipStore.setState({ ships: ships.filter((s) => !doomed.has(s.id)) })
}

interface YearRow {
  year: number
  midgame: MidgameCount
  tiesByKind: Record<string, number>
  warsNow: string[]
  mars: {
    researched: number
    warpMk: number
    hyperdriveMk: number
    researchPerMonth: Record<string, number>
    hyperium: number
    exoticMatter: number
    influence: number
    refineryLevels: number
    ships: number
    starbases: number
    worlds: number
  }
  starbasesAll: number
  lanesAll: number
  shipsLostToJumps: number
  msPerMonth: number
}
interface SeedRun {
  seed: number
  years: YearRow[]
  benchmarks: Record<string, number | null>
  warLog: string[]
  errors: string[]
}

const BENCHMARKS = ['war-on-non-human-nation', 'warp-drive-mk1', 'hyperium-synthesis-1-per-month', 'starbase-in-another-cluster', 'colony-in-another-cluster', 'midgame-15-of-25'] as const

function mkOf(ids: readonly string[], researched: Set<string>): number {
  let mk = 0
  for (const id of ids) {
    if (!researched.has(id)) break
    mk++
  }
  return mk
}

function runSeed(seed: number): SeedRun {
  resetGame()
  usePlayerStore.setState({ economyModel: MODE, selectedCountryId: IDLE_PLAYER ? MARS : null, sandbox: false })
  useGameTimeStore.setState({ simDays: 0 })
  setJumpRoll(seededStream(seed, 'midgame-measure'))
  setUpNewGame()
  for (const c of COUNTRIES) {
    seedStrategicResources(c.id)
    if (MODE === 'abstract') seedSimplisticStock(c.id)
    seedInfluence(c.id)
  }

  const knows = startingKnowledge(NATIONS, clusterOf, SOLAR_NEIGHBORHOOD_ID)
  const benchmarks: Record<string, number | null> = Object.fromEntries(BENCHMARKS.map((b) => [b, null]))
  const hit = (name: (typeof BENCHMARKS)[number], day: number) => {
    if (benchmarks[name] === null) benchmarks[name] = day
  }
  const years: YearRow[] = []
  const warLog: string[] = []
  const errors: string[] = []
  const seenWars = new Set<string>()
  let lostToJumps = 0
  let seenEvents = 0
  let monthMs = 0
  let months = 0
  let hyperiumBeforeSynthesis = 0

  const step = (label: string, fn: () => void) => {
    try {
      fn()
    } catch (e) {
      const text = `${label}: ${(e as Error).message}`
      if (!errors.includes(text)) errors.push(text)
    }
  }

  for (let day = 1; day <= YEARS * DAYS_PER_YEAR; day++) {
    const t0 = performance.now()
    useGameTimeStore.setState({ simDays: day })

    if (day % SIM_DAYS_PER_INCOME_TICK === 0) {
      step('economy', () => {
        if (MODE === 'abstract') {
          const store = useAbstractEconomyStore.getState()
          const playerId = usePlayerStore.getState().selectedCountryId
          const nations = Object.keys(store.byCountry)
          store.advance(1, (s, env) => (s.countryId === playerId ? s : applyAbstractEconomyAI(s, { ...env, atWar: nations.some((o) => atWar(s.countryId, o)) })))
        } else useEconomyStore.getState().advance(1)
      })
      step('strategic resources', () => {
        for (const c of COUNTRIES) applyInfluenceIncome(c.id, 1)
        if (MODE === 'abstract') {
          for (const c of COUNTRIES) applyExtraction(c.id, 1)
        } else {
          for (const c of COUNTRIES) applyStrategicIncome(c.id, 1)
          hyperiumBeforeSynthesis = useResourceStore.getState().stateFor(MARS).amounts.hyperium ?? 0
          for (const c of COUNTRIES) applySynthesis(c.id, 1)
          if ((useResourceStore.getState().stateFor(MARS).amounts.hyperium ?? 0) - hyperiumBeforeSynthesis >= 1) hit('hyperium-synthesis-1-per-month', day)
        }
        for (const c of COUNTRIES) useTechStore.getState().processQueue(c.id)
      })
    }

    step('strategic AI', () => runStrategicAI(day))
    step('comms', () => resolveCommsSignals(day))
    step('shipyards', () => resolveShipyards(day))
    step('ship settle', () => settleShips(day))
    step('survey', () => resolveSurvey(day))
    step('automation', () => resolveAutomation(day))
    step('colonies', () => resolveColonies(day))
    step('deconstruction', () => resolveShipDeconstructions(day))
    step('space combat', crudeSpaceCombat)
    step('ground war', () => resolveGroundWar(day))
    step('starbase sieges', () => resolveStarbaseSieges(day - 1, day))
    step('defenses', () => resolveDefenses(day - 1, day))
    step('bombardment', () => resolveBombardment(day - 1, day))
    // Nothing answers a question put to the player: an idle player declines.
    if (useConfirmStore.getState() && IDLE_PLAYER) step('confirm', () => useConfirmStore.setState(useConfirmStore.getInitialState(), true))

    learnFromPresence(knows, presence())

    // Wars, as they start.
    for (const w of useDiplomacyStore.getState().wars) {
      if (seenWars.has(w.id)) continue
      seenWars.add(w.id)
      warLog.push(`d${day} (y${(day / DAYS_PER_YEAR).toFixed(1)}) ${w.attackerId} -> ${w.defenderId} [${w.tier}]`)
      if (!HOME_IDS.includes(w.attackerId) || !HOME_IDS.includes(w.defenderId)) hit('war-on-non-human-nation', day)
    }
    const events = useDiplomacyStore.getState().events
    for (const e of events.slice(Math.min(seenEvents, events.length))) {
      if (e.kind === 'ship-lost') lostToJumps++
      if (e.kind === 'peace-signed') warLog.push(`d${day} (y${(day / DAYS_PER_YEAR).toFixed(1)}) peace: ${e.text}`)
    }
    seenEvents = events.length

    // Benchmarks.
    const marsTech = useTechStore.getState().stateFor(MARS).researched
    if (marsTech.has('warp-drive-mk1')) hit('warp-drive-mk1', day)
    const owners = useTerritoryStore.getState().bodyOwner
    const marsStarbases = useStarbaseStore.getState().starbases.filter((b) => b.ownerId === MARS)
    if (marsStarbases.some((b) => clusterOfStar(b.starId) !== SOLAR_NEIGHBORHOOD_ID)) hit('starbase-in-another-cluster', day)
    const marsBodies = Object.keys(owners).filter((b) => owners[b] === MARS)
    if (marsBodies.some((b) => {
      const star = bodyStarId(b)
      return !!star && clusterOfStar(star) !== SOLAR_NEIGHBORHOOD_ID
    })) hit('colony-in-another-cluster', day)
    const marsWorlds = Object.values(useAbstractEconomyStore.getState().worlds).filter((w) => owners[w.bodyName] === MARS)
    const refineryLevels = MODE === 'abstract' ? marsWorlds.reduce((n, w) => n + ((w.buildings as Record<string, number>).exoticRefinery ?? 0), 0) : 0
    const marsReport = useAbstractEconomyStore.getState().reports[MARS]
    if (MODE === 'abstract' && marsReport && ((marsReport.produced as Record<string, number>).hyperium ?? 0) >= 1) hit('hyperium-synthesis-1-per-month', day)

    monthMs += performance.now() - t0
    if (day % SIM_DAYS_PER_INCOME_TICK === 0) months++

    if (day % DAYS_PER_YEAR === 0) {
      const t = ties(day)
      const midgame = midgameCount(NATIONS, clusterOf, knows, t.pairs)
      if (midgame.counted >= 15) hit('midgame-15-of-25', day)
      const amounts = useResourceStore.getState().stateFor(MARS).amounts as Record<string, number>
      years.push({
        year: day / DAYS_PER_YEAR,
        midgame,
        tiesByKind: t.byKind,
        warsNow: useDiplomacyStore.getState().wars.map((w) => `${w.attackerId}>${w.defenderId}`),
        mars: {
          researched: marsTech.size,
          warpMk: mkOf(WARP_DRIVE_TECH_IDS, marsTech),
          hyperdriveMk: mkOf(HYPERDRIVE_TECH_IDS, marsTech),
          researchPerMonth: Object.fromEntries(TECH_TREES.map((tree) => [tree, Math.round(((marsReport?.researchByTree as Record<string, number> | undefined)?.[tree] ?? 0) * 10) / 10])),
          hyperium: Math.round((amounts.hyperium ?? 0) * 10) / 10,
          exoticMatter: Math.round((amounts.exoticMatter ?? 0) * 10) / 10,
          influence: Math.round(amounts.influence ?? 0),
          refineryLevels,
          ships: useShipStore.getState().ships.filter((s) => s.ownerId === MARS).length,
          starbases: marsStarbases.length,
          worlds: marsBodies.length,
        },
        starbasesAll: useStarbaseStore.getState().starbases.length,
        lanesAll: useHyperlaneStore.getState().allLanes().length,
        shipsLostToJumps: lostToJumps,
        msPerMonth: months > 0 ? Math.round(monthMs / months) : 0,
      })
      monthMs = 0
      months = 0
    }
  }
  return { seed, years, benchmarks, warLog, errors }
}

// --- Report ----------------------------------------------------------------------
const pad = (v: string | number, n: number) => String(v).padStart(n)
function printRun(run: SeedRun): void {
  console.log(`\n=== seed ${run.seed} (${MODE}${IDLE_PLAYER ? ', idle player' : ', Mars AI-piloted'}) ===`)
  console.log('  yr | counted/25 | met 1-sided active | outside tied | ties w/t/o/s/e | Mars tech warp hyp | res/mo P/S/E     | hyperium exotic infl | refin ships SB worlds | SB-all lanes lost | ms/mo')
  for (const y of run.years) {
    const m = y.midgame
    const k = y.tiesByKind
    const r = y.mars.researchPerMonth
    console.log(
      `  ${pad(y.year, 2)} | ${pad(m.counted, 5)}/${m.nations}   | ${pad(m.metPairs, 3)} ${pad(m.oneSidedPairs, 7)} ${pad(m.activePairs, 6)} | ${pad(m.withOutsideContact, 7)} ${pad(m.withActiveTie, 4)} | ${pad(`${k.war}/${k.treaty}/${k.org}/${k.subject}/${k.embargo}`, 14)} | ${pad(y.mars.researched, 9)} ${pad(y.mars.warpMk, 4)} ${pad(y.mars.hyperdriveMk, 3)} | ${pad(`${r.physics ?? 0}/${r.society ?? 0}/${r.engineering ?? 0}`, 16)} | ${pad(y.mars.hyperium, 8)} ${pad(y.mars.exoticMatter, 6)} ${pad(y.mars.influence, 4)} | ${pad(y.mars.refineryLevels, 5)} ${pad(y.mars.ships, 5)} ${pad(y.mars.starbases, 2)} ${pad(y.mars.worlds, 6)} | ${pad(y.starbasesAll, 6)} ${pad(y.lanesAll, 5)} ${pad(y.shipsLostToJumps, 4)} | ${pad(y.msPerMonth, 5)}`,
    )
  }
  console.log('  benchmarks (first day hit):')
  for (const b of BENCHMARKS) {
    const d = run.benchmarks[b]
    console.log(`    ${b}: ${d === null ? 'not reached' : `day ${d} (year ${(d / DAYS_PER_YEAR).toFixed(1)})`}`)
  }
  console.log(`  wars and peaces (${run.warLog.length}):`)
  for (const line of run.warLog.slice(0, 40)) console.log(`    ${line}`)
  if (run.warLog.length > 40) console.log(`    ... ${run.warLog.length - 40} more`)
  if (run.errors.length > 0) {
    console.log('  ERRORS (each printed once; that step was skipped on the days it threw):')
    for (const e of run.errors) console.log(`    ${e}`)
  }
}

const runs: SeedRun[] = []
for (const seed of SEEDS) {
  const t0 = performance.now()
  const run = runSeed(seed)
  runs.push(run)
  printRun(run)
  console.log(`  wall clock: ${((performance.now() - t0) / 1000).toFixed(1)} s`)
}

console.log(`\n=== median over ${runs.length} seed(s) ===`)
console.log('  yr | counted/25 | met pairs | active pairs | Mars tech | Mars hyperium | Mars exotic | Mars starbases')
for (let i = 0; i < YEARS; i++) {
  const at = runs.map((r) => r.years[i]).filter(Boolean)
  if (at.length === 0) continue
  const med = (f: (y: YearRow) => number) => median(at.map(f))
  console.log(
    `  ${pad(i + 1, 2)} | ${pad(med((y) => y.midgame.counted), 10)} | ${pad(med((y) => y.midgame.metPairs), 9)} | ${pad(med((y) => y.midgame.activePairs), 12)} | ${pad(med((y) => y.mars.researched), 9)} | ${pad(med((y) => y.mars.hyperium), 13)} | ${pad(med((y) => y.mars.exoticMatter), 11)} | ${pad(med((y) => y.mars.starbases), 14)}`,
  )
}
console.log('  benchmarks, seeds that reached each (median year among those):')
for (const b of BENCHMARKS) {
  const days = runs.map((r) => r.benchmarks[b]).filter((d): d is number => d !== null)
  console.log(`    ${b}: ${days.length}/${runs.length}${days.length ? ` (year ${(median(days) / DAYS_PER_YEAR).toFixed(1)})` : ''}`)
}

if (JSON_PATH) {
  writeFileSync(JSON_PATH, JSON.stringify({ mode: MODE, idlePlayer: IDLE_PLAYER, years: YEARS, seeds: SEEDS, runs }, null, 2))
  console.log(`\nwrote ${JSON_PATH}`)
}
process.exit(0)
