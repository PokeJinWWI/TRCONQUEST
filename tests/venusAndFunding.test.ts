// Two small rules from review: Venus has no desert (it is terraformed, like Mars), and the government spends only the government's money
// (no player build entry point lets a company's investment pool pay for an order).
//
// Run:  npx tsx tests/venusAndFunding.test.ts
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { surfaceOf, terrainAt } from '../src/scene/planetTerrain'
import { surfaceMesh } from '../src/scene/surfaceMesh'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

console.log('\n=== Venus and Mars have no desert ===')
for (const body of ['Venus', 'Mars']) {
  const surface = surfaceOf(body, 'wild')
  const n = surfaceMesh().count.fine
  let desert = 0
  let plains = 0
  for (let i = 0; i < n; i++) {
    const t = terrainAt(surface, i)
    if (t === 'desert') desert++
    if (t === 'plains') plains++
  }
  check(`${body}: no desert node, plenty of plains`, desert === 0 && plains > 1000, `${desert} desert, ${plains} plains`)
}

console.log('\n=== The government builds with the government\'s money ===')
{
  const strip = (f: string) => readFileSync(f, 'utf8').replace(/\/\/.*$/gm, '')
  const files: string[] = []
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.tsx$/.test(f)) files.push(p)
    }
  }
  walk('src/components')
  walk('src/scene')
  const bad = files.filter((f) => /kind: 'corporation'/.test(strip(f)) && /queueConstruction/.test(strip(f)))
  check('no UI file that queues construction names a corporation as the owner', bad.length === 0, bad.join(', '))
  check('the Build as selector is gone', !files.some((f) => /Build as:|Owner \/ funding/.test(strip(f))))
}

console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed')
process.exit(failures ? 1 : 0)
