import { ARMY_KINDS } from '../data/armyData'
import { TERRAIN, UNIT_TYPES, type TerrainId } from '../data/groundData'
import { ownerDisplay } from '../data/countryRoster'
import { GRID_DENSITIES, GRID_DENSITY_LABELS } from '../scene/combatArena'
import { armyStrength, unitPersonnel, type Army, type GroundUnit } from '../scene/armyLogic'
import { groundSurface, holderOf, radToKm, unitRangeRad, unitSpeedRadPerDay } from '../scene/groundLogic'
import { TERRAIN_IDS, type BodySurface } from '../scene/planetTerrain'
import { nearestNode } from '../scene/surfaceMesh'
import { controllerOf } from '../scene/territory'
import { isAdditiveClick } from '../scene/selectionInput'
import { useArmyStore } from '../state/armyStore'
import { useGroundViewStore } from '../state/groundViewStore'
import { useTerritoryStore } from '../state/territoryStore'
import { usePlayerStore } from '../state/playerStore'
import { atWar } from '../state/diplomacyStore'
import { relationColorOf, useRelationKey } from '../state/shipRelations'
import { DraggableWindow } from './DraggableWindow'

// The planetary map's panels: the roster/controls window (left) and the
// selected units' capability card (right), plus the click handlers the globe
// uses. Rules live in state/armyStore.ts and scene/groundLogic.ts.

// --- Click handling ------------------------------------------------------------

// A left-click on the ground: choose a landing site, place a console-spawned
// army, or (in plain order mode) nothing.
export function handleGroundClick(bodyName: string, node: number): void {
  const view = useGroundViewStore.getState()
  const mode = view.mode
  if (mode.kind === 'drop') {
    const r = useArmyStore.getState().land(mode.shipId, node)
    if (r.ok) {
      view.setMode({ kind: 'order' })
      // An island landing is allowed (marines can cross), but warn: line
      // units there can't walk to the key nodes on the mainland.
      const surface = groundSurface(bodyName, useTerritoryStore.getState().bodyOwner)
      const island = !!surface && surface.landComponent[node] !== surface.mainland
      const done = r.kind === 'invade' ? 'Invasion landed.' : 'Armies unloaded.'
      view.setNotice(island ? `${done} Note: this is an island — only marines can reach the mainland's key nodes.` : done)
    } else view.setNotice(r.reason)
  } else if (mode.kind === 'spawn') {
    useArmyStore.getState().addArmy({ ownerId: mode.ownerId, kind: mode.armyKind, location: { kind: 'body', bodyName }, anchorNode: node })
    view.setMode({ kind: 'order' })
    view.setNotice(`${ownerDisplay(mode.ownerId).name} ${ARMY_KINDS[mode.armyKind].name} placed.`)
  }
}

// A right-click on the ground: send the selected units there.
export function orderSelectedUnitsTo(node: number): void {
  const view = useGroundViewStore.getState()
  if (view.selectedUnitIds.length === 0) return
  const r = useArmyStore.getState().orderUnits(view.selectedUnitIds, node)
  view.setNotice(r.ok ? null : r.reason)
}

// A right-click on a unit: an enemy becomes the selection's focus-fire target
// (right-click it again to clear).
export function targetWithSelection(unitId: string): void {
  const view = useGroundViewStore.getState()
  const player = usePlayerStore.getState().selectedCountryId
  const armies = useArmyStore.getState().armies
  const target = armies.find((a) => a.units.some((u) => u.id === unitId))
  if (!target || !player || !atWar(target.ownerId, player) || view.selectedUnitIds.length === 0) return
  const selected = armies.flatMap((a) => a.units).filter((u) => view.selectedUnitIds.includes(u.id))
  const already = selected.length > 0 && selected.every((u) => u.targetUnitId === unitId)
  useArmyStore.getState().targetUnit(view.selectedUnitIds, already ? null : unitId)
}

// --- Shared bits -------------------------------------------------------------

function unitStatus(unit: GroundUnit): string {
  if (unit.firingAtId) return unit.path?.length && unit.orderedMove ? 'Moving under fire' : 'Engaged'
  if (unit.path?.length) return 'Moving'
  return UNIT_TYPES[unit.type].holdsPosition ? 'Holding post' : 'Holding'
}

