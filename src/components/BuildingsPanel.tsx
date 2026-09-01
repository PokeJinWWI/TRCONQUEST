import { useMemo } from 'react'
import { RECIPES } from '../economy/recipes'
import { GOODS } from '../economy/goods'
import { estimateWorldGdp, constructionCost } from '../economy/economyTick'
import { useEconomyStore } from '../state/economyStore'
import { usePlayerStore } from '../state/playerStore'
import { formatPop } from '../economy/format'
import type { Country, World } from '../economy/economyTypes'

const TAB_CATEGORIES: Record<string, string[] | null> = {
  Development: null,
  Agriculture: ['agriculture'],
  Resources: ['extraction'],
  Urban: ['industry', 'healthcare'],
}

interface BuildingsPanelProps {
  subtab: string | null
  worldName?: string
  world?: World
  // The owning country — its treasury funds construction here.
  country?: Country
}

// A world's buildings from the live simulation, plus construction on a world
// you govern (funded from the national treasury, see economyTick). Read-only on
// worlds you don't own.
export function BuildingsPanel({ subtab, worldName, world, country }: BuildingsPanelProps) {
  const countryId = usePlayerStore((s) => s.selectedCountryId)
  const queueConstruction = useEconomyStore((s) => s.queueConstruction)
  const cancelConstruction = useEconomyStore((s) => s.cancelConstruction)

  const cats = subtab ? TAB_CATEGORIES[subtab] : null
  const rows = useMemo(() => {
    if (!world) return []
    return world.buildings
      .map((b) => ({ b, recipe: RECIPES[b.recipeId] }))
      .filter(({ recipe }) => recipe && (!cats || cats.includes(recipe.category)))
  }, [world, cats])

  if (!world) {
    return <div className="nav-placeholder">{worldName ? `${worldName} is uninhabited — no economy.` : 'No world in focus.'}</div>
  }

  const totalPop = world.pops.reduce((s, p) => s + p.populationSize, 0)
  const owned = !!countryId && world.ownerId === countryId
  const treasury = country?.treasury ?? 0
  const buildable = Object.values(RECIPES).filter((r) => !cats || cats.includes(r.category))

  return (
    <div className="econ-panel">
      <div className="econ-summary">
        <span>
          <span className="econ-summary-label">{world.name}</span> · Pop {formatPop(totalPop)} · GDP {estimateWorldGdp(world).toFixed(0)}
          {owned && <> · Treasury {treasury.toFixed(0)}</>}
        </span>
      </div>

      {rows.length === 0 ? (
        <div className="nav-placeholder">No buildings in this sector.</div>
      ) : (
        <table className="econ-table">
          <thead>
            <tr>
              <th>Building</th>
              <th>Lvl</th>
              <th>Output</th>
              <th>Profit</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ b, recipe }) => {
              const out = recipe!.outputs[0]
              return (
                <tr key={b.id}>
                  <td>{recipe!.label}</td>
                  <td>{b.level}</td>
                  <td>{out ? GOODS[out.good].label : '—'}</td>
                  <td className={b.lastProfit >= 0 ? 'econ-pos' : 'econ-neg'}>{b.lastProfit.toFixed(0)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {world.constructionQueue.length > 0 && (
        <>
          <div className="econ-subtitle" style={{ marginTop: 8 }}>
            Under construction
          </div>
          {world.constructionQueue.map((o) => {
            const recipe = RECIPES[o.recipeId]
            const pct = Math.max(0, Math.min(100, (o.progress / o.cost) * 100))
            return (
              <div key={o.id} className="econ-build-row">
                <span className="econ-build-name">{recipe?.label ?? o.recipeId}</span>
                <span className="econ-build-bar">
                  <span className="econ-build-fill" style={{ width: `${pct}%` }} />
                </span>
                <span className="econ-build-pct">{Math.round(pct)}%</span>
                {owned && (
                  <button type="button" className="econ-build-cancel" onClick={() => cancelConstruction(world.id, o.id)} aria-label="Cancel">
                    ×
                  </button>
                )}
              </div>
            )
          })}
        </>
      )}

      {owned ? (
        <>
          <div className="econ-subtitle" style={{ marginTop: 8 }}>
            Build (cost {constructionCost()} each)
          </div>
          <div className="econ-build-buttons">
            {buildable.map((r) => (
              <button
                key={r.id}
                type="button"
                className="econ-build-btn"
                onClick={() => queueConstruction(world.id, r.id)}
                disabled={treasury <= 0}
                title={treasury <= 0 ? 'National treasury empty — no funds to build' : `Queue a ${r.label}`}
              >
                + {r.label}
              </button>
            ))}
          </div>
          {treasury <= 0 && <div className="ship-panel-hint">National treasury is empty — build savings (or raise tax) first.</div>}
        </>
      ) : (
        <div className="ship-panel-hint">You don't govern {world.name} — construction is only available on your own worlds.</div>
      )}
    </div>
  )
}
