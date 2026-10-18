import { useEffect } from 'react'
import { COUNTRIES } from '../data/countryData'
import { ownerDisplay } from '../data/countryRoster'
import { useContactStore } from '../state/contactStore'
import { useDiplomacyStore } from '../state/diplomacyStore'
import { useGameTimeStore } from '../state/gameTimeStore'
import { useShipStore } from '../state/shipStore'
import { useStarbaseStore } from '../state/starbaseStore'
import { useTerritoryStore } from '../state/territoryStore'
import { newContacts, presenceBySystem, type Presence } from '../scene/contact'
import { systemOfShip } from '../scene/surveyLogic'
import { bodyStarId } from '../scene/territory'

// One pass at `simDays`: any two nations with a ship, a Starbase or a world in the same system
// who have not met make first contact (scene/contact.ts). Exported so a headless run (tests)
// can drive it without React.
export function resolveContacts(simDays: number): void {
  const nations = new Set(COUNTRIES.map((c) => c.id))
  const entries: Presence[] = []
  for (const ship of useShipStore.getState().ships) {
    const starId = systemOfShip(ship)
    if (starId && nations.has(ship.ownerId)) entries.push({ starId, nation: ship.ownerId })
  }
  for (const sb of useStarbaseStore.getState().starbases) if (nations.has(sb.ownerId)) entries.push({ starId: sb.starId, nation: sb.ownerId })
  for (const [body, owner] of Object.entries(useTerritoryStore.getState().bodyOwner)) {
    if (!owner || !nations.has(owner)) continue
    const starId = bodyStarId(body)
    if (starId) entries.push({ starId, nation: owner })
  }
  const store = useContactStore.getState()
  const made = newContacts(presenceBySystem(entries), new Set(store.met))
  for (const c of made) {
    store.meet(c.a, c.b)
    useDiplomacyStore.getState().pushEvent('first-contact', [c.a, c.b], `${ownerDisplay(c.a).name} and ${ownerDisplay(c.b).name} have made first contact`, simDays, { starId: c.starId })
  }
}

export function useContactResolver() {
  useEffect(() => {
    resolveContacts(useGameTimeStore.getState().simDays)
    return useGameTimeStore.subscribe((state, prev) => {
      if (Math.floor(state.simDays) !== Math.floor(prev.simDays)) resolveContacts(state.simDays)
    })
  }, [])
}
