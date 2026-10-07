// Auto-explore for Turing Scouts (src/scene/autoExplore.ts, scene/automation.ts, state/clusterVisitStore.ts).
// Run:  npx tsx tests/autoExplore.test.ts
import { shipClusterId } from '../src/scene/clusters'
import { NEIGHBORHOODS } from '../src/data/neighborhoodData'
import { SOLAR_NEIGHBORHOOD_ID } from '../src/data/galaxyGen'
import { SHIP_CLASSES, TURING_HYPERDRIVE_COOLDOWN_DAYS } from '../src/data/shipData'
import { STARS } from '../src/data/starData'
import { resolveSurvey } from '../src/hooks/useSurveyResolver'
import { automationsFor, resolveAutomation } from '../src/scene/automation'
import { EXPLORE_RECHECK_DAYS, SOL_CLUSTER, claimedTargets, exploreKey, exploreStatusText, pickExploreTarget, type ExploreInput } from '../src/scene/autoExplore'
import { spawnOwnedShip } from '../src/scene/shipyardLogic'
import { systemOfShip } from '../src/scene/surveyLogic'
import { useClusterVisitStore } from '../src/state/clusterVisitStore'
import { useGameTimeStore } from '../src/state/gameTimeStore'
import { useHyperlaneStore } from '../src/state/hyperlaneStore'
import { usePlayerStore } from '../src/state/playerStore'
import { useShipStore } from '../src/state/shipStore'
import { useSurveyStore } from '../src/state/surveyStore'
import { useTechStore } from '../src/state/techStore'
import { useTerritoryStore } from '../src/state/territoryStore'
import { safeJumps } from './testWarp'

safeJumps()

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const MARS = 'imperial-state-of-mars'
const ship = (id: string) => useShipStore.getState().ships.find((s) => s.id === id)!

// A tiny world: a line of stars and clusters, so the expected choice is obvious.
const stars = [
  { id: 'a', position: [0, 0, 0] as const },
  { id: 'b', position: [1, 0, 0] as const },
  { id: 'c', position: [3, 0, 0] as const },
  { id: 'd', position: [7, 0, 0] as const },
]
const clusters = [
  { id: SOL_CLUSTER, position: [0, 0, 0] as const },
  { id: 'k1', position: [5, 0, 0] as const },
  { id: 'k2', position: [9, 0, 0] as const },
  { id: 'k3', position: [20, 0, 0] as const },
]
const base: ExploreInput = {
  scope: 'interstellar',
  hereStarId: 'a',
  hereClusterId: null,
  stars,
  clusters,
  isStarExplored: (id) => id === 'a',
  isClusterVisited: (id) => id === SOL_CLUSTER,
  claimed: new Set(),
}

console.log('\n=== 1. Target selection per scope (pure) ===')
{
  check('Solar Neighbourhood id matches the data', SOL_CLUSTER === SOLAR_NEIGHBORHOOD_ID)
  check('Interstellar: the nearest star not yet explored', pickExploreTarget(base)?.id === 'b' && pickExploreTarget(base)?.kind === 'star')
  check('...the nearest one FROM HERE, not from home', pickExploreTarget({ ...base, hereStarId: 'd', isStarExplored: (id) => id === 'd' })?.id === 'c')
  check('...an explored star is never picked again (no oscillation)', pickExploreTarget({ ...base, isStarExplored: (id) => id === 'a' || id === 'b' })?.id === 'c')
  check('Interstellar with every star explored: nothing (it never hops clusters)', pickExploreTarget({ ...base, isStarExplored: () => true }) === null)
  check('Intercluster: the nearest cluster not yet visited', pickExploreTarget({ ...base, scope: 'intercluster' })?.id === 'k1' && pickExploreTarget({ ...base, scope: 'intercluster' })?.kind === 'cluster')
  check('...a visited cluster is skipped', pickExploreTarget({ ...base, scope: 'intercluster', isClusterVisited: (id) => id === SOL_CLUSTER || id === 'k1' })?.id === 'k2')
  check('Both: the stars first', pickExploreTarget({ ...base, scope: 'both' })?.kind === 'star')
  check('...then the nearest cluster once the stars are done', pickExploreTarget({ ...base, scope: 'both', isStarExplored: () => true })?.id === 'k1')
  // Beside a foreign cluster: its stars cannot be flown to yet, only clusters are on offer.
  const foreign: ExploreInput = { ...base, scope: 'both', hereStarId: null, hereClusterId: 'k1', isClusterVisited: (id) => id === SOL_CLUSTER || id === 'k1' }
  check('beside a foreign cluster only clusters are offered, nearest from THERE', pickExploreTarget(foreign)?.kind === 'cluster' && pickExploreTarget(foreign)?.id === 'k2')
  check('...and Interstellar there has nothing to do', pickExploreTarget({ ...foreign, scope: 'interstellar' }) === null)
}

