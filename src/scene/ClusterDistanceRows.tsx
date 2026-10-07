// The cluster window's "Distance from <selected ship>" and "Distance from home" rows. Its
// own component so a flying ship's distance follows it (the throttled clock, a few
// renders a second) without the galactic scene subscribing to the clock.
import { useThrottledSimDays } from '../hooks/useThrottledSimDays'
import { useShipStore } from '../state/shipStore'
import { playerShipRenderPosition } from './commsVisual'
import { clusterDistanceRows, formatKly, type ShipPlace } from './clusterDistances'
import { shipClusterId } from './clusters'
import { galacticPosition } from './shipPhysics'

export function ClusterDistanceRows({ clusterId, homeClusterId }: { clusterId: string; homeClusterId: string | null }) {
  const simDays = useThrottledSimDays()
  const ship = useShipStore((s) => (s.selectedShipId ? s.ships.find((x) => x.id === s.selectedShipId) ?? null : null))
  let place: ShipPlace | null = null
  if (ship) {
    const inside = shipClusterId(ship)
    place = inside ? { cluster: inside } : { point: galacticPosition(playerShipRenderPosition(ship, simDays)).toArray() as [number, number, number] }
  }
  const rows = clusterDistanceRows({ clusterId, homeClusterId, ship: ship && place ? { name: ship.name, place } : null })
  return (
    <>
      {rows.map((row) => (
        <div className="inspect-row" key={row.label}>
          <span className="inspect-label">{row.label}</span>
          <span className="inspect-value" style={{ whiteSpace: 'nowrap' }}>{formatKly(row.kly)}</span>
        </div>
      ))}
    </>
  )
}
