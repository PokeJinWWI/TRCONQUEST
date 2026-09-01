import { useMemo } from 'react'
import { usePlayerEconomy } from '../hooks/usePlayerEconomy'
import { RECIPES } from '../economy/recipes'
import { GOODS } from '../economy/goods'
import { estimateGdp } from '../economy/economyTick'

// Which recipe categories each Buildings sub-tab (see ActionBar) shows.
// 'Development' is the whole-economy overview; the others filter to a sector,
// the same way Victoria 3's build menu groups building types.
const TAB_CATEGORIES: Record<string, string[] | null> = {
  Development: null, // all
  Agriculture: ['agriculture'],
  Resources: ['extraction'],
  Urban: ['industry', 'healthcare'],
}

interface BuildingsPanelProps {
  subtab: string | null
}

// Real read-only view of the player's capital-planet economy driven by the
// live simulation (see economyStore / useEconomyTick). Milestone 1 has no
// construction system yet, so this reports the existing buildings — their
// level, staffing, output good and last-tick profit — rather than letting you
// place new ones; that arrives with a later milestone's cost/construction
// layer.
export function BuildingsPanel({ subtab }: BuildingsPanelProps) {
  const econ = usePlayerEconomy()

  const rows = useMemo(() => {
    if (!econ) return []
    const cats = subtab ? TAB_CATEGORIES[subtab] : null
    return econ.buildings
      .map((b) => ({ b, recipe: RECIPES[b.recipeId] }))
      .filter(({ recipe }) => recipe && (!cats || cats.includes(recipe.category)))
  }, [econ, subtab])

  if (!econ) {
    return <div className="nav-placeholder">No developed economy on your capital yet.</div>
  }

  const totalPop = econ.pops.reduce((s, p) => s + p.populationSize, 0)

  return (
    <div className="econ-panel">
      <div className="econ-summary">
        <span>
          <span className="econ-summary-label">{econ.name}</span> · Pop {totalPop.toFixed(1)} · GDP {estimateGdp(econ).toFixed(0)}
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
                  <td>{out ? `${GOODS[out.good].label}` : '—'}</td>
                  <td className={b.lastProfit >= 0 ? 'econ-pos' : 'econ-neg'}>{b.lastProfit.toFixed(1)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      <div className="ship-panel-hint">Construction is not yet available — this reports your standing buildings.</div>
    </div>
  )
}