console.log('\n=== 2. Several scouts split the targets (pure) ===')
{
  const first = pickExploreTarget(base)!
  const claimed = claimedTargets([{ restingStarId: first.id, restingClusterId: null, pendingStarId: null, pendingClusterId: null }])
  const second = pickExploreTarget({ ...base, claimed })!
  check('the second scout skips the star the first is at', first.id === 'b' && second.id === 'c')
  const claims = claimedTargets([
    { restingStarId: 'b', restingClusterId: null, pendingStarId: 'c', pendingClusterId: null },
    { restingStarId: null, restingClusterId: 'k1', pendingStarId: null, pendingClusterId: 'k2' },
  ])
  check('a place a scout rests at or has a jump waiting to is claimed', ['star:b', 'star:c', 'cluster:k1', 'cluster:k2'].every((k) => claims.has(k)) && exploreKey({ kind: 'star', id: 'b' }) === 'star:b')
  check('three scouts take three different stars', (() => {
    let c = new Set<string>()
    const picks: string[] = []
    for (let i = 0; i < 3; i++) {
      const t = pickExploreTarget({ ...base, claimed: c })
      if (!t) break
      picks.push(t.id)
      c = new Set([...c, exploreKey(t)])
    }
    return new Set(picks).size === 3
  })())
}

console.log('\n=== 3. Only Turing Scouts, and they never survey ===')
{
  check('the Turing Scout offers Auto-explore and nothing else', automationsFor('civilian', 'turing-scout').join() === 'explore')
  check('the Hyperspace Scout offers nothing', automationsFor('civilian', 'hyperspace-scout').length === 0)
  check('no other class opts in', SHIP_CLASSES.filter((c) => c.autoExplore).map((c) => c.id).join() === 'turing-scout')
  check('a Science Ship still offers survey only', automationsFor('science', 'science-ship').join() === 'survey')
  check('Turing: a 7-day hyperdrive cooldown and no jump loss', TURING_HYPERDRIVE_COOLDOWN_DAYS === 7 && SHIP_CLASSES.find((c) => c.id === 'turing-scout')!.ftlDrives.some((d) => d.kind === 'hyperdrive' && d.cooldownDays === 7 && d.lossChanceOverride === 0))
  check('...and it defaults to Hyperdrive', SHIP_CLASSES.find((c) => c.id === 'turing-scout')!.defaultDrive === 'hyperdrive')
  check('the status lines are plain sentences', /nothing left to explore \(Interstellar\)/.test(exploreStatusText({ kind: 'nothing', scope: 'interstellar' })) && /Hyperdrive/.test(exploreStatusText({ kind: 'drive', chosen: 'Reaction' })) && /3 days/.test(exploreStatusText({ kind: 'cooldown', days: 2.2 })))
}

function fresh() {
  usePlayerStore.setState({ selectedCountryId: MARS, sandbox: false })
  useGameTimeStore.setState({ simDays: 0, paused: false })
  useShipStore.setState({ ships: [] })
  useSurveyStore.setState({ discovered: {}, known: {}, reports: [] })
  useClusterVisitStore.setState({ visited: {} })
  useHyperlaneStore.setState({ lanes: {} })
  useTerritoryStore.getState().reset()
  useTechStore.setState({ byCountry: { [MARS]: { researchPoints: { physics: 0, society: 0, engineering: 0 }, researched: new Set(['warp-theory', 'hyperdrive-mk1', 'hyperspace-theory', 'warp-comms', 'autonomous-navigation']) } } })
}
const turing = () => spawnOwnedShip('turing-scout', MARS, 'sol', 'Mars')!
const run = (from: number, to: number) => {
  for (let d = from; d <= to; d++) {
    useGameTimeStore.setState({ simDays: d })
    resolveAutomation(d)
    resolveSurvey(d)
  }
}
const exploredCount = () => useSurveyStore.getState().discovered[MARS]?.explored.size ?? 0

