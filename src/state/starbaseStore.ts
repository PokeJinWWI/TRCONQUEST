import { create } from 'zustand'
import { STARBASE_BUILD_DAYS, STARBASE_COST, STARBASE_INFLUENCE_COST, STARBASE_INTEGRITY } from '../data/starbaseData'
import { useResourceStore } from './resourceStore'
import { starbaseAnchorBody, starbasesAt, type Starbase } from '../scene/starbaseLogic'
import { cargoCovers, cargoMinus } from '../scene/cargoLogic'
import { isFullySurveyed, restingStarId } from '../scene/surveyLogic'
import { resolveShipClass } from './shipClassResolver'
import { useShipStore } from './shipStore'
import { useSurveyStore } from './surveyStore'
import { useTerritoryStore } from './territoryStore'
import { useTechStore } from './techStore'
import { atWar } from './diplomacyStore'

// Every Starbase in the game (both economy modes — a Construction Ship pays
// its cost out of the goods in its hold, so no per-mode branching is needed).
// The rules are
// pure in scene/starbaseLogic.ts; hooks/useStarbaseResolver.ts steps the
// sieges. See data/starbaseData.ts for the tuning.

export type StarbaseResult = { ok: true } | { ok: false; reason: string }

interface StarbaseState {
  starbases: Starbase[]
  build: (countryId: string, starId: string, simDays: number, shipId: string | null) => StarbaseResult
  applyDamage: (updates: Record<string, number>, destroyedIds: string[]) => void
}

let counter = 0

// Whether `shipId` (a Construction Ship) can start a Starbase at `starId` for
// `countryId` right now. The ship does the building and pays out of what it
// carries (it isn't consumed), so it must be resting at that star with the
// cost in its hold, and the system must be fully surveyed — by the ship's own
// nation, on the `discovered` layer (the truth; the player's delayed `known`
// layer only decides what they get to click, see scene/intel.ts).
export function canBuildStarbase(countryId: string, starId: string, starbases: Starbase[], shipId: string | null, opts: { anywhere?: boolean } = {}): StarbaseResult {
  if (!useTechStore.getState().stateFor(countryId).researched.has('orbital-construction')) {
    return { ok: false, reason: 'Needs Orbital Construction researched' }
  }
  const ship = shipId ? useShipStore.getState().ships.find((s) => s.id === shipId) : undefined
  if (!ship) return { ok: false, reason: 'Needs a Construction Ship at the system' }
  if (ship.ownerId !== countryId || resolveShipClass(ship.classId)?.role !== 'construction') {
    return { ok: false, reason: 'Only your Construction Ships can build a Starbase' }
  }
  // `anywhere`: the ship is about to fly there (a star's right-click menu), so
  // only whether it COULD build there matters.
  if (!opts.anywhere && restingStarId(ship) !== starId) return { ok: false, reason: 'The Construction Ship has to be resting at the star' }
  const anchor = starbaseAnchorBody(starId)
  if (!anchor) return { ok: false, reason: 'This system is uncharted' }
  if (!isFullySurveyed(useSurveyStore.getState().discovered[countryId], countryId, starId, useTerritoryStore.getState().bodyOwner)) {
    return { ok: false, reason: 'The system is not fully surveyed' }
  }
  const here = starbasesAt(starId, starbases)
  if (here.some((sb) => sb.ownerId === countryId)) return { ok: false, reason: 'Already have a Starbase here' }
  // A nation doesn't build a Starbase to contest ground it's already at war
  // over by other means — refuse where it would just be free-riding into an
  // enemy's own claimed, undefended system. It can still fight for it: take
  // the system by force (invade/occupy any body there) or defeat the
  // standing Starbase first, same as any other contested territory.
  if (here.some((sb) => atWar(sb.ownerId, countryId))) return { ok: false, reason: "An enemy Starbase already holds this system's claim" }
  const influence = useResourceStore.getState().stateFor(countryId).amounts.influence ?? 0
  if (influence < STARBASE_INFLUENCE_COST) {
    return { ok: false, reason: `Needs ${STARBASE_INFLUENCE_COST} influence to claim a system (have ${Math.floor(influence)})` }
  }
  if (!cargoCovers(ship.cargo, STARBASE_COST)) {
    return { ok: false, reason: `The hold is short of materials (needs ${Object.entries(STARBASE_COST).map(([id, n]) => `${n} ${id}`).join(', ')})` }
  }
  return { ok: true }
}

export const useStarbaseStore = create<StarbaseState>((set, get) => ({
  starbases: [],
  build: (countryId, starId, simDays, shipId) => {
    const starbases = get().starbases
    const check = canBuildStarbase(countryId, starId, starbases, shipId)
    if (!check.ok) return check
    const ship = useShipStore.getState().ships.find((s) => s.id === shipId)!
    useShipStore.getState().setShipCargo(ship.id, cargoMinus(ship.cargo, STARBASE_COST))
    useResourceStore.getState().addAmount(countryId, 'influence', -STARBASE_INFLUENCE_COST)
    counter += 1
    const sb: Starbase = {
      id: `starbase-${starId}-${countryId}-${counter}-${Math.round(simDays)}`,
      starId,
      ownerId: countryId,
      integrity: STARBASE_INTEGRITY,
      readySimDays: simDays + STARBASE_BUILD_DAYS,
    }
    set({ starbases: [...starbases, sb] })
    return { ok: true }
  },
  // Writes back one siege step's result (see scene/starbaseLogic.stepStarbaseSieges,
  // stepped by hooks/useStarbaseResolver.ts). A destroyed Starbase's claim
  // goes with it automatically — systemClaim reads starbaseOwnersOf live off
  // this store, nothing else has to happen for the border to fall.
  applyDamage: (updates, destroyedIds) => {
    if (Object.keys(updates).length === 0 && destroyedIds.length === 0) return
    const destroyed = new Set(destroyedIds)
    set((s) => ({
      starbases: s.starbases.filter((sb) => !destroyed.has(sb.id)).map((sb) => (updates[sb.id] !== undefined ? { ...sb, integrity: updates[sb.id] } : sb)),
    }))
  },
}))
