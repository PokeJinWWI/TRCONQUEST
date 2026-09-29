import { useThrottledSimDays } from '../hooks/useThrottledSimDays'
import { useMemo, useState } from 'react'
import { getCountry } from '../data/countryData'
import { RESOURCE_TYPES, type ResourceId } from '../data/resourceData'
import { SHIP_CLASSES, SHIP_ROLE_LABELS, describeFtlDrive, type ShipClass } from '../data/shipData'
import { MAX_QUEUED_BUILDS, shipBuildCost, shipBuildDays, type ResourceCost } from '../data/shipyardData'
import { resolveShipClass } from '../state/shipClassResolver'
import { useShipDesignStore } from '../state/shipDesignStore'
import { usePlayerResources } from '../hooks/usePlayerResources'
import { usePlayerStore } from '../state/playerStore'
import { useShipyardStore } from '../state/shipyardStore'
import { usePlayerEconomy } from '../hooks/usePlayerEconomy'
import { shipyardSlotsForWorld } from '../scene/shipyardLogic'
import { useTechStore } from '../state/techStore'
import { findTech } from '../data/techData'
import { isAbstractEconomy } from '../state/playerStore'

// The resources a hull can actually cost — the ones worth a row in the
// stockpile readout (minerals only feed a future alloy chain).
const COST_RESOURCE_IDS: ResourceId[] = ['alloys', 'energy', 'exoticMatter', 'hyperium', 'special']
const RESOURCE_SHORT = Object.fromEntries(RESOURCE_TYPES.map((r) => [r.id, r.name])) as Record<ResourceId, string>

function CostChips({ cost, amounts }: { cost: ResourceCost; amounts: Record<ResourceId, number> }) {
  return (
    <span className="shipyard-costs">
      {COST_RESOURCE_IDS.filter((id) => (cost[id] ?? 0) > 0).map((id) => {
        const short = (cost[id] ?? 0) > (amounts[id] ?? 0)
        return (
          <span key={id} className={`shipyard-cost${short ? ' short' : ''}`} title={`${RESOURCE_SHORT[id]}: need ${cost[id]}, have ${amounts[id] ?? 0}`}>
            {cost[id]} {RESOURCE_SHORT[id]}
          </span>
        )
      })}
    </span>
  )
}

// Military > Navy > Shipyard: how a player without the debug console gets
// ships. Pick a hull, pay its resources up front, wait its build time at the
// capital, and the finished ship appears in orbit there. See
// data/shipyardData.ts for costs/timing/supply (all placeholder tuning) and
// hooks/useShipyardResolver for what actually advances the queue.
//
// Subtabs: Slips (what is building, one box per slot, and what is waiting),
// then one tab per kind of ship to order. The stockpile stays on top of every
// tab, and a hull you can't build says why under it.

// The order hulls are listed in, and what each group holds.
const GROUPS: { id: string; label: string; hint: string; roles: ShipClass['role'][] }[] = [
  { id: 'warship', label: 'Warships', hint: 'Combat ships', roles: ['warship'] },
  { id: 'transport', label: 'Troop transports', hint: 'Carry armies between worlds', roles: ['transport'] },
  { id: 'support', label: 'Science & support', hint: 'Science, colony, construction, cargo and other civilian ships', roles: ['science', 'colony', 'construction', 'cargo', 'civilian'] },
]
const DESIGNS_GROUP = { id: 'designs', label: 'Your designs', hint: 'Hulls you made in the Ship Designer' }

