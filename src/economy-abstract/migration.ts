// Simple-mode migration, one month: the same rules as Complex (economy/migrationRules.ts) over the Simple economy's worlds, which have a
// population and jobs but no pops and no standard of living, so attraction is jobs, housing and safety (the standard-of-living term's
// weight is shared out in proportion) and people move as a bare headcount. Pure: scene/migrationSimple.ts feeds it the running game.
import { PUSH_TO_GAP, MAX_MONTHLY_SHARE, PEOPLE_PER_LAUNCH_UNIT, WAVE_PUSH, attractionOf, flowShare, pathVerdict, pushOf, DEFAULT_MIGRATION_LAWS, type MigrationFlow, type MigrationLaws } from '../economy/migrationRules'
import { migrationLane } from '../economy/migration'
import { worldJobs, worldWorkforce, type WorldState } from './abstractEconomy'

export interface AbstractMigrationOptions {
  ownerOf: (bodyName: string) => string | undefined
  laws: Record<string, MigrationLaws>
  treatyPairs: ReadonlySet<string>
  treatyQuota?: Record<string, number>
  atWar: (a: string, b: string) => boolean
  // Distress by body (war, occupation, bombardment).
  distress?: Record<string, number>
  // Surface-to-orbit capacity per body; absent = no cap.
  launchOf?: (bodyName: string) => number
}

export function stepAbstractMigration(worlds: readonly WorldState[], opts: AbstractMigrationOptions): { deltas: Record<string, number>; flows: MigrationFlow[] } {
  const deltas: Record<string, number> = {}
  const flows: MigrationFlow[] = []
  const lawsOf = (n: string): MigrationLaws => opts.laws[n] ?? DEFAULT_MIGRATION_LAWS
  const owned = worlds.filter((w) => !!opts.ownerOf(w.bodyName) && w.population > 0).sort((a, b) => (a.bodyName < b.bodyName ? -1 : 1))
  if (owned.length < 2) return { deltas, flows }
  const distressOf = (w: WorldState) => (opts.distress?.[w.bodyName] ?? 0) + (w.devastation ?? 0) * 0.5
  const attraction = (w: WorldState, encouraged: boolean) => {
    const workforce = worldWorkforce(w)
    return attractionOf({ standardOfLiving: null, vacancyRatio: workforce > 0 ? (worldJobs(w) - workforce) / workforce : 0, roomRatio: 1, safety: 1 - pushOf(distressOf(w)), cultureShare: 1, encouraged }).total
  }
  for (const src of owned) {
    const srcOwner = opts.ownerOf(src.bodyName)!
    const push = pushOf(distressOf(src))
    const here = attraction(src, false)
    const options: { dst: WorldState; gap: number; factor: number; reason: string }[] = []
    for (const dst of owned) {
      if (dst.bodyName === src.bodyName) continue
      const dstOwner = opts.ownerOf(dst.bodyName)!
      const verdict = pathVerdict({
        sameNation: dstOwner === srcOwner,
        immigration: lawsOf(dstOwner).immigration,
        emigration: lawsOf(srcOwner).emigration,
        treaty: opts.treatyPairs.has(migrationLane(srcOwner, dstOwner)),
        reach: true,
        atWar: opts.atWar(srcOwner, dstOwner),
      })
      // A controlled path takes only the qualified, which a bare headcount cannot tell apart: a fifth of the flow.
      if (!verdict.open) continue
      const gap = attraction(dst, lawsOf(dstOwner).immigration === 'encouraged') - here + push * PUSH_TO_GAP
      if (flowShare(gap) <= 0) continue
      options.push({ dst, gap, factor: verdict.factor * (verdict.qualifiedOnly ? 0.2 : 1), reason: verdict.reason })
    }
    options.sort((a, b) => b.gap - a.gap || (a.dst.bodyName < b.dst.bodyName ? -1 : 1))
    let budget = src.population * MAX_MONTHLY_SHARE
    for (const o of options) {
      if (budget <= 1e-9) break
      let amount = Math.min(budget, src.population * flowShare(o.gap)) * o.factor
      const launch = Math.min(opts.launchOf?.(src.bodyName) ?? Infinity, opts.launchOf?.(o.dst.bodyName) ?? Infinity)
      if (Number.isFinite(launch)) amount = Math.min(amount, launch * PEOPLE_PER_LAUNCH_UNIT)
      const dstOwner = opts.ownerOf(o.dst.bodyName)!
      const quota = srcOwner !== dstOwner ? opts.treatyQuota?.[migrationLane(srcOwner, dstOwner)] : undefined
      if (quota !== undefined) amount = Math.min(amount, quota)
      if (amount <= 1e-9) continue
      deltas[src.bodyName] = (deltas[src.bodyName] ?? 0) - amount
      deltas[o.dst.bodyName] = (deltas[o.dst.bodyName] ?? 0) + amount
      budget -= amount
      flows.push({ from: src.bodyName, to: o.dst.bodyName, amount, wave: push >= WAVE_PUSH, reason: o.reason })
    }
  }
  return { deltas, flows }
}
