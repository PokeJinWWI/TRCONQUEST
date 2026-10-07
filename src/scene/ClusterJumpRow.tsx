// The cluster panel's Jump row: the loss chance of a hyperdrive jump there for the
// player's selected ships, and what would make it safer. Its own component so the
// number follows research and newly charted lanes (it used to be computed once, when
// the cluster was selected, and went stale).
import { HYPERDRIVE_TECH_IDS, hyperdriveMkOf } from '../data/warpData'
import { useGameTimeStore } from '../state/gameTimeStore'
import { useHyperlaneStore } from '../state/hyperlaneStore'
import { usePlayerStore } from '../state/playerStore'
import { isPlayerOwned } from '../state/shipRelations'
import { useShipStore } from '../state/shipStore'
import { useTechStore } from '../state/techStore'
import { formatLossPercent, saferJumpHint } from './jumpWarning'
import { hyperdriveJumpChance } from './shipPhysics'

export function ClusterJumpRow({ clusterId }: { clusterId: string }) {
  const playerId = usePlayerStore((s) => s.selectedCountryId)
  // Primitives: what the risk depends on besides the ships themselves.
  const mk = useTechStore((s) => hyperdriveMkOf(s.stateFor(playerId ?? '').researched))
  useHyperlaneStore((s) => s.lanesOf(playerId).length)
  useShipStore((s) => s.selectedShipIds.join(','))
  const store = useShipStore.getState()
  const simDays = useGameTimeStore.getState().simDays
  const chances = store.ships
    .filter((s) => store.selectedShipIds.includes(s.id) && isPlayerOwned(s))
    .map((s) => hyperdriveJumpChance(s, { kind: 'cluster', clusterId }, simDays))
    .filter((c): c is number => c !== null)
  if (chances.length === 0) return null
  const worst = Math.max(...chances)
  const hint = saferJumpHint(worst, mk, HYPERDRIVE_TECH_IDS.length)
  return (
    <>
      <div className="inspect-row" title="A hyperdrive jump's loss chance grows with distance (and falls with your Hyperdrive Mk, and on a lane you have charted). Warp ships fly instead, at warp speed.">
        <span className="inspect-label">Jump</span>
        <span className="inspect-value">{formatLossPercent(worst)} chance the ship is lost</span>
      </div>
      {hint && <div className="inspect-status">{hint}</div>}
    </>
  )
}
