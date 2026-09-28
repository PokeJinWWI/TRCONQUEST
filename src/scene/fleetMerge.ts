// Stellaris-style fleet merging. Select several fleets and merge: the one "on
// top" (the lead) carries on with whatever it is doing, and every other fleet
// heads for it — following its destination, so a moving lead is chased — and
// joins it the moment both are resting in the same place. The chase itself is
// the existing follow directive (ShipInstance.followingShipId, re-planned in
// hooks/useShipOrderSettler); this file adds the "and then join" half.
import { useShipStore, type ShipInstance } from '../state/shipStore'
import { fleetLocationKey } from './fleetRules'

// Sends every ship of `fromFleetIds` after the lead fleet, to merge into it
// when they meet. A fleet already resting with the lead joins at once.
export function startFleetMerge(leadFleetId: string, fromFleetIds: string[]): void {
  const store = useShipStore.getState()
  const lead = store.ships.find((s) => s.fleetId === leadFleetId)
  if (!lead) return
  for (const fleetId of fromFleetIds) {
    if (fleetId === leadFleetId) continue
    const ids = store.ships.filter((s) => s.fleetId === fleetId).map((s) => s.id)
    for (const id of ids) store.setFollowing(id, lead.id)
    store.setMergeInto(ids, leadFleetId)
  }
  resolveFleetMerges()
}

// Whether a fleet following the lead has now met it: the follower is entirely
// at rest in one place and the lead fleet is at rest in that same place.
export function hasMetLead(follower: ShipInstance[], lead: ShipInstance[]): boolean {
  const here = fleetLocationKey(follower)
  if (here === null) return false
  const there = fleetLocationKey(lead)
  return there !== null && there === here
}

// Called every settle pass: merges fleets that have met their lead, and drops
// merges that can no longer happen (lead gone, or the player gave the follower
// its own order, which cancels the follow).
export function resolveFleetMerges(): void {
  const store = useShipStore.getState()
  const merging = store.ships.filter((s) => s.mergeIntoFleetId)
  if (merging.length === 0) return
  const byFleet = new Map<string, ShipInstance[]>()
  for (const s of merging) byFleet.set(s.fleetId, [...(byFleet.get(s.fleetId) ?? []), s])
  for (const [fleetId, members] of byFleet) {
    const leadFleetId = members[0].mergeIntoFleetId!
    const all = useShipStore.getState().ships
    const lead = all.filter((s) => s.fleetId === leadFleetId)
    const follower = all.filter((s) => s.fleetId === fleetId)
    const ids = follower.map((s) => s.id)
    // A follower that has been given its own order (or a lead that is gone)
    // is no longer merging.
    if (lead.length === 0 || follower.some((s) => !s.followingShipId)) {
      useShipStore.getState().setMergeInto(ids, null)
      continue
    }
    if (!hasMetLead(follower, lead)) continue
    for (const id of ids) useShipStore.getState().setFollowing(id, null)
    useShipStore.getState().setMergeInto(ids, null)
    useShipStore.getState().mergeFleets(leadFleetId, fleetId)
  }
}

