// Free Flight: whether a ship holds any position it likes in a fight, or is in
// the gravity of the bodies around it (combatResolution.integrateMotion's
// canFreeFloat). Pure. One rule for every nation, the AI's included:
//  - without Free-Flight Maneuvering researched, a ship has no free flight;
//  - with it, free flight is ON unless the ship's own toggle is off
//    (ShipInstance.freeFlight, absent = on, so it is on the moment the tech is
//    researched).
export const FREE_FLIGHT_TECH_ID = 'free-flight-maneuvering'

export function hasFreeFlightTech(researched: ReadonlySet<string>): boolean {
  return researched.has(FREE_FLIGHT_TECH_ID)
}

export function freeFlightActive(researched: ReadonlySet<string>, ship: { freeFlight?: boolean }): boolean {
  return hasFreeFlightTech(researched) && (ship.freeFlight ?? true)
}

// What a fleet's toggle reads: every ship on, every ship off, or both.
export function fleetFreeFlight(ships: readonly { freeFlight?: boolean }[]): 'on' | 'off' | 'mixed' {
  const on = ships.filter((s) => s.freeFlight ?? true).length
  return on === ships.length ? 'on' : on === 0 ? 'off' : 'mixed'
}

// What a ship WITHOUT free flight cannot do in a fight (it is in the gravity of the bodies
// around it, so it cannot hold a chosen position): the positioning stances (Swarm, Kite,
// Stall, and the fleet strategies Divide / Condense / Screen that spread or gather ships to
// chosen places) fall back to Balanced, and the player cannot order it to a point of the
// arena. Everything else stays under control: Balanced, Flee, targeting, chase / ram,
// boosts, countermeasures. One rule for every nation, the AI's included.
export const FREE_FLIGHT_STRATEGIES: readonly string[] = ['swarm', 'kite', 'stall', 'divide', 'condense', 'screen']

export function strategyNeedsFreeFlight(strategy: string): boolean {
  return FREE_FLIGHT_STRATEGIES.includes(strategy)
}

// The strategy a ship actually runs: its own, or Balanced when it needs free flight the ship lacks.
export function usableStrategy<T extends string>(strategy: T, canFreeFlight: boolean): T | 'balanced' {
  return !canFreeFlight && strategyNeedsFreeFlight(strategy) ? 'balanced' : strategy
}

// Why free flight is missing (for a greyed button's text), or null when the ship has it.
export function freeFlightBlock(researched: ReadonlySet<string>, ship: { freeFlight?: boolean }): string | null {
  if (!hasFreeFlightTech(researched)) return 'Needs Free-Flight Maneuvering (Engineering)'
  return (ship.freeFlight ?? true) ? null : 'Free Flight is switched off for this ship'
}

export function strategyBlock(strategy: string, researched: ReadonlySet<string>, ship: { freeFlight?: boolean }): string | null {
  if (!strategyNeedsFreeFlight(strategy)) return null
  const why = freeFlightBlock(researched, ship)
  return why ? `${why}: without free flight a ship cannot hold chosen positions` : null
}

export function moveOrderBlock(researched: ReadonlySet<string>, ship: { freeFlight?: boolean }): string | null {
  const why = freeFlightBlock(researched, ship)
  return why ? `${why}: without free flight a ship cannot be sent to a point` : null
}
