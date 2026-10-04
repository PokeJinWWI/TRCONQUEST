// Quick buttons: pinned with the inner tab that was open, reopened on exactly it, old
// saved ones still working, and removable. See state/customButtonStore.ts.
//
// Run:  npx tsx tests/quickButtons.test.ts

import { readFileSync } from 'node:fs'
import {
  DEFAULT_CUSTOM_BUTTONS,
  innerTabsToSave,
  landingTabs,
  parseSavedButtons,
  pinId,
  pinLabel,
  samePin,
  useCustomButtonStore,
} from '../src/state/customButtonStore'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}
const NAVY: [string, string] = ['Fleet Management', 'Navy']

console.log('\n=== 1. What a pin saves ===')
{
  const w = innerTabsToSave(...NAVY, { fleetTab: 'shipyard', shipyardTab: 'warship' })
  const s = innerTabsToSave(...NAVY, { fleetTab: 'shipyard', shipyardTab: 'support' })
  check('from Shipyard > Warships: the Shipyard tab and the Warships subtab', w.fleetTab === 'shipyard' && w.shipyardTab === 'warship')
  check('from Shipyard > Science & support: its own subtab', s.fleetTab === 'shipyard' && s.shipyardTab === 'support')
  check('the two differ (they are separate subtabs)', w.shipyardTab !== s.shipyardTab && pinId(...NAVY, w) !== pinId(...NAVY, s))
  check('from another Navy tab: just that tab, no shipyard subtab', JSON.stringify(innerTabsToSave(...NAVY, { fleetTab: 'designer', shipyardTab: 'support' })) === JSON.stringify({ fleetTab: 'designer' }))
  check('from any other panel: nothing', Object.keys(innerTabsToSave('Technology', 'Physics', { fleetTab: 'shipyard', shipyardTab: 'slips' })).length === 0)
  check('Slips saves as its own subtab', innerTabsToSave(...NAVY, { fleetTab: 'shipyard', shipyardTab: 'slips' }).shipyardTab === 'slips')
}

console.log('\n=== 2. Where a button lands ===')
{
  const b = (inner: object) => ({ category: NAVY[0], subcategory: NAVY[1], ...inner })
  check('a saved Science & support button lands on exactly that', JSON.stringify(landingTabs(b({ fleetTab: 'shipyard', shipyardTab: 'support' }))) === JSON.stringify({ fleetTab: 'shipyard', shipyardTab: 'support' }))
  check('a saved Warships button lands on Warships', landingTabs(b({ fleetTab: 'shipyard', shipyardTab: 'warship' }))?.shipyardTab === 'warship')
  check('the built-in Shipyard button (no subtab) opens the Shipyard default', JSON.stringify(landingTabs(DEFAULT_CUSTOM_BUTTONS[0])) === JSON.stringify({ fleetTab: 'shipyard', shipyardTab: null }))
  check('an OLD Navy button (no inner tab at all) opens the tab\'s default', JSON.stringify(landingTabs(b({}))) === JSON.stringify({ fleetTab: 'manager', shipyardTab: null }))
  check('a subtab saved for another Navy tab is ignored', landingTabs(b({ fleetTab: 'designer', shipyardTab: 'support' }))?.shipyardTab === null)
  check('other panels have no inner tabs to land on', landingTabs({ category: 'Technology', subcategory: 'Physics' }) === null)
}

console.log('\n=== 3. Pinning, labels, duplicates, removal ===')
{
  useCustomButtonStore.setState({ buttons: [...DEFAULT_CUSTOM_BUTTONS] })
  const st = useCustomButtonStore.getState()
  const labels = { fleetTab: 'Shipyard', shipyardTab: 'Science & support' }
  check('pins the Science & support view', st.pin(...NAVY, { fleetTab: 'shipyard', shipyardTab: 'support' }, labels))
  check('...and the Warships view as a separate button', useCustomButtonStore.getState().pin(...NAVY, { fleetTab: 'shipyard', shipyardTab: 'warship' }, { fleetTab: 'Shipyard', shipyardTab: 'Warships' }))
  check('...the same view twice is refused', !useCustomButtonStore.getState().pin(...NAVY, { fleetTab: 'shipyard', shipyardTab: 'support' }, labels))
  const bs = useCustomButtonStore.getState().buttons
  check('three buttons, each saved with its own subtab', bs.length === 3 && bs[1].shipyardTab === 'support' && bs[2].shipyardTab === 'warship')
  check('labels say which view they open', bs[1].label === 'Navy · Shipyard · Science & support' && pinLabel('Technology', 'Physics', {}) === 'Physics', bs[1].label)
  check('samePin tells views apart', !samePin(bs[1], ...NAVY, { fleetTab: 'shipyard', shipyardTab: 'warship' }) && samePin(bs[1], ...NAVY, { fleetTab: 'shipyard', shipyardTab: 'support' }))
  check('a plain panel pin still works and dedupes', useCustomButtonStore.getState().pin('Technology', 'Physics') && !useCustomButtonStore.getState().pin('Technology', 'Physics'))
  useCustomButtonStore.getState().remove(bs[1].id)
  check('removing a pinned button removes just that one', !useCustomButtonStore.getState().buttons.some((b) => b.id === bs[1].id) && useCustomButtonStore.getState().buttons.some((b) => b.id === bs[2].id))
  useCustomButtonStore.getState().remove('shipyard')
  check('the built-in default cannot be removed', useCustomButtonStore.getState().buttons.some((b) => b.builtin))
  const nav = readFileSync('src/components/NavBar.tsx', 'utf8')
  check('every added button has a visible remove control (and the right-click still removes)', nav.includes('className="nav-custom-remove"') && nav.includes('!b.builtin &&') && /onContextMenu[\s\S]{0,120}removeButton/.test(nav))
}

console.log('\n=== 4. Surviving a reload ===')
{
  const saved = JSON.stringify([
    { id: 'pin:Fleet Management:Navy:shipyard:support', label: 'x', category: 'Fleet Management', subcategory: 'Navy', fleetTab: 'shipyard', shipyardTab: 'support' },
    { id: 'pin:Fleet Management:Navy', label: 'Navy', category: 'Fleet Management', subcategory: 'Navy' },
    { id: 'pin:Technology:Physics', label: 'Physics', category: 'Technology', subcategory: 'Physics' },
    { id: 5, label: 'bad' },
    'junk',
  ])
  const loaded = parseSavedButtons(saved)
  check('the default comes first, every valid saved pin follows, junk is dropped', loaded.length === 4 && loaded[0].builtin === true)
  check('a saved Science & support button keeps its subtab', loaded[1].shipyardTab === 'support' && loaded[1].fleetTab === 'shipyard')
  check('an old saved button with no inner tab loads without one and opens the default', loaded[2].fleetTab === undefined && loaded[2].shipyardTab === undefined && landingTabs(loaded[2])?.fleetTab === 'manager')
  check('no saved data, bad JSON or a non-list give just the default', parseSavedButtons(null).length === 1 && parseSavedButtons('{{').length === 1 && parseSavedButtons('{}').length === 1)
  check('a saved copy of the default is not doubled', parseSavedButtons(JSON.stringify([{ id: 'shipyard', label: 'Shipyard', category: 'Fleet Management', subcategory: 'Navy' }])).length === 1)
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`)
process.exit(failures === 0 ? 0 : 1)
