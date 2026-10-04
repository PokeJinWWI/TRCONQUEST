import { useMemo, useState } from 'react'
import { shipPlaceLabel } from '../scene/shipPhysics'
import { isCivilianClass } from '../scene/fleetRules'
import { useViewStore } from '../state/viewStore'
import { useShipStore } from '../state/shipStore'
import { useTerritoryStore } from '../state/territoryStore'
import { bodyIndex } from '../scene/territory'
import { isNewTabClick, isNewTabContextMenu } from '../scene/selectionInput'
import { useWorkspaceStore } from '../state/workspaceStore'
import { battleTabPatch } from '../scene/battleNav'
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
import { useTreatyStore, treatiesOf } from '../state/treatyStore'
import { ARTICLE_LABELS } from '../data/treatyData'
import { ownerDisplay } from '../data/countryRoster'
import { BATTLE_KIND_LABELS, groundBattleDetail, spaceBattleDetail, terrainBattleDetail, type PlayerBattle } from '../scene/battleList'
import { useTerrainStore } from '../state/terrainStore'
import { openBattle } from '../scene/battleNav'
import { playerArmyGroups, type ArmyGroup } from '../scene/armyOutliner'
import { useBattleStore } from '../state/battleStore'
import { useStarbaseStore } from '../state/starbaseStore'
import { useGameTimeStore } from '../state/gameTimeStore'
import { engagementIntel, unknownShipsMessage } from '../scene/commsVisual'
import { useColonyStore } from '../state/colonyStore'

type EntryKind = 'neighborhood' | 'star' | 'planet' | 'moon' | 'ship' | 'treaty' | 'starbase'
// The filter offers a "black holes" toggle even though nothing in the game
// can be that kind yet — reserving the spot the same way the empty
// Colonies section did before it had real data.
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
  /** Fleet entries only — a civilian hull (science, construction, cargo…),
   * listed under the Fleets section's Civilian tab. */
  civilian?: boolean
}

type FleetTab = 'military' | 'civilian'

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
      // Civilians never share a fleet with warships (fleetRules), so the lead
      // ship says which tab the whole row belongs on.
      return { key: fleetId, name, color: RELATION_COLORS.own, kind: 'ship' as const, leadShipId: members[0].id, civilian: isCivilianClass(members[0].classId), detail: shipPlaceLabel(members[0]) }
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
  // Joined into a string so the list re-derives only when a stage changes.
  const microKey = useColonyStore((s) =>
    Object.values(s.colonies)
      .filter((c) => c.stage === 'micro')
      .map((c) => c.bodyName)
      .join('|'),
  )
  return useMemo(() => {
    if (!selectedCountryId) return []
    const micro = new Set(microKey.split('|'))
    const owned = [...bodyIndex().values()].filter((b) => bodyOwner[b.name] === selectedCountryId)
    const spansSystems = new Set(owned.map((b) => b.starId)).size > 1
    return owned.map((b) => {
      const color =
        b.kind === 'moon'
          ? getMoonsForPlanet(b.parentPlanet ?? '').moons.find((m) => m.name === b.name)?.color
          : getPlanetsForStar(b.starId).find((p) => p.name === b.name)?.color
      const system = spansSystems ? STARS.find((st) => st.id === b.starId)?.name : undefined
      const detail = [micro.has(b.name) ? 'micro-colony' : undefined, system].filter(Boolean).join(' · ') || undefined
      return { key: b.name, name: b.name, color: color ?? '#ffffff', kind: b.kind, parentPlanet: b.parentPlanet, starId: b.starId, detail }
    })
  }, [selectedCountryId, bodyOwner, microKey])
}

// Every article of every treaty (embassy, non-aggression pact, trade
// agreement, alliance, guarantee of independence, treaty port) the player's
// nation is party to — see components/DiplomacyPanel's per-nation profile
// for proposing/cancelling one. One row per article, since a single treaty
// can bundle several.
function useTreatyEntries(): OutlinerEntry[] {
  const playerId = usePlayerStore((s) => s.selectedCountryId)
  const treaties = useTreatyStore((s) => s.treaties)
  return useMemo(() => {
    if (!playerId) return []
    return treatiesOf(treaties, playerId).flatMap((t) => {
      const otherId = t.a === playerId ? t.b : t.a
      return t.articles.map((a, i) => ({
        key: `${t.id}-${i}`,
        name: `${ARTICLE_LABELS[a.kind]} — ${ownerDisplay(otherId).name}`,
        color: ownerDisplay(otherId).color,
        kind: 'treaty' as const,
      }))
    })
  }, [playerId, treaties])
}

