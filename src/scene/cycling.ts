// Tab / Shift+Tab step through your own fleets, C / Shift+C through your own
// colonies (every world you own), in a stable order; the view follows the
// selection (lock-on pans to a fleet; a colony opens in its system).
import { useShipStore } from '../state/shipStore'
import { usePlayerStore } from '../state/playerStore'
import { useTerritoryStore } from '../state/territoryStore'
import { useViewStore } from '../state/viewStore'
import { goToEvent } from './eventNavigation'
import { bodyIndex } from './territory'

// The key after (dir 1) or before (dir -1) `current` in `keys`, wrapping. With
// no current selection it takes the first (or last, going back).
export function nextKey(keys: readonly string[], current: string | null, dir: 1 | -1 = 1): string | null {
  if (keys.length === 0) return null
  const i = current === null ? -1 : keys.indexOf(current)
  if (i === -1) return dir === 1 ? keys[0] : keys[keys.length - 1]
  return keys[(i + dir + keys.length) % keys.length]
}

// Own fleets, in the order their first ship was built: [fleetId, lead ship id].
export function ownFleets(): { fleetId: string; leadShipId: string }[] {
  const player = usePlayerStore.getState().selectedCountryId
  const seen = new Map<string, string>()
  for (const s of useShipStore.getState().ships) if (s.ownerId === player && !seen.has(s.fleetId)) seen.set(s.fleetId, s.id)
  return [...seen].map(([fleetId, leadShipId]) => ({ fleetId, leadShipId }))
}

export function cycleFleets(dir: 1 | -1 = 1): void {
  const fleets = ownFleets()
  const { ships, selectedShipId } = useShipStore.getState()
  const current = ships.find((s) => s.id === selectedShipId)?.fleetId ?? null
  const next = nextKey(fleets.map((f) => f.fleetId), current, dir)
  const lead = fleets.find((f) => f.fleetId === next)?.leadShipId
  if (lead) useShipStore.getState().selectShip(lead)
}

// Own worlds, by system then name.
export function ownColonyNames(): string[] {
  const player = usePlayerStore.getState().selectedCountryId
  const owners = useTerritoryStore.getState().bodyOwner
  const index = bodyIndex()
  return Object.keys(owners)
    .filter((b) => owners[b] === player && index.has(b))
    .sort((a, b) => (index.get(a)!.starId).localeCompare(index.get(b)!.starId) || a.localeCompare(b))
}

export function cycleColonies(dir: 1 | -1 = 1): void {
  const names = ownColonyNames()
  const next = nextKey(names, useViewStore.getState().inViewSelection, dir)
  if (!next) return
  useShipStore.getState().selectShip(null)
  goToEvent({ kind: 'holding', place: { bodyName: next } })
}
