// Pure-function/store verification of the workspace tabs system (see
// src/state/workspaceStore.ts, src/state/viewStore.ts's activeNavCategory).
//
// Run:  npx tsx tests/workspace.test.ts

import { useWorkspaceStore } from '../src/state/workspaceStore'
import { useViewStore } from '../src/state/viewStore'
import { useShipStore } from '../src/state/shipStore'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

console.log('\n=== 1. A fresh app starts with exactly one tab, matching real documented defaults ===')
{
  const { tabs, activeTabId } = useWorkspaceStore.getState()
  check('exactly one tab at start', tabs.length === 1)
  check('that tab is active', tabs[0].id === activeTabId)
  check('default level is system', tabs[0].view.level === 'system')
  check('default star is sol', tabs[0].view.selectedStarId === 'sol')
  check('default neighborhood is solar-neighborhood', tabs[0].view.selectedNeighborhoodId === 'solar-neighborhood')
  check('no NavBar window open by default', tabs[0].view.activeNavCategory === null)
  check('no ship selected by default', tabs[0].selectedShipId === null)
  check('a fresh tab has no custom name (falls back to the auto-derived label)', tabs[0].name === null)
  check('the tab strip is hidden by default (ResourceBar shows instead)', useWorkspaceStore.getState().showTabBar === false)
  // The live stores actually reflect the same defaults at app start.
  check('live viewStore matches', useViewStore.getState().level === 'system' && useViewStore.getState().selectedStarId === 'sol')
}

console.log('\n=== 2. createTab: snapshots the outgoing tab, opens a fresh default one ===')
{
  // Mutate the live stores as if the player navigated and opened a window.
  useViewStore.setState({
    level: 'satellite',
    selectedStarId: 'sol',
    selectedBodyName: 'Mars',
    inViewSelection: 'Mars',
    combatEngagementId: null,
  })
  useViewStore.getState().setNavCategory('Technology', 'Physics')
  useShipStore.getState().selectShip('some-ship-id')

  const before = useWorkspaceStore.getState()
  const firstTabId = before.activeTabId
  useWorkspaceStore.getState().createTab()
  const after = useWorkspaceStore.getState()

  check('a second tab now exists', after.tabs.length === 2)
  check('the new tab is the active one', after.activeTabId !== firstTabId)

  const firstTab = after.tabs.find((t) => t.id === firstTabId)!
  check('the FIRST tab captured the mutated state before switching away', firstTab.view.level === 'satellite' && firstTab.view.selectedBodyName === 'Mars')
  check('...including the NavBar window that was open', firstTab.view.activeNavCategory === 'Technology' && firstTab.view.activeNavSubcategory === 'Physics')
  check('...including the selected ship', firstTab.selectedShipId === 'some-ship-id')

  const newTab = after.tabs.find((t) => t.id === after.activeTabId)!
  check('the NEW tab has the real default state, not a copy of the old one', newTab.view.level === 'system' && newTab.view.selectedBodyName === null)
  check('the new tab has no NavBar window open', newTab.view.activeNavCategory === null)
  check('the new tab has no ship selected', newTab.selectedShipId === null)

  // The live stores must ALSO reflect the fresh tab immediately — this is
  // what makes every existing scene component "just work" without knowing
  // tabs exist: they read the live stores, not the workspace store.
  check('live viewStore now shows the fresh defaults', useViewStore.getState().level === 'system' && useViewStore.getState().selectedBodyName === null)
  check('live shipStore has no selection', useShipStore.getState().selectedShipId === null)
}

