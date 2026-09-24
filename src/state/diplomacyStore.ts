import { create } from 'zustand'
import { PIRATES_ID, isRogueFaction } from '../data/countryRoster'
import {
  MAX_DIPLOMACY_EVENTS,
  OPINION_MAX,
  OPINION_MIN,
  OPINION_ON_WAR_DECLARED,
  TRUCE_DAYS,
  defaultRelation,
  pairKey,
  type DiplomacyEvent,
  type DiplomacyEventKind,
  type Relation,
  type War,
} from '../data/diplomacyData'

// Live diplomatic state between nations — the single source of truth for who
// is at war with whom. Ship hostility is DERIVED from this (see atWar below
// and combatResolution's syncEngagements): a ship owned by Mars fights a ship
// owned by Venus exactly when Mars and Venus are at war, and never otherwise.
// Session-only, like every other store in this project.

export type DeclareWarResult = { ok: true; warId: string } | { ok: false; reason: string }

interface DiplomacyState {
  relations: Record<string, Relation>
  wars: War[]
  events: DiplomacyEvent[]
  declareWar: (attackerId: string, defenderId: string, simDays: number) => DeclareWarResult
  // Dev-tool only (DebugConsole scenarios): puts two nations at war even
  // inside a truce, so a scenario always gets its fight. A no-op if they're
  // already at war. Never call this from gameplay — declareWar's rules are
  // the game.
  forceWar: (attackerId: string, defenderId: string, simDays: number) => void
  // Ends a war with no terms applied — territory handling for a real peace
  // lives in scene/peace.ts, which calls this last.
  endWar: (warId: string, simDays: number) => void
  adjustOpinion: (a: string, b: string, delta: number) => void
  // Adds to a war's attacker-POV battle balance and each side's exhaustion.
  recordWarLosses: (warId: string, attackerLossValue: number, defenderLossValue: number) => void
  addExhaustion: (warId: string, countryId: string, amount: number) => void
  pushEvent: (kind: DiplomacyEventKind, countryIds: string[], text: string, simDays: number) => void
  reset: () => void
}

let eventCounter = 0
let warCounter = 0

// Shared default so a read of a never-touched pair doesn't build a new object
// every call (same reasoning as techStore's UNTOUCHED_COUNTRY_STATE).
const DEFAULT_RELATION: Relation = defaultRelation()

export function relationIn(relations: Record<string, Relation>, a: string, b: string): Relation {
  return relations[pairKey(a, b)] ?? DEFAULT_RELATION
}

export function warBetweenIn(wars: War[], a: string, b: string): War | undefined {
  return wars.find((w) => (w.attackerId === a && w.defenderId === b) || (w.attackerId === b && w.defenderId === a))
}

