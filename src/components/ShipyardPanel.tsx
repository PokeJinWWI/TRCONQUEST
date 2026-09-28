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
import { useGameTimeStore } from '../state/gameTimeStore'
import { usePlayerEconomy } from '../hooks/usePlayerEconomy'
import { shipyardSlotsForWorld } from '../scene/shipyardLogic'
import { useTechStore } from '../state/techStore'
import { findTech } from '../data/techData'

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
// Laid out top to bottom the way a shipyard is used: what is on the slips now
// (one box per slot, so the capacity is visible), what is waiting, then what
// you can order, grouped by kind of ship with what you can afford first.

// The order hulls are listed in, and what each group holds.
const GROUPS: { id: string; label: string; hint: string; roles: ShipClass['role'][] }[] = [
  { id: 'warship', label: 'Warships', hint: 'Combat ships', roles: ['warship'] },
  { id: 'transport', label: 'Troop transports', hint: 'Carry armies between worlds', roles: ['transport'] },
  { id: 'support', label: 'Science & support', hint: 'Science, construction, cargo and other civilian ships', roles: ['science', 'construction', 'cargo', 'civilian'] },
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
  const simDays = useGameTimeStore((s) => s.simDays)
  const researched = useTechStore((s) => s.stateFor(countryId).researched)
  const [message, setMessage] = useState<string | null>(null)
  const [onlyAffordable, setOnlyAffordable] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

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
    return { cost, affordable, techMissing, canBuild: affordable && !queueFull && !techMissing }
  }

  const sections = useMemo(() => {
    const all = [
      ...GROUPS.map((g) => ({ ...g, classes: SHIP_CLASSES.filter((c) => g.roles.includes(c.role)) })),
      { ...DESIGNS_GROUP, roles: [] as ShipClass['role'][], classes: designClasses },
    ]
    return all.filter((g) => g.classes.length > 0)
  }, [designClasses])

  const handleBuild = (classId: string) => {
    const result = queueBuild(countryId, classId, simDays)
    setMessage(result.ok ? null : result.reason)
  }
  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

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

      <div className="fleet-group-header">Slips — {building.length} of {slots} in use</div>
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
      {building.map((o) => orderRow(o, true))}
      {waiting.length > 0 && (
        <>
          <div className="fleet-group-header">Waiting for a slip ({waiting.length})</div>
          {waiting.map((o) => orderRow(o, false))}
        </>
      )}

      <div className="fleet-group-header">Stockpile</div>
      <div className="shipyard-stockpile">
        {COST_RESOURCE_IDS.map((id) => (
          <span key={id} className="shipyard-stock" title={RESOURCE_TYPES.find((r) => r.id === id)?.description}>
            {RESOURCE_SHORT[id]} <b>{Math.floor(amounts[id] ?? 0).toLocaleString()}</b>
            {(monthlyDelta[id] ?? 0) > 0 && <span className="shipyard-income"> +{monthlyDelta[id].toLocaleString()}/mo</span>}
          </span>
        ))}
      </div>

      <div className="fleet-group-header-row">
        <div className="fleet-group-header">Order a ship</div>
        <label className="shipyard-filter" title="Hide hulls you can't build right now">
          <input type="checkbox" checked={onlyAffordable} onChange={(e) => setOnlyAffordable(e.target.checked)} /> Only what I can build now
        </label>
      </div>
      {message && <div className="ship-panel-hint shipyard-message">{message}</div>}
      {sections.map((group) => {
        const rows = group.classes.map((c) => ({ shipClass: c, ...status(c) })).filter((r) => !onlyAffordable || r.canBuild)
        const isCollapsed = collapsed.has(group.id)
        return (
          <div key={group.id} className="shipyard-group">
            <button type="button" className="shipyard-group-title" onClick={() => toggle(group.id)} aria-expanded={!isCollapsed} title={group.hint}>
              <span className={`outliner-section-caret${isCollapsed ? ' collapsed' : ''}`}>▾</span>
              {group.label} <span className="shipyard-group-count">{rows.length}</span>
            </button>
            {!isCollapsed && rows.length === 0 && <div className="ship-panel-hint">Nothing here you can build right now.</div>}
            {!isCollapsed &&
              rows.map(({ shipClass, cost, affordable, techMissing, canBuild }) => (
                <div key={shipClass.id} className={`fleet-row shipyard-hull${canBuild ? '' : ' unavailable'}`}>
                  <div className="fleet-row-head">
                    <span className="fleet-row-name">{shipClass.name}</span>
                    <span className="fleet-row-class">{SHIP_ROLE_LABELS[shipClass.role]}</span>
                    <button
                      type="button"
                      className="ship-panel-unfollow-btn"
                      disabled={!canBuild}
                      onClick={() => handleBuild(shipClass.id)}
                      title={techMissing ? `Needs ${techMissing} researched` : queueFull ? 'The build queue is full' : affordable ? `Build for ${shipBuildDays(shipClass)} days` : 'Not enough resources'}
                    >
                      Build
                    </button>
                  </div>
                  <div className="fleet-row-status">
                    {shipClass.ftlDrives.map(describeFtlDrive).join(', ')} · {shipBuildDays(shipClass)} days
                    {shipClass.cargoCapacity ? ` · Hold ${shipClass.cargoCapacity}` : ''}
                    {techMissing ? ` · Needs ${techMissing}` : ''}
                  </div>
                  <CostChips cost={cost} amounts={amounts} />
                </div>
              ))}
          </div>
        )
      })}
    </div>
  )
}
