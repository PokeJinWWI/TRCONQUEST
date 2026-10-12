// Saving and loading a whole game. Pure data in, pure data out: the file is a
// JSON-able object (`SaveFile`); where it is kept (IndexedDB, a download) is
// state/saveStorage.ts.
//
// What a save holds:
//  - every 'game' store in state/gameStores.ts, through state/saveCodec;
//  - the nations carved at runtime (data/countryData.dynamicCountries);
//  - the 20 empires' resident economy simulation (economy/empireSim), which lives
//    in the worker and is not in any store.
// What it does not hold: UI state (a loaded game opens on a fresh screen), the
// generated galaxy (deterministic from GALAXY_SEED), caches, preferences.
//
// Loading resets everything first (scene/gameReset.resetGame), then puts the saved
// stores back. A save from a NEWER build, or an older one with no migration, is
// refused with a readable error rather than loaded half-way.
import { dynamicCountries, registerCountry, type Country } from '../data/countryData'
import type { EmpireSave } from '../economy/empireSim'
import { migrateWorldDistricts } from '../economy/districtMigration'
import { resetGame } from '../scene/gameReset'
import { upgradeLegacyColonies } from '../scene/colonies'
import { claimSystemForStarbase } from '../scene/sovereignty'
import { useStarbaseStore } from './starbaseStore'
import { usePlacementStore } from './placementStore'
import { exportEmpires, importEmpires } from './economyEngine'
import { economyBusy, empiresRunning, markEmpiresRunning } from './economyStore'
import { gameEntries, type StoreEntry } from './gameStores'
import { useGameTimeStore } from './gameTimeStore'
import { decode, encode, type Json } from './saveCodec'

export const SAVE_FORMAT = 'trconquest-save'
// Bump when the envelope itself changes (store versions are separate).
//   1  the first saves (before development sites, claims, routes and orbits existed)
//   2  those stores are part of the save; an older file is upgraded on load (`upgradeLegacyTerritory`)
export const SAVE_VERSION = 2

export interface SaveFile {
  format: typeof SAVE_FORMAT
  version: number
  savedAt: string
  // Free text shown in the slot list (nation, date in game).
  label: string
  stores: Record<string, { version: number; data: Json }>
  countries: Json
  empires: Json | null
}

export class SaveError extends Error {}

function stateOf(entry: StoreEntry): Record<string, unknown> {
  const state = { ...(entry.store.getState() as Record<string, unknown>) }
  for (const key of entry.exclude ?? []) delete state[key]
  return state
}

// Waits for an economy month in flight to land (a save mid-month would miss it).
async function settleEconomy(timeoutMs = 10_000): Promise<void> {
  const start = Date.now()
  while (economyBusy()) {
    if (Date.now() - start > timeoutMs) throw new SaveError('The economy is still working out a month; try again in a moment.')
    await new Promise((r) => setTimeout(r, 20))
  }
}

export async function createSave(label = ''): Promise<SaveFile> {
  await settleEconomy()
  const stores: SaveFile['stores'] = {}
  for (const entry of gameEntries()) {
    try {
      stores[entry.key] = { version: entry.version, data: encode(stateOf(entry), entry.key) ?? {} }
    } catch (error) {
      throw new SaveError(`Cannot save store "${entry.key}": ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  const empires = empiresRunning() ? await exportEmpires() : null
  return {
    format: SAVE_FORMAT,
    version: SAVE_VERSION,
    savedAt: new Date().toISOString(),
    label,
    stores,
    countries: encode(dynamicCountries(), 'countries') ?? [],
    empires: empires ? (encode(empires, 'empires') ?? null) : null,
  }
}

// Upgrades one store's saved value to the current shape, one version at a time.
function migrated(entry: StoreEntry, saved: { version: number; data: Json }): unknown {
  if (saved.version > entry.version) throw new SaveError(`The save was made by a newer version of the game (store "${entry.key}" is v${saved.version}, this build reads v${entry.version}).`)
  let value: unknown = decode(saved.data)
  for (let v = saved.version; v < entry.version; v++) {
    if (!entry.migrate) throw new SaveError(`The save is too old: store "${entry.key}" v${saved.version} has no migration to v${entry.version}.`)
    value = entry.migrate(value, v)
  }
  return value
}

// Checks a parsed file without touching the game.
// The empires' worlds carry the same district shape as the nations' (a save from before the resource district was split).
function migratedEmpires(save: EmpireSave): EmpireSave {
  return { ...save, worlds: save.worlds.map(migrateWorldDistricts) }
}

export function validateSave(file: unknown): asserts file is SaveFile {
  const f = file as Partial<SaveFile> | null
  if (!f || typeof f !== 'object' || f.format !== SAVE_FORMAT) throw new SaveError('This is not a Terra Relicta save file.')
  if (typeof f.version !== 'number' || f.version > SAVE_VERSION) throw new SaveError('This save was made by a newer version of the game.')
  if (!f.stores || typeof f.stores !== 'object') throw new SaveError('The save file is damaged (no stores).')
}

export async function applySave(file: unknown): Promise<void> {
  validateSave(file)
  // Convert everything first: a bad file must fail before the live game is touched.
  const values = new Map<StoreEntry, unknown>()
  for (const entry of gameEntries()) {
    const saved = file.stores[entry.key]
    if (saved) values.set(entry, migrated(entry, saved))
  }
  const countries = (decode(file.countries) as Country[] | undefined) ?? []
  const empires = file.empires ? migratedEmpires(decode(file.empires) as EmpireSave) : null

  await settleEconomy()
  resetGame()
  // The clock stays paused until the player resumes.
  for (const country of countries) registerCountry(country)
  for (const [entry, value] of values) entry.store.setState(value as never, false)
  if (empires) {
    markEmpiresRunning(true)
    await importEmpires(empires)
  }
  if (file.version < 2) upgradeLegacyTerritory()
  if ((file.stores.placement?.version ?? 0) < 2 || file.version < 2) upgradeLegacyPlacement()
  useGameTimeStore.setState({ paused: true })
}

// A save from before the territorial model has no claims, sites or placements. What it had stays as it was (body ownership
// is still recognized body-wide sovereignty; nothing is widened), and the records the new model keeps for what already
// exists are made: each colony gets its site and settlement claim, each Starbase its provisional system claim.
// Idempotent: filing twice is refused by the claim rules.
export function upgradeLegacyTerritory(): void {
  const now = useGameTimeStore.getState().simDays
  upgradeLegacyColonies(now)
  for (const sb of useStarbaseStore.getState().starbases) claimSystemForStarbase(sb.ownerId, sb.starId, sb.readySimDays)
}

// A game saved before districts were placed on sites: if nothing was ever placed, each world's starting districts and buildings are
// assigned to its sites the first time they are looked at, as in a new game. A game that already has placements (from the first
// territorial build) keeps them as they are and stays on the old room-on-the-site rule: assigning the starting buildings on
// top would count them twice.
export function upgradeLegacyPlacement(): void {
  const p = usePlacementStore.getState()
  if (Object.keys(p.placed).length === 0 && Object.keys(p.levels).length === 0) p.setAutoSeed(true)
}
