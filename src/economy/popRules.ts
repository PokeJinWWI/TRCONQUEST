// Shared pure rules for pops, used by BOTH economies (the Complex tick in economyTick.ts, the Simple tick in
// economy-abstract/abstractEconomy.ts) so they cannot disagree, the way migrationRules.ts is shared. No store, no React.
//
// A pop is split into a WORKFORCE (staffs jobs, earns wages or dividends, pays tax) and DEPENDENTS (children, the elderly, carers: no formal
// job, half a worker's needs). A pop belongs to a social STRATUM through its class (profession). Everything here is NEUTRAL at the default
// laws: a pop at the reference workforce share behaves exactly as before the split existed, and laws, wars and plagues move it from there.
import type { PopClass } from './recipes'

// ---- social strata ----------------------------------------------------------------------------------------------------------

export type SocialStratum = 'lower' | 'middle' | 'upper'
export const SOCIAL_STRATA: SocialStratum[] = ['lower', 'middle', 'upper']
export const SOCIAL_STRATUM_LABEL: Record<SocialStratum, string> = { lower: 'Lower class', middle: 'Middle class', upper: 'Upper class' }
export const SOCIAL_STRATUM_BLURB: Record<SocialStratum, string> = {
  lower: 'Subsistence people and labourers: farms, mines, the line. The most numerous, the least wealthy.',
  middle: 'Technicians and professionals: skilled work that needs schooling.',
  upper: 'Investors and the political class: owners and administrators.',
}
// The profession (class) of each stratum, lowest first.
export const STRATUM_OF: Record<PopClass, SocialStratum> = {
  subsistence: 'lower',
  labor: 'lower',
  technical: 'middle',
  professional: 'middle',
  investor: 'upper',
  political: 'upper',
}
export const CLASSES_OF_STRATUM: Record<SocialStratum, PopClass[]> = {
  lower: ['subsistence', 'labor'],
  middle: ['technical', 'professional'],
  upper: ['investor', 'political'],
}

// ---- workforce and dependents -----------------------------------------------------------------------------------------------

// The share of a pop that is workforce when nothing has been legislated (Simple mode's long-standing constant).
export const REFERENCE_WORKFORCE_SHARE = 0.42
// A dependent needs this share of what a worker does.
export const DEPENDENT_NEED_FACTOR = 0.5
// How far a pop's share moves toward its ideal each month (a share of the remaining gap), and the smallest step it takes.
export const WORKFORCE_DRIFT_RATE = 0.06
export const WORKFORCE_DRIFT_MIN_STEP = 0.0015
export const MIN_WORKFORCE_SHARE = 0.15
export const MAX_WORKFORCE_SHARE = 0.7

export type WomenRights = 'traditional' | 'standard' | 'equal'
export type ChildLabour = 'banned' | 'restricted' | 'allowed'
export type Retirement = 'early' | 'standard' | 'late'
export type EducationLaw = 'basic' | 'religious' | 'public'
export type CitizenshipLaw = 'assimilationist' | 'standard' | 'multicultural'
export interface PopLaws {
  womenRights: WomenRights
  childLabour: ChildLabour
  retirement: Retirement
  education: EducationLaw
  // How a nation treats cultures other than its own (economy/acceptance.ts).
  citizenship: CitizenshipLaw
}
// The defaults reproduce the reference share exactly (every modifier below is 0 for them).
export const DEFAULT_POP_LAWS: PopLaws = { womenRights: 'standard', childLabour: 'restricted', retirement: 'standard', education: 'basic', citizenship: 'standard' }

