import { ruralKeySlots } from '../scene/ruralStructures'
import { useStructureStore } from './structureStore'
import { create } from 'zustand'
import { DEFENSE_DEFS, isMilitaryKind, type DefenseKind } from '../data/defenseData'
import { controllerOf } from '../scene/territory'
import { groundSurface } from '../scene/groundLogic'
import { holderOfInstallation, hostileBatteries, judgeInstallationNode, placeInstallation, shieldBlocksLanding, withInstallationKeys, type Installation } from '../scene/defenseLogic'
import { spaceportSitesOf, syncMilitarySlots } from './nationEconomy'
import { withSpaceportKeys } from '../scene/spaceportSites'
import { withOutpostKey } from '../scene/colonyLogic'
import { withAreaKeys } from '../scene/footprintState'
import { useColonyStore } from './colonyStore'
import type { BodySurface } from '../scene/planetTerrain'
import { atWar } from './diplomacyStore'
import { useGameTimeStore } from './gameTimeStore'
import { missingResources, spendCost } from '../scene/shipyardLogic'
import { useTerritoryStore } from './territoryStore'
import { useResourceStore } from './resourceStore'

// Every planetary defense installation in the game (both economy modes). The
// rules are pure in scene/defenseLogic.ts; the ground war (useGroundCombatResolver)
// writes back integrity and destructions, hooks/useDefenseResolver.ts runs the
// batteries. An installation serves whoever holds its node — nothing about
// ownership is stored beyond who built it.

export type DefenseResult = { ok: true } | { ok: false; reason: string }

interface DefenseState {
  installations: Installation[]
  // Build one on a world the nation owns and holds: paid now from its
  // stockpile, ready after the kind's build time (an absolute deadline).
  // `opts.node` is a place the player chose (checked by scene/defenseLogic.judgeInstallationNode); without one it stands as near
  // the key node it guards as it can. `opts.name` names it.
  build: (countryId: string, bodyName: string, kind: DefenseKind, simDays: number, opts?: { node?: number; name?: string }) => DefenseResult
  // Names (or, with an empty name, un-names) an installation.
  renameInstallation: (id: string, name: string) => void
  // Write back the ground war's / bombardment's result (integrity, removals).
  setInstallations: (installations: Installation[]) => void
}

let counter = 0

// Live rule adapters for callers outside the pure ground war.
// Enemy defense batteries deny `countryId` the orbit of `bodyName`.
export function batteryDenial(countryId: string, bodyName: string): boolean {
  const { bodyOwner, nodeHolders } = useTerritoryStore.getState()
  return hostileBatteries(bodyName, countryId, useDefenseStore.getState().installations, bodyOwner, nodeHolders, atWar, useGameTimeStore.getState().simDays).length > 0
}
// Enemy installations (any kind, built or building) standing on `bodyName`.
export function hostileDefenseCount(countryId: string, bodyName: string): number {
  const { bodyOwner, nodeHolders } = useTerritoryStore.getState()
  return useDefenseStore.getState().installations.filter((i) => {
    if (i.bodyName !== bodyName) return false
    const h = holderOfInstallation(i, bodyOwner, nodeHolders)
    return !!h && atWar(h, countryId)
  }).length
}
// Nodes an enemy shield covers, for a nation landing on `bodyName`.
export function shieldedFor(landerId: string, bodyName: string): (node: number) => boolean {
  const { bodyOwner, nodeHolders } = useTerritoryStore.getState()
  const installations = useDefenseStore.getState().installations
  const simDays = useGameTimeStore.getState().simDays
  return (node) => shieldBlocksLanding(bodyName, node, landerId, installations, bodyOwner, nodeHolders, atWar, simDays)
}

// Military district slots the world's standing defenses take (built or building).
export function militaryInUse(bodyName: string, installations: Installation[]): number {
  return installations.filter((i) => i.bodyName === bodyName && isMilitaryKind(i.kind) && i.integrity > 0).length
}
function militaryByBody(installations: Installation[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const i of installations) if (isMilitaryKind(i.kind) && i.integrity > 0) out[i.bodyName] = (out[i.bodyName] ?? 0) + 1
  return out
}

