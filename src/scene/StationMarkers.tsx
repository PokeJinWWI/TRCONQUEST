import { Html } from '@react-three/drei'
import { useMemo } from 'react'
import { ownerDisplay } from '../data/countryRoster'
import { STARBASE_TIERS } from '../data/starbaseData'
import { useStarbasePanelStore } from '../state/starbasePanelStore'
import { useStarbaseStore } from '../state/starbaseStore'

// The orbital stations circling a body (a Starbase with a zone), drawn in the satellite view: an orbital ring is a torus around the
// equator, anything smaller a block on its orbit. One mesh per station (a handful at most), coloured by owner; a click opens the station.
// No clock subscription: a station under construction is drawn the same, the panel says it is building.
export function StationMarkers({ bodyName, radius }: { bodyName: string; radius: number }) {
  const all = useStarbaseStore((s) => s.starbases)
  const stations = useMemo(() => all.filter((sb) => sb.zone && sb.zone.slice(0, sb.zone.lastIndexOf('~')) === bodyName), [all, bodyName])
  return (
    <>
      {stations.map((sb, i) => {
        const tier = sb.tier ?? 'starbase'
        const color = ownerDisplay(sb.ownerId).color
        const high = sb.zone!.endsWith('~high')
        const orbit = radius * (high ? 1.9 : 1.35) + 0.4
        const label = sb.name ?? `${STARBASE_TIERS[tier].label} (${sb.zone!.endsWith('~high') ? 'high' : 'low'} orbit)`
        const open = (e: { stopPropagation: () => void }) => {
          e.stopPropagation()
          useStarbasePanelStore.getState().open(sb.id)
        }
        if (tier === 'orbital-ring') {
          return (
            <group key={sb.id}>
              <mesh rotation={[Math.PI / 2, 0, 0]} onClick={open}>
                <torusGeometry args={[orbit, Math.max(0.06, radius * 0.025), 10, 128]} />
                <meshBasicMaterial color={color} transparent opacity={0.9} />
              </mesh>
              <Html position={[orbit, 0, 0]} center distanceFactor={14} style={{ pointerEvents: 'none' }}>
                <div className="station-label" style={{ color }}>{label}</div>
              </Html>
            </group>
          )
        }
        const angle = (i / Math.max(1, stations.length)) * Math.PI * 2 + 0.6
        const size = Math.max(0.12, radius * 0.06)
        return (
          <group key={sb.id} position={[Math.cos(angle) * orbit, 0, Math.sin(angle) * orbit]}>
            <mesh onClick={open}>
              <boxGeometry args={[size * 2, size, size]} />
              <meshBasicMaterial color={color} />
            </mesh>
            <Html center distanceFactor={14} position={[0, size * 1.6, 0]} style={{ pointerEvents: 'none' }}>
              <div className="station-label" style={{ color }}>{label}</div>
            </Html>
          </group>
        )
      })}
    </>
  )
}

// The system stations standing at a star (a Starbase with no zone), drawn beside the primary star in the system view.
export function StarStationMarkers({ starId, position, orbit = 3.2 }: { starId: string; position: [number, number, number]; orbit?: number }) {
  const all = useStarbaseStore((s) => s.starbases)
  const stations = useMemo(() => all.filter((sb) => !sb.zone && sb.starId === starId), [all, starId])
  return (
    <>
      {stations.map((sb, i) => {
        const color = ownerDisplay(sb.ownerId).color
        const angle = (i / Math.max(1, stations.length)) * Math.PI * 2 + 0.4
        const label = sb.name ?? `${STARBASE_TIERS[sb.tier ?? 'starbase'].label}`
        return (
          <group key={sb.id} position={[position[0] + Math.cos(angle) * orbit, position[1], position[2] + Math.sin(angle) * orbit]}>
            <mesh
              onClick={(e) => {
                e.stopPropagation()
                useStarbasePanelStore.getState().open(sb.id)
              }}
            >
              <octahedronGeometry args={[0.3, 0]} />
              <meshBasicMaterial color={color} />
            </mesh>
            <Html center distanceFactor={14} position={[0, 0.7, 0]} style={{ pointerEvents: 'none' }}>
              <div className="station-label" style={{ color }}>{label} ({ownerDisplay(sb.ownerId).name})</div>
            </Html>
          </group>
        )
      })}
    </>
  )
}
