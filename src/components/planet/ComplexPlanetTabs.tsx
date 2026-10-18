import { Bi } from '../Bi'
import { estimateWorldGdp, TICKS_PER_YEAR } from '../../economy/economyTick'
import { districtLevelsTotal, landOfWorld } from '../../economy/districts'
import { useEconomyStore } from '../../state/economyStore'
import { unemploymentOf } from '../../economy/economyStep'
import { formatIED, formatPop } from '../../economy/format'
import type { World } from '../../economy/economyTypes'

// Complex mode's planet summary tab. The buildings themselves are the Buildings tab (components/planet/BuildingsTab.tsx), shared with
// Simple mode; ownership, methods and upgrades sit below it as "Manage buildings".

export function ComplexWorldSummary({ world }: { world: World }) {
  const ownerRate = useEconomyStore((s) => s.countries.find((c) => c.id === world.ownerId)?.currency?.rate ?? 1)
  const pop = world.pops.reduce((n, p) => n + p.populationSize, 0)
  const unemployment = useEconomyStore((s) => unemploymentOf(world.ownerId, [world], s.worldReports))
  return (
    <div className="pl-summary">
      <div className="pl-stat-grid">
        <div className="pl-stat"><span><Bi en="Population" /></span><b>{formatPop(pop)}</b></div>
        <div className="pl-stat" title="This world's output per year at current prices"><span><Bi en="GDP / yr" /></span><b>{formatIED(estimateWorldGdp(world) * TICKS_PER_YEAR, ownerRate)}</b></div>
        <div className="pl-stat" title="Share of this world's labour force without a job"><span><Bi en="Unemployment" /></span><b>{(unemployment * 100).toFixed(1)}%</b></div>
        <div className="pl-stat" title="District levels developed / the land this world has"><span><Bi en="Land used" /></span><b>{districtLevelsTotal(world)} / {landOfWorld(world)}</b></div>
        <div className="pl-stat"><span><Bi en="Buildings" /></span><b>{world.buildings.reduce((n, b) => n + b.level, 0)}</b></div>
        <div className="pl-stat"><span><Bi en="Queued" /></span><b>{world.constructionQueue.length}</b></div>
      </div>
    </div>
  )
}

// A group of identical buildings (same recipe) shown as one tile with a count.
