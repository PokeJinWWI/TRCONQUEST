import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import { Vector3, type Group } from 'three'
import type { ShipInstance } from '../state/shipStore'
import { pendingSignalsOf, signalProgress, type PendingSignal } from './commsSignal'
import { useShipStore } from '../state/shipStore'
import { useGameTimeStore } from '../state/gameTimeStore'
import { playerVisualShipRenderPosition } from './commsVisual'

// A signal on its way to a ship is drawn as a small pulsing dot travelling from
// the capital toward it — see commsSignal.ts for what counts as one.
const origin = new Vector3()

function SignalDot({ signal, resolveOrigin, resolveShipPosition }: { signal: PendingSignal; resolveOrigin: (simDays: number) => Vector3 | null; resolveShipPosition?: ShipPositionResolver }) {
  const groupRef = useRef<Group>(null)
  const timeRef = useRef<HTMLSpanElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  useFrame(() => {
    const group = groupRef.current
    const ship = useShipStore.getState().ships.find((s) => s.id === signal.shipId)
    const simDays = useGameTimeStore.getState().simDays
    const from = resolveOrigin(simDays)
    if (!group || !ship || !from) {
      if (wrapRef.current) wrapRef.current.style.display = 'none'
      return
    }
    if (wrapRef.current) wrapRef.current.style.display = ''
    origin.copy(from)
    const to = resolveShipPosition ? resolveShipPosition(ship, simDays) : playerVisualShipRenderPosition(ship, simDays).position
    if (!to) {
      if (wrapRef.current) wrapRef.current.style.display = 'none'
      return
    }
    group.position.copy(origin).lerp(to, signalProgress(signal, simDays))
    if (timeRef.current) timeRef.current.textContent = `${Math.max(0, signal.arrivesSimDays - simDays).toFixed(1)}d`
  })

  return (
    <group ref={groupRef}>
      <Html zIndexRange={[0, 0]} style={{ pointerEvents: 'none' }}>
        <div ref={wrapRef} className={`comms-signal ${signal.kind}`} title={`${signal.label} in transit — takes effect when the signal arrives`}>
          <span className="comms-signal-dot" />
          <span ref={timeRef} className="comms-signal-time" />
        </div>
      </Html>
    </group>
  )
}

// The signals for every listed ship. `resolveOrigin` gives where they set out
// from IN THIS SCENE'S FRAME (the capital), or null when the capital isn't
// representable here (a ship in another system, seen from system view) — then
// that signal isn't drawn.
export type ShipPositionResolver = (ship: ShipInstance, simDays: number) => Vector3 | null

export function CommsSignals({
  ships,
  resolveOrigin,
  resolveShipPosition,
}: {
  ships: ShipInstance[]
  resolveOrigin: (simDays: number) => Vector3 | null
  // Where the ship is in THIS scene's frame (default: its own render position).
  resolveShipPosition?: ShipPositionResolver
}) {
  const now = useGameTimeStore.getState().simDays
  return (
    <>
      {ships.flatMap((ship) =>
        pendingSignalsOf(ship, now).map((signal) => (
          <SignalDot key={`${signal.shipId}:${signal.kind}:${signal.arrivesSimDays}:${signal.index}`} signal={signal} resolveOrigin={resolveOrigin} resolveShipPosition={resolveShipPosition} />
        )),
      )}
    </>
  )
}