// The player's own Starbases, wherever they are — the same "list them all,
// name their system, click to go there" shape useColonyEntries already uses.
function useStarbaseEntries(): OutlinerEntry[] {
  const selectedCountryId = usePlayerStore((s) => s.selectedCountryId)
  const starbases = useStarbaseStore((s) => s.starbases)
  return useMemo(() => {
    if (!selectedCountryId) return []
    return starbases
      .filter((sb) => sb.ownerId === selectedCountryId)
      .map((sb) => {
        const star = STARS.find((s) => s.id === sb.starId)
        return { key: sb.id, name: star?.name ?? sb.starId, color: star?.color ?? '#ffffff', kind: 'starbase' as const, starId: sb.starId }
      })
  }, [selectedCountryId, starbases])
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
  // A space battle is entered only when every ship in it is known to the player
  // (commsVisual.shipsIntel); until then the row says what is missing.
  const unknownMsg = useCombatStore((s) => {
    if (battle.kind !== 'space') return ''
    const e = s.engagements.find((x) => x.id === battle.engagementId)
    if (!e) return ''
    const intel = engagementIntel(e, useShipStore.getState().ships, useGameTimeStore.getState().simDays)
    return intel.allKnown ? '' : unknownShipsMessage(intel)
  })
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
      className={`outliner-entry clickable outliner-battle${here ? ' selected' : ''}${unknownMsg ? ' disabled' : ''}`}
      onContextMenu={(e) => {
        if (unknownMsg || !isNewTabContextMenu(e)) return
        e.preventDefault()
        useWorkspaceStore.getState().openInNewTab(battleTabPatch(battle))
      }}
      onClick={(e) => {
        if (unknownMsg) return
        if (isNewTabClick(e)) useWorkspaceStore.getState().openInNewTab(battleTabPatch(battle))
        else openBattle(battle)
      }}
      title={
        unknownMsg
          ? `Can't enter yet: ${unknownMsg}`
          : here
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
        <span className="outliner-battle-detail">{unknownMsg || detail || spaceDetail || terrainDetail}</span>
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
  tabs,
  activeTab,
  onTab,
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
  // Sub-tabs under the title (Fleets: Military / Civilian). `entries` is
  // already the active tab's list.
  tabs?: { id: string; label: string; count: number }[]
  activeTab?: string
  onTab?: (id: string) => void
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
      {!collapsed && tabs && (
        <div className="outliner-subtabs" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={t.id === activeTab}
              className={`outliner-subtab${t.id === activeTab ? ' active' : ''}`}
              onClick={() => onTab?.(t.id)}
            >
              {t.label}
              {t.count > 0 ? ` (${t.count})` : ''}
            </button>
          ))}
        </div>
      )}
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
                onContextMenu={
                  onEntryClick
                    ? (e) => {
                        if (!isNewTabContextMenu(e)) return
                        e.preventDefault()
                        onEntryClick(entry, { shiftKey: false, ctrlKey: true, metaKey: false })
                      }
                    : undefined
                }
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
// planetData's ownerId, plus the player's own Starbases from starbaseStore —
// see scene/starbaseLogic.ts for what one is).
type OutlinerTab = 'territory' | 'military' | 'info'
const OUTLINER_TABS: { id: OutlinerTab; label: string; tip: string }[] = [
  { id: 'territory', label: 'Territory', tip: 'Colonies, Starbases, your market, and what is in view' },
  { id: 'military', label: 'Fleet', tip: 'Battles, fleets and armies' },
  { id: 'info', label: 'Info', tip: 'Treaties, political movements, interest groups, companies' },
]

