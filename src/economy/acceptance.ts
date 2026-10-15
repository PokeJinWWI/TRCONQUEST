// Culture and religion acceptance, assimilation and conversion (pure; Complex pops carry the labels, Simple keeps nation shares).
//
// A nation has primary cultures (always fully accepted) and a state religion. Everyone else is accepted at a score of 0-100 that its
// cultural policy sets; the score falls in five statuses. Acceptance changes how much clout a pop has, how well it is paid and which jobs
// it can hold; people of a less accepted culture slowly assimilate into a primary one, and followers of another faith slowly convert.
import type { Pop } from './economyTypes'
import { mergeInto } from './popMerge'
import { popLawsOrDefault, type CitizenshipLaw, type PopLaws } from './popRules'
import { radicalShare } from './popPolitics'
import type { PopClass } from './recipes'

export type AcceptanceStatus = 'violent-hostility' | 'cultural-erasure' | 'open-prejudice' | 'second-class' | 'full'
export const ACCEPTANCE_STATUSES: AcceptanceStatus[] = ['violent-hostility', 'cultural-erasure', 'open-prejudice', 'second-class', 'full']
export const ACCEPTANCE_LABEL: Record<AcceptanceStatus, string> = {
  'violent-hostility': 'Violent hostility',
  'cultural-erasure': 'Cultural erasure',
  'open-prejudice': 'Open prejudice',
  'second-class': 'Second-class citizens',
  full: 'Full acceptance',
}
// Lowest score of each status.
const STATUS_FLOOR: [AcceptanceStatus, number][] = [['full', 80], ['second-class', 60], ['open-prejudice', 40], ['cultural-erasure', 20], ['violent-hostility', 0]]
export const statusOfScore = (score: number): AcceptanceStatus => STATUS_FLOOR.find(([, floor]) => score >= floor)![0]

// The score of a culture that is not the nation's own, by cultural policy.
export const CITIZENSHIP_SCORE: Record<CitizenshipLaw, number> = { assimilationist: 25, standard: 55, multicultural: 80 }
export const PRIMARY_SCORE = 100

// What each status does to a pop.
export const STATUS_CLOUT: Record<AcceptanceStatus, number> = { full: 1, 'second-class': 0.8, 'open-prejudice': 0.6, 'cultural-erasure': 0.4, 'violent-hostility': 0.2 }
export const STATUS_WAGE: Record<AcceptanceStatus, number> = { full: 1, 'second-class': 0.95, 'open-prejudice': 0.9, 'cultural-erasure': 0.85, 'violent-hostility': 0.8 }
// Share of its qualification a pop keeps for the skilled professions (technical and professional work): the less accepted are kept out.
export const STATUS_SKILLED_ACCESS: Record<AcceptanceStatus, number> = { full: 1, 'second-class': 0.85, 'open-prejudice': 0.6, 'cultural-erasure': 0.4, 'violent-hostility': 0.25 }
const SKILLED: PopClass[] = ['technical', 'professional']
export const skilledAccess = (status: AcceptanceStatus, cls: PopClass): number => (SKILLED.includes(cls) ? STATUS_SKILLED_ACCESS[status] : 1)
// What a mood of grievance a status adds (standard of living points, for popPolitics.stepLoyalty).
export const STATUS_GRIEVANCE: Record<AcceptanceStatus, number> = { full: 0, 'second-class': 0.02, 'open-prejudice': 0.05, 'cultural-erasure': 0.09, 'violent-hostility': 0.14 }

export interface NationCulture {
  // Cultures that are the nation's own (a nation may have several), and the one people assimilate into.
  primary: string[]
  assimilatesInto: string | null
  stateReligion: string | null
}

