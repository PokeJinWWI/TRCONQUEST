// Buildings that stand on their own ground, in no area and on no site (docs/territorial-design.md section 14): spaceports, defences
// (fortress, shield generator, battery) and rural structures (a space-elevator anchor). Every one of them is a node of the ground map.
// This module is what the Buildings tab's "Standalone buildings" section and the ground map's construction bars read: what can be built
// here, what stands or is being built, and the action that opens the ground map ready to choose the place.
import { DEFENSE_DEFS, BUILDABLE_DEFENSE_KINDS, type DefenseKind } from '../data/defenseData'
import { SIMPLE_BUILDING_DEFS } from '../data/simplisticEconomyData'
import { RECIPES, isRural } from '../economy/recipes'
import { orderCost } from '../economy-abstract/abstractEconomy'
import { useAbstractEconomyStore } from '../state/abstractEconomyStore'
import { canBuildDefense, groundKeySurface, useDefenseStore } from '../state/defenseStore'
import { useEconomyStore, worldByName } from '../state/economyStore'
import { useGameTimeStore } from '../state/gameTimeStore'
import { useGroundViewStore } from '../state/groundViewStore'
import { useLensStore, type LensTool } from '../state/lensStore'
import { isAbstractEconomy } from '../state/playerStore'
import { useStructureStore } from '../state/structureStore'
import { useTechStore } from '../state/techStore'
import { useTerritoryStore } from '../state/territoryStore'
import { useViewStore } from '../state/viewStore'
import { regionAt } from './bodyTopography'
import { isActive } from './defenseLogic'
import { portList } from './portList'
import { holderOf } from './groundLogic'
import { ruralOf } from './ruralOrders'

export interface StandaloneOption {
  id: string
  name: string
  iconId: string
  tool: LensTool
  // Why it cannot be built now (shown beside it, greyed); null = go ahead.
  blocked: string | null
}

export type StandaloneKind = 'port' | 'defense' | 'rural'

export interface StandaloneRow {
  key: string
  kind: StandaloneKind
  iconId: string
  name: string
  // What it is, in a sentence or two (its window).
  description: string
  // Who holds it now, and the region it stands in.
  holder: string | null
  region: string | null
  detail: string
  // A defence's structure, shown as "60/60".
  integrity: string | null
  // How the player renames it (a port, an installation or a rural structure), or null.
  renameAs: { kind: StandaloneKind; id: string } | null
  node: number | null
  // Complex: the economy building this is (opens its window).
  buildingId?: string
  // 0..1 while it is being built; null once it stands.
  progress: number | null
}

export interface PendingBuild {
  id: string
  node: number
  iconId: string
  name: string
  fraction: number
}

const simple = () => isAbstractEconomy()

// Everything the player can put down on open ground of this world, with the reason when it cannot be built just now.
export function standaloneOptions(playerId: string, bodyName: string): StandaloneOption[] {
  const out: StandaloneOption[] = []
  out.push({ id: 'spaceport', name: simple() ? SIMPLE_BUILDING_DEFS.spaceport.name : RECIPES.spaceport?.label ?? 'Spaceport', iconId: 'spaceport', tool: { kind: 'building', id: 'spaceport', name: 'Spaceport' }, blocked: null })
  const installations = useDefenseStore.getState().installations
  for (const kind of BUILDABLE_DEFENSE_KINDS) {
    const check = canBuildDefense(playerId, bodyName, kind, installations)
    out.push({ id: kind, name: DEFENSE_DEFS[kind].name, iconId: kind, tool: { kind: 'defense', defense: kind, name: DEFENSE_DEFS[kind].name }, blocked: check.ok ? null : (check as { reason: string }).reason })
  }
  const researched = useTechStore.getState().stateFor(playerId).researched
  for (const r of Object.values(RECIPES)) {
    if (!isRural(r.id) || r.autoBuilt) continue
    if (simple() && !(r.id in SIMPLE_BUILDING_DEFS)) continue
    out.push({ id: r.id, name: r.label, iconId: r.id, tool: { kind: 'building', id: r.id, name: r.label }, blocked: r.requiresTech && !researched.has(r.requiresTech) ? `Needs ${r.requiresTech}` : null })
  }
  return out
}