export function Outliner() {
  const [collapsed, setCollapsed] = useState(false)
  const [tab, setTab] = useState<OutlinerTab>('territory')
  const [fleetTab, setFleetTab] = useState<FleetTab>('military')
  const [search, setSearch] = useState('')
  const [visibleKinds, setVisibleKinds] = useState<Set<FilterKind>>(
    () => new Set(FILTERS.map((f) => f.kind)),
  )
  const inViewEntries = useInViewEntries()
  const fleetEntries = useFleetEntries()
  const colonyEntries = useColonyEntries()
  const treatyEntries = useTreatyEntries()
  const starbaseEntries = useStarbaseEntries()
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
  const handleInViewClick = (entry: OutlinerEntry, e: { ctrlKey: boolean; metaKey: boolean }) => {
    if (isNewTabClick(e)) return useWorkspaceStore.getState().openInNewTab({ inViewSelection: entry.key, selectedShipId: null })
    selectShip(null)
    selectInView(entry.key)
  }
  // A colony can be in any system: go to its system first (a moon: its
  // planet's satellite view), then select it.
  const handleColonyClick = (entry: OutlinerEntry, e: { ctrlKey: boolean; metaKey: boolean }) => {
    if (isNewTabClick(e) && entry.starId) {
      return useWorkspaceStore.getState().openInNewTab(
        entry.parentPlanet
          ? { level: 'satellite', selectedStarId: entry.starId, selectedBodyName: entry.parentPlanet, inViewSelection: entry.key, selectedShipId: null }
          : { level: 'system', selectedStarId: entry.starId, selectedBodyName: null, inViewSelection: entry.key, selectedShipId: null },
      )
    }
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
  // A Starbase has no body of its own to enter — it stands at its system's
  // own star, so this just opens the interstellar view there. Every charted
  // star lives in the Solar Neighbourhood today (see
  // data/starData.getStarsForNeighborhood), so that's the one this jumps
  // into; a future second charted neighbourhood would need this to look the
  // star's neighbourhood up instead of assuming it.
  const handleStarbaseClick = (entry: OutlinerEntry, e: { ctrlKey: boolean; metaKey: boolean }) => {
    if (isNewTabClick(e) && entry.starId) {
      return useWorkspaceStore.getState().openInNewTab({ level: 'interstellar', selectedNeighborhoodId: 'solar-neighborhood', selectedBodyName: null, inViewSelection: entry.starId, selectedShipId: null })
    }
    selectShip(null)
    const view = useViewStore.getState()
    if (view.level !== 'interstellar' || view.selectedNeighborhoodId !== 'solar-neighborhood') view.enterInterstellar('solar-neighborhood')
    if (entry.starId) selectInView(entry.starId)
  }
  // Shift/Ctrl/Cmd-click adds or removes the fleet from the selection, so
  // several fleets can be ordered at once.
  const handleFleetClick = (entry: OutlinerEntry, e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }) => {
    if (!entry.leadShipId) return
    if (isNewTabClick(e)) return useWorkspaceStore.getState().openInNewTab({ selectedShipId: entry.leadShipId })
    if (isAdditiveClick(e)) {
      useShipStore.getState().toggleShipSelection(entry.leadShipId)
      return
    }
    // Just select it. The view type never changes on a selection: with lock-on
    // on, the scene pans towards the ship where it is (scene/SelectionTracker).
    selectShip(entry.leadShipId)
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
  const matches = (entry: OutlinerEntry) => query === '' || entry.name.toLowerCase().includes(query)
  const militaryFleets = filteredFleets.filter((e) => !e.civilian)
  const civilianShips = filteredFleets.filter((e) => e.civilian)

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

        {/* Always here, whichever tab is open: it filters every list. */}
        <input
          type="text"
          className="outliner-search-input"
          placeholder="Search…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="outliner-tabs" role="tablist">
          {OUTLINER_TABS.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={`outliner-tab${tab === t.id ? ' active' : ''}`} title={t.tip} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'territory' && (
          <>
            {/* What the search and the In View list show: right under the search. */}
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
              title="Colonies"
              entries={colonyEntries.filter(matches)}
              emptyText={query ? 'No match' : 'No colonies established'}
              selectedKey={inViewSelection}
              onEntryClick={handleColonyClick}
            />
            <OutlinerSection title="Starbases" entries={starbaseEntries.filter(matches)} emptyText={query ? 'No match' : 'No starbases built'} onEntryClick={handleStarbaseClick} />
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
          </>
        )}

        {tab === 'military' && (
          <>
            <BattlesSection />
            <OutlinerSection
              title="Fleets"
              entries={fleetTab === 'military' ? militaryFleets : civilianShips}
              emptyText={fleetTab === 'military' ? 'No fleets deployed' : 'No civilian ships'}
              tabs={[
                { id: 'military', label: 'Military', count: militaryFleets.length },
                { id: 'civilian', label: 'Civilian', count: civilianShips.length },
              ]}
              activeTab={fleetTab}
              onTab={(id) => setFleetTab(id as FleetTab)}
              selectedKey={selectedFleetId}
              selectedKeys={selectedFleetIds}
              onEntryClick={handleFleetClick}
            />
            <ArmiesSection />
          </>
        )}

        {tab === 'info' && (
          <>
            <OutlinerSection title="Treaties" entries={treatyEntries.filter(matches)} emptyText={query ? 'No match' : 'No treaties signed'} />
            {/* Reserved sections, matching categories this game doesn't have a
                system for yet. Same "reserve the spot, don't invent content"
                rule as every other empty section in this file. */}
            <OutlinerSection title="Political Movements" entries={[]} emptyText="No political movements active" />
            <OutlinerSection title="Interest Groups" entries={[]} emptyText="No interest groups formed" />
            <OutlinerSection title="Political Lobbies" entries={[]} emptyText="No political lobbies formed" />
            <OutlinerSection title="Companies" entries={[]} emptyText="No companies chartered" />
          </>
        )}
      </div>
    </div>
  )
}
