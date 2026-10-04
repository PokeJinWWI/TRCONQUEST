// The route planner for hyperdrive jumps (scene/jumpRoute.ts): pure, on any graph
// of ids, so the same function plans between stars and between clusters.
// Run: npx tsx tests/jumpRoute.test.ts
import { planJumpRoute, type JumpRouteInput } from '../src/scene/jumpRoute'
import { JUMP_WARN_LOSS } from '../src/scene/jumpWarning'
import { AUTO_ROUTE_MAX_JUMPS } from '../src/data/shipData'
import { NEIGHBORHOODS } from '../src/data/neighborhoodData'
import { SOLAR_NEIGHBORHOOD_ID } from '../src/data/galaxyGen'
import { STARS } from '../src/data/starData'
import { usePlayerStore } from '../src/state/playerStore'
import { useShipStore } from '../src/state/shipStore'
import { useHyperlaneStore } from '../src/state/hyperlaneStore'
import { spawnOwnedShip } from '../src/scene/shipyardLogic'
import { clusterJumpChance, hyperdriveJumpChance, starJumpChance } from '../src/scene/shipPhysics'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps

// A graph given as "a>b": loss, the same both ways.
function graph(edges: Record<string, number>, over: Partial<JumpRouteInput> = {}): JumpRouteInput {
  const nodes = [...new Set(Object.keys(edges).flatMap((k) => k.split('>')))]
  return {
    from: 'A',
    to: 'D',
    nodes,
    lossOf: (a, b) => edges[`${a}>${b}`] ?? edges[`${b}>${a}`] ?? null,
    maxJumps: AUTO_ROUTE_MAX_JUMPS,
    safeLoss: JUMP_WARN_LOSS,
    maxLoss: JUMP_WARN_LOSS,
    ...over,
  }
}

console.log('\n=== 1. The route that loses the fewest ships ===')
{
  // Direct 30%; by B 10% + 10% = 19%; by C 20% + 2% = 21.6%.
  const r = planJumpRoute(graph({ 'A>D': 0.3, 'A>B': 0.1, 'B>D': 0.1, 'A>C': 0.2, 'C>D': 0.02 }, { maxLoss: 1 }))
  check('it minimises the TOTAL loss, not the worst jump or the jump count', r.ok && r.hops.join() === 'B,D', r.ok ? r.hops.join(' > ') : 'refused')
  check('the total is 1 - the product of each jump surviving', r.ok && near(r.totalLoss, 1 - 0.9 * 0.9))
  check('...and it is marked unsafe (a jump over the warning line)', r.ok && r.unsafe)
  const direct = planJumpRoute(graph({ 'A>D': 0.15, 'A>B': 0.1, 'B>D': 0.1 }, { maxLoss: 1 }))
  check('a direct jump wins when no detour loses less', direct.ok && direct.hops.join() === 'D' && near(direct.totalLoss, 0.15))
  const tie = planJumpRoute(graph({ 'A>D': 0.19, 'A>B': 0.1, 'B>D': 0.1 }, { maxLoss: 1 }))
  check('equal totals: the fewer jumps', tie.ok && tie.hops.length === 1)
}

console.log('\n=== 2. Safe jumps are always preferred ===')
{
  // Direct 6% (unsafe); two safe jumps of 4% = 7.8% total, more than the direct jump.
  const edges = { 'A>D': 0.06, 'A>B': 0.04, 'B>D': 0.04 }
  const off = planJumpRoute(graph(edges))
  const on = planJumpRoute(graph(edges, { maxLoss: 1 }))
  check('two safe jumps beat one unsafe one, box off', off.ok && off.hops.join() === 'B,D' && !off.unsafe)
  check('...and box on too, even though the unsafe jump loses less in total', on.ok && on.hops.join() === 'B,D' && !on.unsafe)
  // Two safer jumps beat one dangerous one on the total as well.
  const safer = planJumpRoute(graph({ 'A>D': 0.5, 'A>B': 0.03, 'B>D': 0.03 }))
  check('two safer jumps beat one dangerous jump', safer.ok && safer.hops.length === 2 && near(safer.totalLoss, 1 - 0.97 * 0.97))
  check('exactly the warning line counts as safe', planJumpRoute(graph({ 'A>D': JUMP_WARN_LOSS })).ok)
  const among = planJumpRoute(graph({ 'A>D': 0.05, 'A>B': 0.01, 'B>D': 0.01 }))
  check('among safe routes it still takes the smallest total', among.ok && among.hops.join() === 'B,D')
}

