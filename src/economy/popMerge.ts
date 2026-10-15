// Moving people between pops (pure): migration (economy/migration.ts) and mobility between professions (economy/popMobility.ts) both
// take some of a pop and either add it to the matching pop of the destination or found one, carrying its wealth.
import type { Pop } from './economyTypes'
import { workforceShareOf } from './popRules'

export const popKeyOf = (p: Pick<Pop, 'class' | 'speciesTemplateId' | 'cultureId' | 'religionId'>): string => `${p.class}|${p.speciesTemplateId}|${p.cultureId}|${p.religionId}`

// Adds `amount` people (carrying `wealth`) of `moving` to `dest`: to the pop with the same class, species, culture and religion if there
// is one, else as a new pop named `${destId}:m:${key}`. Averages (literacy, standard of living, needs, workforce share) are weighted by size.
export function mergeInto(dest: Pop[], moving: Pop, amount: number, wealth: number, destId: string): Pop[] {
  const i = dest.findIndex((p) => popKeyOf(p) === popKeyOf(moving))
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
    if (d.workforceShare !== undefined || moving.workforceShare !== undefined) merged.workforceShare = w(workforceShareOf(d), workforceShareOf(moving))
    return dest.map((p, k) => (k === i ? merged : p))
  }
  // A new pop in the destination: the incomers keep the standard of living they arrive with, which the next tick then moves.
  return [...dest, { ...moving, id: `${destId}:m:${popKeyOf(moving)}`, populationSize: amount, wealth }]
}