export const POP_LAW_OPTIONS: { key: keyof PopLaws; label: string; blurb: string; options: { value: string; label: string; blurb: string }[] }[] = [
  {
    key: 'womenRights',
    label: 'Rights of women',
    blurb: 'How many women may work outside the home.',
    options: [
      { value: 'traditional', label: 'Traditional roles', blurb: 'Most women keep house: fewer people in the workforce.' },
      { value: 'standard', label: 'Standard', blurb: 'The reference workforce.' },
      { value: 'equal', label: 'Equal rights', blurb: 'Women work on equal terms: up to 12 points more of the people are in the workforce.' },
    ],
  },
  {
    key: 'childLabour',
    label: 'Child labour',
    blurb: 'Whether children may work. Mostly the lower classes send them.',
    options: [
      { value: 'banned', label: 'Banned', blurb: 'Children stay in school: a smaller workforce, higher literacy.' },
      { value: 'restricted', label: 'Restricted', blurb: 'The reference workforce.' },
      { value: 'allowed', label: 'Allowed', blurb: 'Children work: a larger lower-class workforce, lower literacy.' },
    ],
  },
  {
    key: 'education',
    label: 'Schooling',
    blurb: 'Who runs the schools. It sets how literate people can become, on top of the schools themselves.',
    options: [
      { value: 'basic', label: 'Basic schooling', blurb: 'The reference: literacy follows living standards and the schools you build.' },
      { value: 'religious', label: 'Religious schools', blurb: 'Faith-run schools: a little more literacy, and faiths spread faster.' },
      { value: 'public', label: 'Public schools', blurb: 'State-run schooling: more literacy everywhere.' },
    ],
  },
  {
    key: 'citizenship',
    label: 'Cultural policy',
    blurb: 'How people of other cultures are treated. It sets how accepted they are, and so how fast they assimilate.',
    options: [
      { value: 'assimilationist', label: 'Assimilation', blurb: 'One national culture: others are accepted little and assimilate faster.' },
      { value: 'standard', label: 'Standard', blurb: 'Other cultures are tolerated at a distance.' },
      { value: 'multicultural', label: 'Multiculturalism', blurb: 'Every culture is welcome: full acceptance, little assimilation.' },
    ],
  },
  {
    key: 'retirement',
    label: 'Retirement age',
    blurb: 'How long people work before they depend on others.',
    options: [
      { value: 'early', label: 'Early', blurb: 'More elderly dependents.' },
      { value: 'standard', label: 'Standard', blurb: 'The reference workforce.' },
      { value: 'late', label: 'Late', blurb: 'The old keep working: a larger workforce.' },
    ],
  },
]

