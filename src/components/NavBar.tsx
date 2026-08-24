import { useState } from 'react'
import { DraggableWindow } from './DraggableWindow'
import { FleetManagement } from './FleetManagement'
import { SettingsPanel } from './SettingsPanel'

const NATION_NAME = 'Imperial State of Mars'

const FLEET_CATEGORY = 'Fleet Management'
const SETTINGS_CATEGORY = 'Settings'

const CATEGORIES = ['Situations', 'Government', 'Technology', 'Society', 'Species', 'Contacts', FLEET_CATEGORY, SETTINGS_CATEGORY]

// Stellaris-style left-side nation nav — real nation name (hardcoded for
// now, no empire/player system exists yet) and a row of category buttons,
// each opening a placeholder window. No fake data behind any of them, same
// "reserve the spot, don't invent content" spirit as ChatPlaceholder and the
// Outliner's empty Colonies/Fleets/Starbases sections.
export function NavBar() {
  const [collapsed, setCollapsed] = useState(false)
  const [activeCategory, setActiveCategory] = useState<string | null>(null)

  return (
    <>
      <div className={`nav-sidebar${collapsed ? ' collapsed' : ''}`}>
        <div className="nav-sidebar-content">
          <div className="nav-nation-name">{NATION_NAME}</div>
          <div className="nav-category-list">
            {CATEGORIES.map((category) => (
              <button
                key={category}
                type="button"
                className={`nav-category-btn${activeCategory === category ? ' active' : ''}`}
                onClick={() => setActiveCategory((c) => (c === category ? null : category))}
              >
                {category}
              </button>
            ))}
          </div>
        </div>
        <button
          type="button"
          className="nav-sidebar-toggle"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
        >
          {collapsed ? '›' : '‹'}
        </button>
      </div>

      {activeCategory && (
        <DraggableWindow title={activeCategory} onClose={() => setActiveCategory(null)} wide={activeCategory === FLEET_CATEGORY}>
          {/* Fleet Management and Settings are the first of these categories
              to have real content behind them; the rest stay reserved
              placeholders until there's something true to put in them. */}
          {activeCategory === FLEET_CATEGORY ? (
            <FleetManagement />
          ) : activeCategory === SETTINGS_CATEGORY ? (
            <SettingsPanel />
          ) : (
            <div className="nav-placeholder">Not yet available</div>
          )}
        </DraggableWindow>
      )}
    </>
  )
}
