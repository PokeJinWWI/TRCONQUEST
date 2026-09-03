// Pure-function verification of the tech tree's data-model logic (see
// src/data/techData.ts). No store access needed — same reasoning every other
// combat/economy pure-function module in this project follows.
//
// Run:  npx tsx tests/tech.test.ts

import {
  PHYSICS_TECHS,
  SOCIETY_TECHS,
  ENGINEERING_TECHS,
  ANOMALOUS_UNLOCK_THRESHOLD,
  prerequisitesMet,
  anomalousUnlocked,
  visibleNodeIds,
  canResearch,
  findTech,
  type TechNode,
} from '../src/data/techData'
import { useTechStore } from '../src/state/techStore'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

console.log('\n=== 1. Physics tree shape ===')
{
  check('Physics has real content', PHYSICS_TECHS.length > 20, `${PHYSICS_TECHS.length} nodes`)
  check('Society is structurally real but empty', Array.isArray(SOCIETY_TECHS) && SOCIETY_TECHS.length === 0)
  // Engineering's first real content: the Power Systems chain gating the
  // ship builder's Power Distribution tiers (see shipModules.ts).
  check('Engineering has real content', ENGINEERING_TECHS.length > 0, `${ENGINEERING_TECHS.length} nodes`)
  const ids = PHYSICS_TECHS.map((n) => n.id)
  check('every node id is unique', new Set(ids).size === ids.length)
  const roots = PHYSICS_TECHS.filter((n) => n.prerequisites.length === 0)
  check('exactly 9 roots (8 open + Anomalous)', roots.length === 9, `${roots.length}`)
  check('Anomalous is the only locked node', PHYSICS_TECHS.filter((n) => n.locked).length === 1 && PHYSICS_TECHS.find((n) => n.locked)?.id === 'anomalous-phenomena')
  // Every non-root prerequisite id actually resolves to a real node — a typo
  // in a prerequisite string would silently orphan a branch.
  for (const node of PHYSICS_TECHS) {
    for (const set of node.prerequisites) {
      for (const parentId of set) {
        check(`${node.id}'s prerequisite "${parentId}" resolves to a real node`, PHYSICS_TECHS.some((n) => n.id === parentId))
      }
    }
  }
}

console.log('\n=== 2. prerequisitesMet: AND within a set, OR across sets ===')
{
  const single: TechNode = { id: 't1', name: 't1', category: 'physics', description: '', cost: 10, prerequisites: [['a']] }
  check('single prereq unmet with nothing researched', !prerequisitesMet(single, new Set()))
  check('single prereq met once researched', prerequisitesMet(single, new Set(['a'])))

  const andSet: TechNode = { id: 't2', name: 't2', category: 'physics', description: '', cost: 10, prerequisites: [['a', 'b']] }
  check('AND set needs both', !prerequisitesMet(andSet, new Set(['a'])))
  check('AND set satisfied once both are researched', prerequisitesMet(andSet, new Set(['a', 'b'])))

  const orSets: TechNode = { id: 't3', name: 't3', category: 'physics', description: '', cost: 10, prerequisites: [['a'], ['b']] }
  check('OR set satisfied by the first alternative alone', prerequisitesMet(orSets, new Set(['a'])))
  check('OR set satisfied by the second alternative alone', prerequisitesMet(orSets, new Set(['b'])))
  check('OR set unmet with neither', !prerequisitesMet(orSets, new Set(['c'])))

  const root: TechNode = { id: 't4', name: 't4', category: 'physics', description: '', cost: 10, prerequisites: [] }
  check('a root has no prerequisites to meet', prerequisitesMet(root, new Set()))

  // The real convergent node in the actual tree.
  const exoticMatterTheory = findTech('exotic-matter-theory')!
  check('Exotic Matter Theory is reachable via Quantum alone', prerequisitesMet(exoticMatterTheory, new Set(['quantum-computing'])))
  check('Exotic Matter Theory is reachable via Atomic alone', prerequisitesMet(exoticMatterTheory, new Set(['nuclear-energetics'])))
  const hyperiumSynthesis = findTech('hyperium-synthesis')!
  check(
    'Hyperium Synthesis needs BOTH hyperspace-theory AND exotic-matter-theory (a real AND set), not either alone',
    !prerequisitesMet(hyperiumSynthesis, new Set(['hyperspace-theory'])) &&
      !prerequisitesMet(hyperiumSynthesis, new Set(['exotic-matter-theory'])) &&
      prerequisitesMet(hyperiumSynthesis, new Set(['hyperspace-theory', 'exotic-matter-theory'])),
  )
}

