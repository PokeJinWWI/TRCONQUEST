import { Bi } from '../Bi'
import { useMemo, useState } from 'react'
import { useThrottledSimDays } from '../../hooks/useThrottledSimDays'
import { chooseStandaloneSite, standaloneOptions, standaloneRows, type StandaloneRow } from '../../scene/standalone'
import { useStandaloneDetailStore } from '../../state/standaloneDetailStore'
import { useAbstractEconomyStore } from '../../state/abstractEconomyStore'
import { useBuildingDetailStore } from '../../state/buildingDetailStore'
import { useDefenseStore } from '../../state/defenseStore'
import { useEconomyStore } from '../../state/economyStore'
import { useStructureStore } from '../../state/structureStore'
import { useTerritoryStore } from '../../state/territoryStore'
import { PlanetIcon, buildingIconId } from './PlanetIcons'

// "Standalone buildings", on the Buildings tab and the Development tab alike: what stands on its own ground (spaceports, defences, rural
// structures), each as a building you can click, with a Build button that opens the ground map to choose where. Something being built
// shows its progress here and on the map where it stands.
export function StandaloneSection({ bodyName, playerId, extra = [] }: { bodyName: string; playerId: string | null; extra?: { id: string; name: string; count: number; buildingId?: string }[] }) {
  const [picking, setPicking] = useState(false)
  const owner = useTerritoryStore((s) => s.bodyOwner[bodyName])
  const controller = useTerritoryStore((s) => s.bodyController[bodyName] ?? s.bodyOwner[bodyName])
  const installations = useDefenseStore((s) => s.installations)
  const ports = useStructureStore((s) => s.ports[bodyName])
  const rural = useStructureStore((s) => s.rural[bodyName])
  const worlds = useEconomyStore((s) => s.worlds)
  const queue = useAbstractEconomyStore((s) => (owner ? s.byCountry[owner]?.queue : undefined))
  const simpleBuildings = useAbstractEconomyStore((s) => s.worlds[bodyName]?.buildings)
  const day = useThrottledSimDays()
  const canAct = !!playerId && owner === playerId && controller === playerId
  const rows = useMemo(() => standaloneRows(bodyName), [bodyName, installations, ports, rural, worlds, queue, simpleBuildings, Math.floor(day)])
  const options = useMemo(() => (canAct && playerId ? standaloneOptions(playerId, bodyName) : []), [canAct, playerId, bodyName, installations, Math.floor(day / 30)])
  if (rows.length === 0 && extra.length === 0 && !canAct) return null
  // A building that stands on its own opens like any other: Complex spaceports in the economy building that runs them, the rest in their own window.
  function open(rowOrId: StandaloneRow | string | undefined, _node?: number | null) {
    void _node
    if (typeof rowOrId === 'string') useBuildingDetailStore.getState().openBuilding(bodyName, rowOrId)
    else if (rowOrId?.buildingId) useBuildingDetailStore.getState().openBuilding(bodyName, rowOrId.buildingId)
    else if (rowOrId) useStandaloneDetailStore.getState().open(bodyName, rowOrId.key)
  }
  return (
    <div>
      <div className="econ-subtitle" title="Buildings on their own ground, in no area and on no settlement. Every one is a node of the ground map.">
        <Bi en="Standalone buildings" /> <span className="abs-dim">{rows.length + extra.length}</span>
        {canAct && (
          <button type="button" className="pl-develop" style={{ marginLeft: 8 }} onClick={() => setPicking(!picking)} title="Build something on its own ground: the ground map opens so you can pick the place">
            {picking ? '− Close' : '+ Build'}
          </button>
        )}
      </div>
      {picking && (
        <div className="pl-picker">
          {options.map((o) => (
            <button key={o.id} type="button" className="pl-pick" disabled={!!o.blocked} title={o.blocked ?? `Build a ${o.name}: the ground map opens to choose where`} onClick={() => { chooseStandaloneSite(bodyName, o); setPicking(false) }}>
              <PlanetIcon id={buildingIconId(o.iconId)} size={16} />
              <span>{o.name}</span>
              {o.blocked && <span className="abs-dim">{o.blocked}</span>}
            </button>
          ))}
        </div>
      )}
      <div className="pl-district">
        <div className="pl-grid">
          {extra.map((b) => (
            <button key={b.id} type="button" className="pl-tile" disabled={!b.buildingId} title={`${b.name}: level ${b.count}`} onClick={() => open(b.buildingId)}>
              <PlanetIcon id={buildingIconId(b.id)} size={18} />
              <span className="pl-tile-name">{b.name} Lv {b.count}</span>
            </button>
          ))}
          {rows.map((r) => (
            <button key={r.key} type="button" className={`pl-tile${r.progress !== null ? ' queued' : ''}`} title={`${r.name}${r.detail ? `\n${r.detail}` : ''}`} onClick={() => open(r)}>
              <PlanetIcon id={buildingIconId(r.iconId)} size={18} />
              <span className="pl-tile-name">{r.name}</span>
              {r.progress !== null && <span className="pl-tile-bar"><span style={{ width: `${Math.round(r.progress * 100)}%` }} /></span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
