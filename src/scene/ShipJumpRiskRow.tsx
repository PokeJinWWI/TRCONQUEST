// The ship panel's Jump Risk row: the REAL chance the ship is lost jumping to the star the
// player has picked on the interstellar map (or the star it has a jump waiting for), on a
// lane charted or not, and what would make it safer. Nothing is shown when there is no such
// destination or the ship would not jump there (a flight, a warp ship, its own system): the
// row used to show the drive's two fixed rates whatever the destination, which was never the
// risk of any real jump. Its own component so it follows research and newly charted lanes.
import { HYPERDRIVE_TECH_IDS, hyperdriveMkOf } from '../data/warpData'
import { findStar } from '../data/starData'
import { useHyperlaneStore } from '../state/hyperlaneStore'
import { useGameTimeStore } from '../state/gameTimeStore'
import type { ShipInstance } from '../state/shipStore'
import { useTechStore } from '../state/techStore'
import { useViewStore } from '../state/viewStore'
import { jumpRiskRow } from './jumpWarning'
import { hyperdriveJumpChance, jumpIsCharted } from './shipPhysics'

export function ShipJumpRiskRow({ ship, elevated }: { ship: ShipInstance; elevated: boolean }) {
  const mk = useTechStore((s) => hyperdriveMkOf(s.stateFor(ship.ownerId).researched))
  useHyperlaneStore((s) => s.lanesOf(ship.ownerId).length)
  const level = useViewStore((s) => s.level)
  const picked = useViewStore((s) => s.inViewSelection)
  // The star a jump is waiting for, else the star picked on the interstellar map.
  const waiting = ship.pendingHyperdriveJump && findStar(ship.pendingHyperdriveJump) ? ship.pendingHyperdriveJump : null
  const starId = waiting ?? (level === 'interstellar' && picked && findStar(picked) ? picked : null)
  if (!starId) return null
  const simDays = useGameTimeStore.getState().simDays
  const destination = { kind: 'star' as const, starId }
  const chance = hyperdriveJumpChance(ship, destination, simDays)
  if (chance === null) return null
  const row = jumpRiskRow({ chance, charted: jumpIsCharted(ship, destination, simDays), destination: findStar(starId)?.name ?? starId, elevated, mk, maxMk: HYPERDRIVE_TECH_IDS.length })
  return (
    <>
      <div className="inspect-row" title="The chance the ship is lost on this hyperdrive jump, the number the order rolls against. It grows with distance (and, off a charted lane, the destination's mass) and falls with your Hyperdrive Mk and on a lane you have charted.">
        <span className="inspect-label">{row.label}</span>
        <span className="inspect-value">{row.value}</span>
      </div>
      {row.hint && <div className="inspect-status">{row.hint}</div>}
    </>
  )
}
