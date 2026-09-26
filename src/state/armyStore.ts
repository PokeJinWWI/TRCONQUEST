import { create } from 'zustand'
import { ARMY_KINDS, type ArmyKind } from '../data/armyData'
import { COUNTRIES } from '../data/countryData'
import { UNIT_TYPES } from '../data/groundData'
import { missingResources, spendCost } from '../scene/shipyardLogic'
import {
  armiesAboard,
  canEmbark,
  hasOrbitalSuperiority,
  landingCheck,
  makeUnits,
  type Army,
  type ArmyLocation,
  type LandingKind,
} from '../scene/armyLogic'
import { armyInContact, defaultDropNode, dropCheck, findPath, groundSurface, musterNode, placeUnits } from '../scene/groundLogic'
import { simDaysToGroundStep } from '../scene/groundResolution'
import { controllerOf } from '../scene/territory'
import { useResourceStore } from './resourceStore'
import { useShipStore } from './shipStore'
import { useTerritoryStore } from './territoryStore'
import { useEconomyStore, worldByName } from './economyStore'
import { useGameTimeStore } from './gameTimeStore'
import { atWar } from './diplomacyStore'
import { isPlayerOwned } from './shipRelations'
import { useTerrainStore } from './terrainStore'
import { engagedUnitIds } from '../scene/terrainWar'

// Units fighting on a terrain map take their orders there, not on the planetary
// map (scene/terrainWar.ts).
const inTerrainBattle = () => engagedUnitIds(useTerrainStore.getState().battles)

// Every nation's ground armies — the player's and every AI empire's, under
// the same rules (the AI's Marshal calls these same actions). The fighting is
// stepped by hooks/useGroundCombatResolver over the pure
// scene/groundResolution.stepGroundWar.
export type ArmyActionResult = { ok: true } | { ok: false; reason: string }

export interface NewArmy {
  ownerId: string
  kind: ArmyKind
  location: ArmyLocation
  // Share of full strength (default 1).
  strengthFraction?: number
  // For an army put on a body: where its units stand (a fine node). Omitted:
  // its nation's muster point if it holds the body, else a landing site.
  anchorNode?: number
}

interface ArmyState {
  armies: Army[]
  // How far the ground war has been simulated (integer ground steps; see
  // groundResolution.ts).
  resolvedThroughStep: number
  // Starts training an army at a world. Pays the cost up front.
  recruitArmy: (countryId: string, bodyName: string, kind: ArmyKind, simDays: number) => ArmyActionResult
  // Boards armies onto a transport orbiting the body they're on.
  embark: (armyIds: string[], shipId: string) => ArmyActionResult
  // Puts every army aboard a transport down on the body it orbits, at
  // `dropNode` (a fine surface node) or a sensible default site. At home
  // that's unloading; on an enemy world it's an invasion.
  land: (shipId: string, dropNode?: number) => { ok: true; kind: LandingKind } | { ok: false; reason: string }
  // Straight placement, no rules — game setup and the debug console.
  addArmy: (army: NewArmy) => string
  // Player orders to individual units (any the player doesn't own, or that
  // hold position, are ignored).
  // `queue` (Shift + right-click) adds the move to the END of each unit's
  // current route instead of replacing it; a unit with no route just goes.
  orderUnits: (unitIds: string[], node: number, queue?: boolean) => ArmyActionResult
  targetUnit: (unitIds: string[], targetUnitId: string | null) => void
  haltUnits: (unitIds: string[]) => void
  // Wholesale replacement — the ground-war resolver applying a step.
  setArmies: (armies: Army[], resolvedThroughStep?: number) => void
  reset: () => void
}

let armyCounter = 0
function nextArmyId(): string {
  armyCounter += 1
  return `army-${Date.now().toString(36)}-${armyCounter}`
}

// Where a nation can raise armies: a body it owns and controls that is either
// its capital or an inhabited world, and that isn't blockaded (enemy warships
// holding its orbit cut it off — otherwise a besieged world could always
// out-recruit the invasion waiting overhead).
export function canRecruitAt(countryId: string, bodyName: string): ArmyActionResult {
  const { bodyOwner, bodyController } = useTerritoryStore.getState()
  if (bodyOwner[bodyName] !== countryId) return { ok: false, reason: 'Not your world' }
  if (controllerOf(bodyName, bodyOwner, bodyController) !== countryId) return { ok: false, reason: 'World is occupied' }
  const isCapital = COUNTRIES.some((c) => c.id === countryId && c.capitalBodyName === bodyName)
  if (!isCapital && !worldByName(useEconomyStore.getState().worlds, bodyName)) return { ok: false, reason: 'Needs an inhabited world' }
  if (!hasOrbitalSuperiority(countryId, bodyName, useShipStore.getState().ships, atWar)) {
    return { ok: false, reason: 'Blockaded by enemy warships' }
  }
  return { ok: true }
}

