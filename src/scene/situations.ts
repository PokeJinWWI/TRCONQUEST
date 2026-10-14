// The Situations panel's rules (Victoria 3's "Current Situation"): every kind of
// problem the player may want to act on, as a pure check over a snapshot of the
// game (scene/situationSnapshot.ts builds it from the stores). Nothing here is
// stored: a line exists exactly while its condition holds, so fixing the problem
// clears it. Player preferences (hide a type, pause on it) and snoozes are applied
// on top by `visibleLines` / `newPauseLines`.
import type { EventPlace } from '../data/diplomacyData'
import {
  SITUATION_ARMY_STRENGTH_MIN,
  SITUATION_DAMAGE_MIN,
  SITUATION_DEPOSIT_LOW,
  SITUATION_EMPLOYMENT_MIN,
  SITUATION_INFLUENCE_CAP_SHARE,
  SITUATION_DEFLATION,
  SITUATION_INFLATION_HIGH,
  SITUATION_LOW_SOL_SHARE,
  SITUATION_PRICE_HIGH,
  SITUATION_PRICE_LOW,
  SITUATION_RUNOUT_MONTHS,
  SITUATION_STARBASE_SOON_DAYS,
  SITUATION_SURPLUS_RATIO,
} from '../data/situationData'

export type SituationGroup = 'military' | 'economy' | 'expansion' | 'diplomacy'
export type SituationSeverity = 'info' | 'warning' | 'danger'

export const SITUATION_GROUPS: { id: SituationGroup; label: string }[] = [
  { id: 'military', label: 'Military' },
  { id: 'economy', label: 'Economy' },
  { id: 'expansion', label: 'Research & expansion' },
  { id: 'diplomacy', label: 'Diplomacy & territory' },
]

// What clicking a line does.
export type SituationAction =
  | { kind: 'place'; place: EventPlace }
  | { kind: 'ship'; shipId: string }
  | { kind: 'battle'; key: string }

export interface SituationLine {
  typeId: string
  // Stable for as long as the same problem lasts (a ship id, a body name...).
  key: string
  text: string
  action?: SituationAction
}

// --- The snapshot ---------------------------------------------------------------
// Plain data, already digested from the stores, so every rule is a few lines and a
// test can write one by hand.

export interface SnapShip {
  id: string
  name: string
  className: string
  role: string
  fleetName: string
  // 0..1 of the hull's combat condition lost.
  damage: number
  // Has nothing to do: no order, job, automation or command of any kind.
  idle: boolean
  // Where it rests, for the text ("in orbit of Mars").
  where: string
  // Why automation or an order could not go on, if it said so.
  note: string | null
  // A hyperdrive jump waiting for the drive to cool down.
  jumpWaitingDays: number | null
}

export interface SnapResource {
  id: string
  label: string
  amount: number
  monthlyDelta: number
}

export interface SituationSnapshot {
  playerId: string
  economyModel: 'complex' | 'abstract'
  ships: SnapShip[]
  battles: { key: string; label: string }[]
  // Hostile warships the player can see at its own worlds.
  hostilesAtOwnWorlds: { bodyName: string; count: number; owners: string }[]
  // Own worlds held (occupied) by someone else.
  occupied: { bodyName: string; byName: string }[]
  // Own worlds with a ground war on them.
  groundWar: string[]
  armies: { id: string; label: string; strength: number; max: number; bodyName: string | null }[]
  yard: { slots: number; building: number; waiting: number }
  // Building and district orders queued on the player's own worlds (both modes).
  constructionQueued: number
  treasury: number
  balancePerMonth: number
  resources: SnapResource[]
  influence: { amount: number; cap: number }
  // Simple mode: building inputs short this month.
  inputShortages: string[]
  // Complex mode: goods traded on the player's worlds, price against its normal price.
  prices: { bodyName: string; good: string; label: string; ratio: number }[]
  // Goods made far beyond what they are used for, per month: Simple nationally, Complex per world.
  surpluses: { key: string; label: string; where: string | null; made: number; used: number }[]
  // Annual inflation (fraction; negative = deflation).
  inflation: number
  worlds: { bodyName: string; lowSolShare: number | null; employment: number | null }[]
  unrest: number
  deposits: { bodyName: string; material: string; remaining: number }[]
  routesInDisrepair: { id: string; bodyName: string }[]
  research: {
    // Research points flow in this mode (Simple only, for now).
    hasIncome: boolean
    queueLength: number
    // Queued techs that cannot start, with why.
    blocked: { name: string; reason: string }[]
  }
  unsurveyed: { starId: string; starName: string; count: number }[]
  foundings: { shipId: string; shipName: string; bodyName: string }[]
  starbasesBuilding: { starId: string; starName: string; readyInDays: number }[]
  wars: { id: string; enemyName: string; score: number }[]
  encroachmentsAgainst: { id: string; byName: string; starId: string; starName: string }[]
  incidentsAgainst: { id: string; byName: string; text: string }[]
  contestedClaims: { key: string; label: string; rivals: string; place?: EventPlace }[]
}

