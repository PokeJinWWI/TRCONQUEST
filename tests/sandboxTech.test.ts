// Sandbox tech: the whole default tree researched at start, a click toggling any tech for all four
// factions (cascade on un-research), derived state recomputing, and normal games untouched.
// Run:  npx tsx tests/sandboxTech.test.ts
import { ALL_TECHS, allTechIds, findTech, prerequisitesMet, researchPlan, unresearchEffects, unresearchPlan } from '../src/data/techData'
import { SANDBOX_FACTION_IDS, SANDBOX_PLAYER_ID } from '../src/data/countryRoster'
import { HYPERDRIVE_TECH_IDS, WARP_DRIVE_TECH_IDS, hyperdriveMkOf, usableDrives, warpMkOf } from '../src/data/warpData'
import { chassisAvailable, HULL_CHASSES } from '../src/data/hullChassis'
import { resolveShipClass } from '../src/state/shipClassResolver'
import { techBlock } from '../src/scene/shipyardLogic'
import { hasFreeFlightTech } from '../src/scene/freeFlight'
import { commsTierFor } from '../src/data/commsData'
import { DEFAULT_RESEARCHED, useTechStore } from '../src/state/techStore'
import { useResourceStore } from '../src/state/resourceStore'
import { usePlayerStore } from '../src/state/playerStore'
import { SANDBOX_FREE_RESEARCH, startSandbox } from '../src/scene/sandboxSetup'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}
const store = () => useTechStore.getState()
const have = (id: string) => store().stateFor(id).researched
const mine = () => have(SANDBOX_PLAYER_ID)
const resetAll = () => {
  useTechStore.setState({ byCountry: {}, freeResearchMode: false })
  usePlayerStore.setState({ selectedCountryId: null, sandbox: false })
}

console.log('\n=== 1. Pure plans ===')
{
  const all = new Set(allTechIds())
  check('allTechIds is the whole default tree', allTechIds().length === ALL_TECHS.length && allTechIds().length > 40)
  const mk2 = HYPERDRIVE_TECH_IDS[1]
  const plan = unresearchPlan(mk2, all)
  check('un-researching Hyperdrive Mk II takes Mk III-V with it', HYPERDRIVE_TECH_IDS.slice(1).every((id) => plan.includes(id)) && plan[0] === mk2, plan.join())
  check('...and not Mk I', !plan.includes(HYPERDRIVE_TECH_IDS[0]))
  const afterMk2 = new Set([...all].filter((id) => !plan.includes(id)))
  check('what is left is consistent: every researched tech has its prerequisites', [...afterMk2].every((id) => prerequisitesMet(findTech(id)!, afterMk2) || findTech(id)!.locked === true))
  const warp = unresearchPlan('warp-theory', all)
  check('un-researching Warp Theory takes every Warp Drive Mk and Warp Comms', WARP_DRIVE_TECH_IDS.every((id) => warp.includes(id)) && warp.includes('warp-comms'), `${warp.length} techs`)
  check('an unresearched tech has no plan', unresearchPlan(mk2, new Set()).length === 0)
  check('a leaf takes only itself', unresearchPlan(HYPERDRIVE_TECH_IDS[4], all).join() === HYPERDRIVE_TECH_IDS[4])
  // The Anomalous gate: with only a few techs left it cannot stay.
  const anomalous = ALL_TECHS.find((t) => t.locked)!
  const few = new Set(['classical-mechanics', anomalous.id])
  check('Anomalous Phenomena goes when too few techs remain for its aggregate gate', unresearchPlan('classical-mechanics', few).includes(anomalous.id))
  check('...but stays while enough remain', !unresearchPlan('classical-mechanics', all).includes(anomalous.id))
  const rp = researchPlan(HYPERDRIVE_TECH_IDS[2], new Set(DEFAULT_RESEARCHED))
  check('researching Mk III from the defaults adds Mk II first', rp.join() === `${HYPERDRIVE_TECH_IDS[1]},${HYPERDRIVE_TECH_IDS[2]}`, rp.join())
  check('researching a researched tech adds nothing', researchPlan(HYPERDRIVE_TECH_IDS[0], new Set(DEFAULT_RESEARCHED)).length === 0)
  check('the confirm lines name what goes too, and are empty for a leaf', unresearchEffects(plan)[0].includes('Also un-researches 3') && unresearchEffects([mk2]).length === 0, unresearchEffects(plan)[0])
  check('...and shorten a long list', unresearchEffects(warp, 3)[0].includes('more'))
}

console.log('\n=== 2. A Sandbox game starts with everything researched ===')
{
  resetAll()
  startSandbox()
  check('the player is in the sandbox', usePlayerStore.getState().sandbox && usePlayerStore.getState().selectedCountryId === SANDBOX_PLAYER_ID)
  check('every tech is researched for all four factions', SANDBOX_FACTION_IDS.length === 4 && SANDBOX_FACTION_IDS.every((id) => allTechIds().every((t) => have(id).has(t))))
  check('Free Research is on by default (the named constant)', SANDBOX_FREE_RESEARCH === true && store().freeResearchMode === true)
  check('derived: Hyperdrive Mk V and Warp Mk VII', hyperdriveMkOf(mine()) === 5 && warpMkOf(mine()) === 7)
  check('derived: Hyper Comms, free flight, the frigate hull and every chassis', commsTierFor(mine() as Set<string>) === 'hyper' && hasFreeFlightTech(mine()) && techBlock(resolveShipClass('frigate')!, mine()) === null && chassisAvailable(mine()).length === HULL_CHASSES.length)
}

