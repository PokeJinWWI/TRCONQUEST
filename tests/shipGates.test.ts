// Research-gated ships: the warship ladder (Corvette free, Frigate -> Destroyer ->
// Cruiser -> Battleship each a tech), the dev-only hulls (Swift Courier, Star Jumper),
// the scout line (Hyperspace Scout upgrades into a Turing Scout), the shipyard list
// order, the AI obeying the same gates, and Hyperspace Theory's hyperium shortcut.
//
// Run:  npx tsx tests/shipGates.test.ts

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  BATTLESHIP_TECH_ID,
  CRUISER_TECH_ID,
  DESTROYER_TECH_ID,
  DEV_SHIP_CLASSES,
  FRIGATE_TECH_ID,
  HYPERSPACE_SCOUT_TECH_ID,
  PLAYER_SHIP_CLASSES,
  SCOUT_COST_FACTOR,
  SHIP_CLASSES,
  TURING_HYPERDRIVE_COOLDOWN_DAYS,
  TURING_SCOUT_TECH_ID,
  type HyperDrive,
} from '../src/data/shipData'
import { chassisAvailable, designToShipClass, HULL_CHASSES, type ShipDesign } from '../src/data/hullChassis'
import { emptyLoadout } from '../src/data/hullChassis'
import { shipBuildCost, shipBuildDays } from '../src/data/shipyardData'
import {
  AUTONOMOUS_NAVIGATION_RP_COST,
  HULL_TECH_RP_COST,
  HYPERSPACE_SHORTCUT_HYPERIUM,
  HYPERSPACE_SHORTCUT_RP_COST,
  HYPERSPACE_THEORY_RP_COST,
  canResearch,
  findTech,
  researchTerms,
} from '../src/data/techData'
import { AI_RESEARCH_PATH, AI_WARSHIP_ROTATION } from '../src/data/aiData'
import { STARTING_NAVY } from '../src/data/startingForces'
import { SCENARIOS } from '../src/data/scenarios'
import { RESOURCE_TYPES, type ResourceId } from '../src/data/resourceData'
import { COUNTRIES } from '../src/data/countryData'
import { resolveShipClass } from '../src/state/shipClassResolver'
import { useShipyardStore } from '../src/state/shipyardStore'
import { useResourceStore } from '../src/state/resourceStore'
import { useTechStore } from '../src/state/techStore'
import { useShipStore } from '../src/state/shipStore'
import { usePlayerStore } from '../src/state/playerStore'
import { useArmyStore } from '../src/state/armyStore'
import { useTerritoryStore } from '../src/state/territoryStore'
import { useDiplomacyStore } from '../src/state/diplomacyStore'
import { useAiStore } from '../src/ai/aiStore'
import { useDefenseStore } from '../src/state/defenseStore'
import { useBombardmentStore } from '../src/state/bombardmentStore'
import { useSurveyStore } from '../src/state/surveyStore'
import { useStarbaseStore } from '../src/state/starbaseStore'
import { useHyperlaneStore } from '../src/state/hyperlaneStore'
import { applyStrategicIncome, seedStrategicResources, shipyardRows, spawnOwnedShip, techBlock } from '../src/scene/shipyardLogic'
import { upgradeCost } from '../src/scene/shipUpgrade'
import { setUpNewGame } from '../src/scene/gameSetup'
import { resolveShipyards } from '../src/hooks/useShipyardResolver'
import { resolveCommsSignals } from '../src/hooks/useCommsResolver'
import { runStrategicAI } from '../src/ai/runStrategicAI'
import { buildBlackboard } from '../src/ai/blackboard'
import { captureSnapshot } from '../src/ai/snapshot'
import { shipwright, affordable } from '../src/ai/shipwright'
import { pickResearch } from '../src/ai/expander'
import { INITIAL_AI_MEMORY } from '../src/ai/types'
import { setJumpRoll } from '../src/scene/shipPhysics'
import { seededStream } from '../src/data/galaxyGen'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const MARS = 'imperial-state-of-mars'
const LALANDE = 'kingdom-of-lalande'
const ZERO = Object.fromEntries(RESOURCE_TYPES.map((r) => [r.id, 0])) as Record<ResourceId, number>
const RICH = { ...ZERO, alloys: 1e6, energy: 1e6, hyperium: 1e6, special: 1e6 } as Record<ResourceId, number>
const cls = (id: string) => SHIP_CLASSES.find((c) => c.id === id)!