console.log('\n=== 3. Anomalous: aggregate unlock, not an ordinary prerequisite ===')
{
  check('locked with nothing researched', !anomalousUnlocked(new Set()))
  const nonAnomalousIds = PHYSICS_TECHS.filter((n) => !n.locked).map((n) => n.id)
  const justUnderThreshold = new Set(nonAnomalousIds.slice(0, ANOMALOUS_UNLOCK_THRESHOLD - 1))
  const atThreshold = new Set(nonAnomalousIds.slice(0, ANOMALOUS_UNLOCK_THRESHOLD))
  check('still locked one short of the threshold', !anomalousUnlocked(justUnderThreshold))
  check('unlocked exactly at the threshold', anomalousUnlocked(atThreshold))
  const anomalous = findTech('anomalous-phenomena')!
  check('canResearch refuses Anomalous below the threshold even with infinite points', !canResearch(anomalous, justUnderThreshold, 1_000_000))
  check('canResearch allows Anomalous once the threshold is met and points suffice', canResearch(anomalous, atThreshold, anomalous.cost))
}

console.log('\n=== 4. visibleNodeIds: the "two nodes past anything researched" rule ===')
{
  const empty = visibleNodeIds(PHYSICS_TECHS, new Set())
  check('with nothing researched, every root is visible', PHYSICS_TECHS.filter((n) => n.prerequisites.length === 0).every((n) => empty.has(n.id)))
  check('with nothing researched, a deep node is NOT visible', !empty.has('free-flight-maneuvering'))
  check('Anomalous is visible from the start (locked, not hidden)', empty.has('anomalous-phenomena'))

  const afterClassicalMechanics = visibleNodeIds(PHYSICS_TECHS, new Set(['classical-mechanics']))
  check('researching a root reveals its direct child in full', afterClassicalMechanics.has('orbital-mechanics'))
  check(
    'researching a root reveals its GRANDCHILD too (2 hops), matching "two nodes into the future"',
    afterClassicalMechanics.has('free-flight-maneuvering'),
  )
  check(
    "researching Classical Mechanics does NOT reveal Electromagnetism's children — only the electromagnetism ROOT is visible (every root always is), not anything past it",
    !afterClassicalMechanics.has('directed-energy-weapons'),
  )
  check('electromagnetism itself (a root) is visible regardless', afterClassicalMechanics.has('electromagnetism'))
}

console.log('\n=== 5. canResearch ===')
{
  const cm = findTech('classical-mechanics')!
  check('a root is researchable with enough points and nothing researched yet', canResearch(cm, new Set(), cm.cost))
  check('not researchable with too few points', !canResearch(cm, new Set(), cm.cost - 1))
  check('not researchable once already researched', !canResearch(cm, new Set(['classical-mechanics']), 1000))
  const om = findTech('orbital-mechanics')!
  check('a child is not researchable before its prerequisite', !canResearch(om, new Set(), 1000))
  check('a child IS researchable once its prerequisite is met and points suffice', canResearch(om, new Set(['classical-mechanics']), om.cost))
}

