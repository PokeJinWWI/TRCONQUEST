// The galaxy view's marker picking (scene/galaxyPick.ts) and the click-vs-drag
// rule every "click on empty space" handler uses (scene/dragGuard.ts).
// Run:  npx tsx tests/galaxyPick.test.ts
import { GALAXY_PICK_RADIUS_PX, pickNearest } from '../src/scene/galaxyPick'
import { DRAG_TOLERANCE_PX, wasDrag } from '../src/scene/dragGuard'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

console.log('\n=== Picking a marker by screen distance ===')
{
  const pts = [
    { id: 'a', x: 100, y: 100 },
    { id: 'b', x: 108, y: 100 },
    { id: 'far', x: 400, y: 400 },
  ]
  check('the nearest marker within reach is picked', pickNearest(pts, 101, 100) === 'a')
  check('...even with another close by: the nearer of the two', pickNearest(pts, 107, 100) === 'b')
  check('nothing within reach is nothing', pickNearest(pts, 250, 250) === null)
  check('the reach is a few pixels', GALAXY_PICK_RADIUS_PX >= 8 && GALAXY_PICK_RADIUS_PX <= 16)
  check('no markers is nothing', pickNearest([], 1, 1) === null)
}

console.log('\n=== A drag is not a click ===')
{
  const from = { x: 200, y: 200 }
  check('a still click is a click', !wasDrag({ clientX: 201, clientY: 200 }, from))
  check('a click within tolerance is a click', !wasDrag({ clientX: 200 + DRAG_TOLERANCE_PX, clientY: 200 }, from))
  check('letting go far from where it went down is a drag', wasDrag({ clientX: 260, clientY: 200 }, from))
  check('with no pointer-down on record it is treated as a click', !wasDrag({ clientX: 500, clientY: 500 }, null))
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`)
process.exit(failures === 0 ? 0 : 1)
