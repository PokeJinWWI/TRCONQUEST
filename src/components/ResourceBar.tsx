import { useState } from 'react'
import { RESOURCE_TYPES, HUD_RESOURCE_IDS, type ResourceId } from '../data/resourceData'
import { usePlayerResources } from '../hooks/usePlayerResources'
import { usePlayerExtraction } from '../hooks/usePlayerExtraction'
import { usePlayerTech } from '../hooks/usePlayerTech'
import { useDepositStore } from '../state/depositStore'
import { MATERIALS } from '../data/materials'
import { bodyHasDeposit, EXTRACTION_PER_MONTH } from '../data/deposits'
import { findTech } from '../data/techData'
import { COMPLEX_REFINERY_LEVELS, EXOTIC_PER_HYPERIUM, HYPERIUM_PER_REFINERY, HYPERIUM_SYNTHESIS_TECH_ID } from '../data/synthesisData'
import { synthesisBlock } from '../scene/extraction'
import { usePlayerStore } from '../state/playerStore'
import { ResourceIcon } from './ResourceIcons'
import { DraggableWindow } from './DraggableWindow'

// A signed, HUD-terse rendering of a monthly gain/deficit — `toLocaleString`
// already prefixes a negative number with its own minus sign, so only the
// positive/zero cases need an explicit "+" added.
function formatDelta(delta: number): string {
  if (delta > 0) return `+${delta.toLocaleString()}`
  if (delta < 0) return delta.toLocaleString()
  return '±0'
}

// Real values, currently all zero — see resourceStore for why that's the
// honest number rather than an invented one. Clicking a resource opens a
// small info window with its description plus stockpile/monthly gain-or-
// deficit/debt — a real, functional UI even though the numbers behind it
// stay at zero until an actual production/consumption tick exists to
// produce them, same "build the real thing, the data catches up later"
// pattern this project already follows for Society/Engineering's tech
// trees and the Outliner's Colonies/Starbases sections.
export function ResourceBar() {
  const { amounts, monthlyDelta: baseDelta } = usePlayerResources()
  const { rate: drawn, held } = usePlayerExtraction()
  const researched = usePlayerTech().researched
  const economyModel = usePlayerStore((s) => s.economyModel)
  const deposits = useDepositStore((s) => s.remaining)
  // The deposits it draws are income too, beyond what the economy's own figure carries.
  const monthlyDelta = { ...baseDelta } as Record<ResourceId, number>
  for (const m of MATERIALS) monthlyDelta[m.id] = Math.round((baseDelta[m.id] + (drawn[m.id] ?? 0)) * 10) / 10
  const sandbox = usePlayerStore((s) => s.sandbox)
  const [openId, setOpenId] = useState<ResourceId | null>(null)
  const openResource = RESOURCE_TYPES.find((r) => r.id === openId) ?? null
  const visibleResources = HUD_RESOURCE_IDS.map((id) => RESOURCE_TYPES.find((r) => r.id === id)!)
  // The sandbox has no economy, so no stockpiles to show.
  if (sandbox) return null

  return (
    <div className="resource-bar">
      {visibleResources.map((resource) => {
        const delta = monthlyDelta[resource.id]
        return (
          <button
            key={resource.id}
            type="button"
            className="resource-item"
            title={resource.name}
            onClick={() => setOpenId(resource.id)}
          >
            <ResourceIcon id={resource.id} className="resource-icon" />
            <span className="resource-value">{Math.floor(amounts[resource.id]).toLocaleString()}</span>
            <span className={`resource-delta${delta > 0 ? ' econ-pos' : delta < 0 ? ' econ-neg' : ''}`}>
              {formatDelta(delta)}/mo
            </span>
          </button>
        )
      })}

      {openResource && (
        <DraggableWindow title={openResource.name} memoryKey="resource" onClose={() => setOpenId(null)} maximizable={false}>
          <div className="inspect-row">
            <span className="inspect-label">Stockpile</span>
            <span className="inspect-value">{Math.floor(amounts[openResource.id]).toLocaleString()}</span>
          </div>
          <div className="inspect-row">
            <span className="inspect-label">Monthly</span>
            <span
              className={`inspect-value${
                monthlyDelta[openResource.id] > 0 ? ' econ-pos' : monthlyDelta[openResource.id] < 0 ? ' econ-neg' : ''
              }`}
            >
              {formatDelta(monthlyDelta[openResource.id])}/mo
            </span>
          </div>
          <div className="inspect-row">
            <span className="inspect-label">Debt</span>
            {/* A resource going negative — nothing does yet, since no
                consumption system exists — IS debt: a shortfall the economy
                is running against rather than a stockpile it holds. Derived
                from the stockpile itself rather than a separate stored
                field, so it can never drift out of sync with it. */}
            <span className={`inspect-value${amounts[openResource.id] < 0 ? ' econ-neg' : ''}`}>
              {amounts[openResource.id] < 0 ? Math.abs(amounts[openResource.id]).toLocaleString() : 0}
            </span>
          </div>
          {(openResource.id === 'hyperium' || openResource.id === 'exoticMatter') && (() => {
            const mat = MATERIALS.find((m) => m.id === openResource.id)!
            const mine = held.filter((b) => bodyHasDeposit(mat.id, b))
            const left = mine.reduce((n, b) => n + (deposits[mat.id][b] ?? 0), 0)
            const noTech = !researched.has(mat.extractionTechId)
            return (
              <div className="inspect-row" title={`Finite natural deposits on bodies you own, drawn at ${EXTRACTION_PER_MONTH} a month each with ${findTech(mat.extractionTechId)?.name ?? 'its Extraction tech'}.`}>
                <span className="inspect-label">Deposits held</span>
                <span className="inspect-value">
                  {noTech ? `Needs ${findTech(mat.extractionTechId)?.name ?? 'Extraction'} researched` : mine.length === 0 ? 'none on your worlds' : `${mine.length} · ${Math.floor(left)} left · ${(drawn[mat.id] ?? 0).toFixed(1)}/mo`}
                </span>
              </div>
            )
          })()}
          {openResource.id === 'exoticMatter' && (() => {
            // Exotic matter refines into hyperium: Simple has the Hyperium Refinery
            // building, Complex a nation-level step (scene/extraction.ts).
            const reason = !researched.has(HYPERIUM_SYNTHESIS_TECH_ID) ? 'Needs Hyperium Synthesis researched' : economyModel === 'abstract' ? 'Hyperium Refineries refine it' : synthesisBlock(researched, amounts.exoticMatter)
            return (
              <div className="inspect-row" title={`${EXOTIC_PER_HYPERIUM} exotic matter makes 1 hyperium. Needs Hyperium Synthesis; ${economyModel === 'abstract' ? 'build Hyperium Refineries (Industrial district).' : `refined monthly, up to ${COMPLEX_REFINERY_LEVELS * HYPERIUM_PER_REFINERY} hyperium a month.`}`}>
                <span className="inspect-label">Refining to hyperium</span>
                <span className="inspect-value">{reason ?? `${COMPLEX_REFINERY_LEVELS * HYPERIUM_PER_REFINERY * EXOTIC_PER_HYPERIUM} exotic → ${COMPLEX_REFINERY_LEVELS * HYPERIUM_PER_REFINERY} hyperium a month`}</span>
              </div>
            )
          })()}
          <div className="inspect-divider" />
          <div className="resource-info-description">{openResource.description}</div>
        </DraggableWindow>
      )}
    </div>
  )
}
