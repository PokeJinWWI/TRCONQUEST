// Galactic-view navigation: label picking, camera framing, the cluster window's distance rows,
// the open-space status line and Go To from the galaxy.
// Run:  npx tsx tests/galacticNavigation.test.ts
import { NEIGHBORHOODS, UNITS_PER_KLY, neighborhoodScenePosition } from '../src/data/neighborhoodData'
import { SOLAR_NEIGHBORHOOD_ID } from '../src/data/galaxyGen'
import { getStarsForNeighborhood, starScenePosition } from '../src/data/starData'
import { pickInRects, pickNearest } from '../src/scene/galaxyPick'
import { CLUSTER_FIT_MARGIN, boundingSphere, cameraAlong, fitDistance, nearestDistance, separationDistance, visibleAspect } from '../src/scene/framing'
import { clusterCoreDistanceKly, clusterDistanceRows, formatKly } from '../src/scene/clusterDistances'
import { homeClusterOf } from '../src/scene/homeCluster'
import { isClusterEntryPoint, openSpaceStatus } from '../src/scene/shipStatus'
import { clusterName } from '../src/scene/clusters'
import { getShipStatusText } from '../src/scene/shipPhysics'
import { viewShip } from '../src/scene/shipNav'
import { useViewStore } from '../src/state/viewStore'
import type { ShipInstance } from '../src/state/shipStore'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps

console.log('\n=== 1. A marker\'s label counts as the marker (right-click on the name) ===')
{
  const dots = [{ id: 'sel', x: 100, y: 100 }]
  const labels = [{ id: 'sel', left: 110, top: 92, right: 190, bottom: 108 }]
  check('the dot is picked by distance', pickNearest(dots, 102, 101) === 'sel')
  check('the name beside it is not a dot hit (the old bug: nothing picked, so it became a point order)', pickNearest(dots, 150, 100) === null)
  check('...but it is a label hit', pickInRects(labels, 150, 100) === 'sel')
  check('just outside the label is nothing', pickInRects(labels, 150, 120) === null && pickInRects(labels, 200, 100) === null)
  check('no labels is nothing', pickInRects([], 1, 1) === null)
}

console.log('\n=== 2. Framing ===')
{
  const sphere = boundingSphere([[0, 0, 0], [10, 0, 0], [0, 4, 0]])
  check('the sphere is about the middle of the bounding box', near(sphere.centre[0], 5) && near(sphere.centre[1], 2) && near(sphere.centre[2], 0))
  check('...holding every point', [[0, 0, 0], [10, 0, 0], [0, 4, 0]].every((p) => Math.hypot(p[0] - 5, p[1] - 2, p[2]) <= sphere.radius + 1e-9))
  check('no points: a zero sphere', boundingSphere([]).radius === 0)

  const d = fitDistance(50, 50, 1, 1)
  check('a sphere fits exactly at r / sin(half fov) with no margin', near(d, 50 / Math.sin((25 * Math.PI) / 180), 1e-6))
  check('margin pulls it further out', fitDistance(50, 50, 1, 1.3) > d)
  check('a narrow view is limited by its width, so it sits further out', fitDistance(50, 50, 0.5) > fitDistance(50, 50, 1))
  check('a wide view is not closer than a square one (the vertical fov limits it)', near(fitDistance(50, 50, 2), fitDistance(50, 50, 1)))

  check('the visible aspect is what is left between the side panels', near(visibleAspect(1024, 768, 440), (1024 - 440) / 768))
  check('...never absurdly narrow (a tiny window)', visibleAspect(300, 768, 440) >= 0.4 - 1e-9)
  check('fitting to it sits further out than fitting to the whole window', fitDistance(80, 50, visibleAspect(1024, 768, 440)) > fitDistance(80, 50, 1024 / 768))

  const p = cameraAlong([10, 0, 0], [0, 3, 4], 10)
  check('cameraAlong goes the given distance along the direction', near(Math.hypot(p[0] - 10, p[1], p[2]), 10) && near(p[1], 6) && near(p[2], 8))

  // Every real cluster: the framed camera really holds all of its stars in a 50-degree view.
  const fov = (50 * Math.PI) / 180
  let worst = 0
  let farthest = 0
  for (const n of NEIGHBORHOODS) {
    const pts = getStarsForNeighborhood(n.id).map(starScenePosition)
    if (pts.length === 0) continue
    const s = boundingSphere(pts)
    const dist = fitDistance(s.radius, 50, 1, CLUSTER_FIT_MARGIN)
    // The angle each star makes off the view axis (centre to camera).
    for (const q of pts) {
      const off = Math.hypot(q[0] - s.centre[0], q[1] - s.centre[1], q[2] - s.centre[2])
      worst = Math.max(worst, Math.atan(off / dist))
    }
    farthest = Math.max(farthest, dist)
  }
  check('every cluster\'s stars sit inside the view (half-fov 25 degrees)', worst < fov / 2, `worst ${((worst * 180) / Math.PI).toFixed(1)} deg`)
  check('...from a few hundred units, not the 2,600 the map used to open at', farthest < 600, `farthest ${farthest.toFixed(0)}`)

  // Default galaxy framing: the nearest neighbour lands the asked-for pixels away.
  const home = neighborhoodScenePosition(NEIGHBORHOODS.find((n) => n.id === SOLAR_NEIGHBORHOOD_ID)!)
  const others = NEIGHBORHOODS.filter((n) => n.id !== SOLAR_NEIGHBORHOOD_ID).map(neighborhoodScenePosition)
  const gap = nearestDistance(home, others)
  check('the nearest cluster to Sol is ~2.5 kly (75 units) away', near(gap / UNITS_PER_KLY, 2.5, 0.05), `${(gap / UNITS_PER_KLY).toFixed(2)} kly`)
  const dist = separationDistance(gap, 150, 50, 768)
  const pxPerUnit = 768 / (2 * dist * Math.tan(fov / 2))
  check('separationDistance puts the nearest cluster 150 px from home on a 768 px view', near(gap * pxPerUnit, 150, 1e-6))
  check('at the OLD default (1,836 out) it was ~34 px: under a badge and a ring', (gap * 768) / (2 * 1836 * Math.tan(fov / 2)) < 40)
  check('nearestDistance ignores the point itself and is Infinity with no others', nearestDistance([0, 0, 0], [[0, 0, 0]]) === Infinity && near(nearestDistance([0, 0, 0], [[3, 4, 0], [0, 0, 9]]), 5))
}