const WOMEN_SHARE: Record<WomenRights, number> = { traditional: -0.06, standard: 0, equal: 0.12 }
const RETIRE_SHARE: Record<Retirement, number> = { early: -0.03, standard: 0, late: 0.03 }
// Child labour mostly moves the lower strata; the upper strata keep their children in school either way.
const CHILD_SHARE: Record<ChildLabour, Record<SocialStratum, number>> = {
  banned: { lower: -0.04, middle: -0.01, upper: 0 },
  restricted: { lower: 0, middle: 0, upper: 0 },
  allowed: { lower: 0.07, middle: 0.02, upper: 0 },
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

export function popLawsOrDefault(laws: Partial<PopLaws> | undefined): PopLaws {
  return { ...DEFAULT_POP_LAWS, ...(laws ?? {}) }
}

// The workforce share a stratum settles at under these laws.
export function idealWorkforceShare(laws: Partial<PopLaws> | undefined, stratum: SocialStratum): number {
  const l = popLawsOrDefault(laws)
  return clamp(REFERENCE_WORKFORCE_SHARE + WOMEN_SHARE[l.womenRights] + RETIRE_SHARE[l.retirement] + CHILD_SHARE[l.childLabour][stratum], MIN_WORKFORCE_SHARE, MAX_WORKFORCE_SHARE)
}

// One month's move of a pop's share toward its ideal.
export function driftWorkforceShare(current: number, ideal: number): number {
  const gap = ideal - current
  if (Math.abs(gap) < 1e-9) return current
  const step = Math.max(Math.abs(gap) * WORKFORCE_DRIFT_RATE, WORKFORCE_DRIFT_MIN_STEP)
  return Math.abs(gap) <= step ? ideal : current + Math.sign(gap) * step
}

export const workforceShareOf = (pop: { workforceShare?: number }): number => pop.workforceShare ?? REFERENCE_WORKFORCE_SHARE
export const workforceOf = (pop: { populationSize: number; workforceShare?: number }): number => pop.populationSize * workforceShareOf(pop)
export const dependentsOf = (pop: { populationSize: number; workforceShare?: number }): number => pop.populationSize - workforceOf(pop)

// How much labour a person of this share supplies compared with the reference (1 at the reference).
export const labourFactor = (share: number): number => share / REFERENCE_WORKFORCE_SHARE
// How much a person's needs weigh compared with the reference mix of workers and dependents (1 at the reference).
const needWeight = (share: number): number => share + (1 - share) * DEPENDENT_NEED_FACTOR
export const needsFactor = (share: number): number => needWeight(share) / needWeight(REFERENCE_WORKFORCE_SHARE)

// A nation-wide ideal for Simple mode, which has no classes: the strata weighted by how many people each holds in a typical nation.
const STRATUM_WEIGHT: Record<SocialStratum, number> = { lower: 0.65, middle: 0.3, upper: 0.05 }
export function nationIdealWorkforceShare(laws: Partial<PopLaws> | undefined): number {
  return SOCIAL_STRATA.reduce((n, st) => n + STRATUM_WEIGHT[st] * idealWorkforceShare(laws, st), 0)
}

// ---- literacy and education access ---------------------------------------------------------------------------------------------
//
// A pop's literacy (Pop.educationLevel) moves toward its EDUCATION ACCESS: living standards set the base (the better people live the more
// schooling they reach), schools built beyond what the world started with raise it, and the laws add or take a little. At the default laws,
// with the schools the world started with, access is exactly the standard of living: what the economy always did.
export const SCHOOL_COVERAGE_GAIN = 0.05 // access gained per extra school level per billion people
export const SCHOOL_LEVEL_WEIGHT: Record<string, number> = { school: 1, university: 2 }
const EDUCATION_LAW_ACCESS: Record<EducationLaw, number> = { basic: 0, religious: 0.03, public: 0.08 }
const CHILD_LABOUR_ACCESS: Record<ChildLabour, number> = { banned: 0.03, restricted: 0, allowed: -0.05 }
export const MAX_LITERACY = 0.98

// Schooling a world has: weighted school and university levels per billion people (people in millions).
export function schoolCoverage(buildings: readonly { recipeId: string; level: number }[], populationMillions: number): number {
  let levels = 0
  for (const b of buildings) levels += (SCHOOL_LEVEL_WEIGHT[b.recipeId] ?? 0) * b.level
  return levels / Math.max(1, populationMillions / 1000)
}

export function educationAccess(standardOfLiving: number, coverageAboveStart: number, laws: Partial<PopLaws> | undefined): number {
  const l = popLawsOrDefault(laws)
  return clamp(standardOfLiving + SCHOOL_COVERAGE_GAIN * coverageAboveStart + EDUCATION_LAW_ACCESS[l.education] + CHILD_LABOUR_ACCESS[l.childLabour], 0, MAX_LITERACY)
}

// Simple mode has no pops to carry literacy, so the nation has one number: it moves toward the reference plus what the laws allow, and
// scales its research (neutral at the reference).
export const REFERENCE_LITERACY = 0.6
export const LITERACY_DRIFT_RATE = 0.012
export const LITERACY_RESEARCH_GAIN = 0.5
export function nationLiteracyTarget(laws: Partial<PopLaws> | undefined): number {
  const l = popLawsOrDefault(laws)
  return clamp(REFERENCE_LITERACY + EDUCATION_LAW_ACCESS[l.education] + CHILD_LABOUR_ACCESS[l.childLabour], 0, MAX_LITERACY)
}
export const literacyResearchFactor = (literacy: number | undefined): number => 1 + LITERACY_RESEARCH_GAIN * ((literacy ?? REFERENCE_LITERACY) - REFERENCE_LITERACY)

// ---- birth and mortality -----------------------------------------------------------------------------------------------------------------
//
// A pop's net growth (births minus deaths), unchanged from before the split. Mortality falls steeply with the standard of living; births are
// what makes up the difference, so net growth is exactly GROWTH_RATE x (SoL - GROWTH_MIDPOINT) x 2 (x the room left, once above the
// midpoint): births slow as a world fills, and a dying world loses people to mortality faster than it makes them.
export const GROWTH_RATE = 0.0016
export const GROWTH_MIDPOINT = 0.35
export const MORTALITY_AT_ZERO_SOL = 0.0046 // a month's mortality at a standard of living of 0
export const MORTALITY_EXPONENT = 1.2
export interface BirthMortality {
  birth: number
  mortality: number
  net: number
}
export function birthMortality(standardOfLiving: number, headroom: number): BirthMortality {
  const sol = clamp(standardOfLiving, 0, 1)
  const mortality = MORTALITY_AT_ZERO_SOL * Math.pow(1 - sol, MORTALITY_EXPONENT)
  const net = GROWTH_RATE * (standardOfLiving - GROWTH_MIDPOINT) * 2 * (standardOfLiving >= GROWTH_MIDPOINT ? headroom : 1)
  return { birth: mortality + net, mortality, net }
}