// Every unit whose id is listed, with the army it belongs to.
function unitsById(armies: Army[], ids: Set<string>) {
  const out: { army: Army; unitId: string }[] = []
  for (const army of armies) for (const u of army.units) if (ids.has(u.id)) out.push({ army, unitId: u.id })
  return out
}

export const useArmyStore = create<ArmyState>((set, get) => ({
  armies: [],
  resolvedThroughStep: 0,

  recruitArmy: (countryId, bodyName, kind, simDays) => {
    const spec = ARMY_KINDS[kind]
    if (!spec.recruitCost || spec.recruitDays === undefined) return { ok: false, reason: `${spec.name}s can't be recruited` }
    const where = canRecruitAt(countryId, bodyName)
    if (!where.ok) return where
    const missing = missingResources(spec.recruitCost, useResourceStore.getState().stateFor(countryId).amounts)
    if (missing.length > 0) return { ok: false, reason: `Need more ${missing.join(', ')}` }
    spendCost(countryId, spec.recruitCost)
    const army: Army = {
      id: nextArmyId(),
      ownerId: countryId,
      kind,
      units: makeUnits(kind),
      location: { kind: 'recruiting', bodyName, readySimDays: simDays + spec.recruitDays },
    }
    set((s) => ({ armies: [...s.armies, army] }))
    return { ok: true }
  },

  embark: (armyIds, shipId) => {
    const ship = useShipStore.getState().ships.find((s) => s.id === shipId)
    if (!ship) return { ok: false, reason: 'Unknown ship' }
    const armies = get().armies
    const engaged = inTerrainBattle()
    const check = canEmbark(armyIds, ship, armies, (a) => armyInContact(a, armies, atWar) || a.units.some((u) => engaged.has(u.id)))
    if (!check.ok) return check
    const ids = new Set(armyIds)
    set((s) => ({
      armies: s.armies.map((a) =>
        ids.has(a.id)
          ? {
              ...a,
              location: { kind: 'embarked', shipId },
              // Off the map: positions and plans no longer apply.
              units: a.units.map((u) => ({ ...u, position: undefined, path: undefined, orderedMove: false, targetUnitId: null, firingAtId: null, objectiveNode: null })),
            }
          : a,
      ),
    }))
    return { ok: true }
  },

  land: (shipId, dropNode) => {
    const { ships } = useShipStore.getState()
    const ship = ships.find((s) => s.id === shipId)
    if (!ship) return { ok: false, reason: 'Unknown ship' }
    const { bodyOwner, bodyController, nodeHolders } = useTerritoryStore.getState()
    const armies = get().armies
    const check = landingCheck(ship, armies, ships, bodyOwner, bodyController, atWar)
    if (!check.ok) return check
    const surface = groundSurface(check.bodyName, bodyOwner)
    if (!surface) return { ok: false, reason: 'No surface to land on' }
    const cargo = armiesAboard(armies, shipId)
    const types = cargo.flatMap((a) => a.units.map((u) => u.type))
    let node = dropNode
    if (node === undefined) {
      node =
        check.kind === 'disembark'
          ? musterNode(surface)
          : defaultDropNode(surface, types, ship.ownerId, armies, bodyOwner, nodeHolders, atWar) ?? undefined
      if (node === undefined) return { ok: false, reason: 'No clear landing site' }
    }
    const drop = dropCheck(surface, node, types, ship.ownerId, armies, atWar)
    if (!drop.ok) return drop
    const step = simDaysToGroundStep(useGameTimeStore.getState().simDays)
    const aboard = new Set(cargo.map((a) => a.id))
    set((s) => ({
      armies: s.armies.map((a) =>
        aboard.has(a.id)
          ? { ...a, location: { kind: 'body', bodyName: check.bodyName }, units: placeUnits(surface, a.units, node!, step) }
          : a,
      ),
    }))
    return { ok: true, kind: check.kind }
  },

  addArmy: ({ ownerId, kind, location, strengthFraction, anchorNode }) => {
    const id = nextArmyId()
    let units = makeUnits(kind, strengthFraction ?? 1)
    if (location.kind === 'body') {
      const { bodyOwner, bodyController, nodeHolders } = useTerritoryStore.getState()
      const surface = groundSurface(location.bodyName, bodyOwner)
      if (surface) {
        const holds = controllerOf(location.bodyName, bodyOwner, bodyController) === ownerId
        const anchor =
          anchorNode ??
          (holds
            ? musterNode(surface)
            : defaultDropNode(surface, units.map((u) => u.type), ownerId, get().armies, bodyOwner, nodeHolders, atWar) ?? musterNode(surface))
        units = placeUnits(surface, units, anchor, simDaysToGroundStep(useGameTimeStore.getState().simDays))
      }
    }
    set((s) => ({ armies: [...s.armies, { id, ownerId, kind, units, location }] }))
    return id
  },

  orderUnits: (unitIds, node, queue = false) => {
    const { bodyOwner } = useTerritoryStore.getState()
    const armies = get().armies
    const engaged = inTerrainBattle()
    const mineSelected = unitsById(armies, new Set(unitIds)).filter(({ army }) => isPlayerOwned(army) && army.location.kind === 'body')
    const targets = mineSelected.filter(({ unitId }) => !engaged.has(unitId))
    if (mineSelected.length > 0 && targets.length === 0) return { ok: false, reason: 'In a terrain battle: give the order on the terrain map' }
    if (targets.length === 0) return { ok: false, reason: 'No units of yours selected' }
    const byUnit = new Map<string, { path: NonNullable<ReturnType<typeof findPath>>; keep: NonNullable<ReturnType<typeof findPath>> }>()
    let refused = 0
    for (const { army, unitId } of targets) {
      const unit = army.units.find((u) => u.id === unitId)!
      if (UNIT_TYPES[unit.type].holdsPosition || !unit.position || army.location.kind !== 'body') continue
      const surface = groundSurface(army.location.bodyName, bodyOwner)
      // Queued: plan from where the current route ends, and keep that route.
      const keep = queue && unit.path && unit.path.length > 0 ? unit.path : []
      const from = keep.length > 0 ? keep[keep.length - 1] : unit.position
      const path = surface ? findPath(surface, from, node, unit.type) : null
      if (path) byUnit.set(unitId, { path, keep })
      else refused++
    }
    if (byUnit.size === 0) return { ok: false, reason: refused > 0 ? "They can't get there" : 'Those units hold their position' }
    set((s) => ({
      armies: s.armies.map((a) =>
        a.units.some((u) => byUnit.has(u.id))
          ? { ...a, units: a.units.map((u) => (byUnit.has(u.id) ? { ...u, path: [...byUnit.get(u.id)!.keep, ...byUnit.get(u.id)!.path], orderedMove: true, stillSinceStep: undefined } : u)) }
          : a,
      ),
    }))
    return { ok: true }
  },

  targetUnit: (unitIds, targetUnitId) => {
    const engaged = inTerrainBattle()
    const ids = new Set(unitIds.filter((id) => !engaged.has(id)))
    set((s) => ({
      armies: s.armies.map((a) =>
        isPlayerOwned(a) && a.units.some((u) => ids.has(u.id))
          ? { ...a, units: a.units.map((u) => (ids.has(u.id) ? { ...u, targetUnitId } : u)) }
          : a,
      ),
    }))
  },

  haltUnits: (unitIds) => {
    const engaged = inTerrainBattle()
    const ids = new Set(unitIds.filter((id) => !engaged.has(id)))
    set((s) => ({
      armies: s.armies.map((a) =>
        isPlayerOwned(a) && a.units.some((u) => ids.has(u.id))
          ? { ...a, units: a.units.map((u) => (ids.has(u.id) ? { ...u, path: [], orderedMove: false } : u)) }
          : a,
      ),
    }))
  },

  setArmies: (armies, resolvedThroughStep) =>
    set((s) => ({ armies, resolvedThroughStep: resolvedThroughStep ?? s.resolvedThroughStep })),

  reset: () => set({ armies: [], resolvedThroughStep: 0 }),
}))
