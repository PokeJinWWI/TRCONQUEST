// Verification that HUD windows remember the size the player dragged them to,
// for the game session only (state/windowLayoutStore.ts, DraggableWindow).
// Run:  npx tsx tests/windowLayout.test.ts

import { readFileSync } from 'node:fs'
import { useWindowLayoutStore } from '../src/state/windowLayoutStore'
import { resetGame } from '../src/scene/gameReset'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

console.log('=== 1. Sizes are remembered per window ===')
{
  const st = useWindowLayoutStore.getState()
  st.rememberSize('Economy', { width: 700, height: 500 })
  st.rememberSize('planet', { width: 600, height: 720 })
  const sizes = useWindowLayoutStore.getState().sizes
  check('each window keeps its own size', sizes.Economy.width === 700 && sizes.planet.height === 720)
  useWindowLayoutStore.getState().rememberSize('Economy', { width: 640, height: 480 })
  check('a later resize replaces it', useWindowLayoutStore.getState().sizes.Economy.width === 640 && useWindowLayoutStore.getState().sizes.planet.width === 600)
}

console.log('\n=== 2. Only for this game session ===')
{
  resetGame()
  check('quitting the game forgets every size', Object.keys(useWindowLayoutStore.getState().sizes).length === 0)
  const src = readFileSync(new URL('../src/state/windowLayoutStore.ts', import.meta.url), 'utf8')
  check('nothing is written to browser storage', !/localStorage|sessionStorage|persist\(/.test(src))
}

console.log('\n=== 3. The window reads and writes it ===')
{
  const src = readFileSync(new URL('../src/components/DraggableWindow.tsx', import.meta.url), 'utf8')
  check('opens at the remembered size before the preset', /sizes\[sizeKey\] \?\? defaultSize/.test(src))
  check('remembers the size when a resize ends', /rememberSize\(sizeKey/.test(src))
  const inspect = readFileSync(new URL('../src/components/InspectPanel.tsx', import.meta.url), 'utf8')
  check('the planet window uses one key for every planet', (inspect.match(/memoryKey="planet"/g) ?? []).length === 2)
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