console.log('\n=== 3. Box off refuses a route that needs an unsafe jump ===')
{
  const edges = { 'A>D': 0.3, 'A>B': 0.1, 'B>D': 0.02 }
  const off = planJumpRoute(graph(edges))
  check('no route of safe jumps: refused', !off.ok)
  check('...saying what the direct jump risks and the limit', !off.ok && off.directLoss === 0.3 && off.limit === JUMP_WARN_LOSS)
  const on = planJumpRoute(graph(edges, { maxLoss: 1 }))
  check('box on takes it, by the smallest total', on.ok && on.hops.join() === 'B,D' && on.unsafe)
  const capped = planJumpRoute(graph(edges, { maxLoss: 0.2 }))
  check('the max risk caps each jump: 10% + 2% passes under 20%', capped.ok && capped.hops.join() === 'B,D')
  const tight = planJumpRoute(graph({ 'A>D': 0.3, 'A>B': 0.25, 'B>D': 0.02 }, { maxLoss: 0.2 }))
  check('...and a route whose every option has a jump over it is refused', !tight.ok && tight.limit === 0.2)
  const none = planJumpRoute(graph({ 'A>B': 0.01 }))
  check('no jump there at all: refused with no direct loss', !none.ok && none.directLoss === null)
  check('a jump that is certain loss is never taken', !planJumpRoute(graph({ 'A>D': 1 }, { maxLoss: 1 })).ok)
}

console.log('\n=== 4. The cap on jumps ===')
{
  // A chain A-B-C-E-F-D of safe jumps (5), and nothing shorter.
  const chain = { 'A>B': 0.01, 'B>C': 0.01, 'C>E': 0.01, 'E>F': 0.01, 'F>D': 0.01 }
  check(`a route needing 5 jumps is refused at the cap of ${AUTO_ROUTE_MAX_JUMPS}`, AUTO_ROUTE_MAX_JUMPS === 4 && !planJumpRoute(graph(chain)).ok)
  const five = planJumpRoute(graph(chain, { maxJumps: 5 }))
  check('...and found when 5 are allowed', five.ok && five.hops.join() === 'B,C,E,F,D')
  const four = planJumpRoute(graph({ 'A>B': 0.01, 'B>C': 0.01, 'C>E': 0.01, 'E>D': 0.01, 'A>D': 0.5 }))
  check('four safe jumps are taken over one dangerous one', four.ok && four.hops.length === 4 && !four.unsafe)
  check('a stop is never the start again', four.ok && !four.hops.includes('A'))
}

