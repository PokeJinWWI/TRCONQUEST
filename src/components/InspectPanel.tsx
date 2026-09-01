import { useState } from 'react'
import type { InspectableBody } from '../scene/inspectableBody'
import { estimateHabitability, estimateSize, PLANET_CLASS_LABELS } from '../scene/bodyStats'
import { DraggableWindow } from './DraggableWindow'
import { BuildingsPanel } from './BuildingsPanel'
import { EconomyPanel } from './EconomyPanel'
import { PoliticsPanel } from './PoliticsPanel'
import { useEconomyStore, worldByName } from '../state/economyStore'
import { getCountry } from '../data/countryData'

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
type InspectTab = 'overview' | 'buildings' | 'economy' | 'politics'
const PLANET_TABS: { id: InspectTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'buildings', label: 'Buildings' },
  { id: 'economy', label: 'Economy' },
  { id: 'politics', label: 'Politics' },
]

function OverviewRows({ body, action }: { body: InspectableBody; action?: InspectPanelAction }) {
  const size = estimateSize(body.radiusKm)
  const habitability = body.kind !== 'star' ? estimateHabitability(body.name, body.orbitAU) : null
  const worlds = useEconomyStore((s) => s.worlds)
  const world = worldByName(worlds, body.name)
  const owner = world?.ownerId ? getCountry(world.ownerId)?.name : undefined

  return (
    <>
      <div className="inspect-row">
        <span className="inspect-label">Type</span>
        <span className="inspect-value">{KIND_LABEL[body.kind]}</span>
      </div>
      {owner && (
        <div className="inspect-row">
          <span className="inspect-label">Owner</span>
          <span className="inspect-value">{owner}</span>
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

  // Stars and moons stay a simple single-pane readout — the tabbed
  // planet-management view only makes sense for a planet.
  if (body.kind !== 'planet') {
    return (
      <DraggableWindow title={body.name} onClose={onClose}>
        <OverviewRows body={body} action={action} />
      </DraggableWindow>
    )
  }

  return (
    <DraggableWindow title={body.name} onClose={onClose}>
      <div className="nav-subtabs">
        {PLANET_TABS.map((t) => (
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
      {tab === 'buildings' && <BuildingsPanel subtab={null} worldName={body.name} world={world} country={country} />}
      {tab === 'economy' && <EconomyPanel subcategory="Market" worldName={body.name} world={world} country={country} />}
      {tab === 'politics' && <PoliticsPanel worldName={body.name} world={world} />}
    </DraggableWindow>
  )
}