// Opens the ground map of the world with the option in hand: the next click on the ground is where it goes (the build lens does the rest).
export function chooseStandaloneSite(bodyName: string, option: StandaloneOption): void {
  useViewStore.getState().enterGround(bodyName)
  useLensStore.getState().arm(option.tool)
  useLensStore.getState().say(`Click the ground where the ${option.name} should go. Esc puts it down.`, true)
}

// Opens the ground map on a node.
export function showNodeOnMap(bodyName: string, node: number): void {
  useViewStore.getState().enterGround(bodyName)
  useGroundViewStore.getState().focusNode(node)
}

// What is on order for `recipeId` on this body, oldest first, as 0..1 progress. Complex orders carry their cost; Simple's come from the
// building's own.
function orderFractions(bodyName: string, buildingId: string): number[] {
  if (simple()) {
    const owner = useTerritoryStore.getState().bodyOwner[bodyName]
    const queue = (owner ? useAbstractEconomyStore.getState().byCountry[owner]?.queue : undefined) ?? []
    return queue.filter((o) => o.bodyName === bodyName && o.building === buildingId).map((o) => Math.max(0, Math.min(1, o.progress / Math.max(1, orderCost(o)))))
  }
  const w = worldByName(useEconomyStore.getState().worlds, bodyName)
  return (w?.constructionQueue ?? []).filter((o) => o.recipeId === buildingId && !o.district).map((o) => Math.max(0, Math.min(1, o.progress / Math.max(1, o.cost))))
}

// Spaceports and rural structures that are ordered but not built yet, each with the share of its order done. (Defences under construction
// are drawn by the installation markers themselves.)
export function pendingBuilds(bodyName: string): PendingBuild[] {
  const out: PendingBuild[] = []
  const surface = groundKeySurface(bodyName)
  const built = new Set((surface?.keySlots ?? []).filter((k) => k.kind === 'spaceport').map((k) => k.node))
  const ports = (useStructureStore.getState().ports[bodyName] ?? []).filter((p) => p.chosen && !built.has(p.node))
  const portOrders = orderFractions(bodyName, 'spaceport')
  ports.forEach((p, i) => out.push({ id: p.id, node: p.node, iconId: 'spaceport', name: p.name ?? 'Spaceport', fraction: portOrders[i] ?? 0 }))
  const rural = ruralOf(bodyName).filter((r) => !r.seeded)
  for (const recipeId of new Set(rural.map((r) => r.recipeId))) {
    const orders = orderFractions(bodyName, recipeId)
    const mine = rural.filter((r) => r.recipeId === recipeId)
    // The last ones ordered are the ones still being built.
    mine.slice(Math.max(0, mine.length - orders.length)).forEach((r, i) => out.push({ id: r.id, node: r.node, iconId: recipeId, name: r.name ?? RECIPES[recipeId]?.label ?? recipeId, fraction: orders[i] ?? 0 }))
  }
  return out
}

// How far along an installation's construction is (1 once built).
export const installationProgress = (readySimDays: number, buildDays: number, now: number): number => (now >= readySimDays ? 1 : Math.max(0, Math.min(1, 1 - (readySimDays - now) / Math.max(1, buildDays))))

