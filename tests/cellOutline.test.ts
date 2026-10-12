// The fill and border of a set of ground cells (scene/cellOutline.ts): exact quads per cell, and a border that closes around the set.
//
// Run:  npx tsx tests/cellOutline.test.ts
import { cellShape } from '../src/scene/cellOutline'
import { surfaceMesh } from '../src/scene/surfaceMesh'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}
const mesh = surfaceMesh()
const node = 1000
const ring = [node, ...mesh.neighbors.fine[node]]

// Counts how often each point is an end of a border segment (a closed outline has every point twice).
function endpointCounts(lines: number[]): Map<string, number> {
  const m = new Map<string, number>()
  for (let i = 0; i < lines.length; i += 3) {
    const k = `${lines[i].toFixed(7)},${lines[i + 1].toFixed(7)},${lines[i + 2].toFixed(7)}`
    m.set(k, (m.get(k) ?? 0) + 1)
  }
  return m
}

console.log('\n=== One cell ===')
{
  const one = cellShape(new Set([node]))
  const around = mesh.neighbors.fine[node].length
  check('a cell is two triangles per mesh triangle it touches', one.tris.length / 9 === around * 2, `${one.tris.length / 9} triangles, ${around} neighbours`)
  check('its border is a closed loop (every point is the end of two segments)', one.lines.length > 0 && [...endpointCounts(one.lines).values()].every((n) => n === 2))
  check('its border has two segments per neighbouring cell', one.lines.length / 6 === around * 2)
}

console.log('\n=== A patch ===')
{
  const patch = cellShape(new Set(ring))
  const hole = cellShape(new Set(ring.slice(1)))
  check('the border of a patch is closed too', [...endpointCounts(patch.lines).values()].every((n) => n === 2))
  check('a patch with a hole has an outer and an inner border', hole.lines.length > patch.lines.length)
  check('two cells side by side share an edge: no border between them', cellShape(new Set([node, mesh.neighbors.fine[node][0]])).lines.length < 2 * cellShape(new Set([node])).lines.length)
  check('nothing in the set, nothing drawn', cellShape(new Set()).tris.length === 0)
  check('a filter can leave triangles out', cellShape(new Set(ring), () => true).tris.length === 0)
}

console.log(failures ? `\n${failures} FAILED` : '\nAll cell outline checks passed')
process.exit(failures ? 1 : 0)
