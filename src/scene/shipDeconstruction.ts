// Scrapping a ship: the construction bar in reverse. The ship stays where it is while
// a bar runs from full to empty over what the hull took to build, then it is removed.
// It is a job of its own (state/shipDeconstructionStore.ts), never an order in the
// shipyard queue, so it holds no slip and starts at once. No refund: the one rule for
// taking down something that is already built (a building's teardown pays nothing
// either); cancelling a QUEUED build keeps its full refund (shipyardStore.cancelBuild).
// Timers are absolute simDays deadlines. Everything here is pure; the store and the
// resolver hook are the I/O.
import { shipBuildDays } from '../data/shipyardData'
import type { ShipClass } from '../data/shipData'

export interface ShipDeconstruction {
  shipId: string
  ownerId: string
  shipName: string
  className: string
  startedSimDays: number
  durationDays: number
  finishSimDays: number
}

// The bar runs as long as the hull took to build.
export function deconstructionDays(shipClass: ShipClass): number {
  return shipBuildDays(shipClass)
}

// What is left of the ship: 1 when it starts, 0 when it is gone.
export function deconstructionRemaining(job: Pick<ShipDeconstruction, 'startedSimDays' | 'durationDays'>, simDays: number): number {
  if (job.durationDays <= 0) return 0
  return Math.min(1, Math.max(0, 1 - (simDays - job.startedSimDays) / job.durationDays))
}

export function newDeconstruction(ship: { id: string; ownerId: string; name: string }, shipClass: ShipClass, simDays: number): ShipDeconstruction {
  const durationDays = deconstructionDays(shipClass)
  return { shipId: ship.id, ownerId: ship.ownerId, shipName: ship.name, className: shipClass.name, startedSimDays: simDays, durationDays, finishSimDays: simDays + durationDays }
}

// Why a ship cannot be scrapped now, or null when it can. Armies aboard would go down
// with it (armyLogic.reapLostCargo), so a transport has to be emptied first.
export function deconstructBlock(opts: { alreadyRunning: boolean; engaged: boolean; armiesAboard: number }): string | null {
  if (opts.alreadyRunning) return 'Already being deconstructed'
  if (opts.engaged) return 'It is in a fight'
  if (opts.armiesAboard > 0) return 'Unload its armies first'
  return null
}

// One step to `simDays`: a job whose bar reached empty finishes (the ship goes), unless
// the ship is in a fight, where it waits at empty until the fight is over; a job whose
// ship is already gone (destroyed, lost to a jump) is dropped without finishing.
export function stepDeconstructions(
  jobs: readonly ShipDeconstruction[],
  simDays: number,
  engagedShipIds: ReadonlySet<string>,
  liveShipIds: ReadonlySet<string>,
): { jobs: ShipDeconstruction[]; finished: ShipDeconstruction[] } {
  const remaining: ShipDeconstruction[] = []
  const finished: ShipDeconstruction[] = []
  for (const job of jobs) {
    if (!liveShipIds.has(job.shipId)) continue
    if (simDays >= job.finishSimDays && !engagedShipIds.has(job.shipId)) finished.push(job)
    else remaining.push(job)
  }
  return { jobs: remaining, finished }
}
