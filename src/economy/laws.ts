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

// --- Healthcare law ---
// How healthcare (a service, goods.ts) is paid for. The more the state funds,
// the better the poor are covered — but the heavier the budget burden. This is
// a major driver of deficits.
export type HealthcareSystem = 'public' | 'mixed' | 'private'
export const HEALTHCARE_SYSTEMS: HealthcareSystem[] = ['public', 'mixed', 'private']

export interface HealthcareSystemDef {
  id: HealthcareSystem
  name: string
  description: string
  // Fraction of each pop's healthcare bill the state pays (the pop pays the
  // rest). 1 = universal public system; 0 = pops buy their own care.
  publicFunding: number
}

export const HEALTHCARE_SYSTEM_DEFS: Record<HealthcareSystem, HealthcareSystemDef> = {
  public: {
    id: 'public',
    name: 'Public Healthcare',
    description: 'The state funds healthcare for everyone — universal coverage, even for the poor, but a heavy budget burden.',
    publicFunding: 1,
  },
  mixed: {
    id: 'mixed',
    name: 'Mixed System',
    description: 'The state subsidises half of healthcare; pops pay the rest. A middle path (à la Medicaid).',
    publicFunding: 0.5,
  },
  private: {
    id: 'private',
    name: 'Private Healthcare',
    description: 'Healthcare is left to the market — pops buy their own care, and the poor often go without. Cheap for the state.',
    publicFunding: 0,
  },
}

export function healthcareSystemDef(system: HealthcareSystem): HealthcareSystemDef {
  return HEALTHCARE_SYSTEM_DEFS[system]
}

// --- Foreign bond policy (see bonds/debt in the store) ---
// Whether the state may sell its bonds to foreign holders, and whether such
// sales need the player's explicit approval.
export type ForeignBondPolicy = 'open' | 'approval' | 'closed'
export const FOREIGN_BOND_POLICIES: ForeignBondPolicy[] = ['open', 'approval', 'closed']

export interface ForeignBondPolicyDef {
  id: ForeignBondPolicy
  name: string
  description: string
}
export const FOREIGN_BOND_POLICY_DEFS: Record<ForeignBondPolicy, ForeignBondPolicyDef> = {
  open: { id: 'open', name: 'Open Markets', description: 'Foreign governments and corporations may freely buy state bonds.' },
  approval: { id: 'approval', name: 'Approval Required', description: 'Foreign bond purchases are allowed only with the government’s explicit approval.' },
  closed: { id: 'closed', name: 'Closed', description: 'Only domestic pops and companies may hold state bonds.' },
}
export function foreignBondPolicyDef(p: ForeignBondPolicy): ForeignBondPolicyDef {
  return FOREIGN_BOND_POLICY_DEFS[p]
}

// When a building's production method changes (owner or state), it retools:
// utilization dips to this fraction and ramps back up — so a switch is never a
// free instant win, and rapid flip-flopping is self-penalizing.
export const RETOOL_THROUGHPUT_FACTOR = 0.85

// A private owner only switches method when the best option beats the current
// one's estimated profit by this margin — hysteresis that stops thrashing when
// two methods are near-equal.
export const OWNER_SWITCH_MARGIN = 0.12
