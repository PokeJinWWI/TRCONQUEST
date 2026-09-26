import { useState } from 'react'
import type { InspectableBody } from '../scene/inspectableBody'
import { estimateHabitability, estimateSize, PLANET_CLASS_LABELS } from '../scene/bodyStats'
import { DraggableWindow } from './DraggableWindow'
import { EconomyPanel } from './EconomyPanel'
import { PopsPanel } from './PopsPanel'
import { PoliticsPanel } from './PoliticsPanel'
import { useEconomyStore, worldByName } from '../state/economyStore'
import { getCountry } from '../data/countryData'
import { ownerDisplay } from '../data/countryRoster'
import { useTerritoryStore } from '../state/territoryStore'
import { BodyArmies } from './ArmyViews'
import { useViewStore } from '../state/viewStore'
import { groundSurface } from '../scene/groundLogic'
import { usePlayerStore } from '../state/playerStore'
import { useAbstractEconomyStore } from '../state/abstractEconomyStore'
import { OwnerNote, SimpleDistrictsTab, SimplePopulationTab, SimpleWorldSummary } from './planet/SimplePlanetTabs'
import { ComplexDistrictsTab, ComplexWorldSummary } from './planet/ComplexPlanetTabs'
import { DefenseTab } from './planet/DefenseTab'

export interface InspectPanelAction {
  label: string
  pendingLabel: string
  pending?: boolean
  onClick: () => void
}

interface InspectPanelProps {
  body: InspectableBody
  onClose: () => void
  action?: InspectPanelAction
}

const KIND_LABEL: Record<InspectableBody['kind'], string> = {
  star: 'Star',
  planet: 'Planet',
  moon: 'Moon',
}

// The planet screen (Stellaris-style) for planets and moons: Summary, Districts
// & Buildings, Population, Armies — plus Complex mode's per-world Market and
// Politics. Stars keep the plain single-pane readout.
type InspectTab = 'summary' | 'districts' | 'population' | 'armies' | 'defense' | 'market' | 'politics'
const TAB_LABELS: Record<InspectTab, string> = {
  summary: 'Summary',
  districts: 'Districts & Buildings',
  population: 'Population',
  armies: 'Armies',
  defense: 'Defense',
  market: 'Market',
  politics: 'Politics',
}
const TAB_TIPS: Record<InspectTab, string> = {
  summary: 'The planet at a glance: what it is, who holds it, what it produces',
  districts: 'Districts and the buildings they house — develop districts, fill their slots',
  population: 'Who lives here and what they do',
  armies: 'Ground forces on this world',
  defense: 'Planetary defenses — fortresses, shield generators, defense batteries — and the orbit',
  market: 'This world’s goods market (Complex mode)',
  politics: 'This world’s politics (Complex mode)',
}

function OverviewRows({ body, action }: { body: InspectableBody; action?: InspectPanelAction }) {
  const size = estimateSize(body.radiusKm)
  const habitability = body.kind !== 'star' ? estimateHabitability(body.name, body.orbitAU) : null
  // Ownership and control come from the live territory map (see
  // scene/territory.ts) — it covers every claimed body, not only the
  // inhabited worlds the economy simulates, and it's what war and peace
  // actually change.
  const ownerId = useTerritoryStore((s) => s.bodyOwner[body.name])
  const controllerId = useTerritoryStore((s) => s.bodyController[body.name])
  const owner = ownerId ? getCountry(ownerId) : undefined
  const occupier = controllerId && controllerId !== ownerId ? ownerDisplay(controllerId) : undefined

  return (
    <>
      <div className="inspect-row">
        <span className="inspect-label">Type</span>
        <span className="inspect-value">{KIND_LABEL[body.kind]}</span>
      </div>
      {owner && (
        <div className="inspect-row">
          <span className="inspect-label">Owner</span>
          <span className="inspect-value" style={{ color: owner.color }}>
            {owner.name}
          </span>
        </div>
      )}
      {occupier && (
        <div className="inspect-row">
          <span className="inspect-label">Controller</span>
          <span className="inspect-value" style={{ color: occupier.color }}>
            {occupier.name} (occupied)
          </span>
        </div>
      )}
      <div className="inspect-row">
        <span className="inspect-label">Radius</span>
        <span className="inspect-value">{Math.round(body.radiusKm).toLocaleString()} km</span>
      </div>
      {body.kind === 'planet' && body.orbitAU !== undefined && (
        <div className="inspect-row">
          <span className="inspect-label">Orbit</span>
          <span className="inspect-value">
            {body.orbitAU.toFixed(2)} AU · {body.orbitPeriodYears?.toFixed(2)} yr
          </span>
        </div>
      )}
      {body.orbitPeriodDays !== undefined && (
        <div className="inspect-row">
          <span className="inspect-label">Orbital period</span>
          <span className="inspect-value">{body.orbitPeriodDays.toFixed(2)} days</span>
        </div>
      )}
      {body.moonCount !== undefined && (
        <div className="inspect-row">
          <span className="inspect-label">Moons</span>
          <span className="inspect-value">{body.moonCount}</span>
        </div>
      )}

      {body.kind !== 'star' && (
        <>
          <div className="inspect-divider" />
          {body.planetClass && (
            <div className="inspect-row">
              <span className="inspect-label">Class</span>
              <span className="inspect-value">{PLANET_CLASS_LABELS[body.planetClass]}</span>
            </div>
          )}
          <div className="inspect-row">
            <span className="inspect-label">Size class</span>
            <span className="inspect-value">{size.label}</span>
          </div>
          <div className="inspect-row">
            <span className="inspect-label">Districts</span>
            <span className="inspect-value">{size.districts}</span>
          </div>
          {habitability && (
            <div className="inspect-row">
              <span className="inspect-label">Habitability</span>
              <span className="inspect-value">
                {habitability.label} ({habitability.pct}%)
              </span>
            </div>
          )}
        </>
      )}

      {/* The way to the planetary map, for anything with ground to stand on —
          planets and moons alike (see BodyArmies for the same button under the
          Armies tab). */}
      {body.kind !== 'star' && groundSurface(body.name, useTerritoryStore.getState().bodyOwner) && (
        <button type="button" className="detail-view-btn" onClick={() => useViewStore.getState().enterGround(body.name)}>
          Ground Map
        </button>
      )}

      {action && (
        <>
          <div className="inspect-divider" />
          {action.pending ? (
            <div className="inspect-status ok">{action.pendingLabel}</div>
          ) : (
            <button type="button" className="detail-view-btn" onClick={action.onClick}>
              {action.label}
            </button>
          )}
        </>
      )}
    </>
  )
}

