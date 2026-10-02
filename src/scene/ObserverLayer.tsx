import { useMemo } from 'react'
import { AdditiveBlending, CanvasTexture } from 'three'
import type { StarData } from '../data/starData'
import { empireMarkers, laneSegments } from './observerView'

function dotTexture(): CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 64
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.beginPath()
  ctx.arc(32, 32, 24, 0, Math.PI * 2)
  ctx.fill()
  return new CanvasTexture(canvas)
}

// Observer mode's map layers for one neighbourhood: every charted hyperlane as ONE
// LineSegments draw call, and one point cloud with a marker per empire-owned star.
export function ObserverLayer({ stars, lanes }: { stars: StarData[]; lanes: string[] }) {
  const segments = useMemo(() => laneSegments(lanes, stars), [lanes, stars])
  const markers = useMemo(() => empireMarkers(stars), [stars])
  const texture = useMemo(dotTexture, [])
  return (
    <>
      {segments.length > 0 && (
        <lineSegments frustumCulled={false}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[segments, 3]} />
          </bufferGeometry>
          <lineBasicMaterial color="#7ce8ff" transparent opacity={0.9} />
        </lineSegments>
      )}
      {markers.positions.length > 0 && (
        <points frustumCulled={false}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[markers.positions, 3]} />
            <bufferAttribute attach="attributes-color" args={[markers.colors, 3]} />
          </bufferGeometry>
          <pointsMaterial size={18} sizeAttenuation={false} vertexColors map={texture} transparent depthWrite={false} blending={AdditiveBlending} alphaTest={0.05} />
        </points>
      )}
    </>
  )
}
