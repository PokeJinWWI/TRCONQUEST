// The ship availability rules in one place: the warship gates, dev-only exclusion, the
// scout line (best researched level, explore only, cheaper than a Science Ship) and the
// AI obeying the same gates. (tests/shipGates.test.ts covers the same ground in more
// depth: ordering, refit, headless AI campaign.)
//
// Run:  npx tsx tests/shipLine.test.ts

import { PLAYER_SHIP_CLASSES, SHIP_CLASSES } from '../src/data/shipData'
import { chassisAvailable } from '../src/data/hullChassis'
import { shipBuildCost } from '../src/data/shipyardData'
import { HULL_TECH_RP_COST, canResearch, findTech } from '../src/data/techData'
import { AI_RESEARCH_PATH, AI_WARSHIP_ROTATION } from '../src/data/aiData'
import { RESOURCE_TYPES, type ResourceId } from '../src/data/resourceData'
import { resolveShipClass } from '../src/state/shipClassResolver'
import { useShipyardStore } from '../src/state/shipyardStore'
import { useResourceStore } from '../src/state/resourceStore'
import { useTechStore } from '../src/state/techStore'
import { useShipStore } from '../src/state/shipStore'
import { useSurveyStore } from '../src/state/surveyStore'
import { bestLevelClass, shipyardRows, spawnOwnedShip, techBlock } from '../src/scene/shipyardLogic'
import { applyShipCommand, commandRole } from '../src/scene/shipCommands'
import { isExplored } from '../src/scene/surveyLogic'
import { resolveSurvey } from '../src/hooks/useSurveyResolver'
import { affordable } from '../src/ai/shipwright'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const MARS = 'imperial-state-of-mars'
const ZERO = Object.fromEntries(RESOURCE_TYPES.map((r) => [r.id, 0])) as Record<ResourceId, number>
const set = (...ids: string[]) => new Set(ids)
function reset(researched: string[]) {
  useResourceStore.setState({ byCountry: { [MARS]: { amounts: { ...ZERO, alloys: 1e6, energy: 1e6, hyperium: 1e6, special: 1e6 }, monthlyDelta: { ...ZERO } } } })
  useShipyardStore.setState({ ordersByCountry: {} })
  useTechStore.setState({ byCountry: { [MARS]: { researchPoints: { physics: 0, society: 0, engineering: 0 }, researched: new Set(researched) } } })
}
const build = (id: string) => useShipyardStore.getState().queueBuild(MARS, id, 0)

console.log('\n=== 1. Gating: Corvette only, then a chain ===')
{
  const chain: [string, string][] = [['frigate', 'frigate-hulls'], ['destroyer', 'destroyer-hulls'], ['cruiser', 'cruiser-hulls'], ['battleship', 'battleship-hulls']]
  reset([])
  check('a fresh nation can build exactly one warship: the Corvette', build('corvette').ok && chain.every(([id]) => !build(id).ok))
  let have: string[] = []
  for (const [i, [hull, tech]] of chain.entries()) {
    reset(have)
    check(`${hull}: still locked`, !build(hull).ok && techBlock(resolveShipClass(hull)!, new Set(have)) === findTech(tech)!.name)
    have = [...have, tech]
    reset(have)
    check(`...researching ${tech} unlocks it, and only it`, build(hull).ok && chain.slice(i + 1).every(([next]) => !build(next).ok))
  }
  check('the techs are Engineering, costed by named constants, each needing the one before', chain.every(([hull, tech], i) => { const n = findTech(tech)!; return n.category === 'engineering' && n.cost === HULL_TECH_RP_COST[hull as keyof typeof HULL_TECH_RP_COST] && (i === 0 || n.prerequisites[0][0] === chain[i - 1][1]) }))
  check('...and cannot be researched out of order', !canResearch(findTech('cruiser-hulls')!, set('orbital-mechanics', 'frigate-hulls'), 1e6))
  check('Ship Builder chassis follow the same gates', chassisAvailable(set()).map((c) => c.id).join() === 'civilian-hull,corvette-hull' && chain.every(([hull, tech]) => chassisAvailable(set(tech)).some((c) => c.id === `${hull}-hull`)))
}

console.log('\n=== 2. Dev-only hulls ===')
{
  const dev = ['swift-courier', 'star-jumper']
  reset([])
  check('absent from the player-facing class list', dev.every((id) => !PLAYER_SHIP_CLASSES.some((c) => c.id === id)) && dev.every((id) => SHIP_CLASSES.some((c) => c.id === id)))
  const everything = new Set(SHIP_CLASSES.flatMap((c) => (c.requiresTech ? [c.requiresTech] : [])))
  check('absent from every shipyard list, whatever is researched', shipyardRows(SHIP_CLASSES, everything, resolveShipClass).every((c) => !dev.includes(c.id)))
  check('refused by the shipyard', dev.every((id) => !build(id).ok))
  check('never on the AI rotation, and never "affordable" to it', dev.every((id) => !(AI_WARSHIP_ROTATION as readonly string[]).includes(id) && !affordable(id, { ...ZERO, alloys: 1e6, energy: 1e6, hyperium: 1e6 }, { has: () => true })))
  check('...but spawnable (the Debug Console path)', !!spawnOwnedShip('swift-courier', MARS, 'sol', 'Mars'))
}

