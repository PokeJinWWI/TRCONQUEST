// Ship map icons (src/scene/ShipIcon.tsx): every ship role has its own
// silhouette in the stylesheet, every hull class resolves to one, and the
// civilian roles are told apart from the warship triangle.
// Run:  npx tsx tests/shipIcons.test.ts
import { readFileSync } from 'node:fs'
import { SHIP_CLASSES, SHIP_ROLE_LABELS } from '../src/data/shipData'
import { SHIP_ICON_SIZE, SHIP_ROLE_SHAPES, roleOfClass } from '../src/scene/ShipIcon'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const css = readFileSync('src/App.css', 'utf8')
const roles = Object.keys(SHIP_ROLE_LABELS)
const shapeOf = (role: string) => css.match(new RegExp(`\\.ship-role-${role} \\.ship-shape \\{ clip-path: ([^;]+);`))?.[1]
for (const role of roles) {
  check(`${role} has a silhouette and a legend line`, !!shapeOf(role) && !!(SHIP_ROLE_SHAPES as Record<string, string>)[role])
}
check('every role has a different silhouette', new Set(roles.map(shapeOf)).size === roles.length)
check('every hull class resolves to a role with a silhouette', SHIP_CLASSES.every((c) => roles.includes(roleOfClass(c.id))))
check('a science, a construction and a cargo ship look different from each other and from a warship', new Set(['science-ship', 'construction-ship', 'cargo-ship', 'destroyer'].map((id) => shapeOf(roleOfClass(id)!))).size === 4)
check('icons are bigger between the stars than inside a system, but not huge', SHIP_ICON_SIZE.interstellar > SHIP_ICON_SIZE.system && SHIP_ICON_SIZE.interstellar <= 16)

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`)
process.exit(failures === 0 ? 0 : 1)
