import { wasDrag } from './dragGuard'
import { GalaxyMarkers } from './GalaxyMarkers'
import { useStarbaseActivityKey } from '../hooks/useStarbaseActivity'
import { deselectShipsOnEmptyClick } from './deselect'
import { usePlayerIntel } from './intel'
import { KeyboardPan } from './KeyboardPan'
import { useMemo, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Stars } from '@react-three/drei'
import { Vector3 } from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import type { NeighborhoodData } from '../data/neighborhoodData'
import { NEIGHBORHOODS, neighborhoodScenePosition } from '../data/neighborhoodData'
import { getStarsForNeighborhood } from '../data/starData'
import { useObserverStore } from '../state/observerStore'
import { empireClusterClaims } from './observerView'
import { useViewStore } from '../state/viewStore'
import { CameraFocusRig } from './CameraFocusRig'
import { SelectionTracker } from './SelectionTracker'
import { DistanceThresholdWatcher } from './DistanceThresholdWatcher'
import { DeepSpaceClickPlane } from './DeepSpaceClickPlane'
import { GalacticShips } from './GalacticShips'
import { clusterScenePosition, isShipInGalacticSpace } from './shipPhysics'
import { orderSelectedFleets, playerShipRenderPosition } from './commsVisual'
import { hasOwnShipSelected } from './panelOpen'
import { ClusterJumpRow } from './ClusterJumpRow'
import { useShipStore } from '../state/shipStore'
import { SOLAR_NEIGHBORHOOD_ID } from '../data/galaxyGen'
import { ShipPanel } from './ShipPanel'
import { galacticPanels } from './galacticSelection'
import { cameraAlong, nearestDistance, separationDistance } from './framing'
import { homeClusterOf } from './homeCluster'
import { ClusterDistanceRows } from './ClusterDistanceRows'
import { clusterCoreDistanceKly } from './clusterDistances'
import { usePlayerStore } from '../state/playerStore'
import { DraggableWindow } from '../components/DraggableWindow'
import { useTerritoryStore } from '../state/territoryStore'
import { useStarbaseStore } from '../state/starbaseStore'
import { useGameTimeStore } from '../state/gameTimeStore'
import { systemClaim, type SystemClaim } from './territory'
import { starbaseOwnersOf, type Starbase } from './starbaseLogic'
import type { OwnerMap } from './territory'

const MAX_DISTANCE = 6000
const FOCUS_ARRIVE_DISTANCE = 5
// How close the camera ends up to a ship it was flown to (the ship panel's Go To).
const SHIP_FOCUS_ARRIVE_DISTANCE = 8
// How close (to the locked-on neighborhood) manually zooming in has to get
// before it counts as "entering" it — mirrors InterstellarScene's own
// ENTER_SYSTEM_DISTANCE, same select-first-then-zoom-or-button model one
// level up.
const ENTER_INTERSTELLAR_DISTANCE = 6
// The plain "just arrived, nothing selected" camera position — used both as
// the far-view starting position AND, translated to sit next to whichever
// neighborhood a continuity arrival is returning to (see
// continuityNeighborhoodPosition below), as the near-view one too. Same
// "offset either way" idea InterstellarScene's own DEFAULT_CAMERA_OFFSET
// already uses one level down.
const DEFAULT_CAMERA_OFFSET: [number, number, number] = [40, 60, 110]
// The default opening (no cluster to come back to) looks at the player's own cluster, from far
// enough that its nearest neighbour sits NEIGHBOUR_SEPARATION_PX away on screen: ring, ship badge
// and the lane between them stay apart and clickable. (It used to open on the galaxy's centre,
// with the Solar Neighbourhood's markers under the Outliner and the nearest cluster on top of it.)
// Zooming out still shows the whole galaxy.
const CAMERA_FOV_DEG = 50
const NEIGHBOUR_SEPARATION_PX = 150

