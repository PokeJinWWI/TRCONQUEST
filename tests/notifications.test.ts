// Notifications: where a click takes you, and a real-time clock that stands
// still while the game is paused. Plus where zooming out of a fight lands.
// Run: npx tsx tests/notifications.test.ts
import { TOAST_MS, eventDestination, goToEvent, tickToasts } from '../src/scene/eventNavigation'
import { combatPlaceOf } from '../src/state/combatStore'
import { useViewStore } from '../src/state/viewStore'
import { useWorkspaceStore } from '../src/state/workspaceStore'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

console.log('\n=== 1. Where a notification goes ===')
{
  const planet = eventDestination({ kind: 'body-occupied', place: { bodyName: 'Mars' } })
  check('an event on a planet goes to that planet', planet.kind === 'body' && planet.starId === 'sol' && planet.bodyName === 'Mars' && !planet.parentPlanet, JSON.stringify(planet))
  const moon = eventDestination({ kind: 'colony-founded', place: { bodyName: 'Titan' } })
  check("...on a moon, to the moon inside its planet's view", moon.kind === 'body' && moon.bodyName === 'Titan' && moon.parentPlanet === 'Saturn', JSON.stringify(moon))
  check('an event at a star goes to its system', eventDestination({ kind: 'installation-destroyed', place: { starId: 'alpha-centauri' } }).kind === 'system')
  const war = eventDestination({ kind: 'war-declared' })
  check('a war with no place opens Diplomacy › Wars', war.kind === 'panel' && war.subcategory === 'Wars')
  const treaty = eventDestination({ kind: 'treaty-signed' })
  check('a treaty opens Diplomacy › Treaties', treaty.kind === 'panel' && treaty.subcategory === 'Treaties')

  goToEvent({ kind: 'body-occupied', place: { bodyName: 'Earth' } })
  const v = useViewStore.getState()
  check('clicking it puts the view there, the body selected', v.level === 'system' && v.selectedStarId === 'sol' && v.inViewSelection === 'Earth')
  goToEvent({ kind: 'colony-founded', place: { bodyName: 'Phobos' } })
  const m = useViewStore.getState()
  check('...a moon: its planet\'s satellite view, the moon selected', m.level === 'satellite' && m.selectedBodyName === 'Mars' && m.inViewSelection === 'Phobos')
  goToEvent({ kind: 'war-declared' })
  check('...a war: the Wars tab opens', useViewStore.getState().activeNavCategory === 'Diplomacy' && useViewStore.getState().activeNavSubcategory === 'Wars')
}

console.log('\n=== 2. The notification clock ===')
{
  const t0 = [{ id: 'a', remainingMs: TOAST_MS }, { id: 'b', remainingMs: 300 }]
  check('paused, nothing counts down or disappears', tickToasts(t0, 1000, true) === t0)
  const t1 = tickToasts(t0, 200, false)
  check('running, the clock counts real milliseconds', t1[0].remainingMs === TOAST_MS - 200 && t1[1].remainingMs === 100)
  const t2 = tickToasts(t1, 200, false)
  check('...and a notification that runs out disappears', t2.length === 1 && t2[0].id === 'a')
  let t = t0
  for (let i = 0; i < 1000; i++) t = tickToasts(t, 200, true)
  check('however long the game stays paused, it stays', t.length === 2)
}

console.log('\n=== 3. Zooming out of a fight lands where the fight is ===')
{
  check('a fight over a body names its system and body', JSON.stringify(combatPlaceOf('body:alpha-centauri:Arcadia')) === JSON.stringify({ starId: 'alpha-centauri', bodyName: 'Arcadia' }))
  check('a fight at a star names the star', JSON.stringify(combatPlaceOf('star:barnards-star')) === JSON.stringify({ starId: 'barnards-star' }))
  useViewStore.setState({ level: 'combat', selectedStarId: 'sol', combatEngagementId: 'e1' })
  useViewStore.getState().exitCombat({ starId: 'alpha-centauri', bodyName: 'Arcadia' })
  const v = useViewStore.getState()
  check('exiting combat opens that system, framed on the body — not Sol', v.level === 'system' && v.selectedStarId === 'alpha-centauri' && v.selectedBodyName === 'Arcadia' && v.inViewSelection === 'Arcadia')
}

console.log('\n=== 4. Ctrl/Cmd-click opens a new tab in the background ===')
{
  const w = useWorkspaceStore.getState()
  const before = w.tabs.length
  w.openInNewTab({ activeNavCategory: 'Technology', activeNavSubcategory: 'Physics' })
  const after = useWorkspaceStore.getState()
  check('a tab is added but not switched to', after.tabs.length === before + 1 && after.activeTabId !== after.tabs.at(-1)!.id)
  check('...holding what was clicked', after.tabs.at(-1)!.view.activeNavCategory === 'Technology' && useViewStore.getState().activeNavCategory !== 'Technology')
}

console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILED`}`)
if (failures > 0) process.exit(1)
