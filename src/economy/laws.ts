// Economic-system laws (design doc Section 7, "Laws"). The first law with real
// mechanics: it governs the relationship between the state and private building
// owners. Owners of private buildings normally run them themselves, picking the
// production method that makes them the most money (see the autonomy pass in
// economyTick). The state CAN override a private building's method — but under a
// market economy that interference is resented and the building runs
// inefficiently. Under a command economy the state directs production
// legitimately (no penalty), but owners no longer self-optimize.

export type EconomicSystem = 'command' | 'interventionism' | 'laissez-faire'

// Ordered most-state-control → most-market.
export const ECONOMIC_SYSTEMS: EconomicSystem[] = ['command', 'interventionism', 'laissez-faire']

export interface EconomicSystemDef {
  id: EconomicSystem
  name: string
  description: string
  // Output multiplier applied to a PRIVATELY-owned building whose production
  // method the state has force-set (interference). 1 = no penalty; below 1 the
  // building yields less for the same labor and inputs — a margin squeeze that
  // punishes meddling in a market economy.
  interferenceMalus: number
  // Do private owners autonomously optimize their own production method each
  // tick? Off under a command economy — there the state chooses.
  ownerAutonomy: boolean
}

export const ECONOMIC_SYSTEM_DEFS: Record<EconomicSystem, EconomicSystemDef> = {
  command: {
    id: 'command',
    name: 'Command Economy',
    description: 'The state directs production. Setting any building’s method is legitimate — no penalty — but private owners do not self-optimize.',
    interferenceMalus: 1.0,
    ownerAutonomy: false,
  },
  interventionism: {
    id: 'interventionism',
    name: 'Interventionism',
    description: 'A mixed economy. Owners run their own buildings, but the state may override a method at a modest efficiency cost.',
    interferenceMalus: 0.9,
    ownerAutonomy: true,
  },
  'laissez-faire': {
    id: 'laissez-faire',
    name: 'Laissez-Faire',
    description: 'Owners run their businesses. Forcing a private building’s method is resented and runs it inefficiently.',
    interferenceMalus: 0.7,
    ownerAutonomy: true,
  },
}

export function economicSystemDef(system: EconomicSystem): EconomicSystemDef {
  return ECONOMIC_SYSTEM_DEFS[system]
}

// A building counts as state-run (player directs it freely, owners don't) once
// the state holds at least half of it.
export const STATE_OWNERSHIP_THRESHOLD = 0.5

// When a building's production method changes (owner or state), it retools:
// utilization dips to this fraction and ramps back up — so a switch is never a
// free instant win, and rapid flip-flopping is self-penalizing.
export const RETOOL_THROUGHPUT_FACTOR = 0.85

// A private owner only switches method when the best option beats the current
// one's estimated profit by this margin — hysteresis that stops thrashing when
// two methods are near-equal.
export const OWNER_SWITCH_MARGIN = 0.12
