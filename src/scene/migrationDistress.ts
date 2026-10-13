// Distress on the worlds of the running game, for the migration engine (economy/migration.ts adds famine, displacement and
// bombardment devastation itself, from the world): occupation and an enemy fleet leaning on the orbit.
import { atWar } from '../state/diplomacyStore'
import { useShipStore } from '../state/shipStore'
import { useTerritoryStore } from '../state/territoryStore'
import { orbitedBody, isArmed } from './armyLogic'

export const OCCUPATION_DISTRESS = 0.35
export const BLOCKADE_DISTRESS = 0.15

export function distressByBody(): Record<string, number> {
  const { bodyOwner, bodyController } = useTerritoryStore.getState()
  const out: Record<string, number> = {}
  for (const [body, owner] of Object.entries(bodyOwner)) {
    const controller = bodyController[body]
    if (controller && controller !== owner) out[body] = (out[body] ?? 0) + OCCUPATION_DISTRESS
  }
  for (const ship of useShipStore.getState().ships) {
    const body = orbitedBody(ship)
    const owner = body ? bodyOwner[body] : undefined
    if (body && owner && ship.ownerId !== owner && atWar(owner, ship.ownerId) && isArmed(ship)) out[body] = Math.max(out[body] ?? 0, BLOCKADE_DISTRESS)
  }
  return out
}
