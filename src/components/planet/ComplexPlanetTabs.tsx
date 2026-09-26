import { useState } from 'react'
import { RECIPES, DISTRICT_TYPES, DISTRICT_LABELS, districtOfRecipe, buildingGroup, type DistrictType } from '../../economy/recipes'
import { canBuild, districtUsage, estimateConstructionCost, estimateWorldGdp, TICKS_PER_YEAR } from '../../economy/economyTick'
import {
  DISTRICT_CONSTRUCTION_WORK,
  DISTRICT_DESCRIPTIONS,
  SLOTS_PER_DISTRICT_LEVEL,
  buildingLevelsByDistrict,
  districtBonus,
  districtLevels,
  districtLevelsTotal,
  freeLandOfWorld,
  landOfWorld,
} from '../../economy/districts'
import { useEconomyStore } from '../../state/economyStore'
import { useTerritoryStore } from '../../state/territoryStore'
import { formatMoney, formatPop } from '../../economy/format'
import type { Building, BuildingOwner, ConstructionOrder, Country, World } from '../../economy/economyTypes'
import { PlanetIcon } from './PlanetIcons'
import { ForeignHoldingsRow } from './ForeignHoldings'
import { BuildingsPanel } from '../BuildingsPanel'

// Complex mode's planet screen tabs (Stellaris-style), over the deep sim: the
// world's districts — each a card of building tiles with its level, slots and
// ecosystem bonus — a build picker per district, and the construction queue.
// The full building management (methods, ownership, upgrades) stays available
// below as "Manage buildings".

const pct = (n: number, d = 0) => `${(n * 100).toFixed(d)}%`
const DISTRICT_ICON: Record<DistrictType, string> = { core: 'core', urban: 'urban', industrial: 'industrial', resource: 'resource' }

function ownerLabel(owner: BuildingOwner, corpName: (id: string) => string): string {
  return owner.kind === 'state' ? 'State' : owner.kind === 'worker' ? 'Co-op' : corpName(owner.corporationId)
}

export function ComplexWorldSummary({ world }: { world: World }) {
  const pop = world.pops.reduce((n, p) => n + p.populationSize, 0)
  const jobs = world.buildings.reduce((n, b) => n + (b.jobsPosted ?? 0), 0)
  const employed = world.buildings.reduce((n, b) => n + (b.employed ?? 0), 0)
  return (
    <div className="pl-summary">
      <div className="pl-stat-grid">
        <div className="pl-stat"><span>Population</span><b>{formatPop(pop)}</b></div>
        <div className="pl-stat" title="This world's output per year at current prices"><span>GDP / yr</span><b>{formatMoney(estimateWorldGdp(world) * TICKS_PER_YEAR)}</b></div>
        <div className="pl-stat" title="People employed / jobs posted"><span>Employed</span><b>{formatPop(employed)} / {formatPop(jobs)}</b></div>
        <div className="pl-stat" title="District levels developed / the land this world has"><span>Land used</span><b>{districtLevelsTotal(world)} / {landOfWorld(world)}</b></div>
        <div className="pl-stat"><span>Buildings</span><b>{world.buildings.length}</b></div>
        <div className="pl-stat"><span>Queued</span><b>{world.constructionQueue.length}</b></div>
      </div>
    </div>
  )
}

function BuildingTile({ b, corpName }: { b: Building; corpName: (id: string) => string }) {
  const r = RECIPES[b.recipeId]
  const run = Math.max(0, Math.min(1, b.throughput))
  return (
    <div
      className={`pl-tile owner-${b.owner.kind}${run < 0.6 ? ' understaffed' : ''}`}
      title={`${r?.label ?? b.recipeId} — level ${b.level}\nOwner: ${ownerLabel(b.owner, corpName)}\nRunning at ${pct(run)} · last profit ${formatMoney(b.lastProfit)}`}
    >
      <PlanetIcon id={buildingGroup(b.recipeId)} size={22} />
      <span className="pl-tile-name">{r?.label ?? b.recipeId}</span>
      {b.level > 1 && <span className="pl-tile-level">×{b.level}</span>}
      <span className="pl-tile-bar"><span style={{ width: pct(run) }} /></span>
    </div>
  )
}

