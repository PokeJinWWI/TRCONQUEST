import { isNewTabClick, isNewTabContextMenu } from '../scene/selectionInput'
import { LeadersPanel } from './LeadersPanel'
import { navyTabOnOpen } from '../state/fleetTabStore'
import { innerTabsToSave, landingTabs, useCustomButtonStore } from '../state/customButtonStore'
import { FLEET_TABS } from './FleetManagement'
import { shipyardTabLabel } from './ShipyardPanel'
import { useFleetTabStore } from '../state/fleetTabStore'
import { useWorkspaceStore } from '../state/workspaceStore'
import { useState } from 'react'
import { DraggableWindow } from './DraggableWindow'
import { NationEconomyPanel } from './EconomyPanel'
import { NationTechPanel } from './TechPanel'
import { FleetManagement } from './FleetManagement'
import { ArmyPanel } from './ArmyViews'
import { DiplomacyPanel } from './DiplomacyPanel'
import { InternationalOrgPanel } from './InternationalOrgPanel'
import { LawsPanel } from './LawsPanel'
import { CentralBankPanel, type CentralBankSection } from './CentralBankPanel'
import { BanksPanel } from './BanksPanel'
import { ForexPanel } from './ForexPanel'
import { AbstractEconomyPanel, SimplisticDemographics } from './AbstractEconomyPanel'
import { EconomyOverview } from './EconomyOverview'
import { CorporationsPanel } from './CorporationsPanel'
import { StockExchangePanel } from './StockExchangePanel'
import { DemographicsPanel } from './DemographicsPanel'
import { CharactersPanel } from './CharactersPanel'
import { DebtPanel } from './DebtPanel'
import { ConstructionPanel } from './ConstructionPanel'
import { TradePanel } from './TradePanel'
import { StockpilePanel } from './StockpilePanel'
import { SandboxPanel } from './SandboxPanel'
import { usePlayerStore } from '../state/playerStore'
import { useViewStore } from '../state/viewStore'
import { getCountry } from '../data/countryData'

const SANDBOX_CATEGORY = 'Sandbox'
const MILITARY_CATEGORY = 'Fleet Management'
const NAVY_SUBCATEGORY = 'Navy'
const ARMY_SUBCATEGORY = 'Army'
const ECONOMY_CATEGORY = 'Economy'
const TECHNOLOGY_CATEGORY = 'Technology'
const GOVERNMENT_CATEGORY = 'Government'
const LAWS_SUBCATEGORY = 'Laws'
const CORPORATIONS_CATEGORY = 'Corporations'
const MARKETS_CATEGORY = 'Markets'
const CENTRAL_BANK_CATEGORY = 'Central Bank'
const SOCIETY_CATEGORY = 'Society'
const DEMOGRAPHICS_SUBCATEGORY = 'Demographics'
const CHARACTERS_CATEGORY = 'Characters'
const DIPLOMACY_CATEGORY = 'Diplomacy'

interface CategoryDef {
  name: string
  // Sub-tabs shown inside the category's own window (see .nav-subtabs).
  // Omitted entirely for a category that's still a single flat panel.
  subcategories?: string[]
}

const CATEGORIES: CategoryDef[] = [
  { name: 'Situations' },
  { name: 'Government', subcategories: ['Government Overview', 'Executive', 'Legislative', 'Judicial', 'Offices', 'Leaders', 'Laws', 'Institutions'] },
  { name: 'Economy', subcategories: ['Overview', 'Budget', 'Finance', 'Construction', 'Trade', 'Stockpiles', 'Welfare'] },
  { name: MARKETS_CATEGORY, subcategories: ['Market', 'Stock Exchange', 'Bond Market', 'Forex'] },
  { name: CENTRAL_BANK_CATEGORY, subcategories: ['Overview', 'Monetary Policy', 'Balance Sheet', 'Commercial Banks', 'Currency'] },
  { name: CORPORATIONS_CATEGORY, subcategories: ['State Owned', 'Private', 'Financial Districts'] },
  { name: TECHNOLOGY_CATEGORY, subcategories: ['Physics', 'Society', 'Engineering'] },
  { name: 'Society', subcategories: ['Demographics', 'Culture', 'Religion', 'Species'] },
  { name: DIPLOMACY_CATEGORY, subcategories: ['Relations', 'Wars', 'Treaties', 'Subjects', 'Trade Policy', 'Events'] },
  { name: 'International Organizations' },
  { name: MILITARY_CATEGORY, subcategories: [ARMY_SUBCATEGORY, NAVY_SUBCATEGORY, 'Asymmetric Warfare', 'Mercenaries'] },
  { name: CHARACTERS_CATEGORY, subcategories: ['Characters', 'Families'] },
]