// --- The alert types --------------------------------------------------------------

export interface AlertType {
  id: string
  group: SituationGroup
  label: string
  severity: SituationSeverity
  // Pause the game when a NEW line of this type appears (the player can change it).
  pauseByDefault: boolean
  check: (s: SituationSnapshot) => SituationLine[]
}

const pct = (x: number) => `${Math.round(x * 100)}%`
const line = (typeId: string, key: string, text: string, action?: SituationAction): SituationLine => ({ typeId, key, text, ...(action ? { action } : {}) })
const body = (bodyName: string): SituationAction => ({ kind: 'place', place: { bodyName } })
const star = (starId: string): SituationAction => ({ kind: 'place', place: { starId } })
const nav = (category: string, subcategory: string): SituationAction => ({ kind: 'place', place: { nav: { category, subcategory } } })
const idleOf = (role: string) => (s: SituationSnapshot) => s.ships.filter((sh) => sh.role === role && sh.idle)

export const ALERT_TYPES: AlertType[] = [
  // Military
  {
    id: 'battle',
    group: 'military',
    label: 'Battles under way',
    severity: 'danger',
    pauseByDefault: false,
    check: (s) => s.battles.map((b) => line('battle', b.key, b.label, { kind: 'battle', key: b.key })),
  },
  {
    id: 'hostile-at-world',
    group: 'military',
    label: 'Enemy warships at your worlds',
    severity: 'danger',
    pauseByDefault: true,
    check: (s) => s.hostilesAtOwnWorlds.map((h) => line('hostile-at-world', h.bodyName, `${h.count} ${h.owners} warship${h.count === 1 ? '' : 's'} at ${h.bodyName}`, body(h.bodyName))),
  },
  {
    id: 'world-occupied',
    group: 'military',
    label: 'Occupied worlds',
    severity: 'danger',
    pauseByDefault: false,
    check: (s) => s.occupied.map((o) => line('world-occupied', o.bodyName, `${o.bodyName} is held by ${o.byName}`, body(o.bodyName))),
  },
  {
    id: 'ground-war',
    group: 'military',
    label: 'Ground war on your worlds',
    severity: 'danger',
    pauseByDefault: true,
    check: (s) => s.groundWar.map((b) => line('ground-war', b, `Enemy troops on ${b}`, body(b))),
  },
  {
    id: 'ship-damaged',
    group: 'military',
    label: 'Damaged ships',
    severity: 'warning',
    pauseByDefault: false,
    check: (s) =>
      s.ships
        .filter((sh) => sh.damage >= SITUATION_DAMAGE_MIN)
        .map((sh) => line('ship-damaged', sh.id, `${sh.name} (${sh.fleetName}): ${pct(sh.damage)} damaged`, { kind: 'ship', shipId: sh.id })),
  },
  {
    id: 'army-weak',
    group: 'military',
    label: 'Armies under strength',
    severity: 'warning',
    pauseByDefault: false,
    check: (s) =>
      s.armies
        .filter((a) => a.max > 0 && a.strength / a.max < SITUATION_ARMY_STRENGTH_MIN)
        .map((a) => line('army-weak', a.id, `${a.label}: ${pct(a.strength / a.max)} strength${a.bodyName ? ` on ${a.bodyName}` : ''}`, a.bodyName ? body(a.bodyName) : undefined)),
  },
  {
    id: 'ship-stuck',
    group: 'military',
    label: 'Ships that could not carry on',
    severity: 'warning',
    pauseByDefault: false,
    check: (s) => s.ships.filter((sh) => sh.note).map((sh) => line('ship-stuck', sh.id, `${sh.name}: ${sh.note}`, { kind: 'ship', shipId: sh.id })),
  },
  {
    id: 'jump-waiting',
    group: 'military',
    label: 'Jumps waiting on the drive',
    severity: 'info',
    pauseByDefault: false,
    check: (s) =>
      s.ships
        .filter((sh) => sh.jumpWaitingDays !== null)
        .map((sh) => line('jump-waiting', sh.id, `${sh.name} jumps in ${Math.max(1, Math.ceil(sh.jumpWaitingDays ?? 0))} days`, { kind: 'ship', shipId: sh.id })),
  },
  // Economy
  {
    id: 'yard-idle',
    group: 'economy',
    label: 'Idle shipyard slips',
    severity: 'info',
    pauseByDefault: false,
    check: (s) => {
      const free = s.yard.slots - s.yard.building
      return free > 0 && s.yard.waiting === 0 ? [line('yard-idle', 'yard', `${free} of ${s.yard.slots} slip${s.yard.slots === 1 ? '' : 's'} free`, nav('Fleet Management', 'Navy'))] : []
    },
  },
  {
    id: 'nothing-building',
    group: 'economy',
    label: 'Nothing under construction',
    severity: 'info',
    pauseByDefault: false,
    check: (s) => (s.constructionQueued === 0 ? [line('nothing-building', 'construction', 'No buildings or districts are being built', nav('Economy', 'Construction'))] : []),
  },
  {
    id: 'deficit',
    group: 'economy',
    label: 'Budget deficit',
    severity: 'warning',
    pauseByDefault: false,
    check: (s) =>
      s.balancePerMonth < 0
        ? [line('deficit', s.treasury < 0 ? 'overdraft' : 'deficit', s.treasury < 0 ? `Treasury overdrawn and losing ${fmtMoney(-s.balancePerMonth)}/mo` : `Losing ${fmtMoney(-s.balancePerMonth)}/mo`, nav('Economy', 'Budget'))]
        : [],
  },
  {
    id: 'resource-running-out',
    group: 'economy',
    label: 'Resources running out',
    severity: 'warning',
    pauseByDefault: false,
    check: (s) =>
      s.resources
        .filter((r) => r.monthlyDelta < 0 && r.amount + r.monthlyDelta * SITUATION_RUNOUT_MONTHS < 0)
        .map((r) => line('resource-running-out', r.id, r.amount <= 0 ? `Out of ${r.label}` : `${r.label} runs out in ${Math.max(1, Math.floor(r.amount / -r.monthlyDelta))} months`, nav('Economy', 'Stockpiles'))),
  },
  {
    id: 'price-high',
    group: 'economy',
    label: 'Expensive goods',
    severity: 'warning',
    pauseByDefault: false,
    check: (s) =>
      s.prices
        .filter((p) => p.ratio >= SITUATION_PRICE_HIGH)
        .map((p) => line('price-high', `${p.good}@${p.bodyName}`, `${p.label} on ${p.bodyName}: ${pct(p.ratio)} of its normal price`, nav('Markets', 'Market'))),
  },
  {
    id: 'price-low',
    group: 'economy',
    label: 'Cheap goods (oversupply)',
    severity: 'info',
    pauseByDefault: false,
    check: (s) =>
      s.prices
        .filter((p) => p.ratio <= SITUATION_PRICE_LOW)
        .map((p) => line('price-low', `${p.good}@${p.bodyName}`, `${p.label} on ${p.bodyName}: only ${pct(p.ratio)} of its normal price`, nav('Markets', 'Market'))),
  },
  {
    id: 'surplus',
    group: 'economy',
    label: 'Surplus piling up',
    severity: 'info',
    pauseByDefault: false,
    check: (s) =>
      s.surpluses
        .filter((g) => g.made > 0 && g.made >= Math.max(g.used, 1e-9) * SITUATION_SURPLUS_RATIO)
        .map((g) => line('surplus', g.key, `${g.label}${g.where ? ` on ${g.where}` : ''}: making ${fmtAmount(g.made)}/mo, using ${fmtAmount(g.used)}/mo`, nav('Economy', 'Stockpiles'))),
  },
  {
    id: 'inflation',
    group: 'economy',
    label: 'Inflation / deflation',
    severity: 'warning',
    pauseByDefault: false,
    check: (s) =>
      s.inflation >= SITUATION_INFLATION_HIGH
        ? [line('inflation', 'inflation', `Inflation at ${(s.inflation * 100).toFixed(1)}% a year`)]
        : s.inflation <= SITUATION_DEFLATION
          ? [line('inflation', 'deflation', `Deflation at ${(-s.inflation * 100).toFixed(1)}% a year`)]
          : [],
  },
  {
    id: 'input-shortage',
    group: 'economy',
    label: 'Industry short of inputs',
    severity: 'warning',
    pauseByDefault: false,
    check: (s) => s.inputShortages.map((g) => line('input-shortage', g, `Factories short of ${g}`, nav('Economy', 'Overview'))),
  },
  {
    id: 'low-sol',
    group: 'economy',
    label: 'Low standard of living',
    severity: 'warning',
    pauseByDefault: false,
    check: (s) =>
      s.worlds
        .filter((w) => w.lowSolShare !== null && w.lowSolShare >= SITUATION_LOW_SOL_SHARE)
        .map((w) => line('low-sol', w.bodyName, `${pct(w.lowSolShare ?? 0)} of people on ${w.bodyName} live poorly`, body(w.bodyName))),
  },
  {
    id: 'unemployment',
    group: 'economy',
    label: 'Unemployment',
    severity: 'warning',
    pauseByDefault: false,
    check: (s) =>
      s.worlds
        .filter((w) => w.employment !== null && w.employment < SITUATION_EMPLOYMENT_MIN)
        .map((w) => line('unemployment', w.bodyName, `${pct(1 - (w.employment ?? 1))} out of work on ${w.bodyName}`, body(w.bodyName))),
  },
  {
    id: 'unrest',
    group: 'economy',
    label: 'Unrest from displacement',
    severity: 'warning',
    pauseByDefault: false,
    check: (s) => (s.unrest > 0.5 ? [line('unrest', 'unrest', `Displaced people are restless (${s.unrest.toFixed(1)})`)] : []),
  },
  {
    id: 'deposit-low',
    group: 'economy',
    label: 'Deposits nearly dry',
    severity: 'info',
    pauseByDefault: false,
    check: (s) =>
      s.deposits
        .filter((d) => d.remaining <= SITUATION_DEPOSIT_LOW)
        .map((d) => line('deposit-low', `${d.material}@${d.bodyName}`, d.remaining <= 0 ? `${d.bodyName}'s ${d.material} is exhausted` : `${d.bodyName}: ${Math.round(d.remaining)} ${d.material} left`, body(d.bodyName))),
  },
  {
    id: 'route-disrepair',
    group: 'economy',
    label: 'Routes in disrepair',
    severity: 'info',
    pauseByDefault: false,
    check: (s) => s.routesInDisrepair.map((r) => line('route-disrepair', r.id, `A route on ${r.bodyName} is unpaid and carries half`, body(r.bodyName))),
  },
  // Research & expansion
  {
    id: 'research-idle',
    group: 'expansion',
    label: 'Research queue empty',
    severity: 'warning',
    pauseByDefault: false,
    check: (s) => (s.research.hasIncome && s.research.queueLength === 0 ? [line('research-idle', 'research', 'Nothing is queued for research', nav('Technology', 'Physics'))] : []),
  },
  {
    id: 'research-blocked',
    group: 'expansion',
    label: 'Research blocked',
    severity: 'warning',
    pauseByDefault: false,
    check: (s) => s.research.blocked.map((b) => line('research-blocked', b.name, `${b.name}: ${b.reason}`, nav('Technology', 'Physics'))),
  },
  ...(['science', 'construction', 'colony', 'cargo'] as const).map(
    (role): AlertType => ({
      id: `idle-${role}`,
      group: 'expansion',
      label: `Idle ${role === 'colony' ? 'colony' : role} ships`,
      severity: 'info',
      pauseByDefault: false,
      check: (s) => idleOf(role)(s).map((sh) => line(`idle-${role}`, sh.id, `${sh.name} is idle ${sh.where}`, { kind: 'ship', shipId: sh.id })),
    }),
  ),
  {
    id: 'unsurveyed',
    group: 'expansion',
    label: 'Unsurveyed bodies in your systems',
    severity: 'info',
    pauseByDefault: false,
    check: (s) => s.unsurveyed.map((u) => line('unsurveyed', u.starId, `${u.count} unsurveyed bod${u.count === 1 ? 'y' : 'ies'} in ${u.starName}`, star(u.starId))),
  },
  {
    id: 'influence-capped',
    group: 'expansion',
    label: 'Influence at its cap',
    severity: 'info',
    pauseByDefault: false,
    check: (s) => (s.influence.cap > 0 && s.influence.amount >= s.influence.cap * SITUATION_INFLUENCE_CAP_SHARE ? [line('influence-capped', 'influence', `Influence ${Math.round(s.influence.amount)} / ${s.influence.cap}: new income is lost`)] : []),
  },
  {
    id: 'colony-founding',
    group: 'expansion',
    label: 'Colonies being founded',
    severity: 'info',
    pauseByDefault: false,
    check: (s) => s.foundings.map((f) => line('colony-founding', f.shipId, `${f.shipName} is founding a colony on ${f.bodyName}`, body(f.bodyName))),
  },
  {
    id: 'starbase-soon',
    group: 'expansion',
    label: 'Starbases finishing soon',
    severity: 'info',
    pauseByDefault: false,
    check: (s) =>
      s.starbasesBuilding
        .filter((b) => b.readyInDays <= SITUATION_STARBASE_SOON_DAYS)
        .map((b) => line('starbase-soon', b.starId, `Starbase at ${b.starName} ready in ${Math.max(1, Math.ceil(b.readyInDays))} days`, star(b.starId))),
  },
  // Diplomacy & territory
  {
    id: 'at-war',
    group: 'diplomacy',
    label: 'Wars',
    severity: 'danger',
    pauseByDefault: false,
    check: (s) => s.wars.map((w) => line('at-war', w.id, `At war with ${w.enemyName} (war score ${w.score >= 0 ? '+' : ''}${Math.round(w.score)})`, nav('Diplomacy', 'Wars'))),
  },
  {
    id: 'encroachment',
    group: 'diplomacy',
    label: 'Encroachments on your space',
    severity: 'warning',
    pauseByDefault: false,
    check: (s) => s.encroachmentsAgainst.map((e) => line('encroachment', e.id, `${e.byName} built in ${e.starName}`, star(e.starId))),
  },
  {
    id: 'incident',
    group: 'diplomacy',
    label: 'Incidents against you',
    severity: 'warning',
    pauseByDefault: false,
    check: (s) => s.incidentsAgainst.map((i) => line('incident', i.id, i.text, nav('Diplomacy', 'Events'))),
  },
  {
    id: 'claim-contested',
    group: 'diplomacy',
    label: 'Contested claims',
    severity: 'info',
    pauseByDefault: false,
    check: (s) => s.contestedClaims.map((c) => line('claim-contested', c.key, `${c.label}: also claimed by ${c.rivals}`, c.place ? { kind: 'place', place: c.place } : undefined)),
  },
]