console.log('\n=== 3. The cluster window\'s distances ===')
{
  const home = homeClusterOf('imperial-state-of-mars')
  check('the player\'s home cluster is the one its capital is in', home === SOLAR_NEIGHBORHOOD_ID)
  check('a sandbox player (no nation) has no home', homeClusterOf(null) === null && homeClusterOf('sandbox-player') === null)

  const apus = 'arm3-227'
  const rows = clusterDistanceRows({ clusterId: apus, homeClusterId: home, ship: { name: 'Scout 1', place: { cluster: 'arm3-143' } } })
  check('two rows: from the ship and from home', rows.length === 2 && rows[0].label === 'From Scout 1' && rows[1].label === 'From home')
  check('from home to Apus is ~2.5 kly', near(rows[1].kly ?? -1, 2.5, 0.05), formatKly(rows[1].kly))
  const a = NEIGHBORHOODS.find((n) => n.id === apus)!
  const c = NEIGHBORHOODS.find((n) => n.id === 'arm3-143')!
  check('from a ship inside another cluster is the cluster-to-cluster distance', near(rows[0].kly ?? -1, Math.hypot(a.position[0] - c.position[0], a.position[1] - c.position[1], a.position[2] - c.position[2]), 1e-9))

  const inside = clusterDistanceRows({ clusterId: apus, homeClusterId: home, ship: { name: 'S', place: { cluster: apus } } })
  check('a ship already inside the cluster says so', inside[0].kly === null && formatKly(inside[0].kly) === 'inside this cluster')

  // A ship out between clusters, 30 units (1 kly) from Apus's own point.
  const at = neighborhoodScenePosition(a)
  const flying = clusterDistanceRows({ clusterId: apus, homeClusterId: home, ship: { name: 'S', place: { point: [at[0] + UNITS_PER_KLY, at[1], at[2]] } } })
  check('a ship between clusters is measured from its own point', near(flying[0].kly ?? -1, 1, 1e-9))

  check('no ship selected: only the home row', clusterDistanceRows({ clusterId: apus, homeClusterId: home, ship: null }).length === 1)
  check('home itself has no "from home" row', clusterDistanceRows({ clusterId: SOLAR_NEIGHBORHOOD_ID, homeClusterId: home, ship: null }).length === 0)
  check('no home (sandbox) and no ship: no rows', clusterDistanceRows({ clusterId: apus, homeClusterId: null, ship: null }).length === 0)
  check('distance from the core is the planar distance (Sol: 27.0 kly)', near(clusterCoreDistanceKly(SOLAR_NEIGHBORHOOD_ID), 27, 1e-6))
  check('formatKly: one decimal, and a small one reads as less than 0.1', formatKly(2.5) === '2.5 kly' && formatKly(0.01) === '< 0.1 kly')
}