// A string that changes when anything the panels show does — so they don't
// re-render on every sub-visible position change.
function useBodyArmiesKey(bodyName: string): string {
  useRelationKey()
  return useArmyStore((s) =>
    s.armies
      .filter((a) => a.location.kind === 'body' && a.location.bodyName === bodyName)
      .map((a) => `${a.id}:${a.units.map((u) => `${u.id}.${Math.ceil(u.strength)}.${u.path?.length ? 1 : 0}.${u.firingAtId ? 1 : 0}.${u.targetUnitId ?? ''}`).join(',')}`)
      .join('|'),
  )
}

function bodyArmies(bodyName: string): Army[] {
  return useArmyStore.getState().armies.filter((a) => a.location.kind === 'body' && a.location.bodyName === bodyName)
}

const KEY_LABEL = { capital: 'Capital', city: 'City', spaceport: 'Spaceport', outpost: 'Outpost' } as const

// --- The roster/controls window ----------------------------------------------

export function GroundPanel({ bodyName, surface }: { bodyName: string; surface: BodySurface }) {
  useBodyArmiesKey(bodyName)
  const density = useGroundViewStore((s) => s.density)
  const mode = useGroundViewStore((s) => s.mode)
  const notice = useGroundViewStore((s) => s.notice)
  const selectedIds = useGroundViewStore((s) => s.selectedUnitIds)
  const owners = useTerritoryStore((s) => s.bodyOwner)
  const controllers = useTerritoryStore((s) => s.bodyController)
  const holders = useTerritoryStore((s) => s.nodeHolders[bodyName])
  const player = usePlayerStore((s) => s.selectedCountryId)
  const view = useGroundViewStore.getState()
  const armies = bodyArmies(bodyName)

  const owner = owners[bodyName]
  const controller = controllerOf(bodyName, owners, controllers)
  const keyHolders = surface.keySlots.map((k) => ({ ...k, holder: holderOf(bodyName, k.node, owners, { [bodyName]: holders ?? {} }) }))
  const byOwner = new Map<string, Army[]>()
  for (const a of armies) byOwner.set(a.ownerId, [...(byOwner.get(a.ownerId) ?? []), a])
  const mineSelected = armies.filter((a) => a.ownerId === player).flatMap((a) => a.units).filter((u) => selectedIds.includes(u.id))

  return (
    <DraggableWindow title={`${bodyName} — Ground`} anchor="left" maximizable={false}>
      <div className="inspect-row">
        <span className="inspect-label">Held by</span>
        <span className="inspect-value" style={{ color: controller ? ownerDisplay(controller).color : undefined }}>
          {controller ? ownerDisplay(controller).name : 'Nobody'}
          {owner && controller && owner !== controller ? ` (owner ${ownerDisplay(owner).name})` : ''}
        </span>
      </div>
      <div className="inspect-row">
        <span className="inspect-label">Key nodes</span>
        <span className="inspect-value">
          {keyHolders.length === 0
            ? 'None'
            : keyHolders.map((k) => (
                <span key={k.node} style={{ color: k.holder ? ownerDisplay(k.holder).color : undefined, marginLeft: 6 }} title={`${KEY_LABEL[k.kind]} — ${k.holder ? ownerDisplay(k.holder).name : 'nobody'}`}>
                  {KEY_LABEL[k.kind]}
                </span>
              ))}
        </span>
      </div>
      <div className="ship-panel-hint">Hold every key node, with no enemy on them, to take the world.</div>

      <div className="inspect-row">
        <span className="inspect-label">Grid</span>
        <span className="inspect-value combat-density-row">
          {GRID_DENSITIES.map((d) => (
            <button key={d} type="button" className={`combat-density-btn${d === density ? ' active' : ''}`} onClick={() => view.setDensity(d)}>
              {GRID_DENSITY_LABELS[d]}
            </button>
          ))}
        </span>
      </div>

      {mode.kind === 'drop' && (
        <div className="ground-mode-banner">
          Choose a landing site: click walkable ground clear of the enemy.
          <button type="button" className="detail-view-btn" onClick={() => view.setMode({ kind: 'order' })}>
            Cancel
          </button>
        </div>
      )}
      {mode.kind === 'spawn' && (
        <div className="ground-mode-banner">
          Click the ground to place a {ownerDisplay(mode.ownerId).name} {ARMY_KINDS[mode.armyKind].name}.
          <button type="button" className="detail-view-btn" onClick={() => view.setMode({ kind: 'order' })}>
            Cancel
          </button>
        </div>
      )}
      {notice && <div className="inspect-status ok">{notice}</div>}

      <div className="inspect-divider" />
      <div className="ground-roster">
      {byOwner.size === 0 && <div className="inspect-status">No units on the ground.</div>}
      {[...byOwner.entries()].map(([ownerId, list]) => (
        <div key={ownerId} className="army-group">
          <div className="army-group-label" style={{ color: relationColorOf(ownerId) }}>
            {ownerDisplay(ownerId).name}
            {ownerId === player ? ' (yours)' : player && atWar(ownerId, player) ? ' (hostile)' : ''}
          </div>
          {list.map((army) => {
            const s = armyStrength(army)
            return (
              <div key={army.id} className="ground-army">
                <button
                  type="button"
                  className="ground-army-head"
                  onClick={(e) => {
                    const ids = army.units.map((u) => u.id)
                    if (isAdditiveClick(e)) view.selectUnits([...view.selectedUnitIds, ...ids])
                    else view.selectUnits(ids)
                  }}
                  title="Select every unit in this army"
                >
                  {ARMY_KINDS[army.kind].name} · {Math.ceil(s.strength)}/{s.max}
                </button>
                {army.units.map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    className={`ground-unit-row${selectedIds.includes(u.id) ? ' selected' : ''}`}
                    onClick={(e) => (isAdditiveClick(e) ? view.toggleUnit(u.id) : view.selectUnit(u.id))}
                  >
                    <span className="ground-unit-glyph" style={{ color: relationColorOf(ownerId) }}>{UNIT_TYPES[u.type].glyph}</span>
                    <span className="ground-unit-name">{UNIT_TYPES[u.type].name}</span>
                    <span className="ground-unit-status">{unitStatus(u)}</span>
                    <span className="ground-unit-str">{Math.ceil(u.strength)}</span>
                  </button>
                ))}
              </div>
            )
          })}
        </div>
      ))}
      </div>
      {mineSelected.length > 0 && (
        <div className="dip-actions">
          <button type="button" className="detail-view-btn" onClick={() => useArmyStore.getState().haltUnits(mineSelected.map((u) => u.id))}>
            Halt
          </button>
          <button type="button" className="detail-view-btn" onClick={() => useArmyStore.getState().targetUnit(mineSelected.map((u) => u.id), null)}>
            Clear target
          </button>
        </div>
      )}
      <div className="ship-panel-hint">
        Click a unit to select it (Shift/Ctrl/Cmd adds more). Right-click the ground to move the selection; right-click an enemy to focus fire.
      </div>
    </DraggableWindow>
  )
}

