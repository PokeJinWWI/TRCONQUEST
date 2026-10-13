// Migration rules shared by both economies (Victoria 3 style): every place has an ATTRACTION; people move, a small share a month, from
// where life is worse to where it is better, along PATHS that laws and treaties open or close. Pure and mode-free: the Complex engine
// (economy/migration.ts) and the Simple one (economy-abstract/migration.ts) read the same numbers, so the rules cannot drift apart.
//
//   Attraction = standard of living + job pull + housing + safety + culture acceptance   (Simple mode has no standard of living)
//   Three scales: between the settlements of one world (a display layer, scene/urban), between worlds of one nation (real movement,
//   capped by launch capacity at both ends), and between nations (needs the destination to allow it, the source not to forbid it, and a
//   path: open borders, a `migration` treaty article, a world to reach).

export type MigrationPolicy = 'closed' | 'controlled' | 'open' | 'encouraged'
export type EmigrationPolicy = 'free' | 'restricted' | 'forbidden'
export const MIGRATION_POLICIES: MigrationPolicy[] = ['closed', 'controlled', 'open', 'encouraged']
export const EMIGRATION_POLICIES: EmigrationPolicy[] = ['free', 'restricted', 'forbidden']

export interface PolicyDef<T extends string> {
  id: T
  name: string
  description: string
}

export const MIGRATION_POLICY_DEFS: Record<MigrationPolicy, PolicyDef<MigrationPolicy>> = {
  closed: { id: 'closed', name: 'Closed Borders', description: 'No one may settle here from abroad, except under a migration treaty.' },
  controlled: { id: 'controlled', name: 'Controlled Migration', description: 'Only the qualified (technical and professional pops) the nation needs may come.' },
  open: { id: 'open', name: 'Open Borders', description: 'Anyone may come, wherever they can reach.' },
  encouraged: { id: 'encouraged', name: 'Encouraged Migration', description: 'Open borders, and the nation recruits: its worlds are more attractive (it pays for that in influence).' },
}
export const EMIGRATION_POLICY_DEFS: Record<EmigrationPolicy, PolicyDef<EmigrationPolicy>> = {
  free: { id: 'free', name: 'Free Emigration', description: 'People may leave when they choose.' },
  restricted: { id: 'restricted', name: 'Restricted Emigration', description: 'Only a trickle may leave: the flow is cut to a fifth.' },
  forbidden: { id: 'forbidden', name: 'Emigration Forbidden', description: 'No one may leave.' },
}

// A nation's laws, absent = the default. Existing nations start CLOSED so the calibrated start is untouched; the player may open them.
export interface MigrationLaws {
  immigration: MigrationPolicy
  emigration: EmigrationPolicy
}
export const DEFAULT_MIGRATION_LAWS: MigrationLaws = { immigration: 'closed', emigration: 'free' }

// ---- tuning -----------------------------------------------------------------
// At most this share of a world's people leaves it in a month (the guardrail), whatever the pull.
export const MAX_MONTHLY_SHARE = 0.005
// Attraction gap (0..1 scale) below which nobody moves, and the share of the cap a gap of 1 would give.
export const MIN_ATTRACTION_GAP = 0.04
export const SHARE_PER_GAP = 0.02
// Weights of the attraction terms (sum to 1).
export const ATTRACTION_WEIGHTS = { sol: 0.35, jobs: 0.25, housing: 0.15, safety: 0.15, culture: 0.1 } as const
// An encouraging nation's bonus to its own attraction.
export const ENCOURAGED_BONUS = 0.08
// Restricted emigration lets this share of the flow through.
export const RESTRICTED_EMIGRATION_FACTOR = 0.2
// People (millions) a unit of launch capacity moves between bodies in a month (launch capacity is in transport units: economy/transport).
export const PEOPLE_PER_LAUNCH_UNIT = 0.0002
// Distress (war, occupation, famine, displacement) adds to the pull of leaving, up to this much of the attraction scale.
export const MAX_PUSH = 0.5
// How much of the push counts toward the gap that moves people (a refugee leaves even for a worse place).
export const PUSH_TO_GAP = 1
// A push at or above this makes a flow a WAVE (a refugee burst: an event).
export const WAVE_PUSH = 0.25
// ...and is announced once it is at least this many millions of people in a month.
export const WAVE_EVENT_MIN_MILLIONS = 0.05
// The qualified classes a controlled policy lets in.
export const QUALIFIED_CLASSES: readonly string[] = ['technical', 'professional']
// A settlement founded in play fills over this many days (scene/urban: the display layer of internal migration).
export const SETTLEMENT_FILL_DAYS = 3650

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x))

