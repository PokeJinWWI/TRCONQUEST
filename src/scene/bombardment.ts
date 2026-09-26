// Orbital bombardment — the pure rules. Armed ships set to bombard (limited /
// full) that orbit a world held by a nation they're at war with, with no enemy
// warships contesting that orbit, pour damage onto it each day: into the
// enemy's defense installations, its ground units, and the world's
// DEVASTATION (0–1, which cuts output in both economy modes and slowly heals
// once the bombs stop). A standing enemy shield generator soaks most of it.
// Full bombardment doubles the firepower and kills population. Store I/O in
// hooks/useBombardmentResolver.ts; tuning in data/defenseData.ts.
import {
  BOMBARD_FULL_MULT,
  BOMBARD_POWER_PER_WEAPON,
  BOMBARD_SHARE_INSTALLATIONS,
  BOMBARD_SHARE_UNITS,
  DEFENSE_DEFS,
  DEVASTATION_DECAY_PER_DAY,
  DEVASTATION_PER_DAMAGE,
  FULL_POP_LOSS_MAX_PER_DAY,
  FULL_POP_LOSS_PER_DAMAGE,
  SHIELD_BOMBARD_REDUCTION,
  type BombardStance,
} from '../data/defenseData'
import { UNIT_DESTROYED_BELOW } from '../data/groundData'
import type { AtWarFn } from '../state/diplomacyStore'
import type { Army } from './armyLogic'
import { holderOfInstallation, shieldedAgainst, type Installation } from './defenseLogic'
import type { NodeHolderMap } from './groundLogic'
import { controllerOf, type OwnerMap } from './territory'

export interface BombardShip {
  id: string
  ownerId: string
  bodyName: string | null // orbited body
  armed: boolean
  weapons: number
  stance: BombardStance
}

export interface BombardInput {
  days: number
  simDays: number
  ships: BombardShip[]
  installations: Installation[]
  armies: Army[]
  devastation: Record<string, number>
  owners: OwnerMap
  controllers: OwnerMap
  holders: NodeHolderMap
  atWar: AtWarFn
}

export interface Strike {
  bodyName: string
  attackerId: string
  victimId: string
  damage: number // after any shield
  shielded: boolean
  full: boolean
}

export interface BombardResult {
  installations: Installation[]
  destroyedInstallations: Installation[]
  armies: Army[]
  devastation: Record<string, number>
  popLoss: Record<string, number> // body → share of population killed this step
  strikes: Strike[]
}

// Is `attackerId` free to bombard `bodyName` — at war with its holder, and no
// armed warship of a nation at war with it in orbit?
export function canBombard(attackerId: string, bodyName: string, ships: BombardShip[], owners: OwnerMap, controllers: OwnerMap, atWar: AtWarFn): boolean {
  const victim = controllerOf(bodyName, owners, controllers)
  if (!victim || !atWar(attackerId, victim)) return false
  return !ships.some((s) => s.bodyName === bodyName && s.armed && atWar(s.ownerId, attackerId))
}

export function bombardmentStep(input: BombardInput): BombardResult {
  const { days, ships, owners, controllers, holders, atWar, simDays } = input
  let installations = input.installations
  const destroyedInstallations: Installation[] = []
  let armies = input.armies
  const devastation = { ...input.devastation }
  const popLoss: Record<string, number> = {}
  const strikes: Strike[] = []
  const struck = new Set<string>()

  // Firepower per (body, attacker).
  const power = new Map<string, { body: string; attacker: string; limited: number; full: number }>()
  for (const s of ships) {
    if (!s.bodyName || !s.armed || s.stance === 'off' || s.weapons <= 0) continue
    const key = `${s.bodyName}|${s.ownerId}`
    const p = power.get(key) ?? { body: s.bodyName, attacker: s.ownerId, limited: 0, full: 0 }
    const dmg = s.weapons * BOMBARD_POWER_PER_WEAPON * days
    if (s.stance === 'full') p.full += dmg * BOMBARD_FULL_MULT
    else p.limited += dmg
    power.set(key, p)
  }

  for (const { body, attacker, limited, full } of [...power.values()].sort((a, b) => (a.body + a.attacker < b.body + b.attacker ? -1 : 1))) {
    if (!canBombard(attacker, body, ships, owners, controllers, atWar)) continue
    const victim = controllerOf(body, owners, controllers)!
    const shielded = shieldedAgainst(body, attacker, installations, owners, holders, atWar, simDays)
    const factor = shielded ? 1 - SHIELD_BOMBARD_REDUCTION : 1
    const total = (limited + full) * factor
    if (total <= 0) continue
    struck.add(body)
    strikes.push({ bodyName: body, attackerId: attacker, victimId: victim, damage: total, shielded, full: full > 0 })

    let toDevastation = total * (1 - BOMBARD_SHARE_INSTALLATIONS - BOMBARD_SHARE_UNITS)

    // Installations held by the attacker's enemies.
    const targets = installations.filter((i) => {
      if (i.bodyName !== body || i.integrity <= 0) return false
      const h = holderOfInstallation(i, owners, holders)
      return !!h && atWar(h, attacker)
    })
    const instShare = total * BOMBARD_SHARE_INSTALLATIONS
    if (targets.length > 0) {
      installations = installations.map((i) => (targets.includes(i) ? { ...i, integrity: i.integrity - instShare / targets.length / DEFENSE_DEFS[i.kind].armor } : i))
      const gone = installations.filter((i) => i.integrity <= 0)
      if (gone.length > 0) {
        destroyedInstallations.push(...gone)
        installations = installations.filter((i) => i.integrity > 0)
      }
    } else toDevastation += instShare

    // Enemy ground units on the world.
    const unitShare = total * BOMBARD_SHARE_UNITS
    const enemyUnits = armies.filter((a) => a.location.kind === 'body' && a.location.bodyName === body && atWar(a.ownerId, attacker)).flatMap((a) => a.units)
    if (enemyUnits.length > 0) {
      const each = unitShare / enemyUnits.length
      const hit = new Set(enemyUnits.map((u) => u.id))
      armies = armies
        .map((a) =>
          a.location.kind === 'body' && a.location.bodyName === body && atWar(a.ownerId, attacker)
            ? { ...a, units: a.units.map((u) => (hit.has(u.id) ? { ...u, strength: u.strength - each } : u)).filter((u) => u.strength > UNIT_DESTROYED_BELOW) }
            : a,
        )
        .filter((a) => a.units.length > 0 || a.location.kind !== 'body')
    } else toDevastation += unitShare

    devastation[body] = Math.min(1, (devastation[body] ?? 0) + toDevastation * DEVASTATION_PER_DAMAGE)
    if (full > 0) popLoss[body] = Math.min(FULL_POP_LOSS_MAX_PER_DAY * days, (popLoss[body] ?? 0) + full * factor * FULL_POP_LOSS_PER_DAMAGE)
  }

  // Worlds not bombarded this step heal.
  for (const body of Object.keys(devastation)) {
    if (struck.has(body)) continue
    const next = devastation[body] - DEVASTATION_DECAY_PER_DAY * days
    if (next <= 0) delete devastation[body]
    else devastation[body] = next
  }

  return { installations, destroyedInstallations, armies, devastation, popLoss, strikes }
}