// Whoever holds ground in this neighbourhood's charted systems — the union
// of every one of its stars' own systemClaim (bodies plus Starbases, see
// scene/territory.systemClaim), folded up one level the same way a star's
// own claim folds up from its bodies. Only the Solar Neighbourhood has
// charted stars today (see data/starData.getStarsForNeighborhood); every
// other neighbourhood always reads unclaimed, which is honest — there's
// nothing there yet to claim.
function neighborhoodClaim(neighborhood: NeighborhoodData, bodyOwner: OwnerMap, starbases: Starbase[], simDays: number, knownStar: (starId: string) => boolean): SystemClaim {
  const present = new Set<string>()
  for (const star of getStarsForNeighborhood(neighborhood.id)) {
    // Only systems the player has explored contribute (scene/intel.ts).
    if (!knownStar(star.id)) continue
    const claim = systemClaim(star.id, bodyOwner, starbaseOwnersOf(star.id, starbases, simDays))
    if (claim.kind === 'owned') present.add(claim.countryId)
    else if (claim.kind === 'contested') for (const id of claim.countryIds) present.add(id)
  }
  if (present.size === 0) return { kind: 'unclaimed' }
  if (present.size === 1) return { kind: 'owned', countryId: [...present][0] }
  return { kind: 'contested', countryIds: [...present].sort() }
}