export const ALERT_TYPE_BY_ID: Record<string, AlertType> = Object.fromEntries(ALERT_TYPES.map((t) => [t.id, t]))

function fmtAmount(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n >= 10 ? `${Math.round(n)}` : n.toFixed(1)
}

function fmtMoney(n: number): string {
  const a = Math.abs(n)
  if (a >= 1e9) return `$${(n / 1e9).toFixed(1)}B`
  if (a >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  if (a >= 1e3) return `$${(n / 1e3).toFixed(1)}K`
  return `$${Math.round(n)}`
}

// Every line of every type, in ALERT_TYPES order.
export function situationsFor(s: SituationSnapshot): SituationLine[] {
  return ALERT_TYPES.flatMap((t) => t.check(s))
}

export const lineId = (l: Pick<SituationLine, 'typeId' | 'key'>): string => `${l.typeId}|${l.key}`

export interface SituationPrefs {
  // Types the player chose not to show.
  hidden: Record<string, boolean>
  // Per type: pause when a new line appears (absent = the type's default).
  pause: Record<string, boolean>
}

export const pausesOn = (typeId: string, prefs: Pick<SituationPrefs, 'pause'>): boolean => prefs.pause[typeId] ?? ALERT_TYPE_BY_ID[typeId]?.pauseByDefault ?? false

// What the panel shows: not hidden, not snoozed.
export function visibleLines(lines: readonly SituationLine[], prefs: Pick<SituationPrefs, 'hidden'>, snoozed: ReadonlySet<string>): SituationLine[] {
  return lines.filter((l) => !prefs.hidden[l.typeId] && !snoozed.has(lineId(l)))
}

// Lines that are new since `prev` (by id) and of a type the player pauses on. Hidden types never pause.
export function newPauseLines(prev: readonly SituationLine[], next: readonly SituationLine[], prefs: SituationPrefs, snoozed: ReadonlySet<string>): SituationLine[] {
  const before = new Set(prev.map(lineId))
  return visibleLines(next, prefs, snoozed).filter((l) => !before.has(lineId(l)) && pausesOn(l.typeId, prefs))
}

// A snooze lasts until its line goes away once: drop snoozes whose line no longer exists.
export function prunedSnoozes(snoozed: readonly string[], lines: readonly SituationLine[]): string[] {
  const live = new Set(lines.map(lineId))
  return snoozed.filter((id) => live.has(id))
}

// The worst severity among some lines (null = none).
export function worstSeverity(lines: readonly SituationLine[]): SituationSeverity | null {
  let worst: SituationSeverity | null = null
  for (const l of lines) {
    const sev = ALERT_TYPE_BY_ID[l.typeId]?.severity ?? 'info'
    if (sev === 'danger') return 'danger'
    if (sev === 'warning' || worst === null) worst = sev
  }
  return worst
}