// A world's ground map as the war sees it now: the terrain's key nodes, one
// for every spaceport its economy runs (scene/spaceportSites.ts), and those its
// installations add (active fortresses, a built spaceport). The ONE surface the
// ground war, the map, the planet screen and the AI use.
export function groundKeySurface(bodyName: string, owners = useTerritoryStore.getState().bodyOwner): BodySurface | null {
  const withPorts = groundPortSurface(bodyName, owners)
  if (!withPorts) return null
  const installations = useDefenseStore.getState().installations
  return installations.length > 0 ? withInstallationKeys(withPorts, installations, useGameTimeStore.getState().simDays) : withPorts
}
// The terrain's key nodes plus the colony's planetary outpost and the
// economy's spaceports (no installations yet).
export function groundPortSurface(bodyName: string, owners = useTerritoryStore.getState().bodyOwner): BodySurface | null {
  const surface = portBaseSurface(bodyName, owners)
  if (!surface) return null
  const sites = spaceportSitesOf(bodyName)
  const withPorts = sites.length > 0 ? withSpaceportKeys(surface, sites, useStructureStore.getState().ports[bodyName]) : surface
  // Rural structures on land (space-elevator anchors) are key nodes too; a platform at sea is not.
  const rural = useStructureStore.getState().rural[bodyName]
  const extra = rural && rural.length > 0 ? ruralKeySlots(withPorts, rural) : []
  const withRural = extra.length > 0 ? { ...withPorts, keySlots: [...withPorts.keySlots, ...extra] } : withPorts
  // Every urban area is a key node too (scene/footprintState.withAreaKeys), added last so it moves nothing above.
  const drawn = groundSurface(bodyName, owners)
  return drawn ? withAreaKeys(drawn, withRural) : withRural
}
// The ground with the colony's outpost, before the economy's spaceports are added (what the auto-placed ones are placed against).
export function portBaseSurface(bodyName: string, owners = useTerritoryStore.getState().bodyOwner): BodySurface | null {
  const terrain = groundSurface(bodyName, owners)
  return terrain ? withOutpostKey(terrain, useColonyStore.getState().colonies[bodyName]?.outpostNode) : null
}
// Kept for callers written before spaceport sites: the same surface.
export const liveGroundSurface = groundKeySurface

export function canBuildDefense(countryId: string, bodyName: string, kind: DefenseKind, installations: Installation[]): DefenseResult {
  const { bodyOwner, bodyController } = useTerritoryStore.getState()
  if (bodyOwner[bodyName] !== countryId) return { ok: false, reason: 'Not your world' }
  if (controllerOf(bodyName, bodyOwner, bodyController) !== countryId) return { ok: false, reason: 'World is occupied' }
  const def = DEFENSE_DEFS[kind]
  const here = installations.filter((i) => i.bodyName === bodyName && i.kind === kind).length
  if (here >= def.maxPerWorld) return { ok: false, reason: `At most ${def.maxPerWorld} ${def.name}${def.maxPerWorld === 1 ? '' : 's'} per world` }
  // No Military district slot is needed: a fortress, shield or battery is an ordinary building that stands anywhere (inside an area or settlement, or on its own).
  if (kind === 'spaceport') {
    const surface = groundSurface(bodyName, bodyOwner)
    if (!surface) return { ok: false, reason: 'No ground to build on' }
    if (withInstallationKeys(surface, installations, Infinity).keySlots.some((k) => k.kind === 'spaceport')) return { ok: false, reason: 'This world already has a spaceport' }
  }
  const missing = missingResources(def.cost, useResourceStore.getState().stateFor(countryId).amounts)
  if (missing.length > 0) return { ok: false, reason: `Not enough ${missing.join(', ')}` }
  return { ok: true }
}

export const useDefenseStore = create<DefenseState>((set, get) => ({
  installations: [],
  build: (countryId, bodyName, kind, simDays, opts) => {
    const installations = get().installations
    const check = canBuildDefense(countryId, bodyName, kind, installations)
    if (!check.ok) return check
    const surface = groundSurface(bodyName, useTerritoryStore.getState().bodyOwner)
    if (!surface) return { ok: false, reason: 'No ground to build on' }
    let node: number | null
    if (opts?.node !== undefined) {
      // The key nodes of the world as the war sees it (ports included), so a chosen place cannot sit on one.
      const keyed = groundKeySurface(bodyName) ?? surface
      const judged = judgeInstallationNode(keyed, installations, opts.node)
      if (!judged.ok) return judged
      node = opts.node
    } else node = placeInstallation(surface, installations, kind)
    if (node === null) return { ok: false, reason: 'No room left on the ground' }
    const def = DEFENSE_DEFS[kind]
    spendCost(countryId, def.cost)
    counter += 1
    const inst: Installation = {
      id: `def-${bodyName}-${kind}-${counter}-${Math.round(simDays)}`,
      bodyName,
      kind,
      node,
      integrity: def.integrity,
      builtBy: countryId,
      readySimDays: simDays + def.buildDays,
      ...(opts?.name?.trim() ? { name: opts.name.trim().slice(0, 40) } : {}),
    }
    set({ installations: [...installations, inst] })
    return { ok: true }
  },
  renameInstallation: (id, name) =>
    set((s) => ({
      installations: s.installations.map((i) => {
        if (i.id !== id) return i
        const { name: _drop, ...rest } = i
        void _drop
        return name.trim() ? { ...rest, name: name.trim().slice(0, 40) } : rest
      }),
    })),
  setInstallations: (installations) => set({ installations }),
}))

// Keep both economies' Military districts showing what stands in them.
export function resyncMilitarySlots(): void {
  syncMilitarySlots(militaryByBody(useDefenseStore.getState().installations))
}
useDefenseStore.subscribe((s, prev) => {
  if (s.installations !== prev.installations) syncMilitarySlots(militaryByBody(s.installations))
})
