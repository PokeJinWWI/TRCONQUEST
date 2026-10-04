// Which Navy tab opens: a plain pick of Navy opens Fleet Manager (not the last tab used);
// a quick button or shipyard icon names its own. See state/fleetTabStore.navyTabOnOpen.
//
// Run:  npx tsx tests/navyTab.test.ts

import { readFileSync } from 'node:fs'
import { navyTabOnOpen, useFleetTabStore } from '../src/state/fleetTabStore'
import { FLEET_TABS } from '../src/components/FleetManagement'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}
const at = (category: string | null, subcategory: string | null) => ({ category, subcategory })
const FM = 'Fleet Management'

check('Fleet Manager is the first tab and the store default', FLEET_TABS[0].id === 'manager' && useFleetTabStore.getState().tab === 'manager')
check('entering Navy from Army opens Fleet Manager even if Shipyard was used last', navyTabOnOpen(at(FM, 'Army'), at(FM, 'Navy'), 'shipyard') === 'manager')
check('...from a closed window', navyTabOnOpen(at(null, null), at(FM, 'Navy'), 'shipyard') === 'manager')
check('...from another category', navyTabOnOpen(at('Economy', 'Budget'), at(FM, 'Navy'), 'designer') === 'manager')
check('clicking Navy while already on it leaves the tab alone', navyTabOnOpen(at(FM, 'Navy'), at(FM, 'Navy'), 'shipyard') === 'shipyard')
check('opening anything else leaves the stored tab alone', navyTabOnOpen(at(FM, 'Navy'), at(FM, 'Army'), 'shipyard') === 'shipyard' && navyTabOnOpen(at(null, null), at('Government', 'Laws'), 'strategizer') === 'strategizer')
const nav = readFileSync('src/components/NavBar.tsx', 'utf8')
check('the plain category and subtab clicks use it; quick buttons keep naming their own tab', (nav.match(/openNavyAtDefault\(/g) ?? []).length >= 2 && /landingTabs\(b\)/.test(nav))
const panel = readFileSync('src/components/ShipyardPanel.tsx', 'utf8')
check('in the Shipyard, Slips is the last subtab and the first is a hull group', panel.indexOf('Slips ({building') > panel.indexOf('sections.map') && /\?\? GROUPS\[0\]\.id/.test(panel))

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`)
process.exit(failures === 0 ? 0 : 1)
