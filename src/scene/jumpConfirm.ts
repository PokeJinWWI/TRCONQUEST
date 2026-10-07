// Asks the player before a risky hyperdrive jump (the warning text is
// scene/jumpWarning.ts). Wraps any player-facing order: it runs `proceed` straight
// away when no ship would risk more than 5%, else after a confirmation. The risk
// is estimated from where each ship is when the order is given.
import { useConfirmStore } from '../state/confirmStore'
import { useGameTimeStore } from '../state/gameTimeStore'
import type { MoveDestination, ShipInstance } from '../state/shipStore'
import { driveOfShip, hyperdriveJumpChance, jumpIsCharted, planMoveUnchecked } from './shipPhysics'
import { formatTripTime, isLongTrip } from './driveChoice'
import { CHARTED_LANE_RISK_RATIO, jumpRiskTipText, jumpWarning } from './jumpWarning'

// `onCancel` undoes whatever the caller set up ahead of the order (an arrival command).
// A one-line "Jump risk: 43% chance a ship is lost" for the ships a destination's panel
// or hover is about; null when none would jump (a flight, or a warp ship).
export function jumpRiskLine(ships: readonly ShipInstance[], destination: MoveDestination): string | null {
  const simDays = useGameTimeStore.getState().simDays
  const risks = ships.map((s) => ({ chance: hyperdriveJumpChance(s, destination, simDays), charted: jumpIsCharted(s, destination, simDays) })).filter((r): r is { chance: number; charted: boolean } => r.chance !== null)
  if (risks.length === 0) return null
  const worst = risks.reduce((a, b) => (b.chance > a.chance ? b : a))
  return jumpRiskTipText(worst.chance, worst.charted)
}

// The longest trip among the ships that would fly there on reaction drive (days), or null
// when none would (they jump or warp, which have their own warnings or none). A reaction plan
// rolls no dice, so asking for it here changes nothing.
export function longestReactionTripDays(ships: readonly ShipInstance[], destination: MoveDestination, simDays: number): number | null {
  const trips: number[] = []
  for (const ship of ships) {
    if (driveOfShip(ship) !== 'reaction') continue
    const plan = planMoveUnchecked(ship, destination, simDays)
    if (plan.kind === 'order') trips.push(plan.order.arrivalSimDays - simDays)
  }
  return trips.length > 0 ? Math.max(...trips) : null
}

// A trip of more than a year on reaction drive asks first, showing its real length.
function confirmLongTrip(ships: readonly ShipInstance[], destination: MoveDestination, proceed: () => void, onCancel?: () => void): void {
  const days = longestReactionTripDays(ships, destination, useGameTimeStore.getState().simDays)
  if (days === null || !isLongTrip(days)) return proceed()
  useConfirmStore.getState().requestConfirm({
    title: 'Long trip on reaction drive',
    body: `On reaction drive this trip takes ${formatTripTime(days)}.`,
    effects: ['Pick Hyperdrive or Warp in the ship panel (when the ship has one) to go faster.'],
    confirmLabel: 'Go anyway',
    onConfirm: proceed,
    onCancel,
  })
}

export function confirmRiskyJump(ships: readonly ShipInstance[], destination: MoveDestination, proceedAfterAll: () => void, onCancel?: () => void): void {
  const simDays = useGameTimeStore.getState().simDays
  const proceed = () => confirmLongTrip(ships, destination, proceedAfterAll, onCancel)
  const chances = ships.map((s) => hyperdriveJumpChance(s, destination, simDays)).filter((c): c is number => c !== null)
  const warning = jumpWarning(chances)
  if (!warning) return proceed()
  useConfirmStore.getState().requestConfirm({
    title: 'Risky jump',
    body: warning.text,
    effects: [
      'A ship lost in a jump is gone for good.',
      `A lane you have already charted is about ${Math.round(1 / CHARTED_LANE_RISK_RATIO)} times safer: it is charted by a jump that succeeds.`,
    ],
    confirmLabel: 'Jump anyway',
    onConfirm: proceed,
    onCancel,
  })
}