function reset(researched: string[] = [], amounts: Partial<Record<ResourceId, number>> = RICH) {
  useResourceStore.setState({ byCountry: { [MARS]: { amounts: { ...ZERO, ...amounts }, monthlyDelta: { ...ZERO } } } })
  useShipyardStore.setState({ ordersByCountry: {} })
  useTechStore.setState({ byCountry: { [MARS]: { researchPoints: { physics: 0, society: 0, engineering: 0 }, researched: new Set(researched) } } })
}
const queue = (classId: string) => useShipyardStore.getState().queueBuild(MARS, classId, 0)

console.log('\n=== 1. The warship ladder ===')
{
  const ladder: [string, string, number][] = [
    ['frigate', FRIGATE_TECH_ID, HULL_TECH_RP_COST.frigate],
    ['destroyer', DESTROYER_TECH_ID, HULL_TECH_RP_COST.destroyer],
    ['cruiser', CRUISER_TECH_ID, HULL_TECH_RP_COST.cruiser],
    ['battleship', BATTLESHIP_TECH_ID, HULL_TECH_RP_COST.battleship],
  ]
  check('the Corvette needs no tech: the only warship open at the start', cls('corvette').requiresTech === undefined && PLAYER_SHIP_CLASSES.filter((c) => c.role === 'warship' && !c.requiresTech).map((c) => c.id).join() === 'corvette')
  reset([])
  check('a Corvette builds with no research', queue('corvette').ok)
  for (const [id, tech, rp] of ladder) {
    reset([])
    const refused = queue(id)
    check(`${id}: refused without ${tech}`, !refused.ok && refused.reason.includes(findTech(tech)!.name), refused.ok ? '' : refused.reason)
    check(`${id}: techBlock names the tech`, techBlock(cls(id), new Set()) === findTech(tech)!.name)
    reset([tech])
    check(`${id}: builds once ${tech} is researched`, queue(id).ok)
    const node = findTech(tech)!
    check(`${tech}: an Engineering tech costing ${rp}, in line with the tree (60-320)`, node.category === 'engineering' && node.cost === rp && rp >= 60 && rp <= 320)
  }
  check('...each hull needs the one before it (strict chain)', findTech(DESTROYER_TECH_ID)!.prerequisites[0][0] === FRIGATE_TECH_ID && findTech(CRUISER_TECH_ID)!.prerequisites[0][0] === DESTROYER_TECH_ID && findTech(BATTLESHIP_TECH_ID)!.prerequisites[0][0] === CRUISER_TECH_ID)
  const have = new Set(['classical-mechanics', 'orbital-mechanics'])
  check('...so Destroyer Hulls cannot be researched before Frigate Hulls', !canResearch(findTech(DESTROYER_TECH_ID)!, have, 1e6) && canResearch(findTech(FRIGATE_TECH_ID)!, have, 1e6))
  check('...and a Battleship tech needs the whole ladder', !canResearch(findTech(BATTLESHIP_TECH_ID)!, new Set([...have, FRIGATE_TECH_ID, DESTROYER_TECH_ID]), 1e6))
  check('...the tech has no other effect: only the shipData/hullChassis gates read it', ladder.every(([, tech]) => !findTech(tech)!.resourceCost && !findTech(tech)!.resourceHold))

  // The Ship Builder's chassis follow the same gates.
  const chassisOf = (id: string) => HULL_CHASSES.find((c) => c.id === id)!
  check('each larger chassis carries its hull\'s tech', ladder.every(([id, tech]) => chassisOf(`${id}-hull`).requiresTech === tech) && !chassisOf('corvette-hull').requiresTech && !chassisOf('civilian-hull').requiresTech)
  check('the New Design picker offers only the Civilian and Corvette chassis at the start', chassisAvailable(new Set()).map((c) => c.id).join() === 'civilian-hull,corvette-hull')
  check('...and the Frigate chassis once Frigate Hulls is researched', chassisAvailable(new Set([FRIGATE_TECH_ID])).some((c) => c.id === 'frigate-hull') && !chassisAvailable(new Set([FRIGATE_TECH_ID])).some((c) => c.id === 'destroyer-hull'))
  const design = (chassisId: string): ShipDesign => ({ id: `d-${chassisId}`, name: chassisId, chassisId, equipped: emptyLoadout(chassisOf(chassisId)), powerTier: 1 })
  check('a design on a gated chassis becomes a class with the same gate', designToShipClass(design('cruiser-hull'), chassisOf('cruiser-hull')).requiresTech === CRUISER_TECH_ID && designToShipClass(design('corvette-hull'), chassisOf('corvette-hull')).requiresTech === undefined)
  reset([])
  check('...so the shipyard refuses it until researched', techBlock(designToShipClass(design('cruiser-hull'), chassisOf('cruiser-hull')), new Set()) === findTech(CRUISER_TECH_ID)!.name)

  check('the start fleet is corvettes and the transport only', STARTING_NAVY.every((id) => id === 'corvette' || id === 'troop-transport') && STARTING_NAVY.includes('troop-transport'))
}