console.log('\n=== 5. Between real stars: any star may be a stopover, charted or not ===')
const MARS = 'imperial-state-of-mars'
const VENUS = 'republic-of-venus'
{
  usePlayerStore.setState({ selectedCountryId: MARS, sandbox: false, economyModel: 'abstract' })
  useShipStore.setState({ ships: [] })
  useHyperlaneStore.setState({ lanes: {} })
  const id = spawnOwnedShip('science-ship', MARS, 'sol', 'Mars')!
  const ship = useShipStore.getState().ships.find((s) => s.id === id)!
  const stars = STARS.map((s) => s.id)
  check('a hop from where the ship is has the chance the game rolls (single-hop values preserved)', STARS.every((s) => s.id === 'sol' || near(starJumpChance(ship, 'sol', s.id)!, hyperdriveJumpChance(ship, s.id, 0)!)))
  const plan = (to: string, maxLoss: number) => planJumpRoute({ from: 'sol', to, nodes: stars, lossOf: (a, b) => starJumpChance(ship, a, b), maxJumps: AUTO_ROUTE_MAX_JUMPS, safeLoss: JUMP_WARN_LOSS, maxLoss })
  const direct = starJumpChance(ship, 'sol', 'lalande-21185')!
  const route = plan('lalande-21185', 1)
  check('to Lalande 21185 it stops over at Wolf 359, an uncharted star, because that loses less', route.ok && route.hops.join() === 'wolf-359,lalande-21185' && route.totalLoss < direct, route.ok ? `${(route.totalLoss * 100).toFixed(1)}% against ${(direct * 100).toFixed(1)}% direct` : 'refused')
  check('with the box off nothing outside Sol is in reach at Hyperdrive Mk I', stars.every((s) => s === 'sol' || !plan(s, JUMP_WARN_LOSS).ok))
  // A charted lane is a cheaper edge for the nation that charted it only.
  useHyperlaneStore.getState().addHyperlane(MARS, 'sol', 'lalande-21185')
  const charted = plan('lalande-21185', 1)
  check('once its own nation has charted the direct lane, the direct jump wins', charted.ok && charted.hops.join() === 'lalande-21185' && near(charted.totalLoss, direct * 0.2, 1e-6))
  useHyperlaneStore.setState({ lanes: {} })
  useHyperlaneStore.getState().addHyperlane(VENUS, 'sol', 'lalande-21185')
  const foreign = plan('lalande-21185', 1)
  check('a lane another nation charted changes nothing', foreign.ok && foreign.hops.join() === 'wolf-359,lalande-21185')
  useHyperlaneStore.setState({ lanes: {} })

  console.log('\n=== 6. Between clusters: the same planner on the cluster graph ===')
  const clusters = [...NEIGHBORHOODS].sort((a, b) => Math.hypot(...a.position) - Math.hypot(...b.position))
  const home = NEIGHBORHOODS.find((n) => n.id === SOLAR_NEIGHBORHOOD_ID)!
  const byDistance = NEIGHBORHOODS.filter((n) => n.id !== home.id).sort((a, b) => Math.hypot(a.position[0] - home.position[0], a.position[1] - home.position[1], a.position[2] - home.position[2]) - Math.hypot(b.position[0] - home.position[0], b.position[1] - home.position[1], b.position[2] - home.position[2]))
  const nearest = byDistance[0].id
  const some = [home.id, ...byDistance.slice(0, 12).map((n) => n.id)]
  check('there are clusters to plan between', clusters.length > 12)
  const hop = clusterJumpChance(ship, home.id, nearest)!
  check('a cluster hop has the chance the game rolls for a jump to that cluster', near(hop, hyperdriveJumpChance(ship, { kind: 'cluster', clusterId: nearest }, 0)!), `${(hop * 100).toFixed(1)}%`)
  check('a cluster id is not a star and a star id is not a cluster (the two graphs stay apart)', starJumpChance(ship, home.id, nearest) === null && clusterJumpChance(ship, 'sol', 'sirius') === null)
  const planClusters = (maxLoss: number) => planJumpRoute({ from: home.id, to: nearest, nodes: some, lossOf: (a, b) => clusterJumpChance(ship, a, b), maxJumps: AUTO_ROUTE_MAX_JUMPS, safeLoss: JUMP_WARN_LOSS, maxLoss })
  check('at Hyperdrive Mk I no cluster is in safe reach', !planClusters(JUMP_WARN_LOSS).ok)
  useHyperlaneStore.getState().addHyperlane(MARS, home.id, nearest)
  check('a charted cluster lane is a fifth of the risk, for its nation', near(clusterJumpChance(ship, home.id, nearest)!, Math.min(1, hop) * 0.2, 1e-6) || hop >= 1)
  useHyperlaneStore.setState({ lanes: {} })
}

console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILED`}`)
if (failures > 0) process.exit(1)