// Simple mode replaces Complex mode's deep simulation: no goods
// Markets, Central Bank or Corporations, and Economy is one macro panel. The
// rest of the game (government, tech, society, diplomacy, military…) is unchanged.
const ABSTRACT_CATEGORIES: CategoryDef[] = [
  { name: 'Situations' },
  { name: 'Government', subcategories: ['Government Overview', 'Executive', 'Legislative', 'Judicial', 'Offices', 'Leaders', 'Laws', 'Institutions'] },
  { name: 'Economy' },
  { name: TECHNOLOGY_CATEGORY, subcategories: ['Physics', 'Society', 'Engineering'] },
  { name: 'Society', subcategories: ['Demographics', 'Culture', 'Religion', 'Species'] },
  { name: DIPLOMACY_CATEGORY, subcategories: ['Relations', 'Wars', 'Treaties', 'Subjects', 'Trade Policy', 'Events'] },
  { name: 'International Organizations' },
  { name: MILITARY_CATEGORY, subcategories: [ARMY_SUBCATEGORY, NAVY_SUBCATEGORY, 'Asymmetric Warfare', 'Mercenaries'] },
  { name: CHARACTERS_CATEGORY, subcategories: ['Characters', 'Families'] },
]

// The sandbox has no nation behind it, so no government, economy, markets or
// diplomacy to open — just what a fight needs, and the sandbox's own controls.
const SANDBOX_CATEGORIES: CategoryDef[] = [
  { name: SANDBOX_CATEGORY },
  { name: MILITARY_CATEGORY, subcategories: [ARMY_SUBCATEGORY, NAVY_SUBCATEGORY] },
]

// Central Bank sub-tab label → the panel's internal section id.
const CB_SECTIONS: Record<string, CentralBankSection> = {
  Overview: 'overview',
  'Monetary Policy': 'policy',
  'Balance Sheet': 'balance',
  Currency: 'currency',
}