console.log('\n=== 6. techStore: default seeding, grant, and research ===')
{
  const fresh = useTechStore.getState().stateFor('untouched-country')
  check('a fresh/untouched country starts with Warp Theory already researched', fresh.researched.has('warp-theory'))
  check('a fresh/untouched country starts with Hyperspace Theory already researched', fresh.researched.has('hyperspace-theory'))
  check('a fresh/untouched country has NOT researched Classical Mechanics', !fresh.researched.has('classical-mechanics'))
  check('a fresh/untouched country starts with 0 points in every category', fresh.researchPoints.physics === 0 && fresh.researchPoints.society === 0 && fresh.researchPoints.engineering === 0)
  const reread = useTechStore.getState().stateFor('untouched-country')
  check('re-reading an untouched country returns the SAME reference (no needless re-render churn)', reread === fresh)

  const countryId = 'test-country-1'
  useTechStore.getState().grantResearch(countryId, 'physics', 100)
  check('grantResearch adds points to the right category', useTechStore.getState().stateFor(countryId).researchPoints.physics === 100)
  check("grantResearch doesn't touch other categories", useTechStore.getState().stateFor(countryId).researchPoints.society === 0)

  const okBeforePrereq = useTechStore.getState().researchNode(countryId, 'orbital-mechanics')
  check('researchNode refuses a node whose prerequisite is unmet, even with enough points', !okBeforePrereq)

  const cmOk = useTechStore.getState().researchNode(countryId, 'classical-mechanics')
  check('researchNode succeeds on an affordable, eligible root', cmOk)
  check('the node is now in researched', useTechStore.getState().stateFor(countryId).researched.has('classical-mechanics'))
  const cmCost = findTech('classical-mechanics')!.cost
  check('the cost was deducted from the physics pool', useTechStore.getState().stateFor(countryId).researchPoints.physics === 100 - cmCost)

  const dupe = useTechStore.getState().researchNode(countryId, 'classical-mechanics')
  check('researching the same node twice fails the second time', !dupe)

  const tooExpensive = useTechStore.getState().researchNode(countryId, 'orbital-mechanics')
  check("researchNode refuses a node the country can't afford yet, even once eligible", !tooExpensive, `has ${useTechStore.getState().stateFor(countryId).researchPoints.physics}, needs ${findTech('orbital-mechanics')!.cost}`)
}

console.log('\n=== 7. Soliton Warp Theory was removed (dead-end leaf, no children, no other references) ===')
{
  check('the node no longer exists in the tree', findTech('soliton-warp-theory') === undefined)
  check('nothing still lists it as a prerequisite', PHYSICS_TECHS.every((n) => n.prerequisites.every((set) => !set.includes('soliton-warp-theory'))))
  check("Warp Theory itself is untouched (it had other things depending on it too)", findTech('warp-theory') !== undefined)
}

console.log('\n=== 8. freeResearchMode: the dev console\'s "zero all tech costs" toggle ===')
{
  const cm = findTech('classical-mechanics')!
  check('canResearch still costs real points when freeResearchMode is off (default)', !canResearch(cm, new Set(), 0))
  check('canResearch treats cost as 0 when freeResearchMode is on, even with 0 points', canResearch(cm, new Set(), 0, true))
  check('freeResearchMode never bypasses prerequisites', !canResearch(findTech('orbital-mechanics')!, new Set(), 0, true))
  check('freeResearchMode never bypasses "already researched"', !canResearch(cm, new Set(['classical-mechanics']), 0, true))

  const countryId = 'free-research-country'
  useTechStore.getState().setFreeResearchMode(true)
  check('setFreeResearchMode actually flips the store flag', useTechStore.getState().freeResearchMode === true)
  const okWithZeroPoints = useTechStore.getState().researchNode(countryId, 'classical-mechanics')
  check('researchNode succeeds on a 0-point-pool country while the mode is on', okWithZeroPoints)
  check('...and researchPoints stayed at 0 rather than going negative', useTechStore.getState().stateFor(countryId).researchPoints.physics === 0)
  check('...and the node really is researched', useTechStore.getState().stateFor(countryId).researched.has('classical-mechanics'))

  useTechStore.getState().setFreeResearchMode(false)
  const failsOnceOff = useTechStore.getState().researchNode(countryId, 'orbital-mechanics')
  check('turning the mode back off restores the real cost gate immediately', !failsOnceOff)
}

console.log('\n=== 9. Biology: the new branch ===')
{
  const biology = findTech('biology')!
  check('Biology is a real root (no prerequisites)', biology.prerequisites.length === 0)
  check('Biology is visible from the start, same as every other root', visibleNodeIds(PHYSICS_TECHS, new Set()).has('biology'))
  check('Genetic Engineering is not researchable before Biology', !canResearch(findTech('genetic-engineering')!, new Set(), 1000))
  check('Xenobiology is not researchable before Biology', !canResearch(findTech('xenobiology')!, new Set(), 1000))
  check(
    'both children become researchable once Biology is researched',
    canResearch(findTech('genetic-engineering')!, new Set(['biology']), 90) && canResearch(findTech('xenobiology')!, new Set(['biology']), 90),
  )
  check(
    'both children are visible (not just Biology itself) once Biology is researched, per the 2-hop rule',
    visibleNodeIds(PHYSICS_TECHS, new Set(['biology'])).has('genetic-engineering') &&
      visibleNodeIds(PHYSICS_TECHS, new Set(['biology'])).has('xenobiology'),
  )
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`)
process.exit(failures === 0 ? 0 : 1)