console.log('\n=== 4. The open-space status line ===')
{
  const name = clusterName
  const entry = { kind: 'interstellar-point' as const, position: [0, 0, 0] as const, clusterId: 'arm3-227' }
  check('a foreign cluster\'s origin is its entry point', isClusterEntryPoint(entry))
  check('Sol\'s own origin is not an "entry point" (Sol is there)', !isClusterEntryPoint({ position: [0, 0, 0] }))
  check('a point elsewhere in a foreign cluster is not', !isClusterEntryPoint({ position: [5, 0, 0], clusterId: 'arm3-227' }))
  check('at the entry: the cluster is named (was "In Deep Space")', openSpaceStatus(entry, name, 0) === `At the entry point of ${name('arm3-227')}`, openSpaceStatus(entry, name, 0))
  check('elsewhere in a cluster: deep space of that cluster', openSpaceStatus({ kind: 'interstellar-point', position: [5, 0, 0], clusterId: 'arm3-227' }, name, 0) === `In ${name('arm3-227')}, Deep Space`)
  check('no clusterId means the Solar Neighbourhood', openSpaceStatus({ kind: 'interstellar-point', position: [5, 0, 0] }, name, 0) === `In ${name(SOLAR_NEIGHBORHOOD_ID)}, Deep Space`)
  check('waiting on the drive says so, with the days', openSpaceStatus(entry, name, 12.34) === `At the entry point of ${name('arm3-227')} — waiting for the drive (12.3d)`, openSpaceStatus(entry, name, 12.34))
  check('between clusters', openSpaceStatus({ kind: 'galactic-point' }, name, 0) === 'Between clusters' && openSpaceStatus({ kind: 'galactic-point' }, name, 2) === 'Between clusters — waiting for the drive (2.0d)')

  // Through the real status function: a resting ship, drive ready at day 40.
  const ship = (location: ShipInstance['location'], ready: number) =>
    ({ id: 's', name: 's', order: null, pendingHyperdriveJump: null, followingShipId: null, location, hyperdriveReadySimDays: ready, warpReadySimDays: 0 }) as unknown as ShipInstance
  const resting = ship({ kind: 'interstellar-point', position: [0, 0, 0], clusterId: 'arm3-227' }, 40)
  check('getShipStatusText: waiting for the drive', getShipStatusText(resting, 30) === `At the entry point of ${name('arm3-227')} — waiting for the drive (10.0d)`, getShipStatusText(resting, 30))
  check('...ready once the cooldown has run out', getShipStatusText(resting, 41) === `At the entry point of ${name('arm3-227')}`)
  check('a ship orbiting a body is untouched by it', getShipStatusText(ship({ kind: 'orbiting', systemId: 'sol', bodyName: 'Mars', periodDays: 20, phaseDeg: 0, inclinationDeg: 0 }, 99), 0) === 'In Sol System, orbiting Mars')
}

console.log('\n=== 5. Go To from the galaxy opens the cluster\'s map ===')
{
  const view = () => useViewStore.getState()
  const at = (level: 'galactic' | 'system' | 'interstellar') => useViewStore.setState({ level, selectedNeighborhoodId: SOLAR_NEIGHBORHOOD_ID, interstellarFromGalaxy: false })
  const entryShip = { order: null, location: { kind: 'interstellar-point', position: [0, 0, 0], clusterId: 'arm3-227' } } as unknown as ShipInstance
  const starShip = { order: null, location: { kind: 'orbiting', systemId: 'sol', bodyName: 'Mars', periodDays: 20, phaseDeg: 0, inclinationDeg: 0 } } as unknown as ShipInstance
  const outShip = { order: null, location: { kind: 'galactic-point', position: [1, 0, 1] } } as unknown as ShipInstance

  at('galactic')
  viewShip(entryShip)
  check('a ship at a foreign cluster\'s entry: that cluster\'s interstellar map', view().level === 'interstellar' && view().selectedNeighborhoodId === 'arm3-227')
  check('...arriving the way a zoom in from the galaxy does (framed on the cluster)', view().interstellarFromGalaxy === true)

  at('galactic')
  viewShip(starShip)
  check('a ship inside a system, pressed from the galaxy: its cluster\'s map, not the system', view().level === 'interstellar' && view().selectedNeighborhoodId === SOLAR_NEIGHBORHOOD_ID)

  at('system')
  viewShip(starShip)
  check('from elsewhere the system view is still what a ship in a system opens', view().level === 'system' && view().selectedStarId === 'sol')

  at('galactic')
  viewShip(outShip)
  check('a ship between clusters stays on the galaxy', view().level === 'galactic')
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`)
if (failures > 0) process.exit(1)
