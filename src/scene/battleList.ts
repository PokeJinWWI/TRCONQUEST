// The battles the player is in right now, of every kind, for the Outliner's
// Battles section — one place to see them all and jump to any. Pure: the
// stores are read by the caller. Two kinds exist today:
//   space   an engagement of ships in one place that includes a ship of the
//           player's and a genuinely hostile pair (combatStore's
//           engagementIsContested) — opens the combat arena
//   ground  a world where the player's units are firing or being fired at —
//           opens the planetary map
//   terrain a fight that has come to close quarters and moved onto a terrain
//           map (terrainBattle.ts) with a unit of the player's in it — opens
//           the terrain map
//   contest a world where the player's armies and a hostile nation's share the
//           ground but nobody is firing yet — the same fight in waiting; it
//           becomes a ground battle the moment shots are exchanged
import { armyStrength, playerFightLive, type Army } from './armyLogic'
import { bodyIndex, bodyStarId } from './territory'
import { engagementIsContested, type Engagement } from '../state/combatStore'
import { atWar, type AtWarFn } from '../state/diplomacyStore'
import type { ShipInstance } from '../state/shipStore'
import type { TerrainBattle } from './terrainBattle'

export type BattleKind = 'space' | 'ground' | 'terrain' | 'contest'

export const BATTLE_KIND_LABELS: Record<BattleKind, string> = {
  space: 'Space',
  ground: 'Ground',
  terrain: 'Terrain',
  contest: 'Contest',
}

export interface PlayerBattle {
  // Stable across a fight: 'space:<engagement id>' or 'ground:<body>'.
  key: string
  kind: BattleKind
  // Where it is: an orbit or body name.
  place: string
  // The system to bring into view when opening it (for the breadcrumb).
  starId: string | undefined
  // Space only: the engagement to open. Ground only: the world to open.
  engagementId?: string
  bodyName?: string
  // Terrain only: the terrain battle to open.
  terrainBattleId?: string
}

function shipStarId(ship: Pick<ShipInstance, 'location'>): string | undefined {
  const loc = ship.location
  if (loc.kind === 'orbiting') return loc.systemId
  if (loc.kind === 'star') return loc.starId
  return undefined
}

// Space battles the player has a ship in.
export function playerSpaceBattles(engagements: Engagement[], ships: Pick<ShipInstance, 'id' | 'ownerId' | 'location'>[], playerId: string | null): PlayerBattle[] {
  if (!playerId) return []
  const byId = new Map(ships.map((s) => [s.id, s]))
  const out: PlayerBattle[] = []
  for (const e of engagements) {
    if (!engagementIsContested(e, (id) => byId.has(id))) continue
    const mine = e.participants.map((p) => byId.get(p.shipId)).filter((s): s is NonNullable<typeof s> => !!s && s.ownerId === playerId)
    if (mine.length === 0) continue
    out.push({ key: `space:${e.id}`, kind: 'space', place: e.locationLabel, starId: shipStarId(mine[0]), engagementId: e.id })
  }
  return out
}

// Worlds where the player's ground units are in a fight.
// Units in a terrain battle are that battle's business, not the planetary
// map's: a fight they are in shows as a Terrain battle, not a Ground one.
function withoutEngaged(armies: Army[], engaged: ReadonlySet<string>): Army[] {
  if (engaged.size === 0) return armies
  return armies.map((a) => ({ ...a, units: a.units.filter((u) => !engaged.has(u.id)) }))
}

