import { useState } from 'react'
import { useWorkspaceStore, type TabSnapshot } from '../state/workspaceStore'
import type { ViewLevel } from '../state/viewStore'
import { ResourceBar } from './ResourceBar'

const LEVEL_LABELS: Record<ViewLevel, string> = {
  galactic: 'Galaxy',
  interstellar: 'Interstellar',
  system: 'System',
  satellite: 'Satellite',
  combat: 'Combat',
}

// A short, cheap-to-compute label derived straight from a stored snapshot —
// deliberately not a full port of LocationLabel's own live logic, just
// enough to tell tabs apart at a glance (the whole point of a tab bar for
// the "system view in one tab, a fight in another" use case this exists
// for). Only used until the player renames a tab (see TabSnapshot.name) —
// a custom name always wins once set.
function autoTabLabel(tab: TabSnapshot): string {
  const base = LEVEL_LABELS[tab.view.level]
  if ((tab.view.level === 'system' || tab.view.level === 'satellite') && tab.view.selectedBodyName) {
    return `${base} · ${tab.view.selectedBodyName}`
  }
  return base
}

function Tab({ tab, active, showClose }: { tab: TabSnapshot; active: boolean; showClose: boolean }) {
  const switchToTab = useWorkspaceStore((s) => s.switchToTab)
  const closeTab = useWorkspaceStore((s) => s.closeTab)
  const renameTab = useWorkspaceStore((s) => s.renameTab)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  const commitRename = () => {
    renameTab(tab.id, draft)
    setEditing(false)
  }

  if (editing) {
    return (
      <input
        className="tab-bar-tab-rename"
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commitRename}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commitRename()
          if (e.key === 'Escape') setEditing(false)
        }}
      />
    )
  }

  return (
    <button
      type="button"
      className={`tab-bar-tab${active ? ' active' : ''}`}
      onClick={() => switchToTab(tab.id)}
      onDoubleClick={(e) => {
        e.stopPropagation()
        setDraft(tab.name ?? autoTabLabel(tab))
        setEditing(true)
      }}
      title="Double-click to rename"
    >
      <span>{tab.name ?? autoTabLabel(tab)}</span>
      {showClose && (
        <span
          className="tab-bar-tab-close"
          role="button"
          tabIndex={0}
          aria-label={`Close tab "${tab.name ?? autoTabLabel(tab)}"`}
          onClick={(e) => {
            e.stopPropagation()
            closeTab(tab.id)
          }}
        >
          ×
        </span>
      )}
    </button>
  )
}

// The compact tab strip itself — same footprint as ResourceBar, since it
// SWAPS with it in the header rather than adding a new row (see
// HudCenterSwap below): a separate always-visible row would have needed the
// combined header+strip height threaded through to every panel that docks
// against --hud-top-height (NavBar, Outliner, DebugConsole), which swapping
// in place avoids entirely — the header's own height never changes.
function TabStrip() {
  const tabs = useWorkspaceStore((s) => s.tabs)
  const activeTabId = useWorkspaceStore((s) => s.activeTabId)
  const createTab = useWorkspaceStore((s) => s.createTab)

  return (
    <div className="tab-bar">
      {tabs.map((tab) => (
        <Tab key={tab.id} tab={tab} active={tab.id === activeTabId} showClose={tabs.length > 1} />
      ))}
      <button type="button" className="tab-bar-add" onClick={createTab} aria-label="New tab">
        +
      </button>
    </div>
  )
}

// Occupies the header's center slot — ResourceBar by default, the tab strip
// once toggled. Never both at once, deliberately, to keep the top bar from
// getting cluttered (per the user's own framing).
export function HudCenterSwap() {
  const showTabBar = useWorkspaceStore((s) => s.showTabBar)
  const toggleTabBar = useWorkspaceStore((s) => s.toggleTabBar)

  return (
    <div className="hud-center-swap">
      {showTabBar ? <TabStrip /> : <ResourceBar />}
      <button type="button" className="hud-swap-toggle" onClick={toggleTabBar}>
        {showTabBar ? 'Resources' : 'Tabs'}
      </button>
    </div>
  )
}
