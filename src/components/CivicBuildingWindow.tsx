import { DraggableWindow } from './DraggableWindow'
import { ownerDisplay } from '../data/countryRoster'
import { useCivicDetailStore, useCivicStore } from '../state/civicStore'
import { useTerritoryStore } from '../state/territoryStore'
import { PlanetIcon } from './planet/PlanetIcons'
import { KEY_BUILDING_ICON } from '../scene/keyBuildings'

const KIND_LABEL = { seat: 'Government Seat', landmark: 'Government landmark', cityHall: 'Municipal Government Building', outpostStation: 'Outpost Station' } as const

// A civic building opened (the Senate House, a landmark, a municipal building, a colony's station): what it is, where it stands, who holds it
// and what holding it means. It takes no slot and cannot be demolished; it falls to whoever takes its key node.
export function CivicBuildingWindow() {
  const open = useCivicDetailStore((s) => s.open)
  const close = useCivicDetailStore((s) => s.close)
  const list = useCivicStore((s) => (open ? s.civic[open.bodyName] : undefined))
  const owner = useTerritoryStore((s) => (open ? s.bodyOwner[open.bodyName] : undefined))
  const nodeHolders = useTerritoryStore((s) => (open ? s.nodeHolders[open.bodyName] : undefined))
  const c = open ? list?.find((x) => x.id === open.id) : undefined
  if (!open || !c) return null
  const heldBy = nodeHolders?.[c.node] ?? owner
  const captured = !!heldBy && !!owner && heldBy !== owner
  return (
    <DraggableWindow title={`${c.name} — ${open.bodyName}`} memoryKey="civic" onClose={close}>
      <div className="econ-panel">
        <div className="pl-def" style={{ marginBottom: 8 }}>
          <PlanetIcon id={KEY_BUILDING_ICON[c.kind]} size={28} />
          <div className="pl-def-body">
            <div className="pl-def-name">{c.name}</div>
            <div className="abs-dim">{KIND_LABEL[c.kind]} · Core district</div>
          </div>
        </div>
        <div className="abs-dim" style={{ marginBottom: 8 }}>{c.description}</div>
        <div className="inspect-row"><span className="inspect-label">Stands in</span><span className="inspect-value">{c.place}{c.native ? ` ${c.native}` : ''}</span></div>
        {c.siteId && <div className="inspect-row"><span className="inspect-label">Settlement site</span><span className="inspect-value">{c.siteId}</span></div>}
        <div className="inspect-row" title="Who holds the key node it stands on right now">
          <span className="inspect-label">Held by</span>
          <span className="inspect-value" style={{ color: heldBy ? ownerDisplay(heldBy).color : undefined }}>
            {heldBy ? ownerDisplay(heldBy).name : 'nobody'}
            {captured && <span className="econ-neg"> (captured)</span>}
          </span>
        </div>
        <div className="inspect-row"><span className="inspect-label">Key node</span><span className="inspect-value">{c.role}</span></div>
        <div className="inspect-status">Takes no district slot and costs nothing to keep. It cannot be demolished: it changes hands with its key node.</div>
      </div>
    </DraggableWindow>
  )
}