function PlanetHeader({ body }: { body: InspectableBody }) {
  const ownerId = useTerritoryStore((s) => s.bodyOwner[body.name])
  const owner = ownerId ? getCountry(ownerId) : undefined
  const size = estimateSize(body.radiusKm)
  return (
    <div className="pl-header" style={{ borderColor: owner?.color ?? 'rgba(255,255,255,0.12)' }}>
      <div className="pl-header-globe" style={{ background: `radial-gradient(circle at 35% 35%, ${body.color ?? '#8ab4ff'}, #0b1622 75%)` }} />
      <div className="pl-header-text">
        <div className="pl-header-name">{body.name}</div>
        <div className="abs-dim">
          {body.planetClass ? PLANET_CLASS_LABELS[body.planetClass] : KIND_LABEL[body.kind]} · {size.label}
          {owner ? <> · <span style={{ color: owner.color }}>{owner.name}</span></> : ' · Unclaimed'}
        </div>
      </div>
    </div>
  )
}

export function InspectPanel({ body, onClose, action }: InspectPanelProps) {
  const [tab, setTab] = useState<InspectTab>('summary')
  const worlds = useEconomyStore((s) => s.worlds)
  const countries = useEconomyStore((s) => s.countries)
  const world = worldByName(worlds, body.name)
  const country = world ? countries.find((c) => c.id === world.ownerId) : undefined
  const simple = usePlayerStore((s) => s.economyModel === 'abstract')
  const playerId = usePlayerStore((s) => s.selectedCountryId)
  const simpleWorld = useAbstractEconomyStore((s) => !!s.worlds[body.name])

  if (body.kind === 'star') {
    return (
      <DraggableWindow title={body.name} onClose={onClose}>
        <OverviewRows body={body} action={action} />
      </DraggableWindow>
    )
  }
  // Which tabs this world has: every planet/moon has a Summary and Armies; a
  // world with an economy adds Districts & Buildings and Population; Complex
  // mode keeps its per-world Market and Politics.
  const hasEconomy = simple ? simpleWorld : !!world
  const tabs: InspectTab[] = ['summary', ...(hasEconomy ? (['districts', 'population'] as InspectTab[]) : []), 'armies', 'defense', ...(!simple && world ? (['market', 'politics'] as InspectTab[]) : [])]
  const current = tabs.includes(tab) ? tab : 'summary'

  return (
    <DraggableWindow title={body.name} onClose={onClose} defaultSize={{ width: 520, height: 640 }}>
      <PlanetHeader body={body} />
      <div className="nav-subtabs">
        {tabs.map((t) => (
          <button key={t} type="button" className={`nav-subtab${current === t ? ' active' : ''}`} title={TAB_TIPS[t]} onClick={() => setTab(t)}>
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>
      {current === 'summary' && (
        <>
          {simple && simpleWorld && <SimpleWorldSummary bodyName={body.name} />}
          {!simple && world && <ComplexWorldSummary world={world} />}
          <OverviewRows body={body} action={action} />
        </>
      )}
      {current === 'districts' && (
        <>
          {simple && <OwnerNote bodyName={body.name} countryId={playerId} />}
          {simple ? <SimpleDistrictsTab countryId={playerId} bodyName={body.name} /> : world && <ComplexDistrictsTab playerId={playerId} world={world} country={country} />}
        </>
      )}
      {current === 'population' && (simple ? <SimplePopulationTab bodyName={body.name} /> : <PopsPanel worldName={body.name} world={world} />)}
      {current === 'armies' && <BodyArmies bodyName={body.name} />}
      {current === 'defense' && <DefenseTab bodyName={body.name} playerId={playerId} />}
      {current === 'market' && <EconomyPanel subcategory="Market" worldName={body.name} world={world} country={country} />}
      {current === 'politics' && <PoliticsPanel worldName={body.name} world={world} />}
    </DraggableWindow>
  )
}