console.log('\n=== 4. A Turing Scout exploring the neighbourhood (headless) ===')
{
  fresh()
  const id = turing()
  useShipStore.getState().setAutomation(id, 'explore')
  check('scope defaults to Interstellar', ship(id).exploreScope === undefined)
  let surveyed = false
  const seen: string[] = []
  for (let d = 1; d <= 400; d++) {
    useGameTimeStore.setState({ simDays: d })
    resolveAutomation(d)
    resolveSurvey(d)
    if (ship(id).surveyJob) surveyed = true
    const at = systemOfShip(ship(id))
    if (at && seen[seen.length - 1] !== at) seen.push(at)
  }
  const nonHome = STARS.filter((s) => s.hasSystemData && s.id !== 'sol')
  check('it visited every other star of the neighbourhood', nonHome.every((s) => seen.includes(s.id)), `${seen.length} stars, in order ${seen.join(' > ')}`)
  check('...with no survey job, ever, and no body surveyed', !surveyed && (useSurveyStore.getState().discovered[MARS]?.surveyed.size ?? 0) === 0)
  check('...exploring each star (visiting records it)', nonHome.every((s) => useSurveyStore.getState().discovered[MARS]?.explored.has(s.id)))
  check('...each star once (it never went back)', new Set(seen).size === seen.length)
  check('it charted lanes by jumping', (useHyperlaneStore.getState().lanes[MARS]?.length ?? 0) >= nonHome.length - 1)
  check('with nothing left it says so and stays on', /nothing left to explore \(Interstellar\)/.test(ship(id).automationNote ?? '') && !!ship(id).automations?.includes('explore'))
  const wait = ship(id).exploreRecheckSimDays
  check(`...and rechecks only after ${EXPLORE_RECHECK_DAYS} days`, typeof wait === 'number' && wait > 400 && wait <= 400 + EXPLORE_RECHECK_DAYS)
}

console.log('\n=== 5. Cooldown, pause, drive ===')
{
  fresh()
  const id = turing()
  useShipStore.getState().setAutomation(id, 'explore')
  useGameTimeStore.setState({ simDays: 1 })
  resolveAutomation(1)
  const after = ship(id)
  const firstJumpAt = after.hyperdriveReadySimDays
  check('the first jump leaves the 7-day cooldown behind', firstJumpAt === 1 + TURING_HYPERDRIVE_COOLDOWN_DAYS && systemOfShip(after) !== 'sol')
  const here = systemOfShip(after)
  useGameTimeStore.setState({ simDays: 3 })
  resolveAutomation(3)
  check('on cooldown it does not move, and says when it is ready', systemOfShip(ship(id)) === here && /waiting for the hyperdrive/.test(ship(id).automationNote ?? ''))
  useGameTimeStore.setState({ simDays: firstJumpAt + 1, paused: true })
  resolveAutomation(firstJumpAt + 1)
  check('a paused game does not jump either (as for a manual order)', systemOfShip(ship(id)) === here)
  useGameTimeStore.setState({ paused: false })
  resolveAutomation(firstJumpAt + 1)
  check('...and the next jump comes once the drive is ready and the game runs', systemOfShip(ship(id)) !== here)
  useShipStore.getState().setDriveChoice(id, 'reaction')
  const there = systemOfShip(ship(id))
  useGameTimeStore.setState({ simDays: firstJumpAt + 40 })
  resolveAutomation(firstJumpAt + 40)
  check('set to Reaction it stops and asks for Hyperdrive', systemOfShip(ship(id)) === there && /needs the Hyperdrive/.test(ship(id).automationNote ?? ''))
}

