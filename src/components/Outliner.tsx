import { useMemo, useState } from 'react'
import { useViewStore } from '../state/viewStore'
import { useShipStore } from '../state/shipStore'
import { useFleetStore } from '../state/fleetStore'
import { PLANETS } from '../scene/planetData'
import { getStarsForNeighborhood } from '../data/starData'
import { NEIGHBORHOODS } from '../data/neighborhoodData'
import { getMoonsForPlanet } from '../scene/moonData'
import { ALLEGIANCE_COLORS } from '../data/shipData'

type EntryKind = 'neighborhood' | 'star' | 'planet' | 'moon' | 'ship'
// The filter offers a "black holes" toggle even though nothing in the game
// can be that kind yet — reserving the spot the same way the empty
// Colonies/Starbases sections do.
type FilterKind = EntryKind | 'blackhole'

interface OutlinerEntry {
  key: string
  name: string
  color: string
  kind: EntryKind
  /** Fleet entries only — the ship a click actually selects (see
   * handleFleetClick). A fleet's own id isn't a ship id, so this is what
   * lets the row still resolve to something ShipPanel can inspect. */
  leadShipId?: string
}

const SOL_COLOR = '#ffd27a'
const SOL_NAME = 'Sol'

const FILTERS: { kind: FilterKind; label: string }[] = [
  { kind: 'neighborhood', label: 'Neighborhoods' },
  { kind: 'star', label: 'Stars' },
  { kind: 'planet', label: 'Planets' },
  { kind: 'moon', label: 'Moons' },
  { kind: 'blackhole', label: 'Black Holes' },
]

// What's "in view" is derived purely from viewStore + the same static data
// files every scene already reads.
function useInViewEntries(): OutlinerEntry[] {
  const level = useViewStore((s) => s.level)
  const selectedNeighborhoodId = useViewStore((s) => s.selectedNeighborhoodId)
  const selectedStarId = useViewStore((s) => s.selectedStarId)
  const selectedBodyName = useViewStore((s) => s.selectedBodyName)

  if (level === 'galactic') {
    return NEIGHBORHOODS.map((n) => ({ key: n.id, name: n.name, color: n.color, kind: 'neighborhood' }))
  }

  const STARS = getStarsForNeighborhood(selectedNeighborhoodId)

  if (level === 'interstellar') {
    return STARS.map((star) => ({ key: star.id, name: star.name, color: star.color, kind: 'star' }))
  }

  if (level === 'system') {
    const starName = STARS.find((s) => s.id === selectedStarId)?.name ?? SOL_NAME
    return [
      { key: 'sol', name: starName, color: SOL_COLOR, kind: 'star' },
      ...PLANETS.map((p) => ({ key: p.name, name: p.name, color: p.color, kind: 'planet' as const })),
    ]
  }

  if (level === 'satellite' && selectedBodyName) {
    const isStar = selectedBodyName === SOL_NAME
    const planetData = !isStar ? PLANETS.find((p) => p.name === selectedBodyName) : undefined
    const color = isStar ? SOL_COLOR : planetData?.color ?? '#ffffff'
    const moons = !isStar ? getMoonsForPlanet(selectedBodyName).moons : []
    return [
      { key: selectedBodyName, name: selectedBodyName, color, kind: isStar ? 'star' : 'planet' },
      ...moons.map((m) => ({ key: m.name, name: m.name, color: m.color, kind: 'moon' as const })),
    ]
  }

  return []
}

// Real, not a placeholder — every ship spawned (currently only via the
// dev-only DebugConsole, since there's no production ship-building system
// yet) shows up here, grouped by fleet rather than one row per hull (see
// ShipInstance.fleetId) — a hundred ships is a hundred rows of noise if
// they're not merged into fleets first, but a manageable list once they are.
// Player-owned only: this is the player's OWN fleet roster, not a sensor
// readout of every hull in the system — a hostile or neutral fleet is still
// inspectable via its marker/presence badge, it just doesn't belong in "my
// fleets."
function useFleetEntries(): OutlinerEntry[] {
  const ships = useShipStore((s) => s.ships)
  const fleets = useFleetStore((s) => s.fleets)
  return useMemo(() => {
    const owned = ships.filter((ship) => ship.allegiance === 'player')
    const byFleet = new Map<string, typeof owned>()
    for (const ship of owned) {
      const arr = byFleet.get(ship.fleetId) ?? []
      arr.push(ship)
      byFleet.set(ship.fleetId, arr)
    }
    return Array.from(byFleet.entries()).map(([fleetId, members]) => {
      const fleet = fleets.find((f) => f.id === fleetId)
      const name = members.length > 1 ? `${fleet?.name ?? 'Fleet'} (${members.length})` : members[0].name
      return { key: fleetId, name, color: ALLEGIANCE_COLORS.player, kind: 'ship' as const, leadShipId: members[0].id }
    })
  }, [ships, fleets])
}

function OutlinerIcon({ color, kind }: { color: string; kind: EntryKind }) {
  return (
    <span
      className={`outliner-icon outliner-icon-${kind}`}
      style={{ borderColor: color, backgroundColor: kind === 'star' || kind === 'neighborhood' ? color : 'transparent' }}
    />
  )
}

