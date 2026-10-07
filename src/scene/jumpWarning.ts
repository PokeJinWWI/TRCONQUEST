// The warning before the player orders a risky hyperdrive jump. Pure: given the
// loss chances of the ships that would jump, whether to warn and what to say.
// The same 5% line is the AI's own cap (ai/jumpRules.ts).
import { HYPERDRIVE_ESTABLISHED_LANE_LOSS_CHANCE, HYPERDRIVE_BASE_LOSS_CHANCE } from '../data/shipData'

// A jump riskier than this asks first (and the AI never attempts one: ai/jumpRules).
export const JUMP_WARN_LOSS = 0.05

export interface JumpWarning {
  // The worst chance among the ships, 0..1.
  worst: number
  // How many ships run a risk over the line.
  ships: number
  // "43%", or "5.4%" below 10 so a hair over the line never reads "5%".
  percent: string
  text: string
}

export function formatLossPercent(chance: number): string {
  const pct = chance * 100
  // ">99%" for a jump that is all but certain loss ("100%" would claim certainty).
  if (pct >= 99.5 && pct < 100) return '>99%'
  // One decimal below 10%, so a hair over the 5% line reads "5.0%", never "5%".
  return pct < 9.95 ? `${pct.toFixed(1)}%` : `${Math.round(pct)}%`
}

// Null when no ship runs more than JUMP_WARN_LOSS (exactly 5% does not warn).
export function jumpWarning(chances: readonly number[]): JumpWarning | null {
  const over = chances.filter((c) => c > JUMP_WARN_LOSS)
  if (over.length === 0) return null
  const worst = Math.max(...over)
  const percent = formatLossPercent(worst)
  const sure = worst >= 0.995
  const text = sure
    ? over.length === 1
      ? 'This jump is almost certain to lose the ship.'
      : `This jump is almost certain to lose each of ${over.length} ships.`
    : over.length === 1
      ? `This jump has a ${percent} chance of losing the ship.`
      : `This jump has up to a ${percent} chance of losing each of ${over.length} ships.`
  return { worst, ships: over.length, percent, text }
}

// How much a lane the nation has already charted cuts the risk (the same ratio as ever).
export const CHARTED_LANE_RISK_RATIO = HYPERDRIVE_ESTABLISHED_LANE_LOSS_CHANCE / HYPERDRIVE_BASE_LOSS_CHANCE

// What would make a risky jump safer, for a panel that shows the risk; null at or under
// the warning line. `mk` is the owner's Hyperdrive Mk, `maxMk` the last one there is.
export function saferJumpHint(chance: number, mk: number, maxMk: number): string | null {
  if (chance <= JUMP_WARN_LOSS) return null
  return mk < maxMk
    ? `Safer with a higher Hyperdrive Mk (you have Mk ${mk} of ${maxMk}), or on a lane you have charted.`
    : 'Safer only on a lane you have charted.'
}

// The tip on a star's "Move to" menu item or hover: the real chance (the same number the order
// rolls against) and what that number rests on. On a lane the nation has charted the risk is a
// fifth of the distance risk alone and the destination's mass no longer counts; on an uncharted
// jump it grows with distance AND the destination star's mass.
export function jumpRiskTipText(chance: number, charted: boolean): string {
  const base = `Jump risk: ${formatLossPercent(chance)} chance the ship is lost`
  return charted
    ? `${base} (on a lane you have charted: a fifth of the distance risk)`
    : `${base} (it grows with distance and the destination star's mass; a charted lane cuts it to a fifth)`
}

export interface JumpRiskRow {
  label: string
  value: string
  // What would make it safer, or null at or under the warning line.
  hint: string | null
}

// The ship panel's Jump Risk row for one chosen destination (a star picked on the map).
export function jumpRiskRow(input: { chance: number; charted: boolean; destination: string; elevated: boolean; mk: number; maxMk: number }): JumpRiskRow {
  const lane = input.charted ? 'charted lane' : 'uncharted'
  return {
    label: `Jump Risk to ${input.destination}`,
    value: `${formatLossPercent(input.chance)} (${lane})${input.elevated ? ' (elevated)' : ''}`,
    hint: saferJumpHint(input.chance, input.mk, input.maxMk),
  }
}
