import type { ShipInstance } from '../state/shipStore'

// A signal on its way to a ship. Every strategic command that has to cross FTL
// comms delay — a move, a Shift-queued move, a stance change — is drawn as a
// small pulsing dot travelling from the capital toward the ship, so the player
// can SEE how long it will take: it crawls out at the speed the delay implies,
// carries the days left, and the order takes effect the moment it lands. (The
// same idea as a missile in the combat arena.)
export interface PendingSignal {
  shipId: string
  // Which of the ship's pending commands this is.
  kind: 'move' | 'stance' | 'queue'
  index: number
  label: string
  sentSimDays: number
  arrivesSimDays: number
}

// Every signal a ship currently has in flight.
export function pendingSignalsOf(ship: ShipInstance, fallbackSentSimDays: number): PendingSignal[] {
  const out: PendingSignal[] = []
  const move = ship.pendingMoveOrder
  if (move) out.push({ shipId: ship.id, kind: 'move', index: 0, label: 'Order', sentSimDays: move.sentSimDays ?? fallbackSentSimDays, arrivesSimDays: move.arrivesSimDays })
  const stance = ship.pendingStance
  if (stance) out.push({ shipId: ship.id, kind: 'stance', index: 0, label: 'Stance', sentSimDays: stance.sentSimDays ?? fallbackSentSimDays, arrivesSimDays: stance.arrivesSimDays })
  ;(ship.pendingQueueAdds ?? []).forEach((a, i) =>
    out.push({ shipId: ship.id, kind: 'queue', index: i, label: 'Queued order', sentSimDays: a.sentSimDays, arrivesSimDays: a.arrivesSimDays }),
  )
  return out
}

// How far along its trip a signal is, 0..1.
export function signalProgress(signal: Pick<PendingSignal, 'sentSimDays' | 'arrivesSimDays'>, simDays: number): number {
  const span = signal.arrivesSimDays - signal.sentSimDays
  if (span <= 0) return 1
  return Math.min(1, Math.max(0, (simDays - signal.sentSimDays) / span))
}