console.log('\n=== 2. Dev-only hulls ===')
{
  check('exactly the Swift Courier and the Star Jumper are dev-only', DEV_SHIP_CLASSES.map((c) => c.id).sort().join() === 'star-jumper,swift-courier')
  check('they stay in SHIP_CLASSES (resolvable, tests keep working)', !!resolveShipClass('swift-courier') && !!resolveShipClass('star-jumper'))
  check('...but not in PLAYER_SHIP_CLASSES', PLAYER_SHIP_CLASSES.every((c) => !c.devOnly) && PLAYER_SHIP_CLASSES.length === SHIP_CLASSES.length - 2)
  reset([], RICH)
  check('the shipyard refuses to build one', !queue('swift-courier').ok && !queue('star-jumper').ok && useShipyardStore.getState().ordersFor(MARS).length === 0)
  const allResearched = new Set(SHIP_CLASSES.flatMap((c) => (c.requiresTech ? [c.requiresTech] : [])))
  const rowIds = (classes: typeof SHIP_CLASSES) => shipyardRows(classes, allResearched, resolveShipClass).map((c) => c.id)
  check('shipyard rows drop them even handed the whole roster', !rowIds(SHIP_CLASSES).includes('swift-courier') && !rowIds(SHIP_CLASSES).includes('star-jumper'))
  check('no start fleet, scenario or AI rotation names one', [...STARTING_NAVY, ...AI_WARSHIP_ROTATION, ...SCENARIOS.flatMap((s) => s.ships.map((sh) => sh.classId))].every((id) => !resolveShipClass(id)?.devOnly))
  check('the AI never counts one as buildable', !affordable('swift-courier', RICH, { has: () => true }) && !affordable('star-jumper', RICH, { has: () => true }))
  // Every list in the UI reads PLAYER_SHIP_CLASSES; only the Debug Console reads the full list, labelled.
  const bare = /(?<![A-Z_])SHIP_CLASSES\b/
  const offenders: string[] = []
  for (const dir of ['src/components', 'src/scene', 'src/hooks', 'src/ai']) {
    for (const f of readdirSync(dir)) {
      if (!/\.tsx?$/.test(f) || f === 'DebugConsole.tsx') continue
      if (bare.test(readFileSync(join(dir, f), 'utf8').replace(/\/\/.*$/gm, ''))) offenders.push(`${dir}/${f}`)
    }
  }
  check('no UI, scene or AI file lists the unfiltered SHIP_CLASSES', offenders.length === 0, offenders.join(', '))
  const debug = readFileSync('src/components/DebugConsole.tsx', 'utf8')
  check('the Debug Console lists them, labelled dev-only', /SHIP_CLASSES,/.test(debug) && debug.includes("(dev-only)") && debug.includes('c.devOnly'))
}

