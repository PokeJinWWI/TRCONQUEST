import { useState } from 'react'
import type { InspectableBody } from '../scene/inspectableBody'
import { estimateHabitability, estimateSize, PLANET_CLASS_LABELS } from '../scene/bodyStats'
import { DraggableWindow } from './DraggableWindow'
import { BuildingsPanel } from './BuildingsPanel'
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

// Tabs shown when inspecting a planet — the "everything about this planet in
// one place" view: its stats, its buildings, its market, and (reserved) the
// politics/decisions that will hang off it. Stars and moons keep the plain
// single-pane readout.
type InspectTab = 'overview' | 'armies' | 'pops' | 'buildings' | 'economy' | 'politics'
const PLANET_TABS: { id: InspectTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'armies', label: 'Armies' },
  { id: 'pops', label: 'Pops' },
  { id: 'buildings', label: 'Buildings' },
  { id: 'economy', label: 'Economy' },
  { id: 'politics', label: 'Politics' },
]

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

export function InspectPanel({ body, onClose, action }: InspectPanelProps) {
  const [tab, setTab] = useState<InspectTab>('overview')
  const worlds = useEconomyStore((s) => s.worlds)
  const countries = useEconomyStore((s) => s.countries)
  const world = worldByName(worlds, body.name)
  const country = world ? countries.find((c) => c.id === world.ownerId) : undefined

  // A star stays a simple single-pane readout. Planets and moons get the
  // tabbed view: a moon can be settled, garrisoned and invaded just like a
  // planet, so it gets the same tabs — Overview and Armies always, and Pops,
  // Buildings, Economy and Politics once it's a colonised world.
  if (body.kind === 'star') {
    return (
      <DraggableWindow title={body.name} onClose={onClose}>
        <OverviewRows body={body} action={action} />
      </DraggableWindow>
    )
  }
  const tabs = body.kind === 'planet' || world ? PLANET_TABS : PLANET_TABS.filter((t) => t.id === 'overview' || t.id === 'armies')

  return (
    <DraggableWindow title={body.name} onClose={onClose}>
      <div className="nav-subtabs">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`nav-subtab${tab === t.id ? ' active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'overview' && <OverviewRows body={body} action={action} />}
      {tab === 'armies' && <BodyArmies bodyName={body.name} />}
      {tab === 'pops' && <PopsPanel worldName={body.name} world={world} />}
      {tab === 'buildings' && <BuildingsPanel subtab={null} worldName={body.name} world={world} country={country} />}
      {tab === 'economy' && <EconomyPanel subcategory="Market" worldName={body.name} world={world} country={country} />}
      {tab === 'politics' && <PoliticsPanel worldName={body.name} world={world} />}
    </DraggableWindow>
  )
}