export function playerGroundBattles(all: Army[], playerId: string | null, engaged: ReadonlySet<string> = new Set()): PlayerBattle[] {
  if (!playerId) return []
  const armies = withoutEngaged(all, engaged)
  const byBody = new Map<string, Army[]>()
  for (const a of armies) {
    if (a.location.kind !== 'body') continue
    byBody.set(a.location.bodyName, [...(byBody.get(a.location.bodyName) ?? []), a])
  }
  const out: PlayerBattle[] = []
  for (const [body, here] of [...byBody.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (!playerFightLive(here, playerId)) continue
    out.push({ key: `ground:${body}`, kind: 'ground', place: body, starId: bodyStarId(body), bodyName: body })
  }
  return out
}

// Worlds where the player's armies stand alongside a hostile nation's with no
// shooting going on yet. A world with a live fight is a ground battle instead,
// never both.
export function playerContests(all: Army[], playerId: string | null, atWarFn: AtWarFn = atWar, engaged: ReadonlySet<string> = new Set()): PlayerBattle[] {
  if (!playerId) return []
  const armies = withoutEngaged(all, engaged)
  const byBody = new Map<string, Army[]>()
  for (const a of armies) {
    if (a.location.kind !== 'body' || a.units.length === 0) continue
    byBody.set(a.location.bodyName, [...(byBody.get(a.location.bodyName) ?? []), a])
  }
  const out: PlayerBattle[] = []
  for (const [body, here] of [...byBody.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (!here.some((a) => a.ownerId === playerId) || !here.some((a) => a.ownerId !== playerId && atWarFn(a.ownerId, playerId))) continue
    if (playerFightLive(here, playerId)) continue
    out.push({ key: `contest:${body}`, kind: 'contest', place: body, starId: bodyStarId(body), bodyName: body })
  }
  return out
}

// Terrain battles the player has a unit in.
export function playerTerrainBattles(battles: TerrainBattle[], playerId: string | null): PlayerBattle[] {
  if (!playerId) return []
  return battles
    .filter((b) => b.units.some((u) => u.ownerId === playerId))
    .map((b) => ({ key: `terrain:${b.id}`, kind: 'terrain' as const, place: b.bodyName, starId: bodyStarId(b.bodyName), bodyName: b.bodyName, terrainBattleId: b.id }))
}

// One line of state for a terrain battle: each side's strength.
export function terrainBattleDetail(battle: TerrainBattle | undefined, playerId: string, atWarFn: AtWarFn): string {
  if (!battle) return ''
  let mine = 0
  let theirs = 0
  for (const u of battle.units) {
    if (u.ownerId === playerId) mine += u.strength
    else if (atWarFn(u.ownerId, playerId)) theirs += u.strength
  }
  return `yours ${Math.round(mine)} · enemy ${Math.round(theirs)}`
}

// One line of state for a ground battle: each side's strength on the world.
export function groundBattleDetail(armies: Army[], bodyName: string, playerId: string, atWarFn: AtWarFn): string {
  let mine = 0
  let theirs = 0
  for (const a of armies) {
    if (a.location.kind !== 'body' || a.location.bodyName !== bodyName) continue
    const s = armyStrength(a).strength
    if (a.ownerId === playerId) mine += s
    else if (atWarFn(a.ownerId, playerId)) theirs += s
  }
  return `yours ${Math.round(mine)} · enemy ${Math.round(theirs)}`
}

// One line of state for a space battle: ships on each side.
export function spaceBattleDetail(engagement: Engagement | undefined, ships: Pick<ShipInstance, 'id' | 'ownerId'>[], playerId: string, atWarFn: AtWarFn): string {
  if (!engagement) return ''
  const byId = new Map(ships.map((s) => [s.id, s]))
  let mine = 0
  let theirs = 0
  for (const p of engagement.participants) {
    const ship = byId.get(p.shipId)
    if (!ship) continue
    if (ship.ownerId === playerId) mine++
    else if (atWarFn(ship.ownerId, playerId)) theirs++
  }
  return `${mine} of yours · ${theirs} hostile`
}

// --- Where battles show on the maps ------------------------------------------
//
// Every map level marks the places the player is fighting, so a fight in
// orbit of one planet reads from the interstellar or galactic view too. Each
// answers "which kinds of battle are at or below this marker?", in a fixed
// order so the result can be a stable string.
function kindsOf(battles: PlayerBattle[]): BattleKind[] {
  return (['space', 'ground', 'terrain', 'contest'] as const).filter((k) => battles.some((b) => b.kind === k))
}

// Battles at a body, or — for a planet — at any of its moons (a fight over
// Luna shows on Earth's marker too). A moon's marker shows only its own.
export function battlesAtBody(battles: PlayerBattle[], bodyName: string): PlayerBattle[] {
  const index = bodyIndex()
  return battles.filter((b) => b.place === bodyName || index.get(b.place)?.parentPlanet === bodyName)
}

export function battlesInSystem(battles: PlayerBattle[], starId: string): PlayerBattle[] {
  return battles.filter((b) => b.starId === starId)
}

export function battleKindsAtBody(battles: PlayerBattle[], bodyName: string): BattleKind[] {
  return kindsOf(battlesAtBody(battles, bodyName))
}

export function battleKindsInSystem(battles: PlayerBattle[], starId: string): BattleKind[] {
  return kindsOf(battlesInSystem(battles, starId))
}

// A neighbourhood holds the systems listed for it; battles in any of them show
// on its marker.
export function battlesInStars(battles: PlayerBattle[], starIds: string[]): PlayerBattle[] {
  return battles.filter((b) => b.starId !== undefined && starIds.includes(b.starId))
}
