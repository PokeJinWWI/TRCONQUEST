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
}

// A weighted religion mix (shares should sum to ~1).
export type ReligionMix = { religion: string; share: number }[]
