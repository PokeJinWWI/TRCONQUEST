// Starbase costs shown to the player and the notifications that announce one starting or
// finishing. Pure: the store and the notification system are the callers' business.

// "30 influence": the cost with its units, as shown on the Build Starbase button and menu item.
export function starbaseCostLabel(influence: number): string {
  return `${influence} influence`
}

// The reason shown when the player is short of influence, or null when they can pay.
export function starbaseShortReason(cost: number, have: number): string | null {
  return have < cost ? `Needs ${starbaseCostLabel(cost)} to claim a system (you have ${Math.floor(have)})` : null
}

// A button or menu label with its cost: "Build Starbase · 30 influence".
export function withStarbaseCost(label: string, cost: number): string {
  return `${label} · ${starbaseCostLabel(cost)}`
}

export interface StarbaseLike {
  id: string
  starId: string
  ownerId: string
  readySimDays: number
}

// The Starbases that finished after `fromSimDays` up to and including `toSimDays` (one
// pass of the clock). A Starbase that was already finished at the start of the game or
// at the previous pass is never reported, and neither is one that is still being built.
export function finishedBetween<T extends StarbaseLike>(starbases: readonly T[], fromSimDays: number, toSimDays: number): T[] {
  return starbases.filter((sb) => sb.readySimDays > fromSimDays && sb.readySimDays <= toSimDays)
}

export function starbaseStartedText(nationName: string, starName: string, readyText: string): string {
  return `${nationName} began a Starbase at ${starName}; it will be ready about ${readyText}`
}

export function starbaseFinishedText(nationName: string, starName: string): string {
  return `${nationName}'s Starbase at ${starName} is finished`
}

// The tooltip of a Build Starbase button or menu item: what it does and costs when it can be
// done, else why not (plus the influence shortfall when that is a second, separate reason).
export function starbaseActionTitle(ok: boolean, reason: string | null, short: string | null, cost: number, doing: string): string {
  if (ok) return `${doing}. It costs ${starbaseCostLabel(cost)} as well as the materials in the hold`
  return [reason, short && short !== reason ? short : null].filter((r): r is string => !!r).join('. ')
}