// A nation's own culture and faith, read off its people: any culture that holds at least a fifth of them is primary (the biggest is the one
// others assimilate into), and the biggest faith is the state religion.
export const PRIMARY_CULTURE_SHARE = 0.2
export function nationCultureOf(pops: readonly Pop[]): NationCulture {
  const total = pops.reduce((n, p) => n + p.populationSize, 0)
  if (total <= 0) return { primary: [], assimilatesInto: null, stateReligion: null }
  const cultures = new Map<string, number>()
  const religions = new Map<string, number>()
  for (const p of pops) {
    cultures.set(p.cultureId, (cultures.get(p.cultureId) ?? 0) + p.populationSize)
    religions.set(p.religionId, (religions.get(p.religionId) ?? 0) + p.populationSize)
  }
  const ranked = [...cultures].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
  const primary = ranked.filter(([, n], i) => i === 0 || n / total >= PRIMARY_CULTURE_SHARE).map(([id]) => id)
  const faith = [...religions].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] ?? null
  return { primary, assimilatesInto: ranked[0]?.[0] ?? null, stateReligion: faith }
}

export function acceptanceScore(cultureId: string, nation: NationCulture, laws: Partial<PopLaws> | undefined): number {
  return nation.primary.includes(cultureId) ? PRIMARY_SCORE : CITIZENSHIP_SCORE[popLawsOrDefault(laws).citizenship]
}
export const acceptanceOf = (cultureId: string, nation: NationCulture, laws: Partial<PopLaws> | undefined): AcceptanceStatus => statusOfScore(acceptanceScore(cultureId, nation, laws))

// ---- assimilation and conversion ----------------------------------------------------------------------------------------------------------

export const ASSIMILATION_RATE = 0.002 // a month's share of a minority culture that adopts the nation's
export const CONVERSION_RATE = 0.002
// The cultural policy and the status scale the rate; people already fully accepted have no reason to give up their culture.
const ASSIMILATION_STATUS_FACTOR: Record<AcceptanceStatus, number> = { full: 0, 'second-class': 1, 'open-prejudice': 1.15, 'cultural-erasure': 1.05, 'violent-hostility': 0 }
export function assimilationRate(status: AcceptanceStatus, laws: Partial<PopLaws> | undefined, radicals: number): number {
  const l = popLawsOrDefault(laws)
  const policy = l.citizenship === 'assimilationist' ? 1.5 : 1
  return ASSIMILATION_RATE * ASSIMILATION_STATUS_FACTOR[status] * policy * (1 - radicals)
}
export function conversionRate(laws: Partial<PopLaws> | undefined, radicals: number): number {
  return CONVERSION_RATE * (popLawsOrDefault(laws).education === 'religious' ? 1.5 : 1) * (1 - radicals)
}

export interface AssimilationResult {
  pops: Pop[]
  assimilated: number
  converted: number
}

// One month in one world: minority cultures drift into the nation's, other faiths into the state religion. People are conserved.
export function stepAssimilation(pops: readonly Pop[], nation: NationCulture, laws: Partial<PopLaws> | undefined, worldId: string): AssimilationResult {
  let next: Pop[] = pops.map((p) => ({ ...p }))
  let assimilated = 0
  let converted = 0
  const shift = (p: Pop, amount: number, change: Partial<Pick<Pop, 'cultureId' | 'religionId'>>) => {
    const wealth = p.populationSize > 0 ? p.wealth * (amount / p.populationSize) : 0
    const idx = next.findIndex((x) => x.id === p.id)
    if (idx < 0) return
    next[idx] = { ...next[idx], populationSize: next[idx].populationSize - amount, wealth: next[idx].wealth - wealth }
    next = mergeInto(next, { ...p, ...change }, amount, wealth, worldId)
  }
  for (const p of pops) {
    if (p.populationSize <= 0) continue
    const radicals = radicalShare(p)
    if (nation.assimilatesInto && !nation.primary.includes(p.cultureId)) {
      const amount = p.populationSize * assimilationRate(acceptanceOf(p.cultureId, nation, laws), laws, radicals)
      if (amount > 0) {
        shift(p, amount, { cultureId: nation.assimilatesInto })
        assimilated += amount
      }
    }
    if (nation.stateReligion && p.religionId !== nation.stateReligion) {
      const amount = p.populationSize * conversionRate(laws, radicals)
      if (amount > 0) {
        shift(p, amount, { religionId: nation.stateReligion })
        converted += amount
      }
    }
  }
  return { pops: next.filter((p) => p.populationSize > 1e-9), assimilated, converted }
}
