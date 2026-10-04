// Shared fixture for tests that need real warp flight. No preset hull carries a
// warp drive (the Sol neighbourhood flies hyperdrives, data/warpData.ts), so a
// warp ship is a designer-built hull with a warp or dual drive module, owned by
// a nation that has researched Warp Drive Mk I or better.
import { DESIGN_ID_PREFIX } from '../src/state/shipClassResolver'
import { useShipDesignStore } from '../src/state/shipDesignStore'
import { useTechStore } from '../src/state/techStore'
import { DEFAULT_RESEARCHED } from '../src/state/techStore'
import { setJumpRoll } from '../src/scene/shipPhysics'
import { DUAL_DRIVE_TECH_ID, WARP_DRIVE_TECH_IDS } from '../src/data/warpData'

// Registers a design on `chassisId` with the given drive module and returns the
// class id to spawn ships with.
export function driveHullId(chassisId: string, driveModuleId: 'drive-hyper' | 'drive-warp' | 'drive-dual', name = `Test ${driveModuleId}`): string {
  const designId = useShipDesignStore.getState().createDesign(chassisId, name)
  if (!designId) throw new Error(`no chassis ${chassisId}`)
  useShipDesignStore.getState().equipModule(designId, 'drive', 0, driveModuleId)
  return `${DESIGN_ID_PREFIX}${designId}`
}

export function warpHullId(chassisId = 'corvette-hull'): string {
  return driveHullId(chassisId, 'drive-warp')
}

// Gives `countryId` Warp Drive Mk I..`mk` (and Dual-Drive Systems if asked) on
// top of what it has researched, without spending anything.
export function grantWarp(countryId: string, mk = 1, dual = false): void {
  const current = useTechStore.getState().byCountry[countryId]
  const researched = new Set(current?.researched ?? DEFAULT_RESEARCHED)
  for (const id of WARP_DRIVE_TECH_IDS.slice(0, mk)) researched.add(id)
  if (dual) researched.add(DUAL_DRIVE_TECH_ID)
  useTechStore.setState((s) => ({
    byCountry: { ...s.byCountry, [countryId]: { researchPoints: current?.researchPoints ?? { physics: 0, society: 0, engineering: 0 }, queue: current?.queue, researched } },
  }))
}

// Every preset hull jumps by hyperdrive, and an uncharted jump can lose the ship.
// A test that is not about that risk calls this so its ships always arrive.
export function safeJumps(): void {
  setJumpRoll(() => 1)
}
