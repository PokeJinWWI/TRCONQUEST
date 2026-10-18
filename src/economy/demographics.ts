// Cultures and religions — the two social axes of a pop beyond its species and
// class (see economyTypes.Pop). Milestone-1 content: definitions and per-world
// distributions, so pops genuinely carry a culture and a faith. Mechanics that
// hang off them (discrimination, assimilation, religious politics/taboos) come
// in later milestones; for now they're real attributes that already feed the
// interest-group math and are ready for those systems.

export interface Culture {
  id: string
  name: string
  color: string
}

export const CULTURES: Record<string, Culture> = {
  martian: { id: 'martian', name: 'Martian', color: '#c9704a' },
  venusian: { id: 'venusian', name: 'Venusian', color: '#3d7dc9' },
  arcadian: { id: 'arcadian', name: 'Arcadian', color: '#6aa878' },
  tidalian: { id: 'tidalian', name: 'Tidalian', color: '#5ad1a0' },
  terran: { id: 'terran', name: 'Terran', color: '#b89b5e' },
  // The Republic of Jinshan's peoples: southern Chinese groups, a Zhongyuan minority, and the colony-born blend.
  yue: { id: 'yue', name: 'Yue (Cantonese)', color: '#e0b040' },
  hakka: { id: 'hakka', name: 'Hakka', color: '#c98a3a' },
  min: { id: 'min', name: 'Min (Teochew–Hokkien)', color: '#d9a05a' },
  zhongyuan: { id: 'zhongyuan', name: 'Zhongyuan', color: '#b8a070' },
  wu: { id: 'wu', name: 'Wu (Jiangnan)', color: '#c8b880' },
  jinshanese: { id: 'jinshanese', name: 'Jinshanese', color: '#f0c850' },
  'gan-xiang': { id: 'gan-xiang', name: 'Gan–Xiang', color: '#b08850' },
}

export interface Religion {
  id: string
  name: string
  color: string
}

export const RELIGIONS: Record<string, Religion> = {
  'imperial-church-of-mars': { id: 'imperial-church-of-mars', name: 'Imperial Church of Mars', color: '#e0a060' },
  'martian-buddhist': { id: 'martian-buddhist', name: 'Martian Buddhist', color: '#d0b070' },
  'venusian-storm-cult': { id: 'venusian-storm-cult', name: 'Venusian Storm Cult', color: '#6a9cff' },
  axiomatic: { id: 'axiomatic', name: 'Axiomatic', color: '#a0c0e0' },
  'silicon-dream': { id: 'silicon-dream', name: 'Silicon Dream', color: '#b0a0e0' },
  'arcadian-idyll': { id: 'arcadian-idyll', name: 'Arcadian Idyll', color: '#8fd0a0' },
  'old-earth-theravada': { id: 'old-earth-theravada', name: 'Old-Earth Theravada', color: '#e0c080' },
  'tidal-communion': { id: 'tidal-communion', name: 'Tidal Communion', color: '#50c0b0' },
  'non-affiliated': { id: 'non-affiliated', name: 'Non-affiliated', color: '#8a8f96' },
  // The Republic of Jinshan's faiths, each its own Jinshan form.
  'jinshan-folk': { id: 'jinshan-folk', name: 'Jinshan Folk Religion', color: '#e8b04a' },
  'jinshan-chan': { id: 'jinshan-chan', name: 'Jinshan Chan Buddhism', color: '#d8c890' },
  'jinshan-church': { id: 'jinshan-church', name: 'Jinshan Church', color: '#c0d0e8' },
  'jinshan-daoism': { id: 'jinshan-daoism', name: 'Jinshan Daoism', color: '#a8c8a0' },
  'hui-islam-of-jinshan': { id: 'hui-islam-of-jinshan', name: 'Hui Islam of Jinshan', color: '#80b8a0' },
  'jinshan-ruism': { id: 'jinshan-ruism', name: 'Jinshan Ruism', color: '#c8a878' },
}

// A weighted religion mix (shares should sum to ~1).
export type ReligionMix = { religion: string; share: number }[]

// A culture and the faith its people hold, as a share of a world: how a world with several peoples is seeded (one cohort per
// pair, so the number of pops stays small).
export interface Cohort {
  culture: string
  religion: string
  share: number
}
// The religion mix a set of cohorts adds up to.
export function religionsOfCohorts(cohorts: Cohort[]): ReligionMix {
  const by = new Map<string, number>()
  for (const c of cohorts) by.set(c.religion, (by.get(c.religion) ?? 0) + c.share)
  return [...by].map(([religion, share]) => ({ religion, share }))
}
// The culture with the largest share.
export function leadingCulture(cohorts: Cohort[]): string {
  const by = new Map<string, number>()
  for (const c of cohorts) by.set(c.culture, (by.get(c.culture) ?? 0) + c.share)
  return [...by].sort((a, b) => b[1] - a[1])[0][0]
}
