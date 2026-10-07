// Non-move commands to a ship — survey, and (below) cargo and Starbase
// building. `queueShipCommand` is what the player's UI calls: with instant
// comms contact the command applies at once, otherwise it travels as a signal
// and useCommsResolver applies it when it arrives. `applyShipCommand` is the
// one place a command takes effect, when it reaches the ship. The strategic AI
// sends its commands the same way (queueShipCommand): a nation's orders wait on
// its own comms tier, whoever gives them.
import { useGameTimeStore } from '../state/gameTimeStore'
import { useShipStore, type MoveDestination, type ShipCommand } from '../state/shipStore'
import { useSurveyStore } from '../state/surveyStore'
import { useTerritoryStore } from '../state/territoryStore'
import { resolveShipClass } from '../state/shipClassResolver'
import { useResourceStore } from '../state/resourceStore'
import type { ResourceId } from '../data/resourceData'
import type { ResourceCost } from '../data/shipyardData'
import { useShipyardStore } from '../state/shipyardStore'
import { useStarbaseStore } from '../state/starbaseStore'
import { useTechStore } from '../state/techStore'
import { getCountry } from '../data/countryData'
import { commsTierFor } from '../data/commsData'
import { commsInstantContact, orderSelectedFleets, ownerCommsDelayToShip, shipCommsDelayDays } from './commsVisual'
import { isPlayerOwned } from '../state/shipRelations'
import { confirmRiskyJump } from './jumpConfirm'
import { cargoPlus, cargoSpace, clampToSpace, loadingBody, transferCheck, cargoMinus } from './cargoLogic'
import { spendCost } from './shipyardLogic'
import { restingStarId, surveyJobBodies, systemOfShip } from './surveyLogic'
import { bodyStarId } from './territory'
import { advanceSurveyJob } from '../hooks/useSurveyResolver'
import { startFounding } from './colonies'
import { isArmed } from './armyLogic'

// Signal time for a discovery to reach its nation's capital from where the ship
// is now — the FTL comms delay (0 with Hyper Comms, and for a nation with no
// capital, i.e. a sandbox faction, which needs no report at all).
export function reportDelayDays(ownerId: string, ship: Parameters<typeof shipCommsDelayDays>[0], simDays: number): number {
  const country = getCountry(ownerId)
  if (!country) return 0
  const tier = commsTierFor(useTechStore.getState().stateFor(ownerId).researched)
  return shipCommsDelayDays(ship, country.capitalStarId, country.capitalBodyName, simDays, tier)
}

export function applyShipCommand(shipId: string, command: ShipCommand, simDays: number): void {
  const ship = useShipStore.getState().ships.find((s) => s.id === shipId)
  if (!ship) return
  switch (command.kind) {
    case 'survey': {
      // Being in the system is not needed: the job flies the ship to each body.
      if (resolveShipClass(ship.classId)?.role !== 'science') return
      const starId = command.starId ?? (command.bodyName ? bodyStarId(command.bodyName) : systemOfShip(ship))
      if (!starId) return
      const owners = useTerritoryStore.getState().bodyOwner
      const bodies = surveyJobBodies(useSurveyStore.getState().discovered[ship.ownerId], ship.ownerId, starId, owners, command.bodyName)
      if (bodies.length === 0) return
      useShipStore.getState().setSurveyJob(shipId, { starId, bodies, workingSinceSimDays: null })
      const withJob = useShipStore.getState().ships.find((s) => s.id === shipId)
      if (withJob) advanceSurveyJob(withJob, simDays)
      return
    }
    case 'load': {
      const capacity = resolveShipClass(ship.classId)?.cargoCapacity ?? 0
      if (capacity <= 0) return
      const owners = useTerritoryStore.getState().bodyOwner
      if (!loadingBody(ship, owners).ok) return
      const stock = useResourceStore.getState().stateFor(ship.ownerId).amounts
      const taken = clampToSpace(command.want, stock, cargoSpace(capacity, ship.cargo))
      if (Object.keys(taken).length === 0) return
      spendCost(ship.ownerId, taken)
      useShipStore.getState().setShipCargo(shipId, cargoPlus(ship.cargo, taken))
      return
    }
    case 'unload': {
      if (!loadingBody(ship, useTerritoryStore.getState().bodyOwner).ok) return
      const hold = ship.cargo ?? {}
      const put = command.want ? clampToSpace(command.want, hold, Infinity) : (Object.fromEntries(Object.entries(hold).filter(([, n]) => (n ?? 0) > 0)) as ResourceCost)
      if (Object.keys(put).length === 0) return
      for (const [id, n] of Object.entries(put) as [ResourceId, number][]) useResourceStore.getState().addAmount(ship.ownerId, id, n)
      useShipStore.getState().setShipCargo(shipId, cargoMinus(hold, put))
      return
    }
    case 'transfer': {
      const to = useShipStore.getState().ships.find((s) => s.id === command.toShipId)
      if (!to || !transferCheck(ship, to).ok) return
      const capacity = resolveShipClass(to.classId)?.cargoCapacity ?? 0
      if (capacity <= 0) return
      const moved = clampToSpace(command.want, ship.cargo ?? {}, cargoSpace(capacity, to.cargo))
      if (Object.keys(moved).length === 0) return
      useShipStore.getState().setShipCargo(shipId, cargoMinus(ship.cargo, moved))
      useShipStore.getState().setShipCargo(to.id, cargoPlus(to.cargo, moved))
      return
    }
    case 'build-starbase': {
      const star = restingStarId(ship)
      if (!star) return
      useStarbaseStore.getState().build(ship.ownerId, star, simDays, shipId)
      return
    }
    case 'colonize':
      startFounding(shipId, command.bodyName, simDays)
      return
    case 'upgrade':
      useShipyardStore.getState().queueUpgrade(ship.ownerId, shipId, simDays)
      return
    case 'repair':
      useShipyardStore.getState().queueRepair(ship.ownerId, shipId, simDays)
      return
    case 'attack': {
      // Chase it and fight where they meet (scene/aggression.ts).
      const target = useShipStore.getState().ships.find((s) => s.id === command.targetShipId)
      if (!target || target.ownerId === ship.ownerId || !isArmed(ship)) return
      useShipStore.getState().setAttackTarget(shipId, target.id)
      return
    }
  }
}

