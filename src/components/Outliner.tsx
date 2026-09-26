import { useMemo, useState } from 'react'
import { useViewStore } from '../state/viewStore'
import { useShipStore } from '../state/shipStore'
import { useTerritoryStore } from '../state/territoryStore'
import { bodyIndex } from '../scene/territory'
import { isAdditiveClick } from '../scene/selectionInput'
import { useFleetStore } from '../state/fleetStore'
import { usePlayerStore } from '../state/playerStore'
import { getPlanetsForStar } from '../scene/planetData'
import { getStarsForNeighborhood, getSystemStars, STARS } from '../data/starData'
import { NEIGHBORHOODS } from '../data/neighborhoodData'
import { getMoonsForPlanet } from '../scene/moonData'
import { RELATION_COLORS } from '../data/shipData'
import { useArmyStore } from '../state/armyStore'
import { useCombatStore } from '../state/combatStore'
import { atWar } from '../state/diplomacyStore'
import { BATTLE_KIND_LABELS, groundBattleDetail, spaceBattleDetail, terrainBattleDetail, type PlayerBattle } from '../scene/battleList'
import { useTerrainStore } from '../state/terrainStore'
import { openBattle } from '../scene/battleNav'
import { playerArmyGroups, type ArmyGroup } from '../scene/armyOutliner'
import { useBattleStore } from '../state/battleStore'

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
  /** Moon entries only — the planet whose satellite view holds it. */
  parentPlanet?: string
  /** Colony entries only — the system the world is in. */
  starId?: string
  /** A dim second label (a colony's system, when the list spans several). */
  detail?: string
}

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
    // Every component star (one for a single-star system, several for a
    // multi-star one — see getSystemStars), then the planets.
    return [
      ...getSystemStars(selectedStarId).map((c) => ({ key: c.name, name: c.name, color: c.color, kind: 'star' as const })),
      ...getPlanetsForStar(selectedStarId).map((p) => ({ key: p.name, name: p.name, color: p.color, kind: 'planet' as const })),
    ]
  }

  if (level === 'satellite' && selectedBodyName) {
    const componentStar = getSystemStars(selectedStarId).find((c) => c.name === selectedBodyName)
    const isStar = !!componentStar
    const planetData = !isStar ? getPlanetsForStar(selectedStarId).find((p) => p.name === selectedBodyName) : undefined
    const color = componentStar?.color ?? planetData?.color ?? '#ffffff'
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
  const playerCountryId = usePlayerStore((s) => s.selectedCountryId)
  return useMemo(() => {
    const owned = ships.filter((ship) => ship.ownerId === playerCountryId)
    const byFleet = new Map<string, typeof owned>()
    for (const ship of owned) {
      const arr = byFleet.get(ship.fleetId) ?? []
      arr.push(ship)
      byFleet.set(ship.fleetId, arr)
    }
    return Array.from(byFleet.entries()).map(([fleetId, members]) => {
      const fleet = fleets.find((f) => f.id === fleetId)
      const name = members.length > 1 ? `${fleet?.name ?? 'Fleet'} (${members.length})` : members[0].name
      return { key: fleetId, name, color: RELATION_COLORS.own, kind: 'ship' as const, leadShipId: members[0].id }
    })
  }, [ships, fleets, playerCountryId])
}

// Every world (planet or moon) the player's own country owns, in every system,
// from the live territory map, which is what war and peace change. Not scoped
// to the view: the list is the player's colonies, wherever they are, and
// clicking one takes you there. When they span several systems each row also
// names its system.
function useColonyEntries(): OutlinerEntry[] {
  const selectedCountryId = usePlayerStore((s) => s.selectedCountryId)
  const bodyOwner = useTerritoryStore((s) => s.bodyOwner)
  return useMemo(() => {
    if (!selectedCountryId) return []
    const owned = [...bodyIndex().values()].filter((b) => bodyOwner[b.name] === selectedCountryId)
    const spansSystems = new Set(owned.map((b) => b.starId)).size > 1
    return owned.map((b) => {
      const color =
        b.kind === 'moon'
          ? getMoonsForPlanet(b.parentPlanet ?? '').moons.find((m) => m.name === b.name)?.color
          : getPlanetsForStar(b.starId).find((p) => p.name === b.name)?.color
      const detail = spansSystems ? STARS.find((st) => st.id === b.starId)?.name : undefined
      return { key: b.name, name: b.name, color: color ?? '#ffffff', kind: b.kind, parentPlanet: b.parentPlanet, starId: b.starId, detail }
    })
  }, [selectedCountryId, bodyOwner])
}

