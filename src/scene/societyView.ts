// The Society menu as plain data, for BOTH economies (docs/territorial-design.md has the same pattern for buildings): the nation's people
// by social stratum and class, its pops, its politics, its cultures and religions. Complex reads real pops; Simple has no pops, so it reads
// its strata, workforce and nation-wide literacy and says what it cannot know (it never invents a culture or a class it does not model).
// Pure: callers pass the data in.
import { ACCEPTANCE_LABEL, STATUS_CLOUT, acceptanceOf, assimilationRate, conversionRate, nationCultureOf, statusOfScore, acceptanceScore, type AcceptanceStatus, type NationCulture } from '../economy/acceptance'
import { CULTURES, RELIGIONS } from '../economy/demographics'
import type { Pop } from '../economy/economyTypes'
import { INTEREST_GROUPS } from '../economy/politics'
import { loyalistShare, politicalStrength, radicalShare, simpleLoyalists, simpleRadicals, turmoilOf, wealthLevel } from '../economy/popPolitics'
import { CLASSES_OF_STRATUM, SOCIAL_STRATA, SOCIAL_STRATUM_BLURB, SOCIAL_STRATUM_LABEL, STRATUM_OF, dependentsOf, popLawsOrDefault, workforceOf, type PopLaws, type SocialStratum } from '../economy/popRules'
import { birthMortality } from '../economy/popRules'
import type { PopClass } from '../economy/recipes'

export interface Mood {
  loyalists: number
  neutral: number
  radicals: number
}

export interface ClassRow {
  cls: PopClass
  population: number
  workforce: number
  dependents: number
  wealthPerPerson: number
  wealthLevel: number
  literacy: number
  sol: number
  mood: Mood
}

export interface StratumView {
  stratum: SocialStratum
  label: string
  blurb: string
  population: number
  // Share of the nation's people.
  share: number
  workforce: number
  dependents: number
  // Wealth (Complex only; null in Simple) and its share of the nation's.
  wealth: number | null
  wealthShare: number | null
  literacy: number | null
  sol: number | null
  // Share of the nation's political strength.
  strengthShare: number | null
  mood: Mood
  classes: ClassRow[]
}

export interface SocietyView {
  mode: 'complex' | 'simple'
  population: number
  workforce: number
  dependents: number
  strata: StratumView[]
  literacy: number
  // Share of the nation's people who are radicals.
  turmoil: number
  // Wealth held by the upper stratum (null in Simple): a plain measure of inequality.
  topWealthShare: number | null
  // Birth and death per year, per thousand people (Complex only).
  birthPerThousand: number | null
  deathPerThousand: number | null
}

const sum = <T,>(xs: readonly T[], f: (x: T) => number) => xs.reduce((n, x) => n + f(x), 0)
const wavg = <T,>(xs: readonly T[], w: (x: T) => number, f: (x: T) => number) => {
  const total = sum(xs, w)
  return total > 0 ? sum(xs, (x) => w(x) * f(x)) / total : 0
}
const moodOf = (pops: readonly Pop[]): Mood => {
  const total = sum(pops, (p) => p.populationSize)
  if (total <= 0) return { loyalists: 0, neutral: 1, radicals: 0 }
  const loyalists = sum(pops, (p) => p.populationSize * loyalistShare(p)) / total
  const radicals = sum(pops, (p) => p.populationSize * radicalShare(p)) / total
  return { loyalists, neutral: Math.max(0, 1 - loyalists - radicals), radicals }
}

export function societyViewComplex(pops: readonly Pop[], nation: NationCulture, laws: Partial<PopLaws> | undefined): SocietyView {
  const population = sum(pops, (p) => p.populationSize)
  const accept = (p: Pop) => STATUS_CLOUT[acceptanceOf(p.cultureId, nation, laws)]
  const totalWealth = sum(pops, (p) => p.wealth)
  const totalStrength = sum(pops, (p) => politicalStrength(p, accept(p)))
  const strata: StratumView[] = SOCIAL_STRATA.map((stratum) => {
    const members = pops.filter((p) => STRATUM_OF[p.class] === stratum)
    const classes: ClassRow[] = CLASSES_OF_STRATUM[stratum].map((cls) => {
      const c = members.filter((p) => p.class === cls)
      const size = sum(c, (p) => p.populationSize)
      return {
        cls,
        population: size,
        workforce: sum(c, workforceOf),
        dependents: sum(c, dependentsOf),
        wealthPerPerson: size > 0 ? sum(c, (p) => p.wealth) / size : 0,
        wealthLevel: wealthLevel(sum(c, (p) => p.wealth), size),
        literacy: wavg(c, (p) => p.populationSize, (p) => p.educationLevel),
        sol: wavg(c, (p) => p.populationSize, (p) => p.standardOfLiving),
        mood: moodOf(c),
      }
    })
    const size = sum(members, (p) => p.populationSize)
    const wealth = sum(members, (p) => p.wealth)
    return {
      stratum,
      label: SOCIAL_STRATUM_LABEL[stratum],
      blurb: SOCIAL_STRATUM_BLURB[stratum],
      population: size,
      share: population > 0 ? size / population : 0,
      workforce: sum(members, workforceOf),
      dependents: sum(members, dependentsOf),
      wealth,
      wealthShare: totalWealth > 0 ? wealth / totalWealth : 0,
      literacy: wavg(members, (p) => p.populationSize, (p) => p.educationLevel),
      sol: wavg(members, (p) => p.populationSize, (p) => p.standardOfLiving),
      strengthShare: totalStrength > 0 ? sum(members, (p) => politicalStrength(p, accept(p))) / totalStrength : 0,
      mood: moodOf(members),
      classes: classes.filter((c) => c.population > 0),
    }
  }).filter((s) => s.population > 0)
  const vitals = pops.map((p) => ({ w: p.populationSize, ...birthMortality(p.standardOfLiving, 1) }))
  return {
    mode: 'complex',
    population,
    workforce: sum(pops, workforceOf),
    dependents: sum(pops, dependentsOf),
    strata,
    literacy: wavg(pops, (p) => p.populationSize, (p) => p.educationLevel),
    turmoil: turmoilOf(pops),
    topWealthShare: strata.find((s) => s.stratum === 'upper')?.wealthShare ?? 0,
    birthPerThousand: population > 0 ? (sum(vitals, (v) => v.w * v.birth) / population) * 12 * 1000 : 0,
    deathPerThousand: population > 0 ? (sum(vitals, (v) => v.w * v.mortality) / population) * 12 * 1000 : 0,
  }
}

