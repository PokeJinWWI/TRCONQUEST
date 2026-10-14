import { Bi } from './Bi'
import { SiteChooser } from './planet/SiteChooser'
import { usePlayerStore } from '../state/playerStore'
import { useState } from 'react'
import { RECIPES, DISTRICT_TYPES, DISTRICT_LABELS, districtOfRecipe, buildingGroup, BUILDING_GROUP_LABELS, BUILDING_GROUP_ORDER, type BuildingGroup } from '../economy/recipes'
import { districtUsage, canBuild, estimateConstructionCost, constructionCapacityOf } from '../economy/economyTick'
import { useEconomyStore } from '../state/economyStore'
import { usePlayerEconomy } from '../hooks/usePlayerEconomy'
import { formatIED } from '../economy/format'
import type { BuildingOwner } from '../economy/economyTypes'

const DISTRICT_COLOR: Record<string, string> = {
  core: '#c77dff',
  urban: '#6fe3ff',
  industrial: '#ffd23f',
  mining: '#c98a5a',
  agricultural: '#4ade80',
}

// The full roster (~55 building types) bucketed into its finer sub-categories
// (recipes.ts) so this all-districts build list reads as sections rather than
// one long wall of buttons.
const ALL_RECIPES = Object.values(RECIPES)
const RECIPE_GROUPS: { group: BuildingGroup; items: (typeof ALL_RECIPES)[number][] }[] = (() => {
  const buckets = new Map<BuildingGroup, (typeof ALL_RECIPES)[number][]>()
  for (const r of ALL_RECIPES) {
    // Corporate HQs aren't player-built — companies raise and relocate their own
    // (corporationAI). The state never constructs them.
    if (r.autoBuilt) continue
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
  // The "where?" step for a new building.
  const [choosing, setChoosing] = useState<string | null>(null)
  const playerId = usePlayerStore((s) => s.selectedCountryId)

  if (!country || !world) return <div className="nav-placeholder">No world in focus.</div>
  const rate = country.currency?.rate ?? 1
  const fmt = (n: number) => formatIED(n, rate)
  const usage = districtUsage(world)
  // The government spends only the government's money: a player order is always state-owned and paid from the treasury.
  const owner: BuildingOwner = { kind: 'state' }

  return (
    <div className="econ-panel">
      <div className="econ-summary">
        <span>
          <span className="econ-summary-label">{world.name}</span> · Districts (finite building space)
        </span>
      </div>
      <div className="ship-panel-hint" style={{ marginTop: 0, marginBottom: 6 }}>
        Construction capacity: <b>{constructionCapacityOf(world).toFixed(0)}</b> points/tick — build <b>Construction Sectors</b> (Development) to build faster. Buildings cost construction points; the money is the materials they consume.
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
        Construction funding
      </div>
      <div className="inspect-row">
        <span className="inspect-label"><Bi en="Government pool (treasury)" /></span>
        <span className="inspect-value">{fmt(country.treasury)}</span>
      </div>
      <div className="inspect-row" title="The private sector's pooled capital — a slice of company profits, managed by the financial sector — that finances PRIVATE construction.">
        <span className="inspect-label"><Bi en="Private investment pool" /></span>
        <span className="inspect-value">{fmt(country.investmentPool)}</span>
      </div>

      <div className="econ-subtitle" style={{ marginTop: 10 }}>
        Build — construction consumes materials over time
      </div>
      <div className="ship-panel-hint" style={{ marginTop: 0, marginBottom: 6 }}>
        The government builds with the government's money: the treasury pays, and the building is state-owned. Companies build with their own money, by their own decisions.
      </div>
      {choosing && playerId && (
        <SiteChooser
          request={{ bodyName: world.name, builderId: playerId, title: RECIPES[choosing]?.label ?? choosing, ref: { mode: 'complex' as const, id: choosing } }}
          onCancel={() => setChoosing(null)}
          onChoose={(siteId) => {
            queueConstruction(world.id, choosing, owner, siteId)
            setChoosing(null)
          }}
        />
      )}
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
                  title={room ? `Build a ${r.label} in the ${DISTRICT_LABELS[districtOfRecipe(r.id)]} district — about ${fmt(estimateConstructionCost(r.id, world.market.prices))} of materials` : `${DISTRICT_LABELS[districtOfRecipe(r.id)]} district is full`}
                  onClick={() => setChoosing(r.id)}
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
                  {o.district ? `${DISTRICT_LABELS[o.district]} district — new level` : recipe?.label ?? o.recipeId}
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