console.log('\n=== 3. The scout line ===')
{
  const hyper = set('hyperspace-theory')
  const both = set('hyperspace-theory', 'autonomous-navigation')
  check('a new build is the Hyperspace Scout until Turing is researched', bestLevelClass('hyperspace-scout', hyper, resolveShipClass) === 'hyperspace-scout')
  check('...and the Turing Scout once it is', bestLevelClass('hyperspace-scout', both, resolveShipClass) === 'turing-scout' && bestLevelClass('turing-scout', both, resolveShipClass) === 'turing-scout')
  check('a hull with no line is its own best level', bestLevelClass('corvette', both, resolveShipClass) === 'corvette' && bestLevelClass('science-ship', both, resolveShipClass) === 'science-ship')
  reset(['hyperspace-theory'])
  const first = build('hyperspace-scout')
  const orders = () => useShipyardStore.getState().ordersFor(MARS)
  check('the shipyard builds the Hyperspace Scout before the further tech', first.ok && orders()[0].classId === 'hyperspace-scout')
  reset(['hyperspace-theory', 'autonomous-navigation'])
  const late = build('hyperspace-scout')
  check('...and asked for the same hull after it, comes out as a Turing Scout', late.ok && orders()[0].classId === 'turing-scout' && orders()[0].className === 'Turing Scout')
  reset([])
  check('the scout needs hyperspace tech', !build('hyperspace-scout').ok && techBlock(resolveShipClass('hyperspace-scout')!, set()) === findTech('hyperspace-theory')!.name)
  const sc = shipBuildCost(resolveShipClass('science-ship')!)
  check('both levels are cheaper than a Science Ship in alloys and energy', ['hyperspace-scout', 'turing-scout'].every((id) => { const c = shipBuildCost(resolveShipClass(id)!); return (c.alloys ?? 0) < (sc.alloys ?? 0) && (c.energy ?? 0) < (sc.energy ?? 0) }))

  // Explore only: a scout explores by being there, and never surveys.
  useShipStore.setState({ ships: [] })
  useSurveyStore.setState({ discovered: {}, known: {}, reports: [] })
  const id = spawnOwnedShip('hyperspace-scout', MARS, 'sol', 'Mars')!
  useShipStore.getState().setShipLocation(id, { kind: 'star', starId: 'alpha-centauri', offset: [0, 0, 0] })
  applyShipCommand(id, { kind: 'survey', starId: 'alpha-centauri' }, 0)
  check('a survey command gives a scout no survey job', !useShipStore.getState().ships.find((s) => s.id === id)!.surveyJob && commandRole({ kind: 'survey' }) === 'science')
  check('...a Science Ship does get one (the contrast)', (() => {
    const sid = spawnOwnedShip('science-ship', MARS, 'sol', 'Mars')!
    useShipStore.getState().setShipLocation(sid, { kind: 'star', starId: 'alpha-centauri', offset: [0, 0, 0] })
    applyShipCommand(sid, { kind: 'survey', starId: 'alpha-centauri' }, 0)
    return !!useShipStore.getState().ships.find((s) => s.id === sid)!.surveyJob
  })())
  resolveSurvey(1)
  const intel = useSurveyStore.getState().discovered[MARS]
  check('...and a scout sitting at a star explores it', isExplored(intel, MARS, 'alpha-centauri', {}))
  check('...without surveying any body of it', (intel?.surveyed.size ?? 0) === 0)
}

console.log('\n=== 4. The AI obeys the same gates ===')
{
  const have = (...ids: string[]) => ({ has: (t: string) => ids.includes(t) })
  const rich = { ...ZERO, alloys: 1e6, energy: 1e6, hyperium: 1e6 }
  check('the AI builds a Corvette at the start but not a locked hull', affordable('corvette', rich, have()) && !affordable('frigate', rich, have()) && !affordable('cruiser', rich, have()))
  check('...and the hull once it has researched its tech', affordable('frigate', rich, have('frigate-hulls')) && !affordable('destroyer', rich, have('frigate-hulls')))
  check('its research path walks the chain in order, prerequisite-closed', ['frigate-hulls', 'destroyer-hulls', 'cruiser-hulls'].every((t, i, a) => AI_RESEARCH_PATH.includes(t as never) && (i === 0 || AI_RESEARCH_PATH.indexOf(a[i - 1] as never) < AI_RESEARCH_PATH.indexOf(t as never))) && AI_RESEARCH_PATH.includes('orbital-mechanics'))
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`)
process.exit(failures === 0 ? 0 : 1)