function QueuedTile({ o }: { o: ConstructionOrder }) {
  const name = o.district ? `${DISTRICT_LABELS[o.district]} level` : RECIPES[o.recipeId]?.label ?? o.recipeId
  return (
    <div className="pl-tile queued" title={`Under construction: ${name} — ${Math.round(o.progress)}/${Math.round(o.cost)} construction points`}>
      <PlanetIcon id={o.district ? DISTRICT_ICON[o.district] : buildingGroup(o.recipeId)} size={22} />
      <span className="pl-tile-name">{name}</span>
      <span className="pl-tile-bar"><span style={{ width: pct(Math.min(1, o.progress / o.cost)) }} /></span>
    </div>
  )
}

export function ComplexDistrictsTab({ playerId, world, country }: { playerId: string | null; world: World; country?: Country }) {
  const corporations = useEconomyStore((s) => s.corporations)
  const queueConstruction = useEconomyStore((s) => s.queueConstruction)
  const queueDistrict = useEconomyStore((s) => s.queueDistrict)
  const cancelConstruction = useEconomyStore((s) => s.cancelConstruction)
  const controller = useTerritoryStore((s) => s.bodyController[world.name] ?? s.bodyOwner[world.name])
  const [picking, setPicking] = useState<DistrictType | null>(null)
  const [funder, setFunder] = useState('state')
  const [manage, setManage] = useState(false)

  const canBuildHere = !!playerId && world.ownerId === playerId && controller === playerId
  const corpName = (id: string) => corporations.find((c) => c.id === id)?.name ?? 'Company'
  const myCorps = corporations.filter((c) => c.countryId === world.ownerId)
  const owner: BuildingOwner = funder === 'state' ? { kind: 'state' } : { kind: 'corporation', corporationId: funder }
  const usage = districtUsage(world)
  const levels = districtLevels(world)
  const levelsByDistrict = buildingLevelsByDistrict(world)
  const land = freeLandOfWorld(world)

  return (
    <div className="pl-districts">
      <div className="pl-land" title="Each district level uses one unit of land; a world's land comes from its size.">
        Land <b>{districtLevelsTotal(world)}</b> / {landOfWorld(world)} district levels
        {land > 0 ? <span className="abs-dim"> · {land} free</span> : <span className="econ-neg"> · full</span>}
      </div>
      {canBuildHere && (
        <div className="econ-econsystem pl-funder">
          <span>Build as:</span>
          <select className="econ-method-select" value={funder} onChange={(e) => setFunder(e.target.value)} title="Who owns and pays for new buildings">
            <option value="state">Government (treasury)</option>
            {myCorps.map((c) => (
              <option key={c.id} value={c.id}>{c.name} (investment pool)</option>
            ))}
          </select>
        </div>
      )}

      {DISTRICT_TYPES.map((d) => {
        const bonus = districtBonus(world, d, levelsByDistrict)
        const cap = world.districtCapacity[d]
        const free = Math.max(0, cap - usage[d])
        const inDistrict = world.buildings.filter((b) => districtOfRecipe(b.recipeId) === d).sort((a, b) => buildingGroup(a.recipeId).localeCompare(buildingGroup(b.recipeId)) || b.level - a.level)
        const queued = world.constructionQueue.filter((o) => (o.district ? o.district === d : districtOfRecipe(o.recipeId) === d))
        const buildable = Object.values(RECIPES).filter((r) => districtOfRecipe(r.id) === d)
        return (
          <div key={d} className={`pl-district pl-district-c-${d}`}>
            <div className="pl-district-head" title={DISTRICT_DESCRIPTIONS[d]}>
              <PlanetIcon id={DISTRICT_ICON[d]} size={20} />
              <span className="pl-district-name">{DISTRICT_LABELS[d]} District</span>
              <span className="pl-district-level">Lv {levels[d]}</span>
              <span className="pl-district-slots" title="Building levels used / slots">{usage[d]}/{cap} slots</span>
              {bonus.total > 0 && (
                <span className="pl-district-bonus" title={`Ecosystem: +${pct(bonus.cluster, 1)} from ${levelsByDistrict[d]} building levels clustered here${bonus.link > 0 ? `, +${pct(bonus.link, 1)} from the urban district` : ''}`}>
                  +{pct(bonus.total, 1)}
                </span>
              )}
              {canBuildHere && (
                <button type="button" className="pl-develop" disabled={land <= 0} title={`Develop another level: +${SLOTS_PER_DISTRICT_LEVEL} slots · ${DISTRICT_CONSTRUCTION_WORK} construction points (state) · uses 1 land`} onClick={() => queueDistrict(world.id, d)}>
                  + Level
                </button>
              )}
            </div>
            <div className="pl-grid">
              {inDistrict.map((b) => <BuildingTile key={b.id} b={b} corpName={corpName} />)}
              {queued.map((o) => <QueuedTile key={o.id} o={o} />)}
              {free > 0 &&
                (canBuildHere ? (
                  <button type="button" className="pl-tile empty" title={`${free} free slot${free === 1 ? '' : 's'} — build here`} onClick={() => setPicking(picking === d ? null : d)}>
                    <span className="pl-plus">+</span>
                    <span className="pl-tile-name">{free} free</span>
                  </button>
                ) : (
                  <div className="pl-tile empty" title={`${free} empty slots`}><span className="pl-tile-name">{free} free</span></div>
                ))}
            </div>
            {d === 'urban' && (
              <div className="pl-foreign">
                <div className="abs-dim">Foreign embassies & firms</div>
                <ForeignHoldingsRow bodyName={world.name} playerId={playerId} />
              </div>
            )}
            {picking === d && (
              <div className="pl-picker pl-picker-wide">
                {buildable.map((r) => {
                  const room = canBuild(world, r.id)
                  return (
                    <button key={r.id} type="button" className="pl-pick" disabled={!room}
                      title={`${r.label} — about ${formatMoney(estimateConstructionCost(r.id, world.market.prices))} of materials`}
                      onClick={() => { queueConstruction(world.id, r.id, owner); setPicking(null) }}>
                      <PlanetIcon id={buildingGroup(r.id)} size={16} />
                      <span>{r.label}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}

      {world.constructionQueue.length > 0 && (
        <div className="pl-queue">
          <div className="econ-subtitle">Construction here</div>
          {world.constructionQueue.map((o) => (
            <div key={o.id} className="abs-order">
              <span>
                <PlanetIcon id={o.district ? DISTRICT_ICON[o.district] : buildingGroup(o.recipeId)} size={12} />{' '}
                {o.district ? `${DISTRICT_LABELS[o.district]} district level` : RECIPES[o.recipeId]?.label ?? o.recipeId}
                <span className="abs-dim"> · {ownerLabel(o.owner, corpName)}</span>
              </span>
              <span className="abs-order-bar"><span style={{ width: `${Math.min(100, (o.progress / o.cost) * 100)}%` }} /></span>
              <span className="abs-dim">{Math.round(o.progress)}/{Math.round(o.cost)}</span>
              {canBuildHere && <button type="button" className="abs-x" title="Cancel" onClick={() => cancelConstruction(world.id, o.id)}>×</button>}
            </div>
          ))}
        </div>
      )}

      <button type="button" className="abs-world-toggle pl-manage" onClick={() => setManage(!manage)} title="Production methods, ownership, upgrades and demolition">
        <span>{manage ? '▾' : '▸'} Manage buildings (methods, ownership, upgrades)</span>
      </button>
      {manage && <BuildingsPanel subtab={null} worldName={world.name} world={world} country={country} />}
    </div>
  )
}
