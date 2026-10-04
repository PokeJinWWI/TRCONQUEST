// Which drive a ship uses for a move, the pure part: the player picks one per ship
// (ship panel) from the drives its hull has and its OWNER can use. 'auto' is the rule
// the planner always had, so a ship nobody touched behaves exactly as before:
//   warp usable and `warpEnabled` -> warp; else a usable hyperdrive and no usable warp
//   -> hyperdrive; else reaction. An explicit choice that is not available (a tech
//   gone, a hull swapped) falls back to auto. No drive stats, risk or range live here:
//   shipPhysics.planMoveUnchecked reads this and then does what it always did.
import { usableDrives } from '../data/warpData'

export type ShipDrive = 'reaction' | 'hyperdrive' | 'warp'
export type DriveChoice = ShipDrive | 'auto'

export const DRIVE_LABELS: Record<DriveChoice, string> = { auto: 'Auto', reaction: 'Reaction', hyperdrive: 'Hyperdrive', warp: 'Warp' }
export const DRIVE_ORDER: readonly ShipDrive[] = ['reaction', 'hyperdrive', 'warp']

export interface DriveOption {
  drive: ShipDrive
  available: boolean
  // Why it is greyed out; null when available.
  reason: string | null
}

type HullDrives = readonly { kind: 'warp' | 'hyperdrive' }[]

// The three drives with whether this hull's owner can use each now. Reaction always works.
export function driveOptions(ftlDrives: HullDrives, researched: ReadonlySet<string>): DriveOption[] {
  const usable = usableDrives(ftlDrives, researched)
  const hasWarp = ftlDrives.some((d) => d.kind === 'warp')
  const hasHyper = ftlDrives.some((d) => d.kind === 'hyperdrive')
  return [
    { drive: 'reaction', available: true, reason: null },
    {
      drive: 'hyperdrive',
      available: usable.hyperdrive,
      reason: usable.hyperdrive ? null : hasHyper ? 'Its owner has not researched Hyperdrive Mk I' : 'This hull has no hyperdrive',
    },
    {
      drive: 'warp',
      available: usable.warp,
      reason: usable.warp ? null : hasWarp ? 'Its owner has not researched Warp Drive Mk I' : 'This hull has no warp drive',
    },
  ]
}

// What 'auto' picks: the planner's original rule.
export function autoDrive(ftlDrives: HullDrives, researched: ReadonlySet<string>, warpEnabled: boolean): ShipDrive {
  const usable = usableDrives(ftlDrives, researched)
  if (usable.warp && warpEnabled) return 'warp'
  if (usable.hyperdrive && !usable.warp) return 'hyperdrive'
  return 'reaction'
}

// The drive a move actually uses.
export function effectiveDrive(choice: DriveChoice | undefined, ftlDrives: HullDrives, researched: ReadonlySet<string>, warpEnabled: boolean): ShipDrive {
  if (choice && choice !== 'auto') {
    const option = driveOptions(ftlDrives, researched).find((o) => o.drive === choice)
    if (option?.available) return choice
  }
  return autoDrive(ftlDrives, researched, warpEnabled)
}

// The choice a ship starts with: its class's own default (a Turing Scout flies on its hyperdrive), else auto.
export function defaultDriveChoice(classDefault: DriveChoice | undefined): DriveChoice {
  return classDefault ?? 'auto'
}

// For a selection, the drive the slowest ship uses: reaction is the slowest, then
// warp or hyperdrive by the travel time each ship's plan gives (`daysOf`, supplied
// by the caller from the real plan). Returns the ship's index in `ships`.
export function slowestIndex(ships: readonly { drive: ShipDrive; days: number }[]): number {
  let slow = 0
  for (let i = 1; i < ships.length; i++) if (ships[i].days > ships[slow].days) slow = i
  return slow
}

// Whether a trip is long enough to confirm before sending a ship by reaction drive.
export const LONG_TRIP_DAYS = 365
export function isLongTrip(days: number): boolean {
  return days > LONG_TRIP_DAYS
}
export function formatTripTime(days: number): string {
  return days >= 730 ? `${(days / 365.25).toFixed(1)} years` : `${Math.round(days)} days`
}
