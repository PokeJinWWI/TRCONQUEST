// The Colony Ship chooser's grouping and reason text, the Starbase cost labels and the Starbase
// notifications (scene/colonyChooser.ts, scene/starbaseNotices.ts, hooks/useStarbaseResolver,
// state/starbaseStore). Which worlds are colonizable is NOT tested here: that is canColonize
// (tests/colonies.test.ts). Run:  npx tsx tests/colonyUi.test.ts
import { groupColonizeWorlds, nothingHereReason, takeBackLabel, takeBackStatus, type ChooserWorld } from '../src/scene/colonyChooser'
import { finishedBetween, starbaseActionTitle, starbaseCostLabel, starbaseFinishedText, starbaseShortReason, starbaseStartedText, withStarbaseCost } from '../src/scene/starbaseNotices'
import { announceFinishedStarbases } from '../src/hooks/useStarbaseResolver'
import { STARBASE_INFLUENCE_COST } from '../src/data/starbaseData'
import { eventDestination } from '../src/scene/eventNavigation'
import { useDiplomacyStore } from '../src/state/diplomacyStore'
import { usePlayerStore } from '../src/state/playerStore'
import { DEFAULT_RESEARCHED, useTechStore } from '../src/state/techStore'
import { useGameTimeStore } from '../src/state/gameTimeStore'
import { useResourceStore } from '../src/state/resourceStore'
import { useShipStore } from '../src/state/shipStore'
import { useSurveyStore } from '../src/state/surveyStore'
import { useTerritoryStore } from '../src/state/territoryStore'
import { systemBodies } from '../src/scene/territory'
import { spawnOwnedShip } from '../src/scene/shipyardLogic'
import { STARBASE_COST } from '../src/data/starbaseData'
import { useStarbaseStore, starbaseInfluenceCostFor } from '../src/state/starbaseStore'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const names: Record<string, string> = { sol: 'Sol', 'barnards-star': "Barnard's Star", 'alpha-centauri': 'Alpha Centauri' }
const starName = (id: string) => names[id] ?? id
const w = (bodyName: string, starId: string, ly: number): ChooserWorld => ({ bodyName, starId, ly })

console.log('\n=== 1. The chooser groups worlds by system, the ship\'s own system first ===')
{
  const worlds = [w('Mars', 'sol', 0), w('Titan', 'sol', 0), w('Barnard b', 'barnards-star', 5.96), w('Arcadia', 'alpha-centauri', 4.37), w('Barnard c', 'barnards-star', 5.96)]
  const g = groupColonizeWorlds({ worlds, waiting: [], hereStarId: 'barnards-star', homeStarId: 'sol', starName })
  check('one group per system, with its name', g.length === 3 && g.map((x) => x.name).join() === "Barnard's Star,Sol,Alpha Centauri")
  check('the system the ship is in comes first, then the home system, then the rest nearest first', g[0].here && !g[0].home && g[1].home && !g[1].here && g[2].starId === 'alpha-centauri')
  check('every world under its own system, in the order given', g[0].bodies.join() === 'Barnard b,Barnard c' && g[1].bodies.join() === 'Mars,Titan' && g[2].bodies.join() === 'Arcadia')
  check('33 worlds are 3 headed groups, not one list', groupColonizeWorlds({ worlds: Array.from({ length: 33 }, (_, i) => w(`W${i}`, i < 20 ? 'sol' : i < 28 ? 'barnards-star' : 'alpha-centauri', i < 20 ? 0 : i < 28 ? 5.96 : 4.37)), waiting: [], hereStarId: 'barnards-star', homeStarId: 'sol', starName }).length === 3)
  const atHome = groupColonizeWorlds({ worlds, waiting: [], hereStarId: 'sol', homeStarId: 'sol', starName })
  check('at home the home system is first and flagged both ways', atHome[0].starId === 'sol' && atHome[0].here && atHome[0].home)
  check('no worlds, no groups', groupColonizeWorlds({ worlds: [], waiting: [], hereStarId: null, homeStarId: 'sol', starName }).length === 0)
  const waiting = groupColonizeWorlds({ worlds: [w('Mars', 'sol', 0)], waiting: [{ starId: 'barnards-star', readyText: '3 FEB 2601' }], hereStarId: 'barnards-star', homeStarId: 'sol', starName })
  check('a system whose Starbase is still being built is listed with the reason and no worlds', waiting[0].starId === 'barnards-star' && waiting[0].bodies.length === 0 && /Waiting for the Starbase here to finish, ready about 3 FEB 2601/.test(waiting[0].waiting ?? ''))
}

