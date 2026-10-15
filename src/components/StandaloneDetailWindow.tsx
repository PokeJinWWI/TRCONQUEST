import { Bi } from './Bi'
import { useEffect, useMemo, useState } from 'react'
import { DraggableWindow } from './DraggableWindow'
import { PlanetIcon } from './planet/PlanetIcons'
import { useThrottledSimDays } from '../hooks/useThrottledSimDays'
import { ownerDisplay } from '../data/countryRoster'
import { renamePort } from '../scene/portStructures'
import { standaloneRows, showNodeOnMap, type StandaloneRow } from '../scene/standalone'
import { useBuildingDetailStore } from '../state/buildingDetailStore'
import { useDefenseStore } from '../state/defenseStore'
import { usePlayerStore } from '../state/playerStore'
import { useStandaloneDetailStore } from '../state/standaloneDetailStore'
import { useStructureStore } from '../state/structureStore'
import { useTerritoryStore } from '../state/territoryStore'

// A building that stands on its own ground, opened like any other building: what it is, who holds it, where, how it is doing (integrity, or
// how far its construction is), and a name you can change. Complex spaceports open the economy building that runs them instead.
export function StandaloneDetailWindow() {
  const bodyName = useStandaloneDetailStore((s) => s.bodyName)
  const key = useStandaloneDetailStore((s) => s.key)
  const close = useStandaloneDetailStore((s) => s.close)
  const installations = useDefenseStore((s) => s.installations)
  const ports = useStructureStore((s) => s.ports)
  const rural = useStructureStore((s) => s.rural)
  const owner = useTerritoryStore((s) => (bodyName ? s.bodyOwner[bodyName] : undefined))
  const player = usePlayerStore((s) => s.selectedCountryId)
  const day = Math.floor(useThrottledSimDays())
  const row: StandaloneRow | undefined = useMemo(() => (bodyName && key ? standaloneRows(bodyName).find((r) => r.key === key) : undefined), [bodyName, key, installations, ports, rural, day])
  const [draft, setDraft] = useState('')
  useEffect(() => setDraft(row?.name ?? ''), [row?.name, key])
  if (!bodyName || !key || !row) return null
  const mine = !!player && owner === player
  const rename = () => {
    const r = row.renameAs
    if (!r) return
    if (r.kind === 'port') renamePort(bodyName, r.id, draft)
    else if (r.kind === 'defense') useDefenseStore.getState().renameInstallation(r.id, draft)
    else useStructureStore.getState().renameRural(bodyName, r.id, draft)
  }
  return (
    <DraggableWindow raiseKey={key} title={`${row.name} — ${bodyName}`} memoryKey="standalone" onClose={close}>
      <div className="econ-panel">
        <div className="pl-detail">
          <div className="pl-detail-head">
            <PlanetIcon id={row.iconId} size={26} />
            <div>
              <div className="pl-detail-name">{row.name}</div>
              <div className="abs-dim">{row.kind === 'port' ? 'Spaceport' : row.kind === 'defense' ? 'Defence installation' : 'Structure'}{row.region ? ` · ${row.region}` : ''}</div>
            </div>
            <button type="button" className="abs-x" title="Close" onClick={close}>×</button>
          </div>
          <div className="pl-detail-desc">{row.description}</div>
          {row.progress !== null && (
            <div className="inspect-row"><span className="inspect-label"><Bi en="Under construction" /></span><span className="inspect-value">{Math.round(row.progress * 100)}% built</span></div>
          )}
          {row.progress !== null && <span className="pl-progress" style={{ display: 'block' }}><span style={{ width: `${Math.round(row.progress * 100)}%` }} /></span>}
          {row.holder && <div className="inspect-row"><span className="inspect-label"><Bi en="Held by" /></span><span className="inspect-value" style={{ color: ownerDisplay(row.holder).color }}>{ownerDisplay(row.holder).name}</span></div>}
          {row.integrity && <div className="inspect-row"><span className="inspect-label"><Bi en="Integrity" /></span><span className="inspect-value">{row.integrity}</span></div>}
          {row.detail && row.kind === 'port' && <div className="inspect-row"><span className="inspect-label"><Bi en="Run by" /></span><span className="inspect-value">{row.detail.split(' · ')[0]}</span></div>}
          <div className="pl-detail-actions">
            {row.node !== null && <button type="button" className="laws-enact-btn" onClick={() => showNodeOnMap(bodyName, row.node!)}><Bi en="Show on the ground map" /></button>}
            {row.buildingId && <button type="button" className="laws-enact-btn" onClick={() => useBuildingDetailStore.getState().openBuilding(bodyName, row.buildingId!)}><Bi en="Open the economy building" /></button>}
          </div>
          {mine && row.renameAs && (
            <div className="inspect-row" style={{ marginTop: 6 }}>
              <span className="inspect-label"><Bi en="Name" /></span>
              <input className="ground-key-name-input" value={draft} maxLength={40} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') rename(); e.stopPropagation() }} />
              <button type="button" className="ground-key-rename" title="Save the name" onClick={rename}>✓</button>
            </div>
          )}
        </div>
      </div>
    </DraggableWindow>
  )
}
