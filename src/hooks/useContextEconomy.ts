import { getCountry } from '../data/countryData'
import { worldByName, useEconomyStore } from '../state/economyStore'
import { usePlayerStore } from '../state/playerStore'
import { useViewStore } from '../state/viewStore'
import type { Country, World } from '../economy/economyTypes'

export interface ContextEconomy {
  // The body the panels are about right now: whatever the player is focused on
  // (a selected planet/moon), falling back to their capital when nothing is
  // focused.
  worldName?: string
  // Its local economy, if inhabited (undefined for an uninhabited body).
  world?: World
  // The country that owns the focused world (its national fiscal layer), or the
  // player's own country on the capital fallback.
  country?: Country
  // True when worldName came from an actual in-view focus, not the capital
  // fallback — so a panel can say "Luna" instead of the capital.
  focused: boolean
}

// Resolves which world/country the economy panels are about, following what the
// player is actually looking at (the in-scene selection wins) rather than
// always the capital.
export function useContextEconomy(): ContextEconomy {
  const level = useViewStore((s) => s.level)
  const selectedBodyName = useViewStore((s) => s.selectedBodyName)
  const inViewSelection = useViewStore((s) => s.inViewSelection)
  const countryId = usePlayerStore((s) => s.selectedCountryId)
  const countries = useEconomyStore((s) => s.countries)
  const worlds = useEconomyStore((s) => s.worlds)

  const focusedName =
    level === 'satellite'
      ? inViewSelection ?? selectedBodyName ?? undefined
      : level === 'system'
        ? inViewSelection ?? undefined
        : undefined

  if (focusedName) {
    const world = worldByName(worlds, focusedName)
    const country = world ? countries.find((c) => c.id === world.ownerId) : undefined
    return { worldName: focusedName, world, country, focused: true }
  }

  const capital = countryId ? getCountry(countryId)?.capitalBodyName : undefined
  const country = countryId ? countries.find((c) => c.id === countryId) : undefined
  return { worldName: capital, world: worldByName(worlds, capital), country, focused: false }
}
