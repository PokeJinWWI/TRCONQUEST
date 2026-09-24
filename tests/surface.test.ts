// The planetary map's geodesic grid (src/scene/surfaceMesh.ts).
//
// Run:  npx tsx tests/surface.test.ts

import { arc, moveAlong, nearestNode, nodePoint, normalize, surfaceMesh } from '../src/scene/surfaceMesh'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

// Seeded generator for repeatable random points.
let s = 12345
const rand = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296)

console.log('\n=== 1. Structure ===')
{
  const m = surfaceMesh()
  check('coarse / standard / fine have 162 / 642 / 2562 nodes', m.count.coarse === 162 && m.count.standard === 642 && m.count.fine === 2562)
  check('every node is on the unit sphere', Array.from({ length: m.count.fine }, (_, i) => Math.abs(Math.hypot(nodePoint(i).x, nodePoint(i).y, nodePoint(i).z) - 1)).every((d) => d < 1e-5))
  let symmetric = true
  let degreesOk = true
  for (const density of ['coarse', 'standard', 'fine'] as const) {
    m.neighbors[density].forEach((ns, i) => {
      if (ns.length < 5 || ns.length > 6) degreesOk = false
      for (const j of ns) if (!m.neighbors[density][j].includes(i)) symmetric = false
    })
  }
  check('adjacency is symmetric', symmetric)
  check('every node has 5 or 6 neighbours', degreesOk)
  const twelve = m.neighbors.fine.filter((ns) => ns.length === 5).length
  check('exactly 12 nodes have 5 neighbours (the icosahedron corners)', twelve === 12)
  // Nesting: a coarse node's nearest fine node is itself.
  check('densities nest — coarse nodes are fine nodes', Array.from({ length: 162 }, (_, i) => nearestNode(nodePoint(i), 'fine') === i).every(Boolean))
  const cellKm = (m.fineSpacingRad * 6371).toFixed(0)
  check('a fine cell is a few hundred km on an Earth-sized world', m.fineSpacingRad > 0.05 && m.fineSpacingRad < 0.1, `${cellKm} km`)
}

console.log('\n=== 2. nearestNode matches brute force ===')
{
  const m = surfaceMesh()
  let mismatches = 0
  for (let k = 0; k < 1000; k++) {
    const p = normalize({ x: rand() * 2 - 1, y: rand() * 2 - 1, z: rand() * 2 - 1 })
    for (const density of ['coarse', 'standard', 'fine'] as const) {
      let best = 0
      let bestArc = Infinity
      for (let i = 0; i < m.count[density]; i++) {
        const a = arc(p, nodePoint(i))
        if (a < bestArc) {
          bestArc = a
          best = i
        }
      }
      const got = nearestNode(p, density, Math.floor(rand() * m.count[density]))
      if (got !== best && Math.abs(arc(p, nodePoint(got)) - bestArc) > 1e-9) mismatches++
    }
  }
  check('3000 lookups (random hints) all find the true nearest node', mismatches === 0, `${mismatches} mismatches`)
}

console.log('\n=== 3. Moving along a path ===')
{
  const a = nodePoint(0)
  const b = nodePoint(surfaceMesh().neighbors.fine[0][0])
  const c = nodePoint(surfaceMesh().neighbors.fine[surfaceMesh().neighbors.fine[0][0]][2])
  const total = arc(a, b) + arc(b, c)
  const half = moveAlong(a, [b, c], total / 2)
  const travelled = arc(a, b) >= total / 2 ? arc(a, half.position) : arc(a, b) + arc(b, half.position)
  check('moves exactly the distance it was given', Math.abs(travelled - total / 2) < 1e-9)
  const done = moveAlong(a, [b, c], total * 2)
  check('...stops at the end of the path, reporting what was left', done.path.length === 0 && Math.abs(done.leftover - total) < 1e-9 && arc(done.position, c) < 1e-12)
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`)
process.exit(failures === 0 ? 0 : 1)