function OutlinerSection({
  title,
  entries,
  emptyText,
  selectedKey,
  onEntryClick,
}: {
  title: string
  entries: OutlinerEntry[]
  emptyText: string
  /** The key of whichever entry this section's selection currently points
   * at — compared against each entry to highlight it, same idea as a
   * marker's own `.selected` state in the viewport. */
  selectedKey?: string | null
  /** Omitted for sections with nothing real to select yet (Colonies,
   * Starbases) — entries stay inert rather than clickable-but-no-op. */
  onEntryClick?: (entry: OutlinerEntry) => void
}) {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <div className="outliner-section">
      <button
        type="button"
        className="outliner-section-title"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
      >
        <span className={`outliner-section-caret${collapsed ? ' collapsed' : ''}`}>▾</span>
        {title}
      </button>
      {!collapsed &&
        (entries.length === 0 ? (
          <div className="outliner-empty">{emptyText}</div>
        ) : (
          <ul className="outliner-list">
            {entries.map((entry) => (
              <li
                key={entry.key}
                className={`outliner-entry${onEntryClick ? ' clickable' : ''}${entry.key === selectedKey ? ' selected' : ''}`}
                onClick={onEntryClick ? () => onEntryClick(entry) : undefined}
              >
                <OutlinerIcon color={entry.color} kind={entry.kind} />
                <span className="outliner-entry-name">{entry.name}</span>
              </li>
            ))}
          </ul>
        ))}
    </div>
  )
}

// Stellaris-style right-side outliner: what's currently in view (real,
// derived from viewStore + the game's actual body data) plus placeholder
// sections for nation assets this project doesn't have gameplay systems for
// yet (colonies/fleets/starbases) — reserving their spot the same way
// ChatPlaceholder reserves the comms panel's, rather than inventing fake data.
export function Outliner() {
  const [collapsed, setCollapsed] = useState(false)
  const [search, setSearch] = useState('')
  const [visibleKinds, setVisibleKinds] = useState<Set<FilterKind>>(
    () => new Set(FILTERS.map((f) => f.kind)),
  )
  const inViewEntries = useInViewEntries()
  const fleetEntries = useFleetEntries()
  const inViewSelection = useViewStore((s) => s.inViewSelection)
  const selectInView = useViewStore((s) => s.selectInView)
  const ships = useShipStore((s) => s.ships)
  const selectedShipId = useShipStore((s) => s.selectedShipId)
  const selectShip = useShipStore((s) => s.selectShip)
  // A fleet entry's own key is its fleetId (see useFleetEntries), not any
  // one ship's id, so the row highlights whichever member is actually
  // selected — not just whichever one happens to be listed as the lead.
  const selectedFleetId = ships.find((s) => s.id === selectedShipId)?.fleetId ?? null

  // Mirrors exactly what clicking the entry's own in-scene marker does: pick
  // it in viewStore (engaging that scene's SelectionTracker camera lock) and
  // drop any ship selection, same as every scene's own handleSelect already
  // does for a marker click.
  const handleInViewClick = (entry: OutlinerEntry) => {
    selectShip(null)
    selectInView(entry.key)
  }
  const handleFleetClick = (entry: OutlinerEntry) => {
    if (entry.leadShipId) selectShip(entry.leadShipId)
  }

  const toggleKind = (kind: FilterKind) => {
    setVisibleKinds((prev) => {
      const next = new Set(prev)
      if (next.has(kind)) next.delete(kind)
      else next.add(kind)
      return next
    })
  }

  const query = search.trim().toLowerCase()
  const filteredInView = useMemo(
    () => inViewEntries.filter((entry) => visibleKinds.has(entry.kind) && (query === '' || entry.name.toLowerCase().includes(query))),
    [inViewEntries, visibleKinds, query],
  )
  // Fleets aren't a celestial kind, so the Stars/Planets/Moons/Black Holes
  // pills don't apply to them — only the search box does.
  const filteredFleets = useMemo(
    () => fleetEntries.filter((entry) => query === '' || entry.name.toLowerCase().includes(query)),
    [fleetEntries, query],
  )

  return (
    <div className={`outliner${collapsed ? ' collapsed' : ''}`}>
      <button
        type="button"
        className="outliner-toggle"
        onClick={() => setCollapsed((c) => !c)}
        aria-label={collapsed ? 'Expand outliner' : 'Collapse outliner'}
      >
        {collapsed ? '‹' : '›'}
      </button>
      <div className="outliner-content">
        <div className="outliner-title">Outliner</div>

        <input
          type="text"
          className="outliner-search-input"
          placeholder="Search…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="outliner-filter-pills">
          {FILTERS.map(({ kind, label }) => (
            <button
              key={kind}
              type="button"
              className={`outliner-filter-pill${visibleKinds.has(kind) ? ' active' : ''}`}
              onClick={() => toggleKind(kind)}
            >
              {label}
            </button>
          ))}
        </div>

        <OutlinerSection
          title="In View"
          entries={filteredInView}
          emptyText="Nothing charted here"
          selectedKey={inViewSelection}
          onEntryClick={handleInViewClick}
        />
        <OutlinerSection title="Colonies" entries={[]} emptyText="No colonies established" />
        <OutlinerSection
          title="Fleets"
          entries={filteredFleets}
          emptyText="No fleets deployed"
          selectedKey={selectedFleetId}
          onEntryClick={handleFleetClick}
        />
        <OutlinerSection title="Starbases" entries={[]} emptyText="No starbases built" />
      </div>
    </div>
  )
}
