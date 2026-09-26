import { ownerDisplay } from '../data/countryRoster'
import { UNIT_TYPES } from '../data/groundData'
import { atWar } from '../state/diplomacyStore'
import { useGroundViewStore } from '../state/groundViewStore'
import { usePlayerStore } from '../state/playerStore'
import { relationColorOf, useRelationKey } from '../state/shipRelations'
import { useTerrainStore } from '../state/terrainStore'
import { useViewStore } from '../state/viewStore'
import { isAdditiveClick } from '../scene/selectionInput'
import type { TerrainUnit } from '../scene/terrainBattle'
import { DraggableWindow } from './DraggableWindow'

export function describeCover(defense: number): string {
  if (Math.abs(defense - 1) < 0.02) return 'no cover'
  return defense > 1 ? `${Math.round((1 - 1 / defense) * 100)}% less damage taken` : `${Math.round((1 / defense - 1) * 100)}% more damage taken`
}

function status(u: TerrainUnit): string {
  if (u.firingAtId) return u.path.length && u.orderedMove ? 'Moving under fire' : 'Engaged'
  if (u.path.length) return 'Moving'
  return UNIT_TYPES[u.type].holdsPosition ? 'Holding post' : 'Holding'
}

// The terrain map's window: the two sides' strength, the roster (click to
// select), Halt / Clear target, and the way back to the planetary map.
export function TerrainPanel({ battleId }: { battleId: string }) {
  useRelationKey()
  // A string that changes when anything shown does, so this is not redrawn on every step.
  useTerrainStore((s) =>
    (s.battles.find((b) => b.id === battleId)?.units ?? [])
      .map((u) => `${u.id}.${Math.ceil(u.strength)}.${u.path.length ? 1 : 0}.${u.firingAtId ? 1 : 0}.${u.targetUnitId ?? ''}`)
      .join('|'),
  )
  const battle = useTerrainStore.getState().battles.find((b) => b.id === battleId)
  const selectedIds = useGroundViewStore((s) => s.selectedUnitIds)
  const notice = useGroundViewStore((s) => s.notice)
  const player = usePlayerStore((s) => s.selectedCountryId)
  const view = useGroundViewStore.getState()
  const exitTerrain = useViewStore((s) => s.exitTerrain)
  if (!battle) return null

  const byOwner = new Map<string, TerrainUnit[]>()
  for (const u of battle.units) byOwner.set(u.ownerId, [...(byOwner.get(u.ownerId) ?? []), u])
  const mineSelected = battle.units.filter((u) => u.ownerId === player && selectedIds.includes(u.id))

  return (
    <DraggableWindow title={`${battle.bodyName} — Terrain battle`} anchor="left" maximizable={false}>
      <div className="ship-panel-hint">
        The same war, closer: ranges, speeds and damage as on the planetary map, on real ground. Higher ground shoots harder; steep ground slows you.
      </div>
      <button type="button" className="detail-view-btn" onClick={exitTerrain}>
        Back to the ground map
      </button>
      {notice && <div className="inspect-status ok">{notice}</div>}
      <div className="inspect-divider" />
      <div className="ground-roster">
        {[...byOwner.entries()].map(([ownerId, list]) => {
          const strength = list.reduce((s, u) => s + u.strength, 0)
          const max = list.reduce((s, u) => s + u.maxStrength, 0)
          return (
            <div key={ownerId} className="army-group">
              <div className="army-group-label" style={{ color: relationColorOf(ownerId) }}>
                {ownerDisplay(ownerId).name}
                {ownerId === player ? ' (yours)' : player && atWar(ownerId, player) ? ' (hostile)' : ''} · {Math.ceil(strength)}/{max}
              </div>
              {list.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  className={`ground-unit-row${selectedIds.includes(u.id) ? ' selected' : ''}`}
                  onClick={(e) => (isAdditiveClick(e) ? view.toggleUnit(u.id) : view.selectUnit(u.id))}
                >
                  <span className="ground-unit-glyph" style={{ color: relationColorOf(ownerId) }}>
                    {UNIT_TYPES[u.type].glyph}
                  </span>
                  <span className="ground-unit-name">{UNIT_TYPES[u.type].name}</span>
                  <span className="ground-unit-status">{status(u)}</span>
                  <span className="ground-unit-str">{Math.ceil(u.strength)}</span>
                </button>
              ))}
            </div>
          )
        })}
      </div>
      {mineSelected.length > 0 && (
        <div className="dip-actions">
          <button type="button" className="detail-view-btn" onClick={() => useTerrainStore.getState().haltUnits(battleId, mineSelected.map((u) => u.id))}>
            Halt
          </button>
          <button type="button" className="detail-view-btn" onClick={() => useTerrainStore.getState().targetUnits(battleId, mineSelected.map((u) => u.id), null)}>
            Clear target
          </button>
        </div>
      )}
      <div className="ship-panel-hint">
        Click a unit to select it (Shift/Ctrl/Cmd adds more). Right-click the ground to move the selection (Shift queues); right-click an enemy to focus fire. Scroll out to leave.
      </div>
    </DraggableWindow>
  )
}