// What actually renders inside a category/subcategory pairing. A few slots
// have real content behind them — Fleet Management's existing UI (ship
// roster, designer, stance strategizer) now lives under Military's Navy
// sub-tab, since ships are this game's only naval asset; Map Modes live in the bottom bar's right corner
// (MapModesButton). Everything
// else stays a reserved placeholder, same "don't invent content" spirit as
// the Outliner's empty Starbases section — there's no
// government/economy/society/characters simulation behind these yet.
function renderContent(category: CategoryDef, subcategory: string | null, abstractEconomy: boolean) {
  // Simple mode: the whole Economy category is one macro panel.
  if (abstractEconomy && category.name === ECONOMY_CATEGORY) return <AbstractEconomyPanel />
  if (category.name === SANDBOX_CATEGORY) return <SandboxPanel />
  // Complex mode: the whole economy on one scrollable page (the other tabs keep the detail).
  if (category.name === ECONOMY_CATEGORY && subcategory === 'Overview') return <EconomyOverview />
  if (category.name === ECONOMY_CATEGORY && subcategory === 'Construction') return <ConstructionPanel />
  if (category.name === ECONOMY_CATEGORY && subcategory === 'Trade') return <TradePanel />
  if (category.name === ECONOMY_CATEGORY && subcategory === 'Stockpiles') return <StockpilePanel />
  if (category.name === ECONOMY_CATEGORY) return <NationEconomyPanel subcategory={subcategory} />
  // Markets — the trading venues: goods market, equities, bonds, currencies.
  if (category.name === MARKETS_CATEGORY && subcategory === 'Stock Exchange') return <StockExchangePanel />
  if (category.name === MARKETS_CATEGORY && subcategory === 'Bond Market') return <DebtPanel />
  if (category.name === MARKETS_CATEGORY && subcategory === 'Forex') return <ForexPanel />
  if (category.name === MARKETS_CATEGORY) return <NationEconomyPanel subcategory="Market" />
  // Central Bank — its own category, split across sub-tabs.
  if (category.name === CENTRAL_BANK_CATEGORY && subcategory === 'Commercial Banks') return <BanksPanel />
  if (category.name === CENTRAL_BANK_CATEGORY) return <CentralBankPanel section={CB_SECTIONS[subcategory ?? 'Overview'] ?? 'overview'} />
  if (category.name === TECHNOLOGY_CATEGORY) return <NationTechPanel subcategory={subcategory} />
  if (category.name === GOVERNMENT_CATEGORY && subcategory === LAWS_SUBCATEGORY) return <LawsPanel />
  if (category.name === GOVERNMENT_CATEGORY && subcategory === 'Leaders') return <LeadersPanel />
  if (category.name === CORPORATIONS_CATEGORY) return <CorporationsPanel subcategory={subcategory} />
  if (category.name === SOCIETY_CATEGORY && subcategory === DEMOGRAPHICS_SUBCATEGORY) return abstractEconomy ? <SimplisticDemographics /> : <DemographicsPanel />
  if (category.name === CHARACTERS_CATEGORY) return <CharactersPanel subcategory={subcategory} />
  if (category.name === MILITARY_CATEGORY && subcategory === NAVY_SUBCATEGORY) return <FleetManagement />
  if (category.name === MILITARY_CATEGORY && subcategory === ARMY_SUBCATEGORY) return <ArmyPanel />
  if (category.name === DIPLOMACY_CATEGORY) return <DiplomacyPanel subcategory={subcategory} />
  if (category.name === 'International Organizations') return <InternationalOrgPanel />
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
  const sandbox = usePlayerStore((s) => s.sandbox)
  const abstractEconomy = usePlayerStore((s) => s.economyModel === 'abstract')
  const nationName = sandbox ? 'Sandbox' : (selectedCountryId && getCountry(selectedCountryId)?.name) ?? ''
  const categories = sandbox ? SANDBOX_CATEGORIES : abstractEconomy ? ABSTRACT_CATEGORIES : CATEGORIES

  const activeCategory = categories.find((c) => c.name === activeCategoryName) ?? null

  const customButtons = useCustomButtonStore((s) => s.buttons)
  const pinButton = useCustomButtonStore((s) => s.pin)
  const removeButton = useCustomButtonStore((s) => s.remove)
  const fleetTab = useFleetTabStore((s) => s.tab)
  const shipyardNow = useFleetTabStore((s) => s.shipyardNow)
  const handleCategoryClick = (category: CategoryDef, e: { ctrlKey: boolean; metaKey: boolean }) => {
    // Ctrl/Cmd-click: open this panel in a new tab instead.
    if (isNewTabClick(e)) {
      useWorkspaceStore.getState().openInNewTab({ activeNavCategory: category.name, activeNavSubcategory: category.subcategories?.[0] ?? null })
      return
    }
    if (activeCategoryName === category.name) {
      setNavCategory(null, null)
      return
    }
    openNavyAtDefault(category.name, category.subcategories?.[0] ?? null)
    setNavCategory(category.name, category.subcategories?.[0] ?? null)
  }
  // A plain pick of Navy opens its first tab (Fleet Manager), not the one used last.
  const openNavyAtDefault = (category: string | null, subcategory: string | null) => {
    const fleet = useFleetTabStore.getState()
    const next = navyTabOnOpen({ category: activeCategoryName, subcategory: activeSubcategory }, { category, subcategory }, fleet.tab)
    if (next !== fleet.tab) fleet.setTab(next)
    if (next === 'manager') fleet.requestShipyardTab(null)
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
            {categories.map((category) => (
              <button
                key={category.name}
                type="button"
                className={`nav-category-btn${activeCategoryName === category.name ? ' active' : ''}`}
                onClick={(e) => handleCategoryClick(category, e)}
                onContextMenu={(e) => {
                  if (!isNewTabContextMenu(e)) return
                  e.preventDefault()
                  handleCategoryClick(category, e)
                }}
                title="Ctrl/Cmd-click: open in a new tab"
              >
                {category.name}
              </button>
            ))}
          </div>
          <div className="nav-custom">
            <div className="nav-custom-title">Quick buttons</div>
            {customButtons.map((b) => {
              const active = activeCategoryName === b.category && activeSubcategory === b.subcategory && (!b.fleetTab || fleetTab === b.fleetTab) && (!b.shipyardTab || shipyardNow === b.shipyardTab)
              return (
                <button
                  key={b.id}
                  type="button"
                  className={`nav-category-btn nav-custom-btn${active ? ' active' : ''}`}
                  title={b.builtin ? `Open ${b.label}` : `Open ${b.label}. × (or right-click) removes it.`}
                  onClick={(e) => {
                    if (isNewTabClick(e)) return useWorkspaceStore.getState().openInNewTab({ activeNavCategory: b.category, activeNavSubcategory: b.subcategory })
                    // Land on the inner tabs the button saved (or the panel's defaults).
                    const land = landingTabs(b)
                    if (land) {
                      useFleetTabStore.getState().requestShipyardTab(land.shipyardTab)
                      useFleetTabStore.getState().setTab(land.fleetTab)
                    }
                    setNavCategory(b.category, b.subcategory)
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    if (!b.builtin) removeButton(b.id)
                  }}
                >
                  {b.label}
                  {!b.builtin && (
                    <span
                      className="nav-custom-remove"
                      role="button"
                      aria-label={`Remove ${b.label}`}
                      title="Remove this button"
                      onClick={(e) => {
                        e.stopPropagation()
                        removeButton(b.id)
                      }}
                    >
                      ×
                    </span>
                  )}
                </button>
              )
            })}
            {activeCategoryName && (
              <button
                type="button"
                className="nav-category-btn nav-custom-pin"
                title="Add the open panel to these buttons"
                onClick={() => {
                  const fleet = useFleetTabStore.getState()
                  const inner = innerTabsToSave(activeCategoryName, activeSubcategory, { fleetTab: fleet.tab, shipyardTab: fleet.shipyardNow })
                  pinButton(activeCategoryName, activeSubcategory, inner, {
                    fleetTab: FLEET_TABS.find((t) => t.id === inner.fleetTab)?.label,
                    shipyardTab: inner.shipyardTab ? shipyardTabLabel(inner.shipyardTab) : undefined,
                  })
                }}
              >
                + Pin this panel
              </button>
            )}
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
            // Open at a sensible preset size (Stellaris-style) rather than cramped
            // and content-height; still fully draggable/resizable from there. A
            // roomier width for the wide (table) categories.
            defaultSize={
              (activeCategory.name === MILITARY_CATEGORY && activeSubcategory === NAVY_SUBCATEGORY) || activeCategory.name === TECHNOLOGY_CATEGORY
                ? { width: 620, height: 620 }
                : { width: 380, height: 620 }
            }
          >
            {activeCategory.subcategories && (
              <div className="nav-subtabs">
                {activeCategory.subcategories.map((sub) => (
                  <button
                    key={sub}
                    type="button"
                    className={`nav-subtab${activeSubcategory === sub ? ' active' : ''}`}
                    onContextMenu={(e) => {
                      if (!isNewTabContextMenu(e) || !activeCategoryName) return
                      e.preventDefault()
                      useWorkspaceStore.getState().openInNewTab({ activeNavCategory: activeCategoryName, activeNavSubcategory: sub })
                    }}
                    onClick={(e) =>
                      isNewTabClick(e)
                        ? useWorkspaceStore.getState().openInNewTab({ activeNavCategory: activeCategoryName, activeNavSubcategory: sub })
                        : (openNavyAtDefault(activeCategoryName, sub), setNavCategory(activeCategoryName, sub))
                    }
                  >
                    {sub}
                  </button>
                ))}
              </div>
            )}
            {renderContent(activeCategory, activeSubcategory, abstractEconomy)}
          </DraggableWindow>
        </div>
      )}
    </>
  )
}