console.log('\n=== 3. switchToTab: round-trips state exactly, both directions ===')
{
  const { tabs } = useWorkspaceStore.getState()
  const [firstTabId, secondTabId] = tabs.map((t) => t.id)

  // Currently on the second (fresh) tab — mutate it distinctly.
  useViewStore.setState({ level: 'interstellar', selectedNeighborhoodId: 'solar-neighborhood', inViewSelection: 'alpha-centauri' })
  useShipStore.getState().selectShip('second-tab-ship')

  useWorkspaceStore.getState().switchToTab(firstTabId)
  check('active tab id updated', useWorkspaceStore.getState().activeTabId === firstTabId)
  check('switching back restores the FIRST tab\'s satellite/Mars state exactly', useViewStore.getState().level === 'satellite' && useViewStore.getState().selectedBodyName === 'Mars')
  check('...its NavBar window too', useViewStore.getState().activeNavCategory === 'Technology' && useViewStore.getState().activeNavSubcategory === 'Physics')
  check('...its ship selection too', useShipStore.getState().selectedShipId === 'some-ship-id')

  useWorkspaceStore.getState().switchToTab(secondTabId)
  check('switching forward restores the SECOND tab\'s interstellar state exactly', useViewStore.getState().level === 'interstellar' && useViewStore.getState().inViewSelection === 'alpha-centauri')
  check('...its ship selection too', useShipStore.getState().selectedShipId === 'second-tab-ship')

  check('switching to the already-active tab is a harmless no-op', (() => {
    const before2 = { ...useViewStore.getState() }
    useWorkspaceStore.getState().switchToTab(secondTabId)
    return useViewStore.getState().level === before2.level && useViewStore.getState().inViewSelection === before2.inViewSelection
  })())

  check('switching to a nonexistent tab id does nothing', (() => {
    const activeBefore = useWorkspaceStore.getState().activeTabId
    useWorkspaceStore.getState().switchToTab('not-a-real-tab-id')
    return useWorkspaceStore.getState().activeTabId === activeBefore
  })())
}

console.log('\n=== 4. lockOnEnabled is deliberately global — never touched by a tab switch ===')
{
  useViewStore.setState({ lockOnEnabled: false })
  const { tabs, activeTabId } = useWorkspaceStore.getState()
  const otherTab = tabs.find((t) => t.id !== activeTabId)!
  useWorkspaceStore.getState().switchToTab(otherTab.id)
  check('lockOnEnabled survived the switch unchanged', useViewStore.getState().lockOnEnabled === false)
  useViewStore.setState({ lockOnEnabled: true }) // restore for cleanliness
}

console.log('\n=== 5. closeTab ===')
{
  useWorkspaceStore.setState({
    tabs: [
      { id: 'a', view: { level: 'system', selectedNeighborhoodId: 'solar-neighborhood', selectedStarId: 'sol', selectedBodyName: null, inViewSelection: null, combatEngagementId: null, activeNavCategory: null, activeNavSubcategory: null, techTreeOpen: false }, selectedShipId: null, name: null },
      { id: 'b', view: { level: 'combat', selectedNeighborhoodId: 'solar-neighborhood', selectedStarId: 'sol', selectedBodyName: null, inViewSelection: null, combatEngagementId: 'eng-1', activeNavCategory: null, activeNavSubcategory: null, techTreeOpen: false }, selectedShipId: null, name: null },
      { id: 'c', view: { level: 'galactic', selectedNeighborhoodId: 'solar-neighborhood', selectedStarId: 'sol', selectedBodyName: null, inViewSelection: null, combatEngagementId: null, activeNavCategory: null, activeNavSubcategory: null, techTreeOpen: false }, selectedShipId: null, name: null },
    ],
    activeTabId: 'b',
  })
  useViewStore.setState({ level: 'combat', combatEngagementId: 'eng-1' })

  // Closing a NON-active tab leaves the active one completely undisturbed.
  useWorkspaceStore.getState().closeTab('c')
  check('closing a background tab removes it', useWorkspaceStore.getState().tabs.length === 2)
  check('the active tab is unaffected', useWorkspaceStore.getState().activeTabId === 'b' && useViewStore.getState().level === 'combat')

  // Closing the ACTIVE tab lands on its left neighbor.
  useWorkspaceStore.getState().closeTab('b')
  check('closing the active tab removes it', useWorkspaceStore.getState().tabs.length === 1)
  check('...and lands on the tab to its left', useWorkspaceStore.getState().activeTabId === 'a')
  check('...restoring that tab\'s own state live', useViewStore.getState().level === 'system')

  check('closing the last remaining tab is refused', (() => {
    useWorkspaceStore.getState().closeTab('a')
    return useWorkspaceStore.getState().tabs.length === 1 && useWorkspaceStore.getState().tabs[0].id === 'a'
  })())
}

