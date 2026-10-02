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
import { useColonyStore } from '../state/colonyStore'
import { COLONY_FOUNDING_DAYS, COLONY_PATROL_DAYS } from '../data/colonyData'
import { canColonize, colonizeFromPlanet, colonyCostFor } from '../scene/colonies'
import { useShipStore } from '../state/shipStore'
import { useResourceStore } from '../state/resourceStore'
import { useSurveyStore } from '../state/surveyStore'
import { resolveShipClass } from '../state/shipClassResolver'
import { useThrottledSimDays } from '../hooks/useThrottledSimDays'
import { usePlayerBodySurveyed } from '../scene/intel'

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

// A colony's stage in plain words; a micro-colony shows its patrol progress.
function ColonyRow({ bodyName }: { bodyName: string }) {
  const colony = useColonyStore((s) => s.colonies[bodyName])
  const simDays = useThrottledSimDays()
  if (!colony) return null
  const patrolled = colony.orbitSecureSinceSimDays === null ? 0 : Math.min(COLONY_PATROL_DAYS, Math.floor(simDays - colony.orbitSecureSinceSimDays))
  return (
    <div className="inspect-row">
      <span className="inspect-label">Colony</span>
      <span
        className="inspect-value"
        title={
          colony.stage === 'micro'
            ? `Becomes a planetary colony after ${COLONY_PATROL_DAYS} days with a patrol ship holding its orbit, no hostile warship there and no enemy on the ground. Until then it has little land and cannot raise armies.`
            : 'A full colony: all its land, and it can raise armies.'
        }
      >
        {colony.stage === 'micro' ? `Micro-colony (patrol ${patrolled} / ${COLONY_PATROL_DAYS} days)` : 'Planetary colony'}
      </span>
    </div>
  )
}

// Colonize from the planet menu (Simple mode): on a surveyed world nobody
// holds, with land. "Colonize" sends one of your Colony Ships; "Let ships
// choose" puts every idle Colony Ship on auto-settle, which picks the cheapest
// world it may itself. Says why when it can't.
function ColonizeRows({ bodyName }: { bodyName: string }) {
  const [message, setMessage] = useState<string | null>(null)
  const owner = useTerritoryStore((s) => s.bodyOwner[bodyName])
  const simple = usePlayerStore((s) => s.economyModel === 'abstract')
  const playerId = usePlayerStore((s) => s.selectedCountryId)
  const ships = useShipStore((s) => s.ships)
  // Re-check when what the rules read changes.
  useResourceStore((s) => (playerId ? s.stateFor(playerId).amounts.influence : 0))
  useSurveyStore((s) => (playerId ? s.discovered[playerId] : undefined))
  if (!simple || !playerId || owner || bodyName === 'Sol') return null
  const owners = useTerritoryStore.getState().bodyOwner
  if ((groundSurface(bodyName, owners)?.mainland ?? -1) < 0) return null
  const mine = ships.filter((s) => s.ownerId === playerId && resolveShipClass(s.classId)?.role === 'colony')
  const checks = mine.map((s) => canColonize(s, bodyName, { anywhere: true }))
  const okCheck = checks.find((c) => c.ok)
  const why = mine.length === 0 ? 'You have no Colony Ship: build one in the Shipyard (Science & support)' : okCheck ? null : (checks.find((c) => !c.ok) as { reason: string } | undefined)?.reason ?? null
  const cost = colonyCostFor(playerId, bodyName)
  return (
    <>
      <div className="inspect-divider" />
      <div className="ship-panel-btn-row">
        <button
          type="button"
          className="detail-view-btn"
          disabled={!!why}
          title={why ?? `Send a Colony Ship to found a micro-colony here (${cost} influence, ${COLONY_FOUNDING_DAYS} days in orbit)`}
          onClick={() => {
            const r = colonizeFromPlanet(bodyName)
            setMessage(r.ok ? `${r.shipName} is on its way` : r.reason)
          }}
        >
          Colonize ({cost} influence)
        </button>
        <button
          type="button"
          className="detail-view-btn"
          disabled={mine.length === 0}
          title="Put every Colony Ship of yours on auto-settle: each picks the cheapest world it may settle, itself"
          onClick={() => {
            for (const s of mine) if (!s.founding && !s.arrivalCommand) useShipStore.getState().setAutomation(s.id, 'settle')
            setMessage('Your Colony Ships will choose where to settle')
          }}
        >
          Let ships choose
        </button>
      </div>
      {(why || message) && <div className="ship-panel-hint">{message ?? `Can't colonize: ${why}`}</div>}
    </>
  )
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
  const surveyed = usePlayerBodySurveyed(body.name)

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
      {owner && <ColonyRow bodyName={body.name} />}
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

      {body.kind !== 'star' && !surveyed && (
        <>
          <div className="inspect-divider" />
          <div className="inspect-status">Not surveyed: send a Science Ship to learn its class, size and habitability.</div>
        </>
      )}
      {body.kind !== 'star' && surveyed && (
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

      {body.kind !== 'star' && <ColonizeRows bodyName={body.name} />}

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
  const surveyed = usePlayerBodySurveyed(body.name)
  return (
    <div className="pl-header" style={{ borderColor: owner?.color ?? 'rgba(255,255,255,0.12)' }}>
      <div className="pl-header-globe" style={{ background: `radial-gradient(circle at 35% 35%, ${body.color ?? '#8ab4ff'}, #0b1622 75%)` }} />
      <div className="pl-header-text">
        <div className="pl-header-name">{body.name}</div>
        <div className="abs-dim">
          {surveyed ? <>{body.planetClass ? PLANET_CLASS_LABELS[body.planetClass] : KIND_LABEL[body.kind]} · {size.label}</> : <>{KIND_LABEL[body.kind]} · not surveyed</>}
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
      <DraggableWindow title={body.name} memoryKey="planet" onClose={onClose}>
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
    <DraggableWindow title={body.name} memoryKey="planet" onClose={onClose} defaultSize={{ width: 420, height: 480 }}>
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