// --- The capability card -----------------------------------------------------

function fmt(n: number): string {
  return n >= 100 ? Math.round(n).toLocaleString() : n >= 10 ? n.toFixed(0) : n.toFixed(1)
}

// Plain-language readings of the numbers the ground rules use, so a panel
// says what a terrain or unit trait DOES rather than showing a bare "×2.5".
const pct = (x: number) => `${Math.round(x * 100)}%`

// A terrain's move cost multiplies travel time (groundData.TerrainSpec.moveCost).
export function describeMoveCost(moveCost: number): string {
  if (moveCost >= 90) return "can't be crossed"
  if (moveCost === 1) return 'open-ground speed'
  return `${pct(1 / moveCost)} of open-ground speed`
}

// A defense figure divides the damage a unit takes.
export function describeDefense(defense: number): string {
  if (defense === 1) return 'no cover'
  const change = Math.round((1 / defense - 1) * 100)
  return change < 0 ? `${-change}% less damage taken` : `${change}% more damage taken`
}

function modsFor(type: GroundUnit['type']): string[] {
  const out: string[] = []
  for (const [t, m] of Object.entries(UNIT_TYPES[type].terrain) as [TerrainId, NonNullable<(typeof UNIT_TYPES)['infantry']['terrain'][TerrainId]>][]) {
    const parts: string[] = []
    if (m.impassable) parts.push("can't enter")
    if (m.speed !== undefined) parts.push(`moves at ${pct(m.speed)} speed`)
    if (m.attack !== undefined) parts.push(`deals ${pct(m.attack)} damage`)
    if (m.defense !== undefined) parts.push(describeDefense(m.defense).replace('no cover', 'no extra cover'))
    out.push(`${TERRAIN[t].name}: ${parts.join(', ')}`)
  }
  return out
}

