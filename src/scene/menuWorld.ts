import { COUNTRIES } from '../data/countryData'
import { generatedStarOfBody } from '../data/galaxyGen'
import { usePlayerStore } from '../state/playerStore'
import { getMoonsForPlanet, type MoonData } from './moonData'
import { PLANETS_BY_STAR, getPlanetsForStar, type PlanetData } from './planetData'

// The world behind the main menu: the capital of the nation the player last played, remembered in
// localStorage (a saved game loads through the same player store, so loading one counts), and
// Earth for a new player or when what was remembered cannot be found. Pure lookups here; the
// scene is MenuBackdrop.
export const MENU_WORLD_KEY = 'trc.menu.world.v1'
export const DEFAULT_MENU_WORLD = 'Earth'

export interface MenuWorld {
  name: string
  color: string
  radiusKm: number
  moons: MoonData[]
}

function planetNamed(name: string): PlanetData | undefined {
  for (const planets of Object.values(PLANETS_BY_STAR)) {
    const hit = planets.find((p) => p.name === name)
    if (hit) return hit
  }
  const star = generatedStarOfBody(name)
  return star ? getPlanetsForStar(star.id).find((p) => p.name === name) : undefined
}

// The world to show for a remembered body name; Earth when it is unknown or not a planet.
export function menuWorldOf(name: string | null | undefined): MenuWorld {
  const planet = (name ? planetNamed(name) : undefined) ?? planetNamed(DEFAULT_MENU_WORLD)
  if (!planet) throw new Error('Earth is missing from the planet table')
  return { name: planet.name, color: planet.color, radiusKm: planet.radiusKm, moons: getMoonsForPlanet(planet.name).moons }
}

// The body a nation plays from, or null for one that has no capital (the sandbox faction).
export function capitalBodyOf(countryId: string | null | undefined): string | null {
  return COUNTRIES.find((c) => c.id === countryId)?.capitalBodyName ?? null
}

export function readLastWorld(): string | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(MENU_WORLD_KEY)
  } catch {
    return null
  }
}

export function rememberWorld(bodyName: string): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(MENU_WORLD_KEY, bodyName)
  } catch {
    // Storage blocked or full: the menu just shows Earth next time.
  }
}

// Whenever a nation is picked or a game loaded, remember its capital for the next menu.
usePlayerStore.subscribe((s, before) => {
  if (s.selectedCountryId === before.selectedCountryId || s.sandbox) return
  const body = capitalBodyOf(s.selectedCountryId)
  if (body) rememberWorld(body)
})
