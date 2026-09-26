import { create } from 'zustand'
import { DEFENSE_DEFS, type DefenseKind } from '../data/defenseData'
import { controllerOf } from '../scene/territory'
import { groundSurface } from '../scene/groundLogic'
import { holderOfInstallation, hostileBatteries, placeInstallation, shieldBlocksLanding, type Installation } from '../scene/defenseLogic'
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
  build: (countryId: string, bodyName: string, kind: DefenseKind, simDays: number) => DefenseResult
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

export function canBuildDefense(countryId: string, bodyName: string, kind: DefenseKind, installations: Installation[]): DefenseResult {
  const { bodyOwner, bodyController } = useTerritoryStore.getState()
  if (bodyOwner[bodyName] !== countryId) return { ok: false, reason: 'Not your world' }
  if (controllerOf(bodyName, bodyOwner, bodyController) !== countryId) return { ok: false, reason: 'World is occupied' }
  const def = DEFENSE_DEFS[kind]
  const here = installations.filter((i) => i.bodyName === bodyName && i.kind === kind).length
  if (here >= def.maxPerWorld) return { ok: false, reason: `At most ${def.maxPerWorld} ${def.name}${def.maxPerWorld === 1 ? '' : 's'} per world` }
  const missing = missingResources(def.cost, useResourceStore.getState().stateFor(countryId).amounts)
  if (missing.length > 0) return { ok: false, reason: `Not enough ${missing.join(', ')}` }
  return { ok: true }
}

export const useDefenseStore = create<DefenseState>((set, get) => ({
  installations: [],
  build: (countryId, bodyName, kind, simDays) => {
    const installations = get().installations
    const check = canBuildDefense(countryId, bodyName, kind, installations)
    if (!check.ok) return check
    const surface = groundSurface(bodyName, useTerritoryStore.getState().bodyOwner)
    if (!surface) return { ok: false, reason: 'No ground to build on' }
    const node = placeInstallation(surface, installations, kind)
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
    }
    set({ installations: [...installations, inst] })
    return { ok: true }
  },
  setInstallations: (installations) => set({ installations }),
}))