export interface AttractionInput {
  // Mean standard of living 0..1; null in Simple mode (no such score).
  standardOfLiving: number | null
  // Jobs posted against people looking for work: (jobs - workers) / workers, any real number (more jobs than hands is positive).
  vacancyRatio: number
  // Room against people: capacity / population, any real number.
  roomRatio: number
  // Peace at home 0..1 (1 = nothing wrong).
  safety: number
  // Share (0..1) of the destination's people who are of the mover's culture.
  cultureShare: number
  encouraged: boolean
}

export interface Attraction {
  total: number
  terms: { sol: number | null; jobs: number; housing: number; safety: number; culture: number }
}

export function attractionOf(input: AttractionInput): Attraction {
  const jobs = clamp01(0.5 + 0.5 * Math.max(-1, Math.min(1, input.vacancyRatio)))
  const housing = clamp01(input.roomRatio)
  const safety = clamp01(input.safety)
  const culture = clamp01(input.cultureShare)
  const w = ATTRACTION_WEIGHTS
  // Simple mode has no standard of living: its weight goes to the other terms in proportion.
  const sol = input.standardOfLiving === null ? null : clamp01(input.standardOfLiving)
  const rest = w.jobs + w.housing + w.safety + w.culture
  const total =
    sol === null
      ? ((w.jobs * jobs + w.housing * housing + w.safety * safety + w.culture * culture) / rest) + (input.encouraged ? ENCOURAGED_BONUS : 0)
      : w.sol * sol + w.jobs * jobs + w.housing * housing + w.safety * safety + w.culture * culture + (input.encouraged ? ENCOURAGED_BONUS : 0)
  return { total, terms: { sol, jobs, housing, safety, culture } }
}

// The pull of leaving a place in distress: grows with the distress, capped.
export const pushOf = (distress: number): number => Math.max(0, Math.min(MAX_PUSH, distress))

export interface PathInput {
  sameNation: boolean
  // The destination nation's immigration law, and the source nation's emigration law.
  immigration: MigrationPolicy
  emigration: EmigrationPolicy
  // A `migration` treaty article between the two nations opens the path.
  treaty: boolean
  // The two worlds can reach each other (the same trade group) and the nations are not at war.
  reach: boolean
  atWar: boolean
}

export interface PathVerdict {
  open: boolean
  // Only the qualified classes may use it.
  qualifiedOnly: boolean
  // Multiplier on the flow (restricted emigration).
  factor: number
  reason: string
}

export function pathVerdict(p: PathInput): PathVerdict {
  if (p.sameNation) return { open: true, qualifiedOnly: false, factor: 1, reason: 'within one nation' }
  if (p.atWar) return { open: false, qualifiedOnly: false, factor: 0, reason: 'the nations are at war' }
  if (!p.reach) return { open: false, qualifiedOnly: false, factor: 0, reason: 'no way to reach' }
  if (p.emigration === 'forbidden' && !p.treaty) return { open: false, qualifiedOnly: false, factor: 0, reason: 'the source forbids emigration' }
  const factor = p.emigration === 'restricted' ? RESTRICTED_EMIGRATION_FACTOR : 1
  if (p.treaty) return { open: true, qualifiedOnly: false, factor, reason: 'a migration treaty' }
  if (p.immigration === 'closed') return { open: false, qualifiedOnly: false, factor: 0, reason: 'the destination has closed borders' }
  return { open: true, qualifiedOnly: p.immigration === 'controlled', factor, reason: p.immigration === 'controlled' ? 'controlled migration (the qualified only)' : 'open borders' }
}

// The share of the source's people that moves in a month, given the gap in attraction (destination minus source, push included).
export const flowShare = (gap: number): number => (gap <= MIN_ATTRACTION_GAP ? 0 : Math.min(MAX_MONTHLY_SHARE, gap * SHARE_PER_GAP))

export interface MigrationFlow {
  from: string
  to: string
  // Millions of people this month.
  amount: number
  // A refugee burst: the source is in distress.
  wave: boolean
  reason: string
}