// The player's armies, grouped by world / transport — right below Fleets.
function useArmyGroups(): ArmyGroup[] {
  const playerId = usePlayerStore((s) => s.selectedCountryId)
  // A string of what each row shows, so this re-renders only when a row would
  // change, not on every ground step.
  const key = useArmyStore((s) =>
    playerArmyGroups(s.armies, useShipStore.getState().ships, playerId)
      .map((g) => `${g.key}=${g.label}=${g.detail}`)
      .join('|'),
  )
  return useMemo(
    () => playerArmyGroups(useArmyStore.getState().armies, useShipStore.getState().ships, playerId),
    // key stands in for the store contents it was made from.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, playerId],
  )
}

function openArmyGroup(group: ArmyGroup) {
  if (group.shipId) {
    useShipStore.getState().selectShip(group.shipId)
    return
  }
  if (!group.bodyName) return
  const view = useViewStore.getState()
  if (group.starId && view.selectedStarId !== group.starId) useViewStore.setState({ selectedStarId: group.starId })
  view.enterGround(group.bodyName)
}

function ArmiesSection() {
  const groups = useArmyGroups()
  const [collapsed, setCollapsed] = useState(false)
  const level = useViewStore((s) => s.level)
  const selectedBody = useViewStore((s) => s.selectedBodyName)
  const total = groups.length
  return (
    <div className="outliner-section">
      <button type="button" className="outliner-section-title" onClick={() => setCollapsed((c) => !c)} aria-expanded={!collapsed}>
        <span className={`outliner-section-caret${collapsed ? ' collapsed' : ''}`}>▾</span>
        Armies{total > 0 ? ` (${total})` : ''}
      </button>
      {!collapsed &&
        (total === 0 ? (
          <div className="outliner-empty">No army raised</div>
        ) : (
          <ul className="outliner-list">
            {groups.map((g) => (
              <li
                key={g.key}
                className={`outliner-entry clickable outliner-battle${level === 'ground' && g.bodyName && g.bodyName === selectedBody ? ' selected' : ''}`}
                onClick={() => openArmyGroup(g)}
                title={g.shipId ? 'Select the transport' : `Open the ground map of ${g.bodyName}`}
              >
                <span className="outliner-icon outliner-icon-ship" style={{ borderColor: RELATION_COLORS.own, marginTop: 3 }} />
                <span className="outliner-battle-body">
                  <span className="outliner-entry-name">{g.label}</span>
                  <span className="outliner-battle-detail">{g.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        ))}
    </div>
  )
}

function BattleRow({ battle }: { battle: PlayerBattle }) {
  const playerId = usePlayerStore((s) => s.selectedCountryId)
  const detail = useArmyStore((s) =>
    battle.kind !== 'space' && battle.kind !== 'terrain' && playerId && battle.bodyName ? groundBattleDetail(s.armies, battle.bodyName, playerId, atWar) : '',
  )
  const spaceDetail = useCombatStore((s) =>
    battle.kind === 'space' && playerId
      ? spaceBattleDetail(s.engagements.find((e) => e.id === battle.engagementId), useShipStore.getState().ships, playerId, atWar)
      : '',
  )
  const terrainDetail = useTerrainStore((s) =>
    battle.kind === 'terrain' && playerId ? terrainBattleDetail(s.battles.find((b) => b.id === battle.terrainBattleId), playerId, atWar) : '',
  )
  const level = useViewStore((s) => s.level)
  const terrainBattleId = useViewStore((s) => s.terrainBattleId)
  const engagementId = useViewStore((s) => s.combatEngagementId)
  const selectedBody = useViewStore((s) => s.selectedBodyName)
  const here =
    battle.kind === 'space'
      ? level === 'combat' && engagementId === battle.engagementId
      : battle.kind === 'terrain'
        ? level === 'terrain' && terrainBattleId === battle.terrainBattleId
        : level === 'ground' && selectedBody === battle.bodyName
  return (
    <li
      className={`outliner-entry clickable outliner-battle${here ? ' selected' : ''}`}
      onClick={() => openBattle(battle)}
      title={
        here
          ? 'You are viewing this battle'
          : battle.kind === 'terrain'
            ? `Units are at close quarters at ${battle.place} — open the terrain map`
            : battle.kind === 'contest'
            ? `Hostile armies share ${battle.place}, but nobody is firing yet — open the ground map`
            : `Open the ${BATTLE_KIND_LABELS[battle.kind].toLowerCase()} battle at ${battle.place}`
      }
    >
      <span className={`outliner-battle-tag ${battle.kind}`}>{BATTLE_KIND_LABELS[battle.kind]}</span>
      <span className="outliner-battle-body">
        <span className="outliner-entry-name">{battle.place}</span>
        <span className="outliner-battle-detail">{detail || spaceDetail || terrainDetail}</span>
      </span>
    </li>
  )
}

function BattlesSection() {
  const battles = useBattleStore((s) => s.battles)
  const [collapsed, setCollapsed] = useState(false)
  return (
    <div className="outliner-section">
      <button type="button" className="outliner-section-title" onClick={() => setCollapsed((c) => !c)} aria-expanded={!collapsed}>
        <span className={`outliner-section-caret${collapsed ? ' collapsed' : ''}`}>▾</span>
        Battles{battles.length > 0 ? ` (${battles.length})` : ''}
      </button>
      {!collapsed &&
        (battles.length === 0 ? (
          <div className="outliner-empty">Not in any battle or contest</div>
        ) : (
          <ul className="outliner-list">
            {battles.map((b) => (
              <BattleRow key={b.key} battle={b} />
            ))}
          </ul>
        ))}
    </div>
  )
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
  selectedKeys,
  onEntryClick,
}: {
  title: string
  entries: OutlinerEntry[]
  emptyText: string
  /** The key of whichever entry this section's selection currently points
   * at — compared against each entry to highlight it, same idea as a
   * marker's own `.selected` state in the viewport. */
  selectedKey?: string | null
  // Extra highlighted keys (a multi-selection), on top of selectedKey.
  selectedKeys?: string[]
  /** Omitted for sections with nothing real to select yet (Colonies,
   * Starbases) — entries stay inert rather than clickable-but-no-op. */
  onEntryClick?: (entry: OutlinerEntry, e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }) => void
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
                className={`outliner-entry${onEntryClick ? ' clickable' : ''}${entry.key === selectedKey || selectedKeys?.includes(entry.key) ? ' selected' : ''}`}
                onClick={onEntryClick ? (e) => onEntryClick(entry, e) : undefined}
              >
                <OutlinerIcon color={entry.color} kind={entry.kind} />
                <span className="outliner-entry-name">{entry.name}</span>
                {entry.detail && <span className="outliner-entry-detail">{entry.detail}</span>}
              </li>
            ))}
          </ul>
        ))}
    </div>
  )
}