export function UnitCard({ bodyName, surface }: { bodyName: string; surface: BodySurface }) {
  useBodyArmiesKey(bodyName)
  const selectedIds = useGroundViewStore((s) => s.selectedUnitIds)
  const armies = bodyArmies(bodyName)
  const selected = armies.flatMap((a) => a.units.filter((u) => selectedIds.includes(u.id)).map((u) => ({ army: a, unit: u })))
  if (selected.length === 0) return null
  const radius = surface.radiusKm
  const openSpeed = (u: GroundUnit) => radToKm(unitSpeedRadPerDay(u.type, radius, 'plains'), radius)

  if (selected.length > 1) {
    const slowest = Math.min(...selected.filter((s) => !UNIT_TYPES[s.unit.type].holdsPosition).map((s) => openSpeed(s.unit)))
    return (
      <DraggableWindow title={`${selected.length} units selected`} anchor="right" maximizable={false} onClose={() => useGroundViewStore.getState().selectUnits([])}>
        <table className="ground-unit-table">
          <thead>
            <tr>
              <th>Unit</th>
              <th>Str</th>
              <th>Atk</th>
              <th>Def</th>
              <th>km/day</th>
              <th>Range km</th>
            </tr>
          </thead>
          <tbody>
            {selected.map(({ army, unit }) => (
              <tr key={unit.id}>
                <td style={{ color: relationColorOf(army.ownerId) }}>
                  {UNIT_TYPES[unit.type].glyph} {UNIT_TYPES[unit.type].name}
                </td>
                <td>{Math.ceil(unit.strength)}</td>
                <td>{UNIT_TYPES[unit.type].attack}</td>
                <td>{UNIT_TYPES[unit.type].defense}</td>
                <td>{UNIT_TYPES[unit.type].holdsPosition ? '—' : fmt(openSpeed(unit))}</td>
                <td>{fmt(radToKm(unitRangeRad(unit.type), radius))}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {Number.isFinite(slowest) && <div className="ship-panel-hint">Moving together, the slowest covers {fmt(slowest)} km/day on open ground.</div>}
      </DraggableWindow>
    )
  }

  const { army, unit } = selected[0]
  const spec = UNIT_TYPES[unit.type]
  const node = unit.position ? nearestNode(unit.position, 'fine', unit.nodeHint) : null
  const here = node !== null ? TERRAIN[TERRAIN_IDS[surface.terrain[node]]] : null
  const mods = modsFor(unit.type)
  return (
    <DraggableWindow title={spec.name} anchor="right" maximizable={false} onClose={() => useGroundViewStore.getState().selectUnits([])}>
      <div className="inspect-row">
        <span className="inspect-label">Army</span>
        <span className="inspect-value" style={{ color: relationColorOf(army.ownerId) }}>
          {ownerDisplay(army.ownerId).name} · {ARMY_KINDS[army.kind].name}
        </span>
      </div>
      <div className="inspect-row">
        <span className="inspect-label">Personnel</span>
        <span className="inspect-value">
          {unitPersonnel(unit).toLocaleString()} of {spec.personnel.toLocaleString()}
        </span>
      </div>
      <div className="inspect-row">
        <span className="inspect-label">Strength</span>
        <span className="inspect-value">
          {Math.ceil(unit.strength)}/{unit.maxStrength}
        </span>
      </div>
      <div className="inspect-row">
        <span className="inspect-label">Attack · Defense</span>
        <span className="inspect-value">
          {spec.attack} · {spec.defense}
        </span>
      </div>
      <div className="inspect-row">
        <span className="inspect-label">Speed (open ground)</span>
        <span className="inspect-value">{spec.holdsPosition ? 'Holds position' : `${fmt(openSpeed(unit))} km/day`}</span>
      </div>
      <div className="inspect-row">
        <span className="inspect-label">Range</span>
        <span className="inspect-value">{fmt(radToKm(unitRangeRad(unit.type), radius))} km</span>
      </div>
      <div className="inspect-row">
        <span className="inspect-label">Amphibious</span>
        <span className="inspect-value">{spec.amphibious ? 'Yes — can cross oceans' : 'No'}</span>
      </div>
      {mods.length > 0 && (
        <div className="inspect-row">
          <span className="inspect-label">Terrain</span>
          <span className="inspect-value">{mods.join('; ')}</span>
        </div>
      )}
      <div className="inspect-divider" />
      <div className="inspect-row">
        <span className="inspect-label">Status</span>
        <span className="inspect-value">{unitStatus(unit)}</span>
      </div>
      {here && (
        <div className="inspect-row">
          <span className="inspect-label">Standing on</span>
          <span className="inspect-value">
            {here.name} ({describeDefense(here.defense)})
          </span>
        </div>
      )}
      <div className="ship-panel-hint">{spec.description} Figures are real km on {bodyName} ({Math.round(radius).toLocaleString()} km radius).</div>
    </DraggableWindow>
  )
}