export function ShipyardPanel() {
  const { world } = usePlayerEconomy()
  const { amounts, monthlyDelta } = usePlayerResources()
  const countryId = usePlayerStore((s) => s.selectedCountryId) ?? ''
  const orders = useShipyardStore((s) => s.ordersFor(countryId))
  const queueBuild = useShipyardStore((s) => s.queueBuild)
  const cancelBuild = useShipyardStore((s) => s.cancelBuild)
  const designs = useShipDesignStore((s) => s.designs)
  const simDays = useThrottledSimDays()
  const researched = useTechStore((s) => s.stateFor(countryId).researched)
  const [message, setMessage] = useState<string | null>(null)
  const [onlyAffordable, setOnlyAffordable] = useState(false)
  const [tab, setTab] = useState<string>('slips')

  const slots = shipyardSlotsForWorld(world)
  const capital = getCountry(countryId)?.capitalBodyName
  const designClasses = useMemo(() => designs.map((d) => resolveShipClass(`design:${d.id}`)).filter((c): c is ShipClass => !!c), [designs])
  const building = orders.filter((o) => o.startedSimDays !== null)
  const waiting = orders.filter((o) => o.startedSimDays === null)
  const queueFull = orders.length >= MAX_QUEUED_BUILDS

  const status = (shipClass: ShipClass) => {
    const cost = shipBuildCost(shipClass)
    const affordable = COST_RESOURCE_IDS.every((id) => (cost[id] ?? 0) <= (amounts[id] ?? 0))
    const techMissing = shipClass.requiresTech && !researched.has(shipClass.requiresTech) ? (findTech(shipClass.requiresTech)?.name ?? shipClass.requiresTech) : null
    const short = COST_RESOURCE_IDS.filter((id) => (cost[id] ?? 0) > (amounts[id] ?? 0)).map((id) => `${Math.ceil((cost[id] ?? 0) - (amounts[id] ?? 0))} ${RESOURCE_SHORT[id]}`)
    const reason = techMissing ? `Needs ${techMissing} researched` : queueFull ? `The build queue is full (${MAX_QUEUED_BUILDS} orders)` : !affordable ? `Short of ${short.join(', ')}` : null
    return { cost, affordable, techMissing, reason, canBuild: affordable && !queueFull && !techMissing }
  }

  const sections = useMemo(() => {
    const all = [
      // Colonies exist in Simple mode only (scene/colonies.ts).
      ...GROUPS.map((g) => ({ ...g, classes: SHIP_CLASSES.filter((c) => g.roles.includes(c.role) && (c.role !== 'colony' || isAbstractEconomy())) })),
      { ...DESIGNS_GROUP, roles: [] as ShipClass['role'][], classes: designClasses },
    ]
    return all.filter((g) => g.classes.length > 0)
  }, [designClasses])

  const handleBuild = (classId: string) => {
    const result = queueBuild(countryId, classId, simDays)
    setMessage(result.ok ? null : result.reason)
  }

  const orderRow = (o: (typeof orders)[number], started: boolean) => {
    const fraction = started ? Math.min(1, Math.max(0, (simDays - o.startedSimDays!) / o.durationDays)) : 0
    const daysLeft = started ? Math.max(0, o.finishSimDays! - simDays) : o.durationDays
    return (
      <div key={o.id} className="fleet-row">
        <div className="fleet-row-head">
          <span className="fleet-row-name">{o.className}</span>
          <span className="fleet-row-class">{started ? `${daysLeft.toFixed(1)}d left` : `${o.durationDays}d once a slot frees`}</span>
          <button type="button" className="ship-panel-unfollow-btn" onClick={() => cancelBuild(countryId, o.id)} title="Cancel and refund the full cost">
            Cancel
          </button>
        </div>
        {started && (
          <div className="fleet-row-bar">
            <span className="health-bar-track tone-overall combat-roster-bar">
              <span className="health-bar-fill" style={{ width: `${fraction * 100}%` }} />
            </span>
            <span className="combat-roster-pct">{Math.round(fraction * 100)}%</span>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="fleet-list">
      <div className="ship-panel-hint strategizer-intro">
        {capital ? <>Your shipyard is at <b>{capital}</b>: ships are built there and appear in orbit around it. </> : 'Ships are built at your capital. '}
        Cost is paid up front and refunded in full if you cancel. More slips: build Spaceyards in Economy &gt; Construction.
      </div>

      <div className="shipyard-stockpile">
        {COST_RESOURCE_IDS.map((id) => (
          <span key={id} className="shipyard-stock" title={RESOURCE_TYPES.find((r) => r.id === id)?.description}>
            {RESOURCE_SHORT[id]} <b>{Math.floor(amounts[id] ?? 0).toLocaleString()}</b>
            {(monthlyDelta[id] ?? 0) > 0 && <span className="shipyard-income"> +{monthlyDelta[id].toLocaleString()}/mo</span>}
          </span>
        ))}
      </div>

      <div className="nav-subtabs shipyard-tabs">
        <button type="button" className={`nav-subtab${tab === 'slips' ? ' active' : ''}`} onClick={() => setTab('slips')} title="What is being built, and what is waiting for a slip">
          Slips ({building.length}/{slots}){waiting.length > 0 ? ` +${waiting.length}` : ''}
        </button>
        {sections.map((g) => (
          <button key={g.id} type="button" className={`nav-subtab${tab === g.id ? ' active' : ''}`} onClick={() => setTab(g.id)} title={g.hint}>
            {g.label}
          </button>
        ))}
      </div>
      {message && <div className="ship-panel-hint shipyard-message">{message}</div>}

      {tab === 'slips' && (
        <>
          <div className="shipyard-slips">
            {Array.from({ length: slots }, (_, i) => {
              const o = building[i]
              return (
                <div key={i} className={`shipyard-slip${o ? ' busy' : ''}`} title={o ? `${o.className} under construction` : 'Free slip'}>
                  {o ? o.className : 'Free'}
                </div>
              )
            })}
          </div>
          {building.length === 0 && waiting.length === 0 && <div className="ship-panel-hint">Nothing on the slips. Order a ship from one of the other tabs.</div>}
          {building.map((o) => orderRow(o, true))}
          {waiting.length > 0 && (
            <>
              <div className="fleet-group-header">Waiting for a slip ({waiting.length})</div>
              {waiting.map((o) => orderRow(o, false))}
            </>
          )}
        </>
      )}

      {sections
        .filter((g) => g.id === tab)
        .map((group) => {
          const rows = group.classes.map((c) => ({ shipClass: c, ...status(c) })).filter((r) => !onlyAffordable || r.canBuild)
          return (
            <div key={group.id} className="shipyard-group">
              <label className="shipyard-filter" title="Hide hulls you can't build right now">
                <input type="checkbox" checked={onlyAffordable} onChange={(e) => setOnlyAffordable(e.target.checked)} /> Only what I can build now
              </label>
              {rows.length === 0 && <div className="ship-panel-hint">Nothing here you can build right now.</div>}
              {rows.map(({ shipClass, cost, reason, canBuild }) => (
                <div key={shipClass.id} className={`fleet-row shipyard-hull${canBuild ? '' : ' unavailable'}`}>
                  <div className="fleet-row-head">
                    <span className="fleet-row-name">{shipClass.name}</span>
                    <span className="fleet-row-class">{SHIP_ROLE_LABELS[shipClass.role]}</span>
                    <button type="button" className="ship-panel-unfollow-btn" disabled={!canBuild} onClick={() => handleBuild(shipClass.id)} title={reason ?? `Build for ${shipBuildDays(shipClass)} days`}>
                      Build
                    </button>
                  </div>
                  <div className="fleet-row-status">
                    {shipClass.ftlDrives.map(describeFtlDrive).join(', ')} · {shipBuildDays(shipClass)} days
                    {shipClass.cargoCapacity ? ` · Hold ${shipClass.cargoCapacity}` : ''}
                  </div>
                  <CostChips cost={cost} amounts={amounts} />
                  {reason && <div className="shipyard-reason">Can't build: {reason}</div>}
                </div>
              ))}
            </div>
          )
        })}
    </div>
  )
}
