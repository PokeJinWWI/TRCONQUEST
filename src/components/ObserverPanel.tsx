import { useMemo } from 'react'
import { DraggableWindow } from './DraggableWindow'
import { galaxyEmpires } from '../data/generatedEmpires'
import { NEIGHBORHOODS } from '../data/neighborhoodData'
import { findStar } from '../data/starData'
import { ALL_TECHS } from '../data/techData'
import { HUMAN_BASELINE_TIER } from '../data/techTiers'
import { useEconomyStore } from '../state/economyStore'
import { useObserverStore } from '../state/observerStore'
import { useViewStore } from '../state/viewStore'

const TECH_NAME = new Map(ALL_TECHS.map((t) => [t.id, t.name]))
const num = (n: number) => Math.round(n).toLocaleString()

// Observer mode's panel: every generated empire, with the systems it owns, its tech,
// influence and (in Complex mode, where the empires' economies run) its economy
// summary. Read-only. It reads the empire data (static) and the monthly summaries
// the economy store receives; it never subscribes to the clock.
export function ObserverPanel() {
  const setPanelOpen = useObserverStore((s) => s.setPanelOpen)
  const summaries = useEconomyStore((s) => s.empireSummaries)
  const empires = useMemo(() => galaxyEmpires(), [])
  const hasEconomy = Object.keys(summaries).length > 0
  return (
    <DraggableWindow title="Observer: empires" memoryKey="observer" onClose={() => setPanelOpen(false)} wide>
      <div className="inspect-status">
        {empires.length} empires. View only: nothing here changes the game or what you know.
        {!hasEconomy && ' Economy figures appear in Complex mode.'}
      </div>
      {empires.map((e) => {
        const cluster = NEIGHBORHOODS.find((n) => n.id === e.clusterId)
        const s = summaries[e.id]
        return (
          <div key={e.id} className="observer-empire">
            <div className="inspect-row">
              <span className="inspect-label" style={{ color: e.color }}>{e.name}{e.lore ? ' (lore)' : ''}</span>
              <button type="button" className="detail-view-btn" onClick={() => useViewStore.getState().enterInterstellar(e.clusterId, true)}>
                Go
              </button>
            </div>
            <div className="inspect-row"><span className="inspect-label">Neighbourhood</span><span className="inspect-value">{cluster?.name ?? e.clusterId}</span></div>
            <div className="inspect-row">
              <span className="inspect-label">Systems ({e.ownedStarIds.length})</span>
              <span className="inspect-value">{e.ownedStarIds.map((id) => findStar(id)?.name ?? id).join(', ')}</span>
            </div>
            <div className="inspect-row"><span className="inspect-label">Influence</span><span className="inspect-value">{num(e.influence)}</span></div>
            <div className="inspect-row" title={[...e.researched].map((t) => TECH_NAME.get(t) ?? t).join(', ')}>
              <span className="inspect-label">Tech</span>
              <span className="inspect-value">tier {e.techTier} ({e.techTier > HUMAN_BASELINE_TIER ? 'above' : e.techTier === HUMAN_BASELINE_TIER ? 'at' : 'below'} humans) · {e.researched.size} researched</span>
            </div>
            {s && (
              <div className="inspect-row">
                <span className="inspect-label">Economy</span>
                <span className="inspect-value">
                  {s.worlds} worlds · pop {num(s.population)}M · GDP {num(s.gdp)}/mo · treasury {num(s.treasury)} · inflation {(s.inflation * 100).toFixed(1)}% · unemployment {(s.unemployment * 100).toFixed(0)}%
                </span>
              </div>
            )}
            <div className="inspect-divider" />
          </div>
        )
      })}
    </DraggableWindow>
  )
}