console.log('\n=== 6. renameTab and toggleTabBar ===')
{
  useWorkspaceStore.setState({
    tabs: [
      { id: 'x', view: { level: 'system', selectedNeighborhoodId: 'solar-neighborhood', selectedStarId: 'sol', selectedBodyName: null, inViewSelection: null, combatEngagementId: null, activeNavCategory: null, activeNavSubcategory: null, techTreeOpen: false }, selectedShipId: null, name: null },
      { id: 'y', view: { level: 'combat', selectedNeighborhoodId: 'solar-neighborhood', selectedStarId: 'sol', selectedBodyName: null, inViewSelection: null, combatEngagementId: null, activeNavCategory: null, activeNavSubcategory: null, techTreeOpen: false }, selectedShipId: null, name: null },
    ],
    activeTabId: 'x',
  })

  useWorkspaceStore.getState().renameTab('y', 'Home Fleet Defense')
  check('renaming a BACKGROUND tab (not the active one) works directly', useWorkspaceStore.getState().tabs.find((t) => t.id === 'y')!.name === 'Home Fleet Defense')
  check('renaming one tab does not touch another', useWorkspaceStore.getState().tabs.find((t) => t.id === 'x')!.name === null)

  useWorkspaceStore.getState().renameTab('x', 'Scouting')
  check('renaming the ACTIVE tab works too', useWorkspaceStore.getState().tabs.find((t) => t.id === 'x')!.name === 'Scouting')

  useWorkspaceStore.getState().switchToTab('y')
  check('a custom name survives being snapshotted out on a tab switch', useWorkspaceStore.getState().tabs.find((t) => t.id === 'x')!.name === 'Scouting')
  check('...and survives being the active tab through a switch too', useWorkspaceStore.getState().tabs.find((t) => t.id === 'y')!.name === 'Home Fleet Defense')

  useWorkspaceStore.getState().renameTab('y', '')
  check('renaming to an empty/falsy value clears back to the auto-derived label (null)', useWorkspaceStore.getState().tabs.find((t) => t.id === 'y')!.name === null)

  const before = useWorkspaceStore.getState().showTabBar
  useWorkspaceStore.getState().toggleTabBar()
  check('toggleTabBar flips the flag', useWorkspaceStore.getState().showTabBar === !before)
  useWorkspaceStore.getState().toggleTabBar()
  check('...and flips back', useWorkspaceStore.getState().showTabBar === before)
}

console.log('\n=== 7. techTreeOpen survives a tab switch away and back (the bug this field was added to fix) ===')
{
  useWorkspaceStore.setState({
    tabs: [
      {
        id: 'tree-a',
        view: {
          level: 'system',
          selectedNeighborhoodId: 'solar-neighborhood',
          selectedStarId: 'sol',
          selectedBodyName: null,
          inViewSelection: null,
          combatEngagementId: null,
          activeNavCategory: 'Technology',
          activeNavSubcategory: 'Physics',
          techTreeOpen: false,
        },
        selectedShipId: null,
        name: null,
      },
      {
        id: 'tree-b',
        view: {
          level: 'system',
          selectedNeighborhoodId: 'solar-neighborhood',
          selectedStarId: 'sol',
          selectedBodyName: null,
          inViewSelection: null,
          combatEngagementId: null,
          activeNavCategory: null,
          activeNavSubcategory: null,
          techTreeOpen: false,
        },
        selectedShipId: null,
        name: null,
      },
    ],
    activeTabId: 'tree-a',
  })
  useViewStore.setState({ activeNavCategory: 'Technology', activeNavSubcategory: 'Physics' })

  // Open the tree view on tab A, exactly like clicking TechPanel's "Tree
  // View" button, and confirm the previously-real bug: switching to another
  // tab (which restores a DIFFERENT activeNavCategory/techTreeOpen — here,
  // no NavBar window open at all) and back used to lose it, because it lived
  // in a component-local useState that got unmounted and remounted along
  // with the NavBar window in between.
  useViewStore.getState().setTechTreeOpen(true)
  check('tree view is open on tab A', useViewStore.getState().techTreeOpen === true)

  useWorkspaceStore.getState().switchToTab('tree-b')
  check('switching away captured techTreeOpen into tab A\'s own snapshot', useWorkspaceStore.getState().tabs.find((t) => t.id === 'tree-a')!.view.techTreeOpen === true)
  check('tab B (which never had the tree open) restores it closed', useViewStore.getState().techTreeOpen === false)

  useWorkspaceStore.getState().switchToTab('tree-a')
  check('switching BACK to tab A restores the tree view still open', useViewStore.getState().techTreeOpen === true)
  check('...and its NavBar window/subcategory too', useViewStore.getState().activeNavCategory === 'Technology' && useViewStore.getState().activeNavSubcategory === 'Physics')

  useViewStore.getState().setTechTreeOpen(false)
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`)
process.exit(failures === 0 ? 0 : 1)
