// Rural structures, store side: ordering one at a chosen node and keeping the ledger (state/structureStore.rural) in step with the
// economy's own count, as portStructures does for spaceports. Land structures are key nodes of the ground map (a named target that can be
// captured, scene/ruralStructures.ruralKeySlots); a platform at sea is not (nobody can walk to it) and falls only with orbital control.
import { RECIPES, isRural } from '../economy/recipes'
import { useAbstractEconomyStore } from '../state/abstractEconomyStore'
import { portBaseSurface } from '../state/defenseStore'
import { useEconomyStore, worldByName } from '../state/economyStore'
import { isAbstractEconomy } from '../state/playerStore'
import { useStructureStore, type RuralStructure } from '../state/structureStore'
import { useTerritoryStore } from '../state/territoryStore'
import type { SimpleBuildingId } from '../data/simplisticEconomyData'
import type { OrderResult } from './lensOrders'
import { fromLonLat } from './mapProjection'
import { arc, nodePoint, surfaceMesh } from './surfaceMesh'
import { capturableByGround, judgeRuralNode, type NodeJudgement } from './ruralStructures'
import { controllerOf } from './territory'

const rulesOf = (recipeId: string) => ({ equatorial: recipeId === 'spaceElevatorAnchor', allowSea: RECIPES[recipeId]?.allowSea === true })

// How many of `recipeId` the economy has on the body, built or on order.
export function ruralCount(bodyName: string, recipeId: string): number {
  if (isAbstractEconomy()) {
    const owner = useTerritoryStore.getState().bodyOwner[bodyName]
    const w = useAbstractEconomyStore.getState().worlds[bodyName]
    const queued = owner ? (useAbstractEconomyStore.getState().byCountry[owner]?.queue ?? []).filter((o) => o.bodyName === bodyName && o.building === recipeId).length : 0
    return ((w?.buildings as Record<string, number> | undefined)?.[recipeId] ?? 0) + queued
  }
  const w = worldByName(useEconomyStore.getState().worlds, bodyName)
  if (!w) return 0
  return w.buildings.filter((b) => b.recipeId === recipeId).reduce((n, b) => n + Math.max(1, b.level), 0) + w.constructionQueue.filter((o) => o.recipeId === recipeId && !o.district).length
}

// Forgets structures the economy no longer has (a cancelled order, a demolished building): the latest give theirs up first.
export function reconcileRural(bodyName: string): void {
  const store = useStructureStore.getState()
  const list = store.rural[bodyName]
  if (!list || list.length === 0) return
  const kept: RuralStructure[] = []
  // Anchors the game opened with are relics of the old empire's works and stay whatever the economy counts.
  kept.push(...list.filter((r) => r.seeded))
  for (const recipeId of new Set(list.map((r) => r.recipeId))) kept.push(...list.filter((r) => !r.seeded && r.recipeId === recipeId).slice(0, ruralCount(bodyName, recipeId)))
  if (kept.length !== list.length) store.setRural(bodyName, list.filter((r) => kept.includes(r)))
}

export function ruralOf(bodyName: string): readonly RuralStructure[] {
  reconcileRural(bodyName)
  return useStructureStore.getState().rural[bodyName] ?? []
}

export function judgeRural(bodyName: string, recipeId: string, node: number): NodeJudgement {
  const surface = portBaseSurface(bodyName)
  if (!surface) return { ok: false, reason: 'No ground here.' }
  return judgeRuralNode(surface, node, ruralOf(bodyName), rulesOf(recipeId))
}

export function placeRural(builderId: string, bodyName: string, recipeId: string, node: number, name?: string): OrderResult {
  if (!isRural(recipeId)) return { ok: false, reason: 'That building goes on a development site.' }
  const { bodyOwner, bodyController } = useTerritoryStore.getState()
  if (bodyOwner[bodyName] !== builderId) return { ok: false, reason: `You do not govern ${bodyName}.` }
  if (controllerOf(bodyName, bodyOwner, bodyController) !== builderId) return { ok: false, reason: `${bodyName} is occupied.` }
  const judged = judgeRural(bodyName, recipeId, node)
  if (!judged.ok) return judged
  const before = ruralCount(bodyName, recipeId)
  if (isAbstractEconomy()) {
    const r = useAbstractEconomyStore.getState().queueBuilding(builderId, bodyName, recipeId as SimpleBuildingId)
    if (!r.ok) return { ok: false, reason: r.reason }
  } else {
    useEconomyStore.getState().queueConstruction(bodyName, recipeId, { kind: 'state' })
  }
  if (ruralCount(bodyName, recipeId) <= before) return { ok: false, reason: 'The order was refused: no room, no money, or the building is not available.' }
  const store = useStructureStore.getState()
  store.addRural(bodyName, { id: `${bodyName}#rural-${Date.now().toString(36)}-${(store.rural[bodyName] ?? []).length}`, recipeId, node, ownerId: builderId, ...(name?.trim() ? { name: name.trim().slice(0, 40) } : {}) })
  return { ok: true }
}

export function isSeaNode(bodyName: string, node: number): boolean {
  const surface = portBaseSurface(bodyName)
  return !!surface && !capturableByGround(surface, node)
}

// Places a body's starting rural structures (once): each target snaps to the nearest node of the right kind on the band that the rules
// allow. They are the owner's, not ordered, and the economy does not count them.
export function seedRuralStructures(bodyName: string, ownerId: string, recipeId: string, targets: readonly { name: string; at: [number, number]; sea: boolean }[]): void {
  const store = useStructureStore.getState()
  if ((store.rural[bodyName] ?? []).some((r) => r.seeded)) return
  const surface = portBaseSurface(bodyName)
  if (!surface) return
  const mesh = surfaceMesh()
  const list: RuralStructure[] = []
  for (const t of targets) {
    const at = fromLonLat((t.at[0] * Math.PI) / 180, (t.at[1] * Math.PI) / 180)
    let best = -1
    let bestD = Infinity
    for (let i = 0; i < mesh.count.fine; i++) {
      if (capturableByGround(surface, i) === t.sea) continue
      const d = arc(nodePoint(i), at)
      if (d < bestD && judgeRuralNode(surface, i, list, { equatorial: true, allowSea: true }).ok) {
        best = i
        bestD = d
      }
    }
    if (best >= 0) list.push({ id: `${bodyName}#rural-seed-${list.length}`, recipeId, node: best, ownerId, name: t.name, seeded: true })
  }
  if (list.length > 0) store.setRural(bodyName, [...(store.rural[bodyName] ?? []), ...list])
}
