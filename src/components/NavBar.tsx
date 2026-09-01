import { useState } from 'react'
import { DraggableWindow } from './DraggableWindow'
import { FleetManagement } from './FleetManagement'
import { MapModeSelector } from './MapModeSelector'
import { SettingsPanel } from './SettingsPanel'
import { usePlayerStore } from '../state/playerStore'
import { getCountry } from '../data/countryData'

const SETTINGS_CATEGORY = 'Settings'
const MILITARY_CATEGORY = 'Military'
const NAVY_SUBCATEGORY = 'Navy'
const MAP_MODES_CATEGORY = 'Map Modes'

interface CategoryDef {
  name: string
  // Sub-tabs shown inside the category's own window (see .nav-subtabs).
  // Omitted entirely for a category that's still a single flat panel.
  subcategories?: string[]
}

const CATEGORIES: CategoryDef[] = [
  { name: 'Situations' },
  { name: 'Government', subcategories: ['Government Overview', 'Executive', 'Legislative', 'Judicial', 'Offices', 'Laws', 'Institutions'] },
  { name: 'Economy', subcategories: ['Market', 'Budget', 'Welfare'] },
  { name: 'Technology' },
  { name: 'Society', subcategories: ['Culture', 'Religion', 'Species'] },
  { name: 'Diplomacy' },
  { name: 'International Organizations' },
  { name: MILITARY_CATEGORY, subcategories: ['Army', NAVY_SUBCATEGORY, 'Asymmetric Warfare', 'Mercenaries'] },
  { name: 'Characters', subcategories: ['Characters', 'Families'] },
  { name: MAP_MODES_CATEGORY },
  { name: SETTINGS_CATEGORY },
]

// What actually renders inside a category/subcategory pairing. Three slots
// have real content behind them — Fleet Management's existing UI (ship
// roster, designer, stance strategizer) now lives under Military's Navy
// sub-tab, since ships are this game's only naval asset; Settings stays a
// flat panel; and Map Modes is a real, working selector (see
// mapModeStore/mapModeColor.ts), not a placeholder — it's the same map
// modes the bottom ActionBar's icons switch to as a side effect, just
// picked directly and without resetting when the window closes. Everything
// else stays a reserved placeholder, same "don't invent content" spirit as
// the Outliner's empty Starbases section — there's no
// government/economy/society/characters simulation behind these yet.
function renderContent(category: CategoryDef, subcategory: string | null) {
  if (category.name === SETTINGS_CATEGORY) return <SettingsPanel />
  if (category.name === MAP_MODES_CATEGORY) return <MapModeSelector />
  if (category.name === MILITARY_CATEGORY && subcategory === NAVY_SUBCATEGORY) return <FleetManagement />
  return <div className="nav-placeholder">Not yet available</div>
}

// Stellaris-style left-side nation nav — the real selected country's name
// (see playerStore/MainMenu), a row of top-level category buttons, and (for
// most categories) a further row of sub-tabs inside the opened window. No
// fake data behind any placeholder panel.
export function NavBar() {
  const [collapsed, setCollapsed] = useState(false)
  const [activeCategoryName, setActiveCategoryName] = useState<string | null>(null)
  const [activeSubcategory, setActiveSubcategory] = useState<string | null>(null)
  const selectedCountryId = usePlayerStore((s) => s.selectedCountryId)
  const nationName = (selectedCountryId && getCountry(selectedCountryId)?.name) ?? ''

  const activeCategory = CATEGORIES.find((c) => c.name === activeCategoryName) ?? null

  const handleCategoryClick = (category: CategoryDef) => {
    if (activeCategoryName === category.name) {
      setActiveCategoryName(null)
      setActiveSubcategory(null)
      return
    }
    setActiveCategoryName(category.name)
    setActiveSubcategory(category.subcategories?.[0] ?? null)
  }

  const handleClose = () => {
    setActiveCategoryName(null)
    setActiveSubcategory(null)
  }

  return (
    <>
      <div className={`nav-sidebar${collapsed ? ' collapsed' : ''}`}>
        <div className="nav-sidebar-content">
          <div className="nav-nation-name">{nationName}</div>
          <div className="nav-category-list">
            {CATEGORIES.map((category) => (
              <button
                key={category.name}
                type="button"
                className={`nav-category-btn${activeCategoryName === category.name ? ' active' : ''}`}
                onClick={() => handleCategoryClick(category)}
              >
                {category.name}
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
        <DraggableWindow
          title={activeCategory.name}
          onClose={handleClose}
          wide={activeCategory.name === MILITARY_CATEGORY && activeSubcategory === NAVY_SUBCATEGORY}
        >
          {activeCategory.subcategories && (
            <div className="nav-subtabs">
              {activeCategory.subcategories.map((sub) => (
                <button
                  key={sub}
                  type="button"
                  className={`nav-subtab${activeSubcategory === sub ? ' active' : ''}`}
                  onClick={() => setActiveSubcategory(sub)}
                >
                  {sub}
                </button>
              ))}
            </div>
          )}
          {renderContent(activeCategory, activeSubcategory)}
        </DraggableWindow>
      )}
    </>
  )
}
