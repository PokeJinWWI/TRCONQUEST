import type { ContextMenuItem } from './StarContextMenu'
import { resolveShipClass } from '../state/shipClassResolver'
import { isPlayerOwned } from '../state/shipRelations'
import { useShipStore } from '../state/shipStore'
import { canBuildStarbase, starbaseInfluenceCostFor, useStarbaseStore } from '../state/starbaseStore'
import { useResourceStore } from '../state/resourceStore'
import { orderSelectedToDoAt } from './shipCommands'
import { starbaseAnchorBody } from './starbaseLogic'
import { starbaseActionTitle, starbaseShortReason, withStarbaseCost } from './starbaseNotices'

// "Build Starbase" on the system's star itself (a Starbase orbits the star, so right-clicking
// the star offers it like the star's own menu on the map): for the player's selected
// Construction Ships, greyed out with the reason unless one could build there.
export function starbaseMenuItem(systemId: string, bodyName: string): ContextMenuItem | null {
  if (starbaseAnchorBody(systemId) !== bodyName) return null
  const store = useShipStore.getState()
  const builders = store.ships.filter((s) => store.selectedShipIds.includes(s.id) && isPlayerOwned(s) && resolveShipClass(s.classId)?.role === 'construction')
  if (builders.length === 0) return null
  const starbases = useStarbaseStore.getState().starbases
  const checks = builders.map((b) => canBuildStarbase(b.ownerId, systemId, starbases, b.id, { anywhere: true }))
  const ok = checks.some((c) => c.ok)
  const refused = checks.find((c) => !c.ok)
  const cost = starbaseInfluenceCostFor(builders[0].ownerId, systemId, starbases)
  const short = starbaseShortReason(cost, useResourceStore.getState().stateFor(builders[0].ownerId).amounts.influence ?? 0)
  return {
    label: withStarbaseCost('Build Starbase', cost),
    disabled: !ok,
    title: starbaseActionTitle(ok, refused && !refused.ok ? refused.reason : null, short, cost, 'Fly there and build a Starbase from the hold'),
    onClick: () => orderSelectedToDoAt(systemId, { kind: 'build-starbase' }),
  }
}