export function GalacticViewScene() {
  const controlsRef = useRef<OrbitControlsImpl>(null)
  const enterInterstellar = useViewStore((s) => s.enterInterstellar)
  const selectedId = useViewStore((s) => s.inViewSelection)
  const selectInView = useViewStore((s) => s.selectInView)
  const lockOnEnabled = useViewStore((s) => s.lockOnEnabled)
  const [focusedId, setFocusedId] = useState<string | null>(null)
  // Set by the ship panel's Go To: a one-time fly to the selected ship.
  const [flyingToShip, setFlyingToShip] = useState(false)

  const selectedShipId = useShipStore((s) => s.selectedShipId)
  const trackedShip = useShipStore((s) => (selectedShipId ? s.ships.find((x) => x.id === selectedShipId) ?? null : null))
  const panels = galacticPanels(selectedShipId, selectedId)
  const selected = useMemo(() => NEIGHBORHOODS.find((n) => n.id === selectedId) ?? null, [selectedId])
  const focused = useMemo(() => NEIGHBORHOODS.find((n) => n.id === focusedId) ?? null, [focusedId])

  const bodyOwner = useTerritoryStore((s) => s.bodyOwner)
  const starbases = useStarbaseStore((s) => s.starbases)
  // Not the clock: see useStarbaseActivityKey (a scene subscribed to simDays re-rendered every frame).
  const starbaseActivity = useStarbaseActivityKey()
  const intel = usePlayerIntel()
  // Observer mode (a cheat) adds every empire's neighbourhood: a view override only.
  const observer = useObserverStore((s) => s.on)
  const claimsByNeighborhood = useMemo(() => {
    const claims = new Map(NEIGHBORHOODS.map((n) => [n.id, neighborhoodClaim(n, bodyOwner, starbases, useGameTimeStore.getState().simDays, intel.known)]))
    if (observer) for (const [id, claim] of empireClusterClaims()) claims.set(id, claim)
    return claims
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bodyOwner, starbases, starbaseActivity, intel.known, observer])

  // If we're arriving here because the player zoomed out of a neighborhood's
  // interstellar view, inViewSelection is already seeded to that
  // neighborhood (see exitInterstellarToGalactic) — used once, at mount,
  // purely to start the camera framed on it directly rather than snapping
  // all the way out to the far default. Captured via a ref (not read
  // reactively), same reasoning as InterstellarScene's own
  // continuityStarIdRef, so a later in-scene click doesn't retroactively
  // move where the camera STARTED.
  const continuityNeighborhoodIdRef = useRef(useViewStore.getState().inViewSelection)
  const continuityNeighborhoodPosition = useMemo<[number, number, number] | null>(() => {
    const id = continuityNeighborhoodIdRef.current
    if (!id) return null
    const neighborhood = NEIGHBORHOODS.find((n) => n.id === id)
    return neighborhood ? neighborhoodScenePosition(neighborhood) : null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // Home: the cluster the player's capital is in. Read once, at mount, like the continuity neighbourhood.
  const homeClusterId = useMemo(() => homeClusterOf(usePlayerStore.getState().selectedCountryId), [])
  const cameraHomeId = homeClusterId ?? SOLAR_NEIGHBORHOOD_ID
  const homeFrame = useMemo(() => {
    const at = clusterScenePosition(cameraHomeId).toArray() as [number, number, number]
    const others = NEIGHBORHOODS.filter((n) => n.id !== cameraHomeId).map(neighborhoodScenePosition)
    const gap = nearestDistance(at, others)
    const distance = Number.isFinite(gap) ? separationDistance(gap, NEIGHBOUR_SEPARATION_PX, CAMERA_FOV_DEG, window.innerHeight) : 400
    return { target: at, position: cameraAlong(at, DEFAULT_CAMERA_OFFSET, Math.min(Math.max(distance, 120), MAX_DISTANCE / 2)) }
  }, [cameraHomeId])
  const initialCameraPosition = useMemo<[number, number, number]>(() => {
    if (!continuityNeighborhoodPosition) return homeFrame.position
    return [
      continuityNeighborhoodPosition[0] + DEFAULT_CAMERA_OFFSET[0],
      continuityNeighborhoodPosition[1] + DEFAULT_CAMERA_OFFSET[1],
      continuityNeighborhoodPosition[2] + DEFAULT_CAMERA_OFFSET[2],
    ]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const initialTarget = useMemo<[number, number, number]>(
    () => continuityNeighborhoodPosition ?? homeFrame.target,
    [continuityNeighborhoodPosition, homeFrame],
  )

  // Select-first, same as every other level: clicking just locks the camera
  // on (SelectionTracker) — flying all the way in only starts once "Enter
  // Neighborhood" is pressed, or the player zooms in close enough themselves.
  const handleSelect = (neighborhood: NeighborhoodData) => {
    selectInView(neighborhood.id)
  }

  const handleEnterNeighborhood = () => {
    if (selected?.hasInterstellarData) setFocusedId(selected.id)
  }

  // Where the selected ship is: out between clusters its live position, else the
  // Solar Neighbourhood it is inside.
  const shipFocusPosition = (): Vector3 =>
    trackedShip && isShipInGalacticSpace(trackedShip)
      ? playerShipRenderPosition(trackedShip, useGameTimeStore.getState().simDays).position
      : clusterScenePosition(SOLAR_NEIGHBORHOOD_ID)

  // A click on a marker selects it (markers are one point cloud, so it is picked by
  // screen distance); anywhere else it is a click on empty space.
  const pickerRef = useRef<((clientX: number, clientY: number) => NeighborhoodData | null) | null>(null)
  const pickedByClick = (event: MouseEvent): boolean => {
    const hit = pickerRef.current?.(event.clientX, event.clientY)
    if (!hit) return false
    handleSelect(hit)
    return true
  }
  // Right-click: with a ship of yours selected, an order (to the cluster under the
  // pointer, else to that point of galactic space); with none, it just selects the
  // cluster. Out between clusters a ship can only go to a cluster or a point of space.
  const handleOrderTo = (point: [number, number, number], event: MouseEvent) => {
    const hit = pickerRef.current?.(event.clientX, event.clientY)
    if (!hasOwnShipSelected()) {
      if (hit) handleSelect(hit)
      return
    }
    orderSelectedFleets(hit ? { kind: 'cluster', clusterId: hit.id } : { kind: 'galactic-point', position: point })
  }
  const handleUnfocus = (event: MouseEvent) => {
    // A right-click on empty space is an order, not a deselect.
    if (event.type === 'contextmenu' || wasDrag(event)) return
    if (event.target instanceof Element && event.target.closest('.planet-marker')) return
    if (pickedByClick(event)) return
    deselectShipsOnEmptyClick(event)
    selectInView(null)
  }

  return (
    <div className="galactic-wrapper">
      <Canvas camera={{ position: initialCameraPosition, fov: CAMERA_FOV_DEG, near: 0.5, far: 20000 }} onPointerMissed={handleUnfocus}>
        <color attach="background" args={['#020409']} />
        <KeyboardPan controlsRef={controlsRef} />
        <ambientLight intensity={0.3} />
        <Stars radius={4000} depth={1000} count={6000} factor={6} fade speed={0.1} />

        <DeepSpaceClickPlane onDeselect={() => selectInView(null)} onOrderTo={handleOrderTo} size={200000} consumeClick={pickedByClick} />

        <GalacticShips />

        <GalaxyMarkers claims={claimsByNeighborhood} selectedId={selectedId} pickerRef={pickerRef} />

        {focused && (
          <CameraFocusRig
            key={focused.id}
            controlsRef={controlsRef}
            arriveDistance={FOCUS_ARRIVE_DISTANCE}
            getTargetPosition={() => new Vector3(...neighborhoodScenePosition(focused))}
            onArrive={() => enterInterstellar(focused.id, true)}
          />
        )}

        {flyingToShip && trackedShip && (
          <CameraFocusRig
            key={selectedShipId ?? 'ship'}
            controlsRef={controlsRef}
            arriveDistance={SHIP_FOCUS_ARRIVE_DISTANCE}
            getTargetPosition={shipFocusPosition}
            onArrive={() => setFlyingToShip(false)}
          />
        )}

        {selected && !focused && lockOnEnabled && !trackedShip && (
          <SelectionTracker controlsRef={controlsRef} getPosition={() => new Vector3(...neighborhoodScenePosition(selected))} />
        )}

        {/* A selected ship wins the camera lock: out between clusters it pans to the ship,
            inside the Solar Neighbourhood to the neighbourhood (the view never changes). */}
        {trackedShip && !focused && !flyingToShip && lockOnEnabled && (
          <SelectionTracker
            controlsRef={controlsRef}
            getPosition={shipFocusPosition}
          />
        )}

        {selected?.hasInterstellarData && !focused && lockOnEnabled && (
          <DistanceThresholdWatcher
            mode="min"
            threshold={ENTER_INTERSTELLAR_DISTANCE}
            onTrigger={handleEnterNeighborhood}
            controlsRef={controlsRef}
          />
        )}

        <OrbitControls
          ref={controlsRef}
          target={initialTarget}
          enabled={!focused && !flyingToShip}
          enablePan
          enableDamping
          dampingFactor={0.08}
          minDistance={1}
          maxDistance={MAX_DISTANCE}
        />
      </Canvas>

      {/* Go To flies the camera only to a ship that is ON this map (out between clusters);
          a ship inside a cluster gets the panel's default: open the map it is in (shipNav.viewShip). */}
      {panels.ship && <ShipPanel onGoTo={trackedShip && isShipInGalacticSpace(trackedShip) ? () => setFlyingToShip(true) : undefined} goToPending={flyingToShip} />}

      {panels.cluster && selected && (
        <DraggableWindow title={selected.name} memoryKey="galaxy-selection" onClose={() => selectInView(null)}>
          <div className="inspect-row">
            <span className="inspect-label">Distance from core</span>
            <span className="inspect-value">{clusterCoreDistanceKly(selected.id).toFixed(1)} kly</span>
          </div>
          <ClusterDistanceRows clusterId={selected.id} homeClusterId={homeClusterId} />
          {selected.id !== SOLAR_NEIGHBORHOOD_ID && <ClusterJumpRow clusterId={selected.id} />}
          <div className="inspect-divider" />
          {selected.hasInterstellarData ? (
            focused ? (
              <div className="inspect-status ok">Entering neighborhood…</div>
            ) : (
              <button type="button" className="detail-view-btn" onClick={handleEnterNeighborhood}>
                Enter Neighborhood
              </button>
            )
          ) : (
            <div className="inspect-status">Not yet charted</div>
          )}
        </DraggableWindow>
      )}
    </div>
  )
}