console.log('\n=== 3. The scout line ===')
{
  const science = cls('science-ship')
  const hyper = cls('hyperspace-scout')
  const turing = cls('turing-scout')
  const sc = shipBuildCost(science)
  const hc = shipBuildCost(hyper)
  check('a Hyperspace Scout is gated behind hyperspace tech', hyper.requiresTech === HYPERSPACE_SCOUT_TECH_ID && !!findTech(HYPERSPACE_SCOUT_TECH_ID))
  check('...and cheaper than a Science Ship (alloys, energy, build time)', (hc.alloys ?? 0) < (sc.alloys ?? 0) && (hc.energy ?? 0) < (sc.energy ?? 0) && shipBuildDays(hyper) <= shipBuildDays(science), `${hc.alloys}/${hc.energy} vs ${sc.alloys}/${sc.energy}`)
  check('...by the named factor, with the drive\'s hyperium undiscounted', hc.alloys === Math.round((sc.alloys ?? 0) * SCOUT_COST_FACTOR) && hc.hyperium === sc.hyperium)
  check('the Turing Scout is the next level of the same line, behind a further tech', hyper.upgradesTo === 'turing-scout' && turing.requiresTech === TURING_SCOUT_TECH_ID && TURING_SCOUT_TECH_ID !== HYPERSPACE_SCOUT_TECH_ID && findTech(TURING_SCOUT_TECH_ID)!.cost === AUTONOMOUS_NAVIGATION_RP_COST)
  const drive = turing.ftlDrives[0] as HyperDrive
  check('Turing keeps its 0% loss override and 7-day cooldown', drive.lossChanceOverride === 0 && drive.cooldownDays === TURING_HYPERDRIVE_COOLDOWN_DAYS && TURING_HYPERDRIVE_COOLDOWN_DAYS === 7)
  check('Turing still needs one rare core', shipBuildCost(turing).special === 1 && shipBuildCost(hyper).special === undefined)

  check('the upgrade costs exactly the difference: one special core', JSON.stringify(upgradeCost(hyper, turing)) === JSON.stringify({ special: 1 }))

  // One row per line in the shipyard.
  const scouts = [hyper, turing]
  const none = new Set([HYPERSPACE_SCOUT_TECH_ID])
  check('before the further tech: the Hyperspace Scout builds, the Turing Scout waits at the bottom', shipyardRows(scouts, none, resolveShipClass).map((c) => c.id).join() === 'hyperspace-scout,turing-scout' && techBlock(turing, none) === findTech(TURING_SCOUT_TECH_ID)!.name)
  const both = new Set([HYPERSPACE_SCOUT_TECH_ID, TURING_SCOUT_TECH_ID])
  check('after it: one row, the Turing Scout (the line moved up)', shipyardRows(scouts, both, resolveShipClass).map((c) => c.id).join() === 'turing-scout')
  // (The upgrade itself, a slip order that keeps the ship, is tests/shipUpgrade.test.ts.)
}

console.log('\n=== 4. The shipyard list order ===')
{
  const researched = new Set([FRIGATE_TECH_ID, CRUISER_TECH_ID])
  const warships = PLAYER_SHIP_CLASSES.filter((c) => c.role === 'warship')
  const rows = shipyardRows(warships, researched, resolveShipClass).map((c) => c.id)
  check('unlocked hulls first, in their stable order', rows.slice(0, 3).join() === 'frigate,cruiser,corvette'.split(',').sort((a, b) => warships.findIndex((c) => c.id === a) - warships.findIndex((c) => c.id === b)).join(), rows.join())
  check('tech-locked hulls at the bottom, in their stable order', rows.slice(3).join() === 'destroyer,battleship', rows.join())
  check('nothing is dropped or added', rows.length === warships.length)
  check('with nothing researched: the Corvette alone on top, the ladder below in order', shipyardRows(warships, new Set(), resolveShipClass).map((c) => c.id).join() === 'corvette,frigate,destroyer,cruiser,battleship')
  check('every locked row has a "needs <tech>" reason', warships.filter((c) => techBlock(c, new Set())).every((c) => (techBlock(c, new Set()) ?? '').length > 0))
  const panel = readFileSync('src/components/ShipyardPanel.tsx', 'utf8')
  check('the panel renders it as "Can\'t build: needs <tech>" through the same rows', panel.includes('shipyardRows(') && panel.includes('`needs ${techMissing}`') && panel.includes("Can't build: {reason}"))
}

