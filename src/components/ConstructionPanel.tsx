import { useState } from 'react'
import { RECIPES, DISTRICT_TYPES, DISTRICT_LABELS, districtOfRecipe, buildingGroup, BUILDING_GROUP_LABELS, BUILDING_GROUP_ORDER, type BuildingGroup } from '../economy/recipes'
import { districtUsage, canBuild, constructionCost } from '../economy/economyTick'
import { useEconomyStore } from '../state/economyStore'
import { usePlayerEconomy } from '../hooks/usePlayerEconomy'
import { formatMoney } from '../economy/format'
import type { BuildingOwner } from '../economy/economyTypes'

const DISTRICT_COLOR: Record<string, string> = {
  core: '#c77dff',
  urban: '#6fe3ff',
  industrial: '#ffd23f',
  resource: '#4ade80',
}

// The full roster (~55 building types) bucketed into its finer sub-categories
// (recipes.ts) so this all-districts build list reads as sections rather than
// one long wall of buttons.
const ALL_RECIPES = Object.values(RECIPES)
const RECIPE_GROUPS: { group: BuildingGroup; items: (typeof ALL_RECIPES)[number][] }[] = (() => {
  const buckets = new Map<BuildingGroup, (typeof ALL_RECIPES)[number][]>()
  for (const r of ALL_RECIPES) {
    const g = buildingGroup(r.id)
    if (!buckets.has(g)) buckets.set(g, [])
    buckets.get(g)!.push(r)
  }
  return BUILDING_GROUP_ORDER.filter((g) => buckets.has(g)).map((g) => ({ group: g, items: buckets.get(g)! }))
})()

// Economy → Construction: the planet's finite districts, the two construction
// pools (the GOVERNMENT pool funded from the treasury, and PRIVATE pools funded
// from each company's own cash), and the build queue. Construction consumes
// building materials (steel, machinery, consumer goods) from the market, so it
// drives demand in the wider economy.
export function ConstructionPanel() {
  const { country, world } = usePlayerEconomy()
  const corporations = useEconomyStore((s) => s.corporations)
  const queueConstruction = useEconomyStore((s) => s.queueConstruction)
  const cancelConstruction = useEconomyStore((s) => s.cancelConstruction)
  const [funder, setFunder] = useState('state')

  if (!country || !world) return <div className="nav-placeholder">No world in focus.</div>
  const usage = districtUsage(world)
  const myCorps = corporations.filter((c) => c.countryId === country.id)
  const owner: BuildingOwner = funder === 'state' ? { kind: 'state' } : { kind: 'corporation', corporationId: funder }
  const funderName = funder === 'state' ? 'the Government' : myCorps.find((c) => c.id === funder)?.name ?? 'a company'

  return (
    <div className="econ-panel">
      <div className="econ-summary">
        <span>
          <span className="econ-summary-label">{world.name}</span> · Districts (finite building space)
        </span>
      </div>

      {DISTRICT_TYPES.map((d) => {
        const cap = world.districtCapacity[d]
        const used = usage[d]
        const pct = cap > 0 ? Math.min(100, (used / cap) * 100) : 0
        return (
          <div className="demo-bar-row" key={d}>
            <span className="demo-bar-label">{DISTRICT_LABELS[d]}</span>
            <span className="demo-bar-track">
              <span className="demo-bar-fill" style={{ width: `${pct}%`, background: DISTRICT_COLOR[d] }} />
            </span>
            <span className="demo-bar-val">
              {used}/{cap}
            </span>
          </div>
        )
      })}

      <div className="econ-subtitle" style={{ marginTop: 10 }}>
        Construction pools
      </div>
      <div className="inspect-row">
        <span className="inspect-label">Government pool (treasury)</span>
        <span className="inspect-value">{formatMoney(country.treasury)}</span>
      </div>
      {myCorps.map((c) => (
        <div className="inspect-row" key={c.id}>
          <span className="inspect-label">{c.name}</span>
          <span className="inspect-value">{formatMoney(c.cash)}</span>
        </div>
      ))}

      <div className="econ-subtitle" style={{ marginTop: 10 }}>
        Build (cost {formatMoney(constructionCost())}, paid by {funderName})
      </div>
      <div className="econ-econsystem" style={{ marginBottom: 6 }}>
        <span>Funded by:</span>
        <select className="econ-method-select" value={funder} onChange={(e) => setFunder(e.target.value)}>
          <option value="state">Government (treasury)</option>
          {myCorps.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      {RECIPE_GROUPS.map(({ group, items }) => (
        <div className="econ-build-group" key={group}>
          <div className="econ-build-group-label">{BUILDING_GROUP_LABELS[group]}</div>
          <div className="econ-build-buttons">
            {items.map((r) => {
              const room = canBuild(world, r.id)
              return (
                <button
                  key={r.id}
                  type="button"
                  className="econ-build-btn"
                  disabled={!room}
                  title={room ? `Build a ${r.label} in the ${DISTRICT_LABELS[districtOfRecipe(r.id)]} district` : `${DISTRICT_LABELS[districtOfRecipe(r.id)]} district is full`}
                  onClick={() => queueConstruction(world.id, r.id, owner)}
                >
                  + {r.label}
                </button>
              )
            })}
          </div>
        </div>
      ))}

      {world.constructionQueue.length > 0 && (
        <>
          <div className="econ-subtitle" style={{ marginTop: 10 }}>
            Under construction
          </div>
          {world.constructionQueue.map((o) => {
            const recipe = RECIPES[o.recipeId]
            const pct = Math.max(0, Math.min(100, (o.progress / o.cost) * 100))
            const who = o.owner.kind === 'corporation' ? corporations.find((c) => c.id === (o.owner as { corporationId: string }).corporationId)?.name ?? 'Company' : 'Government'
            return (
              <div key={o.id} className="econ-build-row">
                <span className="econ-build-name" title={`${who} · ${DISTRICT_LABELS[districtOfRecipe(o.recipeId)]}`}>
                  {recipe?.label ?? o.recipeId}
                </span>
                <span className="econ-build-bar">
                  <span className="econ-build-fill" style={{ width: `${pct}%` }} />
                </span>
                <span className="econ-build-pct">{Math.round(pct)}%</span>
                <button type="button" className="econ-build-cancel" onClick={() => cancelConstruction(world.id, o.id)} aria-label="Cancel">
                  ×
                </button>
              </div>
            )
          })}
        </>
      )}
      <div className="ship-panel-hint">
        Each building occupies its district (core = government/finance, urban = services, industrial = power/industry,
        resource = mines/farms). Construction consumes steel, machinery and consumer goods from the market.
      </div>
    </div>
  )
}