console.log('\n=== 6. Two scouts split the neighbourhood (headless) ===')
{
  fresh()
  const a = turing()
  const b = turing()
  useShipStore.getState().setAutomation(a, 'explore')
  useShipStore.getState().setAutomation(b, 'explore')
  const firstStops: Record<string, string> = {}
  const visits: Record<string, string[]> = { [a]: [], [b]: [] }
  for (let d = 1; d <= 60; d++) {
    useGameTimeStore.setState({ simDays: d })
    resolveAutomation(d)
    resolveSurvey(d)
    for (const id of [a, b]) {
      const at = systemOfShip(ship(id))
      if (at && at !== 'sol' && !visits[id].includes(at)) visits[id].push(at)
      if (at && at !== 'sol' && !firstStops[id]) firstStops[id] = at
    }
  }
  check('they start on different stars', !!firstStops[a] && !!firstStops[b] && firstStops[a] !== firstStops[b], `${firstStops[a]} / ${firstStops[b]}`)
  check('...and never both visit the same star', visits[a].every((s) => !visits[b].includes(s)), `${visits[a].join(',')} | ${visits[b].join(',')}`)
}

console.log('\n=== 7. Intercluster and Both ===')
{
  fresh()
  const id = turing()
  useShipStore.getState().setAutomation(id, 'explore')
  useShipStore.getState().setExploreScope(id, 'intercluster')
  useGameTimeStore.setState({ simDays: 1 })
  resolveAutomation(1)
  const loc = ship(id).location
  // (A ship arriving at a cluster is at its entry point, inside it: tests/foreignCluster.test.ts.)
  check('Intercluster: it jumps to the nearest cluster (arriving at its entry point)', loc.kind === 'interstellar-point' && !!loc.clusterId && loc.clusterId !== SOLAR_NEIGHBORHOOD_ID, JSON.stringify(loc))
  const nearest = shipClusterId(ship(id)) ?? ''
  resolveSurvey(1)
  check('...being there records the visit', useClusterVisitStore.getState().isVisited(MARS, nearest) && !useClusterVisitStore.getState().isVisited(MARS, 'some-other'))
  check('...and the home cluster always counts as visited', useClusterVisitStore.getState().isVisited(MARS, SOLAR_NEIGHBORHOOD_ID))
  run(2, 20)
  const next = ship(id).location
  check('the next jump goes to ANOTHER cluster, not back', shipClusterId(ship(id)) !== nearest && shipClusterId(ship(id)) !== SOLAR_NEIGHBORHOOD_ID && next.kind === 'interstellar-point', JSON.stringify(next))
  check('hyperlanes between clusters were charted by the jumps', (useHyperlaneStore.getState().lanes[MARS]?.length ?? 0) >= 2)
  const solDist = (cid: string) => { const n = NEIGHBORHOODS.find((x) => x.id === cid)!, s = NEIGHBORHOODS[0]; return Math.hypot(n.position[0] - s.position[0], n.position[1] - s.position[1], n.position[2] - s.position[2]) }
  check('the first cluster really was the nearest to Sol', NEIGHBORHOODS.filter((n) => n.id !== SOLAR_NEIGHBORHOOD_ID).every((n) => solDist(nearest) <= solDist(n.id) + 1e-9))

  fresh()
  const both = turing()
  useShipStore.getState().setAutomation(both, 'explore')
  useShipStore.getState().setExploreScope(both, 'both')
  const kinds: string[] = []
  for (let d = 1; d <= 90; d++) {
    useGameTimeStore.setState({ simDays: d })
    resolveAutomation(d)
    resolveSurvey(d)
    const k = ship(both).location.kind
    if (kinds[kinds.length - 1] !== k) kinds.push(k)
  }
  check('Both: it explores the neighbourhood\'s stars, then crosses to a cluster', exploredCount() >= STARS.filter((s) => s.hasSystemData).length - 1 && shipClusterId(ship(both)) !== SOLAR_NEIGHBORHOOD_ID && ship(both).location.kind === 'interstellar-point', kinds.join(' > '))
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`)
process.exit(failures === 0 ? 0 : 1)
