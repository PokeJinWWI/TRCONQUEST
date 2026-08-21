import { useState } from 'react'
import { DraggableWindow } from './DraggableWindow'

const NATION_NAME = 'Imperial State of Mars'

const CATEGORIES = ['Situations', 'Government', 'Technology', 'Society', 'Species', 'Contacts', 'Fleet Management']

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
        <DraggableWindow title={activeCategory} onClose={() => setActiveCategory(null)}>
          <div className="nav-placeholder">Not yet available</div>
        </DraggableWindow>
      )}
    </>
  )
}
