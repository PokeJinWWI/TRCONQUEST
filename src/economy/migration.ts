// Complex-mode migration, one month: pure, run in the economy pipeline after each tick (economy/economyStep.ts), so it lives in the
// worker with its inputs passed in (policies, treaty pairs, distress) and reads no store. Rules are economy/migrationRules.ts.
//
// For every ordered pair of worlds (source, destination) with an open path and a destination more attractive than the source (distress
// at the source counts as a push), a small share of the source's people moves: it leaves the source's pops in proportion and joins the
// destination's matching pop (same class, species, culture, religion) or founds one, taking its wealth along. A source never sends more
// than MAX_MONTHLY_SHARE of its people in a month, between bodies a move is capped by launch capacity at both ends, and a treaty may
// set a quota.
import {
  PUSH_TO_GAP,
  DEFAULT_MIGRATION_LAWS,
  MAX_MONTHLY_SHARE,
  PEOPLE_PER_LAUNCH_UNIT,
  QUALIFIED_CLASSES,
  WAVE_PUSH,
  attractionOf,
  flowShare,
  pathVerdict,
  pushOf,
  type Attraction,
  type MigrationFlow,
  type MigrationLaws,
} from './migrationRules'
import type { Pop, World, WorldReport } from './economyTypes'

export interface MigrationOptions {
  laws: Record<string, MigrationLaws>
  // Directed pairs ('from>to', see migrationLane) that a migration treaty opens, with an optional monthly quota (millions) per lane.
  treatyPairs: ReadonlySet<string>
  treatyQuota?: Record<string, number>
  atWar: (a: string, b: string) => boolean
  canReach: (a: string, b: string) => boolean
  // Distress by world id (0 = none): war, occupation, famine, displacement. Added to the push of leaving.
  distress?: Record<string, number>
  // Launch capacity per world id (surface to orbit): the cap on moving people between bodies.
  launch?: Record<string, number>
  reports?: Record<string, WorldReport>
}

export interface MigrationResult {
  worlds: World[]
  flows: MigrationFlow[]
}

// One direction of a migration treaty: people moving from nation `from` to nation `to`.
export const migrationLane = (from: string, to: string): string => `${from}>${to}`
const popTotal = (w: World): number => w.pops.reduce((n, p) => n + p.populationSize, 0)

function meanSoL(w: World): number {
  const total = popTotal(w)
  return total > 0 ? w.pops.reduce((n, p) => n + p.standardOfLiving * p.populationSize, 0) / total : 0.5
}

// Jobs against hands, from the last tick's report: (posted jobs - workers) / workers, summed over the classes that work for wages.
function vacancyRatio(report: WorldReport | undefined): number {
  if (!report) return 0
  let jobs = 0
  let workers = 0
  for (const [cls, l] of Object.entries(report.labor)) {
    if (cls === 'investor' || cls === 'subsistence') continue
    jobs += l.jobs
    workers += l.workers
  }
  return workers > 0 ? (jobs - workers * 1) / workers : 0
}

export function attractionOfWorld(w: World, report: WorldReport | undefined, distress: number, cultureId: string, encouraged: boolean): Attraction {
  const total = popTotal(w)
  const sameCulture = total > 0 ? w.pops.filter((p) => p.cultureId === cultureId).reduce((n, p) => n + p.populationSize, 0) / total : 0
  return attractionOf({
    standardOfLiving: meanSoL(w),
    vacancyRatio: vacancyRatio(report),
    roomRatio: total > 0 ? w.populationCapacity / total : 1,
    safety: 1 - pushOf(distress),
    cultureShare: sameCulture,
    encouraged,
  })
}

// Distress at home: what the caller passes (war, occupation) plus famine (a standard of living in the gutter) and displacement.
export const FAMINE_SOL = 0.25
export const FAMINE_DISTRESS = 0.3
export const DISPLACEMENT_DISTRESS_PER_POINT = 0.02
export function distressOf(w: World, given: number): number {
  return given + (meanSoL(w) < FAMINE_SOL ? FAMINE_DISTRESS : 0) + (w.displacedUnrest ?? 0) * DISPLACEMENT_DISTRESS_PER_POINT + (w.devastation ?? 0) * 0.5
}

const keyOf = (p: Pop) => `${p.class}|${p.speciesTemplateId}|${p.cultureId}|${p.religionId}`

function mergeInto(dest: Pop[], moving: Pop, amount: number, wealth: number, destId: string): Pop[] {
  const i = dest.findIndex((p) => keyOf(p) === keyOf(moving))
  if (i >= 0) {
    const d = dest[i]
    const size = d.populationSize + amount
    const w = (x: number, y: number) => (d.populationSize * x + amount * y) / size
    const merged: Pop = {
      ...d,
      populationSize: size,
      wealth: d.wealth + wealth,
      educationLevel: w(d.educationLevel, moving.educationLevel),
      standardOfLiving: w(d.standardOfLiving, moving.standardOfLiving),
      needsSatisfaction: Object.fromEntries(Object.keys(d.needsSatisfaction).map((t) => [t, w(d.needsSatisfaction[t as keyof typeof d.needsSatisfaction], moving.needsSatisfaction[t as keyof typeof d.needsSatisfaction])])) as Pop['needsSatisfaction'],
    }
    return dest.map((p, k) => (k === i ? merged : p))
  }
  // A new pop in the destination: the incomers keep the standard of living they arrive with, which the next tick then moves.
  return [...dest, { ...moving, id: `${destId}:m:${keyOf(moving)}`, populationSize: amount, wealth }]
}