// Simple: its three strata (workers, specialists, the unemployed) read as lower, middle (specialists) and lower (no job); no wealth, no
// upper stratum, no classes.
export interface SimpleStratumInput {
  workers: { population: number; happiness: number }
  specialists: { population: number; happiness: number }
  unemployed: { population: number; happiness: number }
}
export function societyViewSimple(input: { population: number; workforce: number; literacy: number; strata: SimpleStratumInput; approval?: number; growthPerYear?: number }): SocietyView {
  const { workers, specialists, unemployed } = input.strata
  const lowerPop = workers.population + unemployed.population
  const moodOfHappiness = (h: number): Mood => {
    const radicals = simpleRadicals(h)
    const loyalists = simpleLoyalists(h)
    return { loyalists, radicals, neutral: Math.max(0, 1 - loyalists - radicals) }
  }
  const lowerMood = (() => {
    const a = moodOfHappiness(workers.happiness)
    const b = moodOfHappiness(unemployed.happiness)
    const t = lowerPop || 1
    return { loyalists: (a.loyalists * workers.population + b.loyalists * unemployed.population) / t, radicals: (a.radicals * workers.population + b.radicals * unemployed.population) / t, neutral: (a.neutral * workers.population + b.neutral * unemployed.population) / t }
  })()
  const mk = (stratum: SocialStratum, population: number, mood: Mood): StratumView => ({
    stratum, label: SOCIAL_STRATUM_LABEL[stratum], blurb: SOCIAL_STRATUM_BLURB[stratum], population, share: input.population > 0 ? population / input.population : 0,
    workforce: input.population > 0 ? (input.workforce * population) / input.population : 0,
    dependents: input.population > 0 ? population - (input.workforce * population) / input.population : 0,
    wealth: null, wealthShare: null, literacy: input.literacy, sol: null, strengthShare: null, mood, classes: [],
  })
  const strata = [mk('lower', lowerPop, lowerMood), mk('middle', specialists.population, moodOfHappiness(specialists.happiness))].filter((s) => s.population > 0)
  const turmoil = input.population > 0 ? sum(strata, (s) => s.population * s.mood.radicals) / input.population : 0
  // Simple has one growth figure; read as births and deaths it splits the way Complex's do (mortality falls steeply with how content people are).
  const vitals = input.approval !== undefined && input.growthPerYear !== undefined ? simpleBirthsAndDeaths(input.approval, input.growthPerYear) : null
  return { mode: 'simple', population: input.population, workforce: input.workforce, dependents: Math.max(0, input.population - input.workforce), strata, literacy: input.literacy, turmoil, topWealthShare: null, birthPerThousand: vitals?.birth ?? null, deathPerThousand: vitals?.death ?? null }
}

// Births and deaths per thousand a year from Simple's single yearly growth: mortality as in Complex (by how content people are), births the rest.
export function simpleBirthsAndDeaths(approval: number, growthPerYear: number): { birth: number; death: number } {
  const death = Math.max(0, birthMortality(approval, 1).mortality * 12 * 1000)
  return { birth: Math.max(0, death + growthPerYear * 1000), death }
}

// ---- the pop table -----------------------------------------------------------------------------------------------------------------------

