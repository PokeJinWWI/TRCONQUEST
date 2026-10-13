import { create } from 'zustand'
import { DEFAULT_MIGRATION_LAWS, type EmigrationPolicy, type MigrationFlow, type MigrationLaws, type MigrationPolicy } from '../economy/migrationRules'

// Migration, both economy modes: each nation's laws (a nation with none has DEFAULT_MIGRATION_LAWS: closed borders, free emigration, so
// the calibrated start is untouched) and what moved in recent months, for the Population tab. The movement itself is the pure engines
// (economy/migration.ts for Complex inside the worker, economy-abstract/migration.ts for Simple).
export interface MigrationRecord {
  // The economy's tick (month counter) the flows belong to.
  tick: number
  flows: MigrationFlow[]
}

export const MIGRATION_HISTORY_LENGTH = 120

interface MigrationStore {
  laws: Record<string, MigrationLaws>
  history: MigrationRecord[]
  setImmigration: (nationId: string, policy: MigrationPolicy) => void
  setEmigration: (nationId: string, policy: EmigrationPolicy) => void
  record: (tick: number, flows: MigrationFlow[]) => void
}

export const useMigrationStore = create<MigrationStore>((set) => ({
  laws: {},
  history: [],
  setImmigration: (nationId, immigration) => set((s) => ({ laws: { ...s.laws, [nationId]: { ...(s.laws[nationId] ?? DEFAULT_MIGRATION_LAWS), immigration } } })),
  setEmigration: (nationId, emigration) => set((s) => ({ laws: { ...s.laws, [nationId]: { ...(s.laws[nationId] ?? DEFAULT_MIGRATION_LAWS), emigration } } })),
  record: (tick, flows) => set((s) => ({ history: [...s.history, { tick, flows }].slice(-MIGRATION_HISTORY_LENGTH) })),
}))

export const lawsOfNation = (nationId: string, laws = useMigrationStore.getState().laws): MigrationLaws => laws[nationId] ?? DEFAULT_MIGRATION_LAWS
