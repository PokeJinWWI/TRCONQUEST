interface HyperlaneLineProps {
  from: [number, number, number]
  to: [number, number, number]
}

// A charted hyperlane between two stars — a plain straight segment, same
// `<line>`/bufferGeometry pattern as OrbitRing, just two points instead of a
// sampled circle. Same color/opacity as OrbitRing (rather than a distinct
// hue) specifically so it reads clearly against the dark interstellar
// background — a dimmer, unrelated color proved hard to actually see there.
export function HyperlaneLine({ from, to }: HyperlaneLineProps) {
  const points = new Float32Array([...from, ...to])

  return (
    <line>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[points, 3]} />
      </bufferGeometry>
      <lineBasicMaterial color="#7ce8ff" transparent opacity={0.9} />
    </line>
  )
}