console.log('\n=== 5. The AI obeys the same gates ===')
{
  check('the AI research path holds the three hulls it rotates, prerequisite-closed', ['frigate-hulls', 'destroyer-hulls', 'cruiser-hulls'].every((t) => AI_RESEARCH_PATH.includes(t as never)) && AI_RESEARCH_PATH.every((id) => findTech(id)!.prerequisites.every((set) => set.some((p) => AI_RESEARCH_PATH.includes(p as never) || ['extradimensional-physics', 'relativity', 'hyperspace-theory'].includes(p)))))
  check('...in ladder order, before Hyperdrive Mk II', AI_RESEARCH_PATH.indexOf('frigate-hulls') < AI_RESEARCH_PATH.indexOf('destroyer-hulls') && AI_RESEARCH_PATH.indexOf('destroyer-hulls') < AI_RESEARCH_PATH.indexOf('cruiser-hulls') && AI_RESEARCH_PATH.indexOf('cruiser-hulls') < AI_RESEARCH_PATH.indexOf('hyperdrive-mk2'))

  const JUMP_SEED = 1
  setJumpRoll(seededStream(JUMP_SEED, 'ship-gates'))
  const freshWorld = () => {
    useHyperlaneStore.setState({ lanes: {} })
    useShipStore.setState({ ships: [] })
    useArmyStore.getState().reset()
    useTerritoryStore.getState().reset()
    useDiplomacyStore.getState().reset()
    useAiStore.getState().reset()
    useShipyardStore.setState({ ordersByCountry: {} })
    useResourceStore.setState({ byCountry: {} })
    useDefenseStore.setState({ installations: [] })
    useBombardmentStore.setState({ devastation: {}, strikes: [] })
    useTechStore.setState({ byCountry: {} })
    useSurveyStore.setState({ discovered: {}, known: {}, reports: [] })
    useStarbaseStore.setState({ starbases: [] })
    usePlayerStore.setState({ selectedCountryId: LALANDE })
    setUpNewGame()
    for (const c of COUNTRIES) seedStrategicResources(c.id)
  }

  freshWorld()
  const planned = shipwright(buildBlackboard(MARS, captureSnapshot(0)), captureSnapshot(0), INITIAL_AI_MEMORY).intents.filter((i) => i.kind === 'build-ship')
  check('at the start the AI builds only Corvettes (and transports), never a locked hull', planned.length > 0 && planned.every((i) => i.kind === 'build-ship' && (i.classId === 'corvette' || i.classId === 'troop-transport')), JSON.stringify(planned))
  check('...a locked hull is not "affordable" to it however rich it is', !affordable('frigate', RICH, { has: () => false }) && affordable('frigate', RICH, { has: (t) => t === FRIGATE_TECH_ID }))
  useTechStore.setState({ byCountry: { [MARS]: { researchPoints: { physics: 40, society: 0, engineering: 0 }, researched: new Set(['warp-theory', 'warp-comms', 'hyperspace-theory', 'hyperdrive-mk1']) } } })
  check('pickResearch walks the path (Classical Mechanics first)', pickResearch(buildBlackboard(MARS, captureSnapshot(0))) === 'classical-mechanics')
  useTechStore.setState({ byCountry: { [MARS]: { researchPoints: { physics: 0, society: 0, engineering: 1000 }, researched: new Set(['warp-theory', 'warp-comms', 'hyperspace-theory', 'hyperdrive-mk1', 'classical-mechanics', 'orbital-mechanics', 'orbital-construction']) } } })
  check('...and after Orbital Construction, Frigate Hulls', pickResearch(buildBlackboard(MARS, captureSnapshot(0))) === 'frigate-hulls')

  // A headless run: three AI nations with research income still field the whole ladder, and never queue a locked hull.
  freshWorld()
  const aiIds = [MARS, 'republic-of-venus', 'orion-republic']
  const queuedLocked: string[] = []
  const classesBuilt = new Set<string>()
  const stop = useShipyardStore.subscribe((now, before) => {
    for (const owner of Object.keys(now.ordersByCountry)) {
      for (const o of now.ordersByCountry[owner]) {
        if ((before.ordersByCountry[owner] ?? []).some((x) => x.id === o.id)) continue
        const c = resolveShipClass(o.classId)!
        if (techBlock(c, useTechStore.getState().stateFor(owner).researched)) queuedLocked.push(`${owner}:${o.classId}`)
        classesBuilt.add(o.classId)
      }
    }
  })
  for (let day = 1; day <= 2400; day++) {
    if (day % 30 === 0) {
      for (const c of COUNTRIES) applyStrategicIncome(c.id, 1)
      for (const id of aiIds) {
        useTechStore.getState().grantResearch(id, 'physics', 25)
        useTechStore.getState().grantResearch(id, 'engineering', 25)
      }
    }
    // Halfway, every AI navy is lost (as in a war): the rebuilt one comes from the rotation,
    // and by now the whole ladder is researched. (At peace the AI stops at its warship target,
    // which the corvettes it starts with already meet, so it would never need to build more.)
    if (day === 1500) useShipStore.setState({ ships: useShipStore.getState().ships.filter((sh) => !(aiIds.includes(sh.ownerId) && resolveShipClass(sh.classId)!.role === 'warship')) })
    runStrategicAI(day)
    resolveCommsSignals(day)
    resolveShipyards(day)
    // Nothing fights here: keep the hulls (and the stockpile's hyperium) from running out by topping hyperium up.
    if (day % 30 === 0) for (const id of aiIds) useResourceStore.getState().addAmount(id, 'hyperium', 2)
  }
  stop()
  const researched = (id: string) => useTechStore.getState().stateFor(id).researched
  check('no AI nation ever queued a hull it had not researched', queuedLocked.length === 0, queuedLocked.slice(0, 3).join(', '))
  check('the AI still builds warships (Corvettes first)', classesBuilt.has('corvette'))
  check('...and, rebuilding a lost navy once they are researched, the ladder hulls too', ['frigate', 'destroyer', 'cruiser'].every((h) => classesBuilt.has(h)), [...classesBuilt].join(','))
  check('...every AI nation reached Cruiser Hulls', aiIds.every((id) => researched(id).has('cruiser-hulls')), aiIds.map((id) => researched(id).has('cruiser-hulls')).join())
  check('...none of them built the Battleship or a dev hull', !classesBuilt.has('battleship') && !classesBuilt.has('swift-courier') && !classesBuilt.has('star-jumper'))
  setJumpRoll(seededStream(JUMP_SEED, 'ai-test'))
}