// Stellaris-style right-side outliner: what's currently in view and which of
// it the player's own country owns (both real, derived from viewStore +
// planetData's ownerId), plus a placeholder Starbases section for a nation
// asset this project doesn't have a gameplay system for yet — reserving its
// spot the same way ChatPlaceholder reserves the comms panel's, rather than
// inventing fake data.
export function Outliner() {
  const [collapsed, setCollapsed] = useState(false)
  const [search, setSearch] = useState('')
  const [visibleKinds, setVisibleKinds] = useState<Set<FilterKind>>(
    () => new Set(FILTERS.map((f) => f.kind)),
  )
  const inViewEntries = useInViewEntries()
  const fleetEntries = useFleetEntries()
  const colonyEntries = useColonyEntries()
  const inViewSelection = useViewStore((s) => s.inViewSelection)
  const selectInView = useViewStore((s) => s.selectInView)
  const ships = useShipStore((s) => s.ships)
  const selectedShipId = useShipStore((s) => s.selectedShipId)
  const selectShip = useShipStore((s) => s.selectShip)
  // A fleet entry's own key is its fleetId (see useFleetEntries), not any
  // one ship's id, so the row highlights whichever member is actually
  // selected — not just whichever one happens to be listed as the lead.
  const selectedFleetId = ships.find((s) => s.id === selectedShipId)?.fleetId ?? null
  const selectedIdsKey = useShipStore((s) => s.selectedShipIds.join('|'))
  const selectedFleetIds = useMemo(() => {
    const ids = new Set(selectedIdsKey.split('|'))
    return [...new Set(ships.filter((s) => ids.has(s.id)).map((s) => s.fleetId))]
  }, [selectedIdsKey, ships])

  // Mirrors exactly what clicking the entry's own in-scene marker does: pick
  // it in viewStore (engaging that scene's SelectionTracker camera lock) and
  // drop any ship selection, same as every scene's own handleSelect already
  // does for a marker click.
  const handleInViewClick = (entry: OutlinerEntry) => {
    selectShip(null)
    selectInView(entry.key)
  }
  // A colony can be in any system: go to its system first (a moon: its
  // planet's satellite view), then select it.
  const handleColonyClick = (entry: OutlinerEntry) => {
    const view = useViewStore.getState()
    selectShip(null)
    if (entry.parentPlanet) {
      const there = view.level === 'satellite' && view.selectedBodyName === entry.parentPlanet && view.selectedStarId === entry.starId
      if (!there) {
        if (entry.starId && view.selectedStarId !== entry.starId) useViewStore.setState({ selectedStarId: entry.starId })
        view.enterSatellite(entry.parentPlanet)
      }
      selectInView(entry.key)
    } else if (view.selectedStarId === entry.starId && (view.level === 'system' || (view.level === 'satellite' && view.selectedBodyName === entry.key))) {
      selectInView(entry.key)
    } else if (entry.starId) {
      view.enterSystem(entry.starId, entry.key)
    }
  }
  // Shift/Ctrl/Cmd-click adds or removes the fleet from the selection, so
  // several fleets can be ordered at once.
  const handleFleetClick = (entry: OutlinerEntry, e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }) => {
    if (!entry.leadShipId) return
    if (isAdditiveClick(e)) useShipStore.getState().toggleShipSelection(entry.leadShipId)
    else selectShip(entry.leadShipId)
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

        <BattlesSection />
        <OutlinerSection
          title="Colonies"
          entries={colonyEntries}
          emptyText="No colonies established"
          selectedKey={inViewSelection}
          onEntryClick={handleColonyClick}
        />

        {/* Your own market, not a list of every market that exists — same
            player-only scope as Fleets/Colonies, hence singular. */}
        <OutlinerSection title="Market" entries={[]} emptyText="No market established" />
        <OutlinerSection
          title="In View"
          entries={filteredInView}
          emptyText="Nothing charted here"
          selectedKey={inViewSelection}
          onEntryClick={handleInViewClick}
        />
        <OutlinerSection
          title="Fleets"
          entries={filteredFleets}
          emptyText="No fleets deployed"
          selectedKey={selectedFleetId}
          selectedKeys={selectedFleetIds}
          onEntryClick={handleFleetClick}
        />
        <ArmiesSection />
        <OutlinerSection title="Starbases" entries={[]} emptyText="No starbases built" />
        {/* Reserved sections below, matching categories this game doesn't
            have a system for yet but that the new bottom ActionBar
            (Politics/Diplomacy/Buildings) and left NavBar (Economy/Military)
            categories already gesture at — Army and Navy are the two
            military branches; Navy is already the real "Fleets" section
            above, so only Army is new here. Same "reserve the spot, don't
            invent content" rule as every other empty section in this file. */}
        <OutlinerSection title="Interest Groups" entries={[]} emptyText="No interest groups formed" />
        <OutlinerSection title="Political Movements" entries={[]} emptyText="No political movements active" />
        <OutlinerSection title="Political Lobbies" entries={[]} emptyText="No political lobbies formed" />
        <OutlinerSection title="Treaties" entries={[]} emptyText="No treaties signed" />
        <OutlinerSection title="Companies" entries={[]} emptyText="No companies chartered" />
      </div>
    </div>
  )
}