console.log('\n=== 3. Toggling ===')
{
  const mk2 = HYPERDRIVE_TECH_IDS[1]
  check('un-researching Mk II succeeds', store().toggleTech(mk2))
  check('...for every faction at once', SANDBOX_FACTION_IDS.every((id) => !have(id).has(mk2) && !have(id).has(HYPERDRIVE_TECH_IDS[4]) && have(id).has(HYPERDRIVE_TECH_IDS[0])))
  check('derived: Hyperdrive Mk is now 1, a hyperdrive hull still has its Mk I drive', hyperdriveMkOf(mine()) === 1 && usableDrives([{ kind: 'hyperdrive' }], mine()).hyperdrive)
  check('...the rest of the tree is untouched (Warp Mk VII)', warpMkOf(mine()) === 7)
  store().toggleTech('frigate-hulls')
  check('derived: un-researching a hull tech blocks that hull (and the next hull up that stood on it)', techBlock(resolveShipClass('frigate')!, mine()) !== null && techBlock(resolveShipClass('destroyer')!, mine()) !== null)
  store().toggleTech('free-flight-maneuvering')
  check('derived: free flight gone', !hasFreeFlightTech(mine()))
  store().toggleTech('warp-theory')
  check('derived: Warp Theory off: no Warp Mk, comms fall back to Hyper (it is its own tech)', warpMkOf(mine()) === 0 && !usableDrives([{ kind: 'warp' }], mine()).warp && commsTierFor(mine() as Set<string>) === 'hyper')
  // Back on.
  check('researching Mk II again restores it', store().toggleTech(mk2) && have(SANDBOX_PLAYER_ID).has(mk2) && hyperdriveMkOf(mine()) === 2, `Mk ${hyperdriveMkOf(mine())}`)
  check('...Mk III-V stay off (only what was clicked, plus missing prerequisites)', !mine().has(HYPERDRIVE_TECH_IDS[2]))
  store().toggleTech(HYPERDRIVE_TECH_IDS[4])
  check('researching Mk V adds Mk III and IV (the missing prerequisites), so Mk reads 5', hyperdriveMkOf(mine()) === 5, `Mk ${hyperdriveMkOf(mine())}`)
  store().toggleTech('frigate-hulls')
  check('re-researching the frigate hull gate unblocks it', techBlock(resolveShipClass('frigate')!, mine()) === null)
  check('no resources moved, no points spent', Object.values(useResourceStore.getState().stateFor(SANDBOX_PLAYER_ID).amounts).every((n) => n === 0) && mine().size > 0 && store().stateFor(SANDBOX_PLAYER_ID).researchPoints.physics === 0)
  check('a tech researched/removed leaves the queue clean', (store().stateFor(SANDBOX_PLAYER_ID).queue ?? []).length === 0)
  check('an unknown tech is refused', !store().toggleTech('no-such-tech'))
}

console.log('\n=== 4. Free Research off: researching costs, un-researching does not ===')
{
  store().setFreeResearchMode(false)
  store().toggleTech('thermodynamics')
  check('un-researching is still free with Free Research off', !mine().has('thermodynamics'))
  check('researching with no points is refused (costs apply again)', !store().toggleTech('thermodynamics') && !mine().has('thermodynamics'))
  store().grantResearch(SANDBOX_PLAYER_ID, 'physics', 1000)
  check('with the points it works, the player pays and the others follow', store().toggleTech('thermodynamics') && SANDBOX_FACTION_IDS.every((id) => have(id).has('thermodynamics')) && store().stateFor(SANDBOX_PLAYER_ID).researchPoints.physics < 1000)
  // A cheap single-prerequisite tech with nothing consumed: take its prerequisite away, and with real costs it cannot come back first.
  const child = ALL_TECHS.find((t) => !t.locked && !t.resourceCost && t.prerequisites.length === 1 && t.prerequisites[0].length === 1 && t.cost <= 500 && have(SANDBOX_PLAYER_ID).has(t.id))!
  const parent = child.prerequisites[0][0]
  store().toggleTech(parent)
  store().grantResearch(SANDBOX_PLAYER_ID, child.category, 100000)
  check('the cascade took the child with its prerequisite', !mine().has(parent) && !mine().has(child.id), `${parent} -> ${child.id}`)
  check('with real costs, researching the child without its prerequisite is refused even with the points', !store().toggleTech(child.id) && !mine().has(child.id))
  check('researching the prerequisite first, then the child, works', store().toggleTech(parent) && store().toggleTech(child.id) && mine().has(child.id))
}

console.log('\n=== 5. Normal games are unchanged ===')
{
  resetAll()
  usePlayerStore.getState().selectCountry('imperial-state-of-mars')
  check('a nation starts with only the default techs', have('imperial-state-of-mars').size === DEFAULT_RESEARCHED.length && !have('imperial-state-of-mars').has(HYPERDRIVE_TECH_IDS[1]))
  check('Free Research is off', store().freeResearchMode === false)
  check('toggleTech is refused outside the sandbox and changes nothing', !store().toggleTech(HYPERDRIVE_TECH_IDS[1]) && !store().toggleTech(HYPERDRIVE_TECH_IDS[0]) && have('imperial-state-of-mars').size === DEFAULT_RESEARCHED.length && have('imperial-state-of-mars').has(HYPERDRIVE_TECH_IDS[0]))
  check('the sandbox factions\' techs were not seeded by a normal start', SANDBOX_FACTION_IDS.every((id) => have(id).size === DEFAULT_RESEARCHED.length))
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`)
if (failures > 0) process.exit(1)