export interface PopRow {
  id: string
  cls: PopClass
  stratum: SocialStratum
  culture: string
  religion: string
  population: number
  workforce: number
  dependents: number
  literacy: number
  wealthLevel: number
  sol: number
  mood: number
  status: AcceptanceStatus
}
export type PopSort = 'population' | 'class' | 'literacy' | 'sol' | 'wealth' | 'mood'
const CLASS_RANK: Record<PopClass, number> = { subsistence: 0, labor: 1, technical: 2, professional: 3, investor: 4, political: 5 }
export function popRows(pops: readonly Pop[], nation: NationCulture, laws: Partial<PopLaws> | undefined, sort: PopSort = 'population'): PopRow[] {
  const rows = pops.map((p): PopRow => ({
    id: p.id, cls: p.class, stratum: STRATUM_OF[p.class], culture: CULTURES[p.cultureId]?.name ?? p.cultureId, religion: RELIGIONS[p.religionId]?.name ?? p.religionId,
    population: p.populationSize, workforce: workforceOf(p), dependents: dependentsOf(p), literacy: p.educationLevel, wealthLevel: wealthLevel(p.wealth, p.populationSize), sol: p.standardOfLiving,
    mood: p.loyalty ?? 0, status: acceptanceOf(p.cultureId, nation, laws),
  }))
  const by: Record<PopSort, (a: PopRow, b: PopRow) => number> = {
    population: (a, b) => b.population - a.population,
    class: (a, b) => CLASS_RANK[a.cls] - CLASS_RANK[b.cls] || b.population - a.population,
    literacy: (a, b) => b.literacy - a.literacy,
    sol: (a, b) => b.sol - a.sol,
    wealth: (a, b) => b.wealthLevel - a.wealthLevel || b.population - a.population,
    mood: (a, b) => a.mood - b.mood,
  }
  return rows.sort((a, b) => by[sort](a, b) || (a.id < b.id ? -1 : 1))
}

// ---- politics ------------------------------------------------------------------------------------------------------------------------------

export interface GroupRow {
  id: string
  name: string
  color: string
  share: number
  mood: Mood
}
export function politicsView(pops: readonly Pop[], nation: NationCulture, laws: Partial<PopLaws> | undefined): GroupRow[] {
  const accept = (p: Pop) => STATUS_CLOUT[acceptanceOf(p.cultureId, nation, laws)]
  const strengths = INTEREST_GROUPS.map((g) => ({ g, members: pops.filter((p) => g.classes.includes(p.class)) }))
  const total = sum(strengths, ({ members }) => sum(members, (p) => politicalStrength(p, accept(p))))
  return strengths
    .map(({ g, members }) => ({ id: g.id, name: g.name, color: g.color, share: total > 0 ? sum(members, (p) => politicalStrength(p, accept(p))) / total : 0, mood: moodOf(members) }))
    .sort((a, b) => b.share - a.share)
}

// ---- culture and religion ---------------------------------------------------------------------------------------------------------------------

export interface CultureRow {
  id: string
  name: string
  color: string
  population: number
  share: number
  primary: boolean
  status: AcceptanceStatus
  statusLabel: string
  score: number
  // Per year, the share of these people that adopts the nation's culture.
  assimilationPerYear: number
}
export function cultureView(pops: readonly Pop[], nation: NationCulture, laws: Partial<PopLaws> | undefined): CultureRow[] {
  const total = sum(pops, (p) => p.populationSize)
  const ids = [...new Set(pops.map((p) => p.cultureId))]
  return ids
    .map((id): CultureRow => {
      const members = pops.filter((p) => p.cultureId === id)
      const size = sum(members, (p) => p.populationSize)
      const status = acceptanceOf(id, nation, laws)
      const radicals = wavg(members, (p) => p.populationSize, (p) => radicalShare(p))
      return { id, name: CULTURES[id]?.name ?? id, color: CULTURES[id]?.color ?? '#9aa', population: size, share: total > 0 ? size / total : 0, primary: nation.primary.includes(id), status, statusLabel: ACCEPTANCE_LABEL[status], score: acceptanceScore(id, nation, laws), assimilationPerYear: nation.primary.includes(id) ? 0 : assimilationRate(status, laws, radicals) * 12 }
    })
    .sort((a, b) => b.population - a.population)
}

export interface ReligionRow {
  id: string
  name: string
  color: string
  population: number
  share: number
  state: boolean
  // Per year, the share of these people that converts to the state religion.
  conversionPerYear: number
}
export function religionView(pops: readonly Pop[], nation: NationCulture, laws: Partial<PopLaws> | undefined): ReligionRow[] {
  const total = sum(pops, (p) => p.populationSize)
  return [...new Set(pops.map((p) => p.religionId))]
    .map((id): ReligionRow => {
      const members = pops.filter((p) => p.religionId === id)
      const size = sum(members, (p) => p.populationSize)
      const radicals = wavg(members, (p) => p.populationSize, (p) => radicalShare(p))
      return { id, name: RELIGIONS[id]?.name ?? id, color: RELIGIONS[id]?.color ?? '#9aa', population: size, share: total > 0 ? size / total : 0, state: nation.stateReligion === id, conversionPerYear: nation.stateReligion === id ? 0 : conversionRate(laws, radicals) * 12 }
    })
    .sort((a, b) => b.population - a.population)
}

export const nationCultureFromPops = (pops: readonly Pop[]): NationCulture => nationCultureOf(pops)
export { popLawsOrDefault, statusOfScore }