// Everything that stands on its own on this world or is being built there.
export function standaloneRows(bodyName: string): StandaloneRow[] {
  const rows: StandaloneRow[] = []
  const now = useGameTimeStore.getState().simDays
  const list = portList(bodyName)
  const world = simple() ? undefined : worldByName(useEconomyStore.getState().worlds, bodyName)
  const corporations = useEconomyStore.getState().corporations
  const { bodyOwner, nodeHolders } = useTerritoryStore.getState()
  const holderAt = (node: number): string | null => holderOf(bodyName, node, bodyOwner, nodeHolders) ?? null
  const portNodes = new Map((useStructureStore.getState().ports[bodyName] ?? []).map((p) => [p.node, p.id]))
  for (const r of list.rows) {
    if (r.building) continue
    // Complex: the economy building that runs it (the state's, or the company named as its operator).
    const building = world?.buildings.find((b) => b.recipeId === 'spaceport' && (r.operator?.includes('(state)') ? b.owner.kind === 'state' : b.owner.kind === 'corporation' && corporations.find((c) => c.id === (b.owner as { corporationId: string }).corporationId)?.name === r.operator))
    const portId = portNodes.get(r.node)
    rows.push({
      key: r.id, kind: 'port', iconId: 'spaceport', name: r.name, description: `One of ${bodyName}'s spaceports: landing fields and orbital lift, a key node of the ground map.${r.operator ? ` Run by ${r.operator}.` : ''}`,
      holder: holderAt(r.node), region: r.area ? `inside ${r.area}` : r.region, detail: [r.operator, r.area ? `in ${r.area}` : r.region].filter(Boolean).join(' · '), integrity: null,
      renameAs: portId ? { kind: 'port', id: portId } : null, node: r.node, ...(building ? { buildingId: building.id } : {}), progress: null,
    })
  }
  for (const p of pendingBuilds(bodyName)) {
    const isPort = p.iconId === 'spaceport'
    rows.push({
      key: p.id, kind: isPort ? 'port' : 'rural', iconId: p.iconId, name: p.name, description: `${p.name} is being built.`, holder: bodyOwner[bodyName] ?? null, region: regionAt(bodyName, p.node),
      detail: `${Math.round(p.fraction * 100)}% built · ${regionAt(bodyName, p.node) ?? ''}`.replace(/ · $/, ''), integrity: null, renameAs: isPort ? { kind: 'port', id: p.id } : { kind: 'rural', id: p.id }, node: p.node, progress: p.fraction,
    })
  }
  for (const i of useDefenseStore.getState().installations) {
    if (i.bodyName !== bodyName || i.kind === 'spaceport' || i.integrity <= 0) continue
    const def = DEFENSE_DEFS[i.kind]
    const building = !isActive(i, now)
    const progress = building ? installationProgress(i.readySimDays, def.buildDays, now) : null
    rows.push({
      key: i.id, kind: 'defense', iconId: i.kind, name: i.name ?? def.name, description: def.description, holder: holderAt(i.node), region: regionAt(bodyName, i.node),
      detail: building ? `${Math.round((progress ?? 0) * 100)}% built · ${regionAt(bodyName, i.node) ?? ''}`.replace(/ · $/, '') : [regionAt(bodyName, i.node), `integrity ${Math.round(i.integrity)}/${def.integrity}`].filter(Boolean).join(' · '),
      integrity: `${Math.round(i.integrity)}/${def.integrity}`, renameAs: { kind: 'defense', id: i.id }, node: i.node, progress,
    })
  }
  const building = new Set(pendingBuilds(bodyName).map((p) => p.id))
  for (const r of ruralOf(bodyName)) {
    if (building.has(r.id)) continue
    rows.push({
      key: r.id, kind: 'rural', iconId: r.recipeId, name: r.name ?? RECIPES[r.recipeId]?.label ?? r.recipeId, description: 'A structure on its own ground: a node of the ground map.', holder: holderAt(r.node) ?? r.ownerId, region: regionAt(bodyName, r.node),
      detail: regionAt(bodyName, r.node) ?? '', integrity: null, renameAs: { kind: 'rural', id: r.id }, node: r.node, progress: null,
    })
  }
  return rows
}

// The Defense tab's build button (and every other defence build menu): the ground map opens with the defence in hand, and the player clicks
// where it goes. Refused up front when it cannot be built (the reason is returned).
export function chooseDefenseSite(playerId: string, bodyName: string, kind: DefenseKind): { ok: true } | { ok: false; reason: string } {
  const option = standaloneOptions(playerId, bodyName).find((o) => o.id === kind)
  if (!option) return { ok: false, reason: 'That cannot be built here.' }
  if (option.blocked) return { ok: false, reason: option.blocked }
  chooseStandaloneSite(bodyName, option)
  return { ok: true }
}