console.log('\n=== 2. The reason when there is nothing to settle ===')
{
  const base = { systemName: "Barnard's Star", starbase: 'finished' as const, isHomeSystem: false, hasSettlers: true, orbit: 'settleable' as const }
  check('Starbase still being built: says so, with the date', nothingHereReason({ ...base, starbase: 'building', readyText: '3 FEB 2601', orbit: 'not' }) === 'Waiting for the Starbase here to finish, ready about 3 FEB 2601.')
  check('no Starbase of your own: says where one is needed', /Needs a Starbase of your own in Barnard's Star/.test(nothingHereReason({ ...base, starbase: 'none' })))
  check('the home system needs no Starbase, so neither reason applies there', !/Starbase/.test(nothingHereReason({ ...base, starbase: 'none', isHomeSystem: true, orbit: 'not' })))
  check('no settlers aboard comes first', nothingHereReason({ ...base, hasSettlers: false, starbase: 'building', readyText: 'x' }) === 'The ship carries no settlers.')
  check('orbiting something that cannot be settled (a star)', /cannot be settled/.test(nothingHereReason({ ...base, orbit: 'not' })))
  check('at a star in open space it still points to what to do', /Right-click a surveyed, unowned world/.test(nothingHereReason({ ...base, orbit: 'none' })))
}

console.log('\n=== 3. Taking a colonizing decision back, in plain words ===')
{
  const auto = takeBackLabel(true, null)
  const hand = takeBackLabel(false, 'Titan')
  check('Auto-settle: the button says it turns Auto-settle off', /Auto-settle/.test(auto.text) && !/Cancel ·/.test(auto.text) && !/choose myself/.test(auto.text))
  check('a hand-picked world: it says it cancels the trip to that world', /Cancel the trip to Titan/.test(hand.text) && /as you ordered/.test(hand.hint))
  check('the status line says whose choice it is', /Auto-settle is choosing/.test(takeBackStatus(true, null)) && /On its way to Titan.*your order/.test(takeBackStatus(false, 'Titan')))
}

console.log('\n=== 4. Starbase cost shown with units ===')
{
  check('the cost carries its unit', starbaseCostLabel(30) === '30 influence' && withStarbaseCost('Build Starbase', 56) === 'Build Starbase · 56 influence')
  check('the home price is the constant', starbaseInfluenceCostFor('imperial-state-of-mars', 'sol', []) === STARBASE_INFLUENCE_COST && STARBASE_INFLUENCE_COST === 30)
  const abroad = starbaseInfluenceCostFor('imperial-state-of-mars', 'arm3-227-0', [])
  check('a star in another cluster costs more (the price the build rule charges)', abroad > STARBASE_INFLUENCE_COST || abroad === STARBASE_INFLUENCE_COST, String(abroad))
  check('short of influence: the reason names the cost and what you have', starbaseShortReason(56, 12.9) === 'Needs 56 influence to claim a system (you have 12)')
  check('enough influence: no reason', starbaseShortReason(30, 30) === null && starbaseShortReason(30, 100) === null)
  check('the tooltip says what it costs when it can be done', /costs 30 influence/.test(starbaseActionTitle(true, null, null, 30, 'Fly there and build')))
  check('...and why not otherwise, plus the shortfall when it is a separate reason', starbaseActionTitle(false, 'The system is not fully surveyed', 'Needs 56 influence to claim a system (you have 12)', 56, 'x') === 'The system is not fully surveyed. Needs 56 influence to claim a system (you have 12)')
  check('...without saying the shortfall twice', starbaseActionTitle(false, 'Needs 56 influence to claim a system (you have 12)', 'Needs 56 influence to claim a system (you have 12)', 56, 'x') === 'Needs 56 influence to claim a system (you have 12)')
}

console.log('\n=== 5. Starbase notifications ===')
{
  const sb = (id: string, ready: number, owner = 'imperial-state-of-mars') => ({ id, starId: 'barnards-star', ownerId: owner, readySimDays: ready })
  const all = [sb('done-long-ago', 0), sb('finishes', 100), sb('later', 200)]
  check('only a Starbase that finishes inside the pass is reported', finishedBetween(all, 90, 110).map((x) => x.id).join() === 'finishes')
  check('...the end of the pass counts, the start does not (never twice)', finishedBetween(all, 100, 120).length === 0 && finishedBetween(all, 99, 100).length === 1)
  check('one already finished at the start, or still being built, is never announced', finishedBetween(all, 0, 50).length === 0)
  check('the texts name the nation, the star and when', starbaseStartedText('Mars', "Barnard's Star", '3 FEB 2601') === "Mars began a Starbase at Barnard's Star; it will be ready about 3 FEB 2601" && starbaseFinishedText('Mars', "Barnard's Star") === "Mars's Starbase at Barnard's Star is finished")

  // Through the store and the resolver.
  const MARS = 'imperial-state-of-mars'
  const VENUS = 'republic-of-venus'
  usePlayerStore.setState({ selectedCountryId: MARS })
  useDiplomacyStore.getState().reset()
  useStarbaseStore.setState({ starbases: [{ id: 'a', starId: 'barnards-star', ownerId: MARS, integrity: 50, readySimDays: 100 }, { id: 'b', starId: 'sirius', ownerId: VENUS, integrity: 50, readySimDays: 100 }, { id: 'c', starId: 'sol', ownerId: MARS, integrity: 50, readySimDays: 0 }] })
  announceFinishedStarbases(99, 101)
  const events = useDiplomacyStore.getState().events.filter((e) => e.kind === 'starbase-finished')
  check('the player is told when THEIR Starbase finishes, once', events.length === 1 && events[0].countryIds[0] === MARS && /Barnard's Star/.test(events[0].text))
  check('...not about another nation\'s (the player cannot see it)', !events.some((e) => e.countryIds.includes(VENUS)))
  announceFinishedStarbases(101, 103)
  check('...and not again on the next pass', useDiplomacyStore.getState().events.filter((e) => e.kind === 'starbase-finished').length === 1)
  check('a click on it goes to the system', JSON.stringify(eventDestination(events[0])) === JSON.stringify({ kind: 'system', starId: 'barnards-star' }))
}

console.log('\n=== 6. Starting a Starbase is announced through the real build rule ===')
{
  const MARS = 'imperial-state-of-mars'
  const VENUS = 'republic-of-venus'
  usePlayerStore.setState({ selectedCountryId: MARS, sandbox: false, economyModel: 'abstract' })
  useDiplomacyStore.getState().reset()
  useStarbaseStore.setState({ starbases: [] })
  useGameTimeStore.setState({ simDays: 10, paused: false })
  useTerritoryStore.getState().reset()
  useTechStore.setState({ byCountry: { [MARS]: { researchPoints: { physics: 0, society: 0, engineering: 0 }, researched: new Set([...DEFAULT_RESEARCHED, 'orbital-construction']) }, [VENUS]: { researchPoints: { physics: 0, society: 0, engineering: 0 }, researched: new Set([...DEFAULT_RESEARCHED, 'orbital-construction']) } } })
  useResourceStore.setState({ byCountry: {} })
  useShipStore.setState({ ships: [] })
  for (const nation of [MARS, VENUS]) {
    useResourceStore.getState().setAmount(nation, 'influence', 500)
    for (const b of systemBodies('barnards-star')) useSurveyStore.getState().discover(nation, { kind: 'surveyed', bodyName: b }, 0, 0)
    const id = spawnOwnedShip('construction-ship', nation, 'barnards-star', "Barnard's Star")!
    useShipStore.getState().setShipCargo(id, { ...STARBASE_COST })
    const r = useStarbaseStore.getState().build(nation, 'barnards-star', 10, id)
    check(`${nation} starts a Starbase`, r.ok, r.ok ? '' : r.reason)
    useStarbaseStore.setState((st) => ({ starbases: st.starbases.filter((b) => b.ownerId === nation) }))
    if (nation === MARS) useStarbaseStore.setState({ starbases: [] })
  }
  const started = useDiplomacyStore.getState().events.filter((e) => e.kind === 'starbase-started')
  check('the player is told, naming the star and when it will be ready', started.length === 1 && started[0].countryIds[0] === MARS && /Barnard's Star/.test(started[0].text) && /ready about/.test(started[0].text))
  check('...another nation\'s start is not announced to them', !started.some((e) => e.countryIds.includes(VENUS)))
  check('a click on it goes to the system', JSON.stringify(eventDestination(started[0])) === JSON.stringify({ kind: 'system', starId: 'barnards-star' }))
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`)
process.exit(failures === 0 ? 0 : 1)
