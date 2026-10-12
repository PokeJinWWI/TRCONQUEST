import { useMemo } from 'react'
import { DEFENSE_DEFS, type DefenseKind } from '../data/defenseData'
import { ROUTE_SPECS, type RouteKind } from '../data/infrastructureData'
import { LAND_USE_LABEL, LAND_USE_POLICIES, LAND_USE_TEXT } from '../data/zoningData'
import { buildableIn, districtLabel, districtsOfMode } from '../scene/areaView'
import { ruralSummary } from '../scene/ruralState'
import { MILLION_PEOPLE_PER_MARK } from '../data/ruralData'
import { useLensStore, type LensTool } from '../state/lensStore'
import { landUsePolicyOf, useZoneStore } from '../state/zoneStore'
import { usePlayerStore } from '../state/playerStore'
import { useViewStore } from '../state/viewStore'
import { groundSurface } from '../scene/groundLogic'
import { useTerritoryStore } from '../state/territoryStore'

// The build lens palette (the ⚙ panel): every district, building, defence, route and zoning tool the nation can pick up, grouped by
// district. Picking one arms the lens and takes the player to the world's ground map, where a click places it. Buildings the nation
// cannot build are listed greyed with the reason, never hidden.
export function LensPalette({ bodyName }: { bodyName: string | undefined }) {
  const armed = useLensStore((s) => s.armed)
  const me = usePlayerStore((s) => s.selectedCountryId)
  const simple = usePlayerStore((s) => s.economyModel) === 'abstract'
  const policy = useZoneStore((s) => (me ? (s.policy[me] ?? landUsePolicyOf(me, s.policy)) : 'free'))
  const mode = simple ? 'simple' : 'complex'

  const groups = useMemo(() => {
    if (!me) return []
    return districtsOfMode(mode).map((d) => ({ district: d, label: districtLabel(mode, d), buildings: buildableIn(mode, d, me) }))
  }, [me, mode])

  if (!bodyName || !me) return <div className="nav-placeholder">No world selected</div>

  const pick = (tool: LensTool) => {
    useLensStore.getState().arm(armed && sameTool(armed, tool) ? null : tool)
    if (!(armed && sameTool(armed, tool))) {
      const view = useViewStore.getState()
      // The lens works on the ground map of this world.
      if (!(view.level === 'ground' && view.selectedBodyName === bodyName) && groundSurface(bodyName, useTerritoryStore.getState().bodyOwner)) view.enterGround(bodyName)
    }
  }
  const on = (tool: LensTool) => (armed && sameTool(armed, tool) ? ' active' : '')
  const rural = ruralSummary(bodyName)

  return (
    <div className="lens-palette">
      <div className="abs-dim">
        Pick something up, then click {bodyName}'s ground map. Click inside a district to build there, or on open ground to found a new one. Right-click with it in hand to cancel an order or take one down (taking down costs money and materials).
      </div>

      <div>
        <div className="lens-group-title">Develop a district level</div>
        <div className="lens-group">
          {groups.map((g) => {
            const tool: LensTool = { kind: 'level', district: g.district, name: g.label }
            return (
              <button key={g.district} type="button" className={`lens-tool${on(tool)}`} onClick={() => pick(tool)} title={`One more ${g.label} level. On open ground this founds a new district.`}>
                {g.label}
              </button>
            )
          })}
        </div>
      </div>

      {groups.map((g) => (
        <div key={g.district}>
          <div className="lens-group-title">{g.label} buildings</div>
          <div className="lens-group">
            {g.buildings.map((b) => {
              const tool: LensTool = { kind: 'building', id: b.id, name: b.name }
              return (
                <button key={b.id} type="button" className={`lens-tool${on(tool)}`} disabled={!!b.blocked} title={b.blocked ?? `Place a ${b.name}`} onClick={() => pick(tool)}>
                  {b.name}
                </button>
              )
            })}
          </div>
        </div>
      ))}

      <div>
        <div className="lens-group-title">Defences</div>
        <div className="lens-group">
          {(Object.keys(DEFENSE_DEFS) as DefenseKind[]).map((k) => {
            const tool: LensTool = { kind: 'defense', defense: k, name: k === 'spaceport' ? 'Spaceport (installation)' : DEFENSE_DEFS[k].name }
            return (
              <button key={k} type="button" className={`lens-tool${on(tool)}`} onClick={() => pick(tool)} title={`Place a ${DEFENSE_DEFS[k].name} exactly where you click`}>
                {k === 'spaceport' ? 'Spaceport (installation)' : DEFENSE_DEFS[k].name}
              </button>
            )
          })}
        </div>
      </div>

      <div>
        <div className="lens-group-title">Roads and railways</div>
        <div className="lens-group">
          {(Object.keys(ROUTE_SPECS) as RouteKind[]).map((k) => {
            const tool: LensTool = { kind: 'route', route: k, name: ROUTE_SPECS[k].name }
            return (
              <button key={k} type="button" className={`lens-tool${on(tool)}`} onClick={() => pick(tool)} title={`Lay a ${ROUTE_SPECS[k].name.toLowerCase()}: click one site, then another`}>
                {ROUTE_SPECS[k].name}
              </button>
            )
          })}
        </div>
      </div>

      <div>
        <div className="lens-group-title">Zoning</div>
        <div className="lens-group">
          <button type="button" className={`lens-tool${on({ kind: 'zone', name: 'Zone' })}`} onClick={() => pick({ kind: 'zone', name: 'Zone' })} title="Pick a district, then paint the ground it may grow into. Its room is what its zone holds.">
            Draw a zone
          </button>
          <button type="button" className={`lens-tool${on({ kind: 'reserve', name: 'Nature reserve' })}`} onClick={() => pick({ kind: 'reserve', name: 'Nature reserve' })} title="Keep untouched rural ground wild: no district will grow over it.">
            Nature reserve
          </button>
        </div>
        <div className="abs-dim" style={{ marginTop: 6 }}>
          Rural land (untouched, in no district): {rural.cells.toLocaleString()} cells, about {Math.round(rural.millions).toLocaleString()}M people on {rural.marks.length} homesteads and farmsteads (one mark for about {MILLION_PEOPLE_PER_MARK}M).{rural.reserved > 0 ? ` ${rural.reserved} cells are kept as nature reserve.` : ''}
        </div>
        <div className="lens-group-title">Land-use law</div>
        <div className="lens-group">
          {LAND_USE_POLICIES.map((p) => (
            <button key={p} type="button" className={`lens-tool${policy === p ? ' active' : ''}`} title={LAND_USE_TEXT[p]} onClick={() => useZoneStore.getState().setPolicy(me, p)}>
              {LAND_USE_LABEL[p]}
            </button>
          ))}
        </div>
        <div className="abs-dim" style={{ marginTop: 6 }}>{LAND_USE_TEXT[policy]}</div>
      </div>
    </div>
  )
}

function sameTool(a: LensTool, b: LensTool): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'building' && b.kind === 'building') return a.id === b.id
  if (a.kind === 'level' && b.kind === 'level') return a.district === b.district
  if (a.kind === 'defense' && b.kind === 'defense') return a.defense === b.defense
  if (a.kind === 'route' && b.kind === 'route') return a.route === b.route
  return true
}
