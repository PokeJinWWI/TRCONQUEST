// Quick buttons in the navigation bar. Run: npx tsx tests/customButtons.test.ts
import { useCustomButtonStore } from '../src/state/customButtonStore'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}
const st = () => useCustomButtonStore.getState()
const sy = st().buttons[0]
check('Shipyard is there from the start, opening Fleet Management > Navy > Shipyard', st().buttons.length === 1 && sy.label === 'Shipyard' && sy.category === 'Fleet Management' && sy.subcategory === 'Navy' && sy.fleetTab === 'shipyard' && !!sy.builtin)
check('a panel can be pinned', st().pin('Economy', 'Trade') && st().buttons.some((b) => b.label === 'Trade' && b.category === 'Economy'))
check('...once', !st().pin('Economy', 'Trade') && st().buttons.length === 2)
st().remove('pin:Economy:Trade')
check('a pinned button can be removed', st().buttons.length === 1)
st().remove('shipyard')
check('the default one cannot', st().buttons.length === 1)
console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILED`}`)
if (failures > 0) process.exit(1)
