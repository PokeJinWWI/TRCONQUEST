import type { PopClass } from './recipes'
import type { World } from './economyTypes'

// Interest groups — the standing, class-based political blocs of the design
// doc (Section 2c). Milestone-1 slice: four baseline groups, each drawing its
// membership (and thus its Political Strength) from a set of pop classes. No
// parties, agendas, or in-government/opposition split yet; this is the
// underlying strength math the Political map mode and the legislature will
// later sit on top of.
export type InterestGroupId = 'trade-unions' | 'intelligentsia' | 'industrialists' | 'bureaucracy'

export interface InterestGroupDef {
  id: InterestGroupId
  name: string
  color: string
  // The pop classes that sympathize with this group.
  classes: PopClass[]
}

export const INTEREST_GROUPS: InterestGroupDef[] = [
  { id: 'trade-unions', name: 'Trade Unions', color: '#ff6b4a', classes: ['subsistence', 'labor'] },
  { id: 'intelligentsia', name: 'Intelligentsia', color: '#6fe3ff', classes: ['technical', 'professional'] },
  { id: 'industrialists', name: 'Industrialists', color: '#ffd23f', classes: ['investor'] },
  { id: 'bureaucracy', name: 'Bureaucracy', color: '#c77dff', classes: ['political'] },
]

// Political weight per class — not one-pop-one-vote (design doc Section 2c):
// wealthier, higher-status classes carry disproportionate clout, so a small
// Investor bloc can outweigh a large Subsistence one.
const CLASS_POLITICAL_WEIGHT: Record<PopClass, number> = {
  subsistence: 0.5,
  labor: 1,
  technical: 1.5,
  professional: 2.5,
  investor: 4,
  political: 3,
}

const GROUP_OF_CLASS: Partial<Record<PopClass, InterestGroupId>> = {}
for (const g of INTEREST_GROUPS) for (const c of g.classes) GROUP_OF_CLASS[c] = g.id

export interface InterestGroupStrength {
  def: InterestGroupDef
  strength: number
  // Share of the planet's total political strength, 0..1.
  share: number
}

// Each group's Political Strength on a planet: the sum over its sympathetic
// pops of (population × class political weight × a mild wealth multiplier), so
// both how many and how rich/high-status they are matter — exactly the tension
// the future Political map mode is built to surface. Returned ranked, with each
// group's share of the planet total.
export function interestGroupStrengths(world: World): InterestGroupStrength[] {
  const raw: Record<InterestGroupId, number> = { 'trade-unions': 0, intelligentsia: 0, industrialists: 0, bureaucracy: 0 }
  for (const pop of world.pops) {
    const gid = GROUP_OF_CLASS[pop.class]
    if (!gid) continue
    const wealthMult = 1 + Math.min(2, pop.wealth / 200)
    raw[gid] += pop.populationSize * CLASS_POLITICAL_WEIGHT[pop.class] * wealthMult
  }
  const total = Object.values(raw).reduce((s, v) => s + v, 0)
  return INTEREST_GROUPS.map((def) => ({ def, strength: raw[def.id], share: total > 0 ? raw[def.id] / total : 0 })).sort(
    (a, b) => b.strength - a.strength,
  )
}
