// Playable factions — see playerStore.ts for the selected-country session
// state and MainMenu.tsx for where a player picks one of these.
export interface Country {
  id: string
  name: string
  color: string
  // Where a freshly-selected player starts — the system to enter and the
  // body to arrive pre-selected at (see MainMenu.selectCountry).
  capitalStarId: string
  capitalBodyName: string
}

export const COUNTRIES: Country[] = [
  {
    id: 'imperial-state-of-mars',
    name: 'Imperial State of Mars',
    color: '#c9704a',
    capitalStarId: 'sol',
    capitalBodyName: 'Mars',
  },
  {
    id: 'republic-of-venus',
    name: 'Republic of Venus',
    color: '#3d7dc9',
    capitalStarId: 'sol',
    capitalBodyName: 'Venus',
  },
  {
    id: 'orion-republic',
    name: 'Orion Republic',
    color: '#8fd0ff',
    capitalStarId: 'alpha-centauri',
    capitalBodyName: 'Arcadia',
  },
]

export function getCountry(id: string): Country | undefined {
  return COUNTRIES.find((c) => c.id === id)
}
