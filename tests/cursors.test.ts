// The custom cursors (src/assets/cursors/*.svg, wired through the --cursor-*
// variables in src/index.css): every stylesheet rule and inline style asks for
// a cursor through a variable, never the bare `pointer` / `default` /
// `not-allowed` keyword, so the sci-fi cursors can't quietly regress to the
// system arrow. Run:  npx tsx tests/cursors.test.ts
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const css = readFileSync('src/index.css', 'utf8')
for (const name of ['pointer', 'target', 'blocked']) check(`cursor picture ${name}.svg exists`, existsSync(`src/assets/cursors/${name}.svg`))
for (const v of ['--cursor-default', '--cursor-pointer', '--cursor-blocked']) check(`${v} is defined with a keyword fallback`, new RegExp(`${v}:[^;]*url\\([^;]*,\\s*[a-z-]+;`).test(css))
check('the page default cursor is the deck pointer', /html\s*{[^}]*cursor:\s*var\(--cursor-default\)/.test(css))

const files: string[] = []
const walk = (dir: string) => {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) walk(p)
    else if (/\.(css|tsx?)$/.test(f)) files.push(p)
  }
}
walk('src')
const bare = /cursor\s*[:=]\s*['"]?(pointer|default|not-allowed)\b/
const offenders = files.filter((f) => f !== 'src/index.css').flatMap((f) => readFileSync(f, 'utf8').split('\n').map((l, i) => (bare.test(l) ? `${f}:${i + 1}` : '')).filter(Boolean))
check('no stylesheet rule or style sets a bare pointer/default/not-allowed cursor', offenders.length === 0, offenders.slice(0, 5).join(', '))

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`)
process.exit(failures === 0 ? 0 : 1)
