// Shift+drag box selection, the pure part (src/scene/boxSelect.ts): the box a
// drag makes and which markers it takes. Run:  npx tsx tests/boxSelect.test.ts
import { BOX_SELECT_MIN_PX, isBoxDrag, pickInBox, rectFromDrag, type BoxCandidate } from '../src/scene/boxSelect'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const at = (kind: 'ship' | 'unit', id: string, x: number, y: number, size = 10): BoxCandidate => ({
  kind,
  id,
  rect: { left: x - size / 2, top: y - size / 2, right: x + size / 2, bottom: y + size / 2 },
})

console.log('\n=== The box ===')
{
  const r = rectFromDrag(300, 400, 100, 50)
  check('a drag in any direction gives the same box', r.left === 100 && r.top === 50 && r.right === 300 && r.bottom === 400)
  check('a tiny drag is a click, not a box', !isBoxDrag(10, 10, 10 + BOX_SELECT_MIN_PX - 1, 10 + BOX_SELECT_MIN_PX - 1))
  check('a real drag is a box', isBoxDrag(10, 10, 10 + BOX_SELECT_MIN_PX, 10))
}

console.log('\n=== What it takes ===')
{
  const box = rectFromDrag(100, 100, 300, 300)
  const got = pickInBox(box, [
    at('ship', 'a', 150, 150),
    at('ship', 'b', 299, 299),
    at('ship', 'outside', 400, 150),
    at('ship', 'above', 150, 50),
    at('unit', 'u1', 200, 250),
    at('unit', 'u-out', 99, 200),
    { kind: 'ship', id: 'hidden', rect: { left: 0, top: 0, right: 0, bottom: 0 } },
    at('ship', 'a', 150, 150),
  ])
  check('ships whose markers are inside are taken', got.ships.join() === 'a,b', got.ships.join())
  check('units are taken separately from ships', got.units.join() === 'u1', got.units.join())
  check('a marker that is not drawn (zero size) is never taken', !got.ships.includes('hidden'))
  check('an id is listed once', got.ships.filter((s) => s === 'a').length === 1)
  check('a marker straddling the edge counts by its centre', pickInBox(box, [at('ship', 'edge', 101, 200, 10)]).ships.length === 1 && pickInBox(box, [at('ship', 'edge', 96, 200, 10)]).ships.length === 0)
  check('an empty box takes nothing', pickInBox(box, []).ships.length === 0)
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`)
process.exit(failures === 0 ? 0 : 1)