console.log('\n=== 6. Hyperspace Theory: the long way and the shortcut ===')
{
  const node = findTech('hyperspace-theory')!
  check('the plain cost is the wall', node.cost === HYPERSPACE_THEORY_RP_COST && HYPERSPACE_THEORY_RP_COST === 200_000 && researchTerms(node).cost === 200_000)
  check('the shortcut is the old 120 points plus 5 hyperium', node.shortcut?.cost === HYPERSPACE_SHORTCUT_RP_COST && HYPERSPACE_SHORTCUT_RP_COST === 120 && HYPERSPACE_SHORTCUT_HYPERIUM === 5 && researchTerms(node, true).resourceCost.hyperium === 5)
  const have = new Set(['extradimensional-physics'])
  check('120 points do not buy the long way, but do the shortcut', !canResearch(node, have, 120) && canResearch(node, have, 120, false, true))
  check('...which still needs its prerequisite', !canResearch(node, new Set(), 1e6, false, true))

  // A nation without it: the shortcut consumes the points and the hyperium.
  useResourceStore.setState({ byCountry: { [MARS]: { amounts: { ...ZERO, hyperium: 4 }, monthlyDelta: { ...ZERO } } } })
  useTechStore.setState({ byCountry: { [MARS]: { researchPoints: { physics: 200, society: 0, engineering: 0 }, researched: new Set(['extradimensional-physics']) } } })
  check('4 hyperium is not enough: the shortcut is blocked and nothing is spent', useTechStore.getState().researchBlock(MARS, 'hyperspace-theory', true) !== null && !useTechStore.getState().researchNode(MARS, 'hyperspace-theory', true) && useTechStore.getState().stateFor(MARS).researchPoints.physics === 200)
  check('...and the long way is out of reach', !useTechStore.getState().researchNode(MARS, 'hyperspace-theory'))
  useResourceStore.getState().addAmount(MARS, 'hyperium', 1)
  check('with 5 hyperium the shortcut works', useTechStore.getState().researchNode(MARS, 'hyperspace-theory', true) && useTechStore.getState().stateFor(MARS).researched.has('hyperspace-theory'))
  check('...paying 120 points and the 5 hyperium', useTechStore.getState().stateFor(MARS).researchPoints.physics === 80 && useResourceStore.getState().stateFor(MARS).amounts.hyperium === 0)
  check('the nations still START with it (it is only a wall for a nation without it)', new Set(useTechStore.getState().stateFor('some-fresh-nation').researched).has('hyperspace-theory'))
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`)
process.exit(failures === 0 ? 0 : 1)