export function stepMigration(worlds: World[], opts: MigrationOptions): MigrationResult {
  if (worlds.length < 2) return { worlds, flows: [] }
  const lawsOf = (nation: string): MigrationLaws => opts.laws[nation] ?? DEFAULT_MIGRATION_LAWS
  const next = new Map(worlds.map((w) => [w.id, { ...w, pops: w.pops.map((p) => ({ ...p })) }]))
  const flows: MigrationFlow[] = []
  const sorted = [...worlds].sort((a, b) => (a.id < b.id ? -1 : 1))
  for (const src of sorted) {
    const total = popTotal(src)
    if (total <= 0) continue
    const distress = distressOf(src, opts.distress?.[src.id] ?? 0)
    const push = pushOf(distress)
    const srcLaws = lawsOf(src.ownerId)
    // Where would its people rather be? Best first.
    const options: { dst: World; gap: number; qualifiedOnly: boolean; factor: number; reason: string }[] = []
    for (const dst of sorted) {
      if (dst.id === src.id || popTotal(dst) <= 0) continue
      const verdict = pathVerdict({
        sameNation: dst.ownerId === src.ownerId,
        immigration: lawsOf(dst.ownerId).immigration,
        emigration: srcLaws.emigration,
        treaty: opts.treatyPairs.has(migrationLane(src.ownerId, dst.ownerId)),
        reach: dst.ownerId === src.ownerId || opts.canReach(src.ownerId, dst.ownerId),
        atWar: opts.atWar(src.ownerId, dst.ownerId),
      })
      if (!verdict.open) continue
      // The movers' culture is the source's main one; the attraction of staying is judged at home with the same eyes.
      const culture = src.pops.slice().sort((a, b) => b.populationSize - a.populationSize)[0]?.cultureId ?? src.cultureId
      const here = attractionOfWorld(src, opts.reports?.[src.id], 0, culture, false).total
      const there = attractionOfWorld(dst, opts.reports?.[dst.id], distressOf(dst, opts.distress?.[dst.id] ?? 0), culture, lawsOf(dst.ownerId).immigration === 'encouraged').total
      const gap = there - here + push * PUSH_TO_GAP
      if (flowShare(gap) <= 0) continue
      options.push({ dst, gap, qualifiedOnly: verdict.qualifiedOnly, factor: verdict.factor, reason: verdict.reason })
    }
    options.sort((a, b) => b.gap - a.gap || (a.dst.id < b.dst.id ? -1 : 1))
    let budget = total * MAX_MONTHLY_SHARE
    for (const o of options) {
      if (budget <= 1e-9) break
      let amount = Math.min(budget, total * flowShare(o.gap)) * o.factor
      // Between bodies, launch capacity at both ends is the bottleneck.
      const launch = Math.min(opts.launch?.[src.id] ?? Infinity, opts.launch?.[o.dst.id] ?? Infinity)
      if (Number.isFinite(launch)) amount = Math.min(amount, launch * PEOPLE_PER_LAUNCH_UNIT)
      const quota = opts.treatyQuota?.[migrationLane(src.ownerId, o.dst.ownerId)]
      if (src.ownerId !== o.dst.ownerId && quota !== undefined) amount = Math.min(amount, quota)
      // Only those who may go: a controlled path takes the qualified classes.
      const current = next.get(src.id)!
      const eligible = current.pops.filter((p) => !o.qualifiedOnly || QUALIFIED_CLASSES.includes(p.class))
      const eligibleTotal = eligible.reduce((n, p) => n + p.populationSize, 0)
      if (eligibleTotal <= 0 || amount <= 1e-9) continue
      amount = Math.min(amount, eligibleTotal * 0.5)
      let moved = 0
      let destPops = next.get(o.dst.id)!.pops
      const srcPops = current.pops.map((p) => {
        if (!eligible.includes(p)) return p
        const take = amount * (p.populationSize / eligibleTotal)
        if (take <= 0) return p
        const wealth = p.populationSize > 0 ? p.wealth * (take / p.populationSize) : 0
        destPops = mergeInto(destPops, p, take, wealth, o.dst.id)
        moved += take
        return { ...p, populationSize: p.populationSize - take, wealth: p.wealth - wealth }
      })
      next.set(src.id, { ...current, pops: srcPops })
      next.set(o.dst.id, { ...next.get(o.dst.id)!, pops: destPops })
      budget -= moved
      if (moved > 0) flows.push({ from: src.id, to: o.dst.id, amount: moved, wave: push >= WAVE_PUSH, reason: o.reason })
    }
  }
  return { worlds: worlds.map((w) => next.get(w.id) ?? w), flows }
}
