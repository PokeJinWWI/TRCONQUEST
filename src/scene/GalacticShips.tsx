// Ships in the galactic view: the player's own ships out between clusters (a marker
// each fleet, riding its live position, with its order drawn as a line) and a
// presence badge on the Solar Neighbourhood for the ones inside it (all of them
// begin there). Few ships, so DOM markers are fine here: the 300+ cluster markers
// stay a point cloud (GalaxyMarkers).
import { Html } from '@react-three/drei'
import { useMemo } from 'react'
import { RELATION_COLORS } from '../data/shipData'
import { usePlayerStore } from '../state/playerStore'
import { useShipStore, type MoveDestination, type ShipInstance } from '../state/shipStore'
import { forwardWheelToCanvas } from '../utils/forwardWheel'
import { NavigationLine } from './NavigationLine'
import { PendingOrderLine } from './PendingOrderLine'
import { QueuedRouteLine } from './QueuedRouteLine'
import { playerShipRenderPosition } from './commsVisual'
import { clusterLaneSegments, galacticDestinationPosition, galacticOrderLines, shipsByCluster } from './galacticOrders'
import { NEIGHBORHOODS, neighborhoodScenePosition } from '../data/neighborhoodData'
import { useHyperlaneStore, allLanesOf } from '../state/hyperlaneStore'
import { useObserverStore } from '../state/observerStore'
import { clusterName } from './clusters'
import { ShipMarker } from './ShipMarker'
import { SHIP_ICON_SIZE, ShipIcon, roleOfClass } from './ShipIcon'
import { homeBadgeLeadId } from './galacticSelection'
import { isAdditiveClick } from './selectionInput'
import { clusterRestingShipsByFleet, clusterScenePosition, galacticPosition, isShipInGalacticSpace } from './shipPhysics'

const NAV_ARROW_LENGTH = 5
// The galactic marker size: between the system and interstellar ones.
const GALACTIC_ICON_PX = SHIP_ICON_SIZE.interstellar
// Dash/gap (screen pixels) of a command still behind comms delay and of queued legs: the
// interstellar view's values (InterstellarScene PENDING_DASH_SIZE / PENDING_GAP_SIZE).
const PENDING_DASH_SIZE = 6
const PENDING_GAP_SIZE = 4

// Where a pending command's dashed line starts: the ship's marker if it is out between
// clusters, else the Solar Neighbourhood's point (where its badge is).
const resolveGalacticStart = (ship: ShipInstance, simDays: number) => galacticPosition(playerShipRenderPosition(ship, simDays))
const resolveGalacticTarget = (destination: MoveDestination) => galacticDestinationPosition(destination)

export function GalacticShips() {
  const ships = useShipStore((s) => s.ships)
  const selectShip = useShipStore((s) => s.selectShip)
  const playerId = usePlayerStore((s) => s.selectedCountryId)
  const own = useMemo(() => ships.filter((s) => s.ownerId === playerId), [ships, playerId])
  const out = useMemo(() => own.filter(isShipInGalacticSpace), [own])
  const outClusters = useMemo(() => clusterRestingShipsByFleet(out), [out])
  // The ones inside a cluster (the Solar Neighbourhood, or another they have entered),
  // as a badge on that cluster.
  const inside = useMemo(() => [...shipsByCluster(own)], [own])
  // The charted lanes between clusters: the player's own, every nation's in Observer
  // mode, as ONE LineSegments.
  const lanesByNation = useHyperlaneStore((s) => s.lanes)
  const observer = useObserverStore((s) => s.on)
  const laneSegments = useMemo(() => {
    const lanes = observer ? allLanesOf(lanesByNation) : playerId ? lanesByNation[playerId] ?? [] : []
    const at = new Map(NEIGHBORHOODS.map((n) => [n.id, neighborhoodScenePosition(n)]))
    return clusterLaneSegments(lanes, (id) => at.get(id) ?? null)
  }, [lanesByNation, playerId, observer])
  // The same three kinds of order arrow the interstellar view draws (scene/galacticOrders.ts).
  const lines = useMemo(() => galacticOrderLines(ships, playerId), [ships, playerId])

  return (
    <>
      {laneSegments.length > 0 && (
        <lineSegments key={laneSegments.length} frustumCulled={false}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[laneSegments, 3]} />
          </bufferGeometry>
          <lineBasicMaterial color="#7ce8ff" transparent opacity={0.9} />
        </lineSegments>
      )}
      {outClusters.map((cluster) => (
        <ShipMarker key={cluster.key} ships={cluster.ships} iconSize={GALACTIC_ICON_PX} />
      ))}
      {lines.committed.map((s) => (
        <NavigationLine key={`nav-${s.id}`} ship={s} color={RELATION_COLORS.own} arrowLength={NAV_ARROW_LENGTH} />
      ))}
      {lines.pending.map((s) => (
        <PendingOrderLine
          key={`pending-${s.id}`}
          ship={s}
          color={RELATION_COLORS.own}
          arrowLength={NAV_ARROW_LENGTH}
          dashSize={PENDING_DASH_SIZE}
          gapSize={PENDING_GAP_SIZE}
          resolveTarget={resolveGalacticTarget}
          resolveStart={resolveGalacticStart}
        />
      ))}
      {lines.queued.map((s) => (
        <QueuedRouteLine
          key={`queue-${s.id}`}
          ship={s}
          color={RELATION_COLORS.own}
          arrowLength={NAV_ARROW_LENGTH}
          dashSize={PENDING_DASH_SIZE}
          gapSize={PENDING_GAP_SIZE}
          resolveTarget={resolveGalacticTarget}
        />
      ))}
      {inside.map(([clusterId, home]) => (
        <group key={clusterId} position={clusterScenePosition(clusterId)}>
          <Html zIndexRange={[0, 0]} style={{ pointerEvents: 'auto' }}>
            <div
              className="galactic-ship-badge"
              // Shift+drag box selection picks the badge by this (components/BoxSelectLayer).
              data-select-ship={homeBadgeLeadId(home) ?? undefined}
              title={`${home.length} of your ships in ${clusterName(clusterId)}`}
              onClick={(e) => {
                e.stopPropagation()
                const lead = homeBadgeLeadId(home)!
                // Shift adds to / removes from the selection, as on every ship marker.
                if (isAdditiveClick(e)) useShipStore.getState().toggleShipSelection(lead)
                else selectShip(lead)
              }}
              onWheel={forwardWheelToCanvas}
            >
              <ShipIcon inline role={roleOfClass(home[0].classId)} color={RELATION_COLORS.own} size={SHIP_ICON_SIZE.interstellar} />
              {home.length > 1 && <span className="galactic-ship-badge-count">{home.length}</span>}
            </div>
          </Html>
        </group>
      ))}
    </>
  )
}
