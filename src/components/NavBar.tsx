import { useState } from 'react'
import { DraggableWindow } from './DraggableWindow'
import { NationEconomyPanel } from './EconomyPanel'
import { NationTechPanel } from './TechPanel'
import { FleetManagement } from './FleetManagement'
import { LawsPanel } from './LawsPanel'
import { CorporationsPanel } from './CorporationsPanel'
import { StockExchangePanel } from './StockExchangePanel'
import { DemographicsPanel } from './DemographicsPanel'
import { CharactersPanel } from './CharactersPanel'
import { DebtPanel } from './DebtPanel'
import { ConstructionPanel } from './ConstructionPanel'
import { MapModeSelector } from './MapModeSelector'
import { SettingsPanel } from './SettingsPanel'
import { usePlayerStore } from '../state/playerStore'
import { useViewStore } from '../state/viewStore'
import { getCountry } from '../data/countryData'

const SETTINGS_CATEGORY = 'Settings'
const MILITARY_CATEGORY = 'Military'
const NAVY_SUBCATEGORY = 'Navy'
const MAP_MODES_CATEGORY = 'Map Modes'
const ECONOMY_CATEGORY = 'Economy'
const TECHNOLOGY_CATEGORY = 'Technology'
const GOVERNMENT_CATEGORY = 'Government'
const LAWS_SUBCATEGORY = 'Laws'
const CORPORATIONS_CATEGORY = 'Corporations'
const STOCK_EXCHANGE_CATEGORY = 'Stock Exchange'
const SOCIETY_CATEGORY = 'Society'
const DEMOGRAPHICS_SUBCATEGORY = 'Demographics'
const CHARACTERS_CATEGORY = 'Characters'

interface CategoryDef {
  name: string
  // Sub-tabs shown inside the category's own window (see .nav-subtabs).
  // Omitted entirely for a category that's still a single flat panel.
  subcategories?: string[]
}

const CATEGORIES: CategoryDef[] = [
  { name: 'Situations' },
  { name: 'Government', subcategories: ['Government Overview', 'Executive', 'Legislative', 'Judicial', 'Offices', 'Laws', 'Institutions'] },
  { name: 'Economy', subcategories: ['Market', 'Budget', 'Finance', 'Debt', 'Construction', 'Welfare'] },
  { name: CORPORATIONS_CATEGORY, subcategories: ['State Owned', 'Private'] },
  { name: STOCK_EXCHANGE_CATEGORY },
  { name: TECHNOLOGY_CATEGORY, subcategories: ['Physics', 'Society', 'Engineering'] },
  { name: 'Society', subcategories: ['Demographics', 'Culture', 'Religion', 'Species'] },
  { name: 'Diplomacy' },
  { name: 'International Organizations' },
  { name: MILITARY_CATEGORY, subcategories: ['Army', NAVY_SUBCATEGORY, 'Asymmetric Warfare', 'Mercenaries'] },
  { name: CHARACTERS_CATEGORY, subcategories: ['Characters', 'Families'] },
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
  if (category.name === ECONOMY_CATEGORY && subcategory === 'Debt') return <DebtPanel />
  if (category.name === ECONOMY_CATEGORY && subcategory === 'Construction') return <ConstructionPanel />
  if (category.name === ECONOMY_CATEGORY) return <NationEconomyPanel subcategory={subcategory} />
  if (category.name === TECHNOLOGY_CATEGORY) return <NationTechPanel subcategory={subcategory} />
  if (category.name === GOVERNMENT_CATEGORY && subcategory === LAWS_SUBCATEGORY) return <LawsPanel />
  if (category.name === CORPORATIONS_CATEGORY) return <CorporationsPanel subcategory={subcategory} />
  if (category.name === STOCK_EXCHANGE_CATEGORY) return <StockExchangePanel />
  if (category.name === SOCIETY_CATEGORY && subcategory === DEMOGRAPHICS_SUBCATEGORY) return <DemographicsPanel />
  if (category.name === CHARACTERS_CATEGORY) return <CharactersPanel subcategory={subcategory} />
  if (category.name === MILITARY_CATEGORY && subcategory === NAVY_SUBCATEGORY) return <FleetManagement />
  return <div className="nav-placeholder">Not yet available</div>
}

// Stellaris-style left-side nation nav — the real selected country's name
// (see playerStore/MainMenu), a row of top-level category buttons, and (for
// most categories) a further row of sub-tabs inside the opened window. No
// fake data behind any placeholder panel.
export function NavBar() {
  const [collapsed, setCollapsed] = useState(false)
  // Lives in viewStore, not local state — see that store's own comment on
  // activeNavCategory: workspace tabs need a single generic "everything in
  // the current tab's open windows" snapshot rule, so this can't be
  // component-local without becoming a special case for tab switching.
  const activeCategoryName = useViewStore((s) => s.activeNavCategory)
  const activeSubcategory = useViewStore((s) => s.activeNavSubcategory)
  const setNavCategory = useViewStore((s) => s.setNavCategory)
  const techTreeOpen = useViewStore((s) => s.techTreeOpen)
  const selectedCountryId = usePlayerStore((s) => s.selectedCountryId)
  const nationName = (selectedCountryId && getCountry(selectedCountryId)?.name) ?? ''

  const activeCategory = CATEGORIES.find((c) => c.name === activeCategoryName) ?? null

  const handleCategoryClick = (category: CategoryDef) => {
    if (activeCategoryName === category.name) {
      setNavCategory(null, null)
      return
    }
    setNavCategory(category.name, category.subcategories?.[0] ?? null)
  }

  const handleClose = () => {
    setNavCategory(null, null)
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

      {/* Visually hidden (not unmounted — TechTreeGraph's full-screen overlay
          is portalled from *inside* renderContent's NationTechPanel, a child
          of the DraggableWindow below, so unmounting the window would take
          the tree view down with it the instant it opened) while the tech
          tree overlay is open. This is deliberate rather than relying on the
          overlay's z-index alone: DraggableWindow's shared bring-to-front
          counter climbs on every window click across the whole session,
          including the very click that opens the tree, so after enough
          window interactions the panel's z-index outruns the overlay's fixed
          80 and would otherwise render on top of it instead of disappearing
          behind it. */}
      {activeCategory && (
        <div style={techTreeOpen && activeCategory.name === TECHNOLOGY_CATEGORY ? { display: 'none' } : undefined}>
          <DraggableWindow
            title={activeCategory.name}
            onClose={handleClose}
            wide={(activeCategory.name === MILITARY_CATEGORY && activeSubcategory === NAVY_SUBCATEGORY) || activeCategory.name === TECHNOLOGY_CATEGORY}
          >
            {activeCategory.subcategories && (
              <div className="nav-subtabs">
                {activeCategory.subcategories.map((sub) => (
                  <button
                    key={sub}
                    type="button"
                    className={`nav-subtab${activeSubcategory === sub ? ' active' : ''}`}
                    onClick={() => setNavCategory(activeCategoryName, sub)}
                  >
                    {sub}
                  </button>
                ))}
              </div>
            )}
            {renderContent(activeCategory, activeSubcategory)}
          </DraggableWindow>
        </div>
      )}
    </>
  )
}