export function queueShipCommand(shipId: string, command: ShipCommand): void {
  const store = useShipStore.getState()
  const ship = store.ships.find((s) => s.id === shipId)
  if (!ship) return
  const simDays = useGameTimeStore.getState().simDays
  const delay = ownerCommsDelayToShip(ship, simDays)
  if (commsInstantContact(delay)) {
    applyShipCommand(shipId, command, simDays)
    return
  }
  store.setPendingCommands(shipId, [...(ship.pendingCommands ?? []), { command, arrivesSimDays: simDays + delay, sentSimDays: simDays }])
}

// Fires every command whose signal has arrived, in order.
export function resolvePendingCommands(simDays: number): void {
  const { ships, setPendingCommands } = useShipStore.getState()
  for (const ship of ships) {
    const pending = ship.pendingCommands
    if (!pending || pending.length === 0) continue
    const due = pending.filter((p) => simDays >= p.arrivesSimDays)
    if (due.length === 0) continue
    setPendingCommands(ship.id, pending.filter((p) => simDays < p.arrivesSimDays))
    for (const p of due) applyShipCommand(ship.id, p.command, simDays)
  }
}

// The role a command belongs to, and so which of the player's selected ships a
// star's right-click menu hands it to.
export function commandRole(command: ShipCommand): 'science' | 'construction' | 'colony' | null {
  if (command.kind === 'survey') return 'science'
  if (command.kind === 'build-starbase') return 'construction'
  if (command.kind === 'colonize') return 'colony'
  return null
}

// "Survey" from a right-click menu: every selected Science Ship surveys the
// system (or one body of it), flying to each body in turn.
// The survey job flies the ship itself, so a jump to another star is asked about here
// (scene/jumpConfirm.confirmRiskyJump: one question for every selected Science Ship, as
// for any other order; a ship already in the system does not jump and is not asked).
export function orderSelectedToSurvey(starId: string, bodyName?: string): void {
  const store = useShipStore.getState()
  const science = store.ships.filter((s) => store.selectedShipIds.includes(s.id) && isPlayerOwned(s) && resolveShipClass(s.classId)?.role === 'science')
  if (science.length === 0) return
  const destination: MoveDestination = bodyName ? { kind: 'body', systemId: starId, bodyName } : { kind: 'star', starId }
  confirmRiskyJump(science, destination, () => {
    for (const s of science) queueShipCommand(s.id, { kind: 'survey', starId, bodyName })
  })
}

// A star's right-click menu action: every selected ship of the right kind does
// `command` at `starId` — right away if it is already resting there, else it
// flies there (each selected fleet moving as one, as any right-click order
// does) and does it on arrival (ShipInstance.arrivalCommand).
export function orderSelectedToDoAt(starId: string, command: ShipCommand): void {
  const role = commandRole(command)
  if (!role) return
  const store = useShipStore.getState()
  const selected = store.ships.filter((s) => store.selectedShipIds.includes(s.id) && isPlayerOwned(s))
  const actors = selected.filter((s) => resolveShipClass(s.classId)?.role === role)
  for (const s of actors) {
    if (restingStarId(s) === starId) queueShipCommand(s.id, command)
    // Set BEFORE the move goes out: a comms-delayed order lands later, and an
    // order to this same star leaves the arrival command alone.
    else store.setArrivalCommand(s.id, { starId, command })
  }
  // Declining a risky jump takes the arrival commands back.
  const dropArrival = () => {
    for (const s of actors) if (useShipStore.getState().ships.find((x) => x.id === s.id)?.arrivalCommand?.starId === starId) useShipStore.getState().setArrivalCommand(s.id, null)
  }
  if (selected.some((s) => restingStarId(s) !== starId)) orderSelectedFleets({ kind: 'star', starId }, undefined, dropArrival)
  // A jump that landed the ship at once never "arrives" — do it now.
  const after = useShipStore.getState()
  for (const s of actors) {
    const ship = after.ships.find((x) => x.id === s.id)
    if (ship?.arrivalCommand && restingStarId(ship) === starId) {
      after.setArrivalCommand(ship.id, null)
      queueShipCommand(ship.id, command)
    }
  }
}