export const useDiplomacyStore = create<DiplomacyState>((set, get) => ({
  relations: {},
  wars: [],
  events: [],

  declareWar: (attackerId, defenderId, simDays) => {
    if (attackerId === defenderId) return { ok: false, reason: 'A nation cannot declare war on itself.' }
    const state = get()
    const relation = relationIn(state.relations, attackerId, defenderId)
    if (relation.status === 'war') return { ok: false, reason: 'Already at war.' }
    if (simDays < relation.truceUntilSimDays) return { ok: false, reason: 'A truce is still in effect.' }

    warCounter += 1
    const war: War = {
      id: `war-${warCounter}-${Math.round(simDays)}`,
      attackerId,
      defenderId,
      startedSimDays: simDays,
      battleBalance: 0,
      exhaustion: { [attackerId]: 0, [defenderId]: 0 },
    }
    const key = pairKey(attackerId, defenderId)
    const opinion = Math.max(OPINION_MIN, relation.opinion + OPINION_ON_WAR_DECLARED)
    set((s) => ({
      wars: [...s.wars, war],
      relations: { ...s.relations, [key]: { ...relation, status: 'war', opinion } },
    }))
    return { ok: true, warId: war.id }
  },

  forceWar: (attackerId, defenderId, simDays) => {
    const state = get()
    if (relationIn(state.relations, attackerId, defenderId).status === 'war') return
    const key = pairKey(attackerId, defenderId)
    set((s) => ({ relations: { ...s.relations, [key]: { ...relationIn(s.relations, attackerId, defenderId), truceUntilSimDays: 0 } } }))
    get().declareWar(attackerId, defenderId, simDays)
  },

  endWar: (warId, simDays) =>
    set((s) => {
      const war = s.wars.find((w) => w.id === warId)
      if (!war) return s
      const key = pairKey(war.attackerId, war.defenderId)
      const relation = relationIn(s.relations, war.attackerId, war.defenderId)
      return {
        wars: s.wars.filter((w) => w.id !== warId),
        relations: { ...s.relations, [key]: { ...relation, status: 'peace', truceUntilSimDays: simDays + TRUCE_DAYS } },
      }
    }),

  adjustOpinion: (a, b, delta) =>
    set((s) => {
      const key = pairKey(a, b)
      const relation = relationIn(s.relations, a, b)
      const opinion = Math.max(OPINION_MIN, Math.min(OPINION_MAX, relation.opinion + delta))
      return { relations: { ...s.relations, [key]: { ...relation, opinion } } }
    }),

  recordWarLosses: (warId, attackerLossValue, defenderLossValue) =>
    set((s) => ({
      wars: s.wars.map((w) =>
        w.id === warId
          ? {
              ...w,
              battleBalance: w.battleBalance + defenderLossValue - attackerLossValue,
              exhaustion: {
                ...w.exhaustion,
                [w.attackerId]: (w.exhaustion[w.attackerId] ?? 0) + attackerLossValue,
                [w.defenderId]: (w.exhaustion[w.defenderId] ?? 0) + defenderLossValue,
              },
            }
          : w,
      ),
    })),

  addExhaustion: (warId, countryId, amount) =>
    set((s) => ({
      wars: s.wars.map((w) => (w.id === warId ? { ...w, exhaustion: { ...w.exhaustion, [countryId]: (w.exhaustion[countryId] ?? 0) + amount } } : w)),
    })),

  pushEvent: (kind, countryIds, text, simDays) =>
    set((s) => {
      eventCounter += 1
      const event: DiplomacyEvent = { id: `dip-${eventCounter}`, simDays, kind, countryIds, text }
      const events = [...s.events, event]
      return { events: events.length > MAX_DIPLOMACY_EVENTS ? events.slice(events.length - MAX_DIPLOMACY_EVENTS) : events }
    }),

  reset: () => set({ relations: {}, wars: [], events: [] }),
}))

// Whether two nations are currently at war — the one question every hostility
// check in the game reduces to. Reads the live store; pure callers that want
// to stay store-free (combatResolution's syncEngagements, the AI) accept an
// `atWar` function instead, defaulting to this one.
export function atWar(a: string, b: string): boolean {
  if (a === b) return false
  const rogue = rogueHostility(a, b)
  if (rogue !== null) return rogue
  return relationIn(useDiplomacyStore.getState().relations, a, b).status === 'war'
}

// The fixed hostility of the no-nation factions (see countryRoster's
// ROGUE_FACTIONS): pirates fight everyone, friendly irregulars fight only
// pirates. Null when neither side is a rogue faction — then the stored
// diplomacy decides.
export function rogueHostility(a: string, b: string): boolean | null {
  if (!isRogueFaction(a) && !isRogueFaction(b)) return null
  if (a === b) return false
  return a === PIRATES_ID || b === PIRATES_ID
}

export type AtWarFn = (a: string, b: string) => boolean

// A snapshot-bound atWar — used where one pass needs a consistent view even if
// the store changes mid-pass (e.g. the AI planning several agents in a row).
export function atWarFrom(relations: Record<string, Relation>): AtWarFn {
  return (a, b) => {
    if (a === b) return false
    const rogue = rogueHostility(a, b)
    if (rogue !== null) return rogue
    return relationIn(relations, a, b).status === 'war'
  }
}

// A string that changes exactly when any pair's war status changes — for
// zustand selectors that need to re-render on war/peace (ship colors, relation
// labels) without subscribing to the whole relations object.
export function warsKeyOf(wars: War[]): string {
  return wars
    .map((w) => pairKey(w.attackerId, w.defenderId))
    .sort()
    .join(',')
}
