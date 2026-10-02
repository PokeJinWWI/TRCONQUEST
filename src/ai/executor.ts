// The only part of the strategic AI that changes the world: carries out one
// empire's intents through the same store actions and rules the player's UI
// uses — including the signal delay: orders to ships go out from the capital at
// the empire's own comms tier (scene/commsVisual.ownerCommsDelayToShip), so an
// empire without Hyper Comms waits on its distant fleets like the player does.
// Anything a rule refuses (unaffordable, orbit not clear, …) is simply
// dropped — the agents will reassess next pass.
import { ownerDisplay } from '../data/countryRoster'
import type { PeaceTerms } from '../data/diplomacyData'
import { AI_PLAYER_OFFER_COOLDOWN_DAYS, AI_PLAYER_OFFER_MAX_COOLDOWN_DAYS, AI_PLAYER_OFFER_MIN_GAP_DAYS } from '../data/aiData'
import { useDiplomacyStore } from '../state/diplomacyStore'
import { useShipyardStore } from '../state/shipyardStore'
import { useTechStore } from '../state/techStore'
import { queueShipCommand } from '../scene/shipCommands'
import type { MoveDestination } from '../state/shipStore'
import { useArmyStore } from '../state/armyStore'
import { useShipStore } from '../state/shipStore'
import { useConfirmStore } from '../state/confirmStore'
import { useGameTimeStore } from '../state/gameTimeStore'
import { fleetMembersOf, queueBombard, queueFleetMoveOrder, queuePatrol } from '../scene/commsVisual'
import { declareWarOn, makePeace, proposePeace } from '../scene/peace'
import { sendAttackOrder } from '../scene/aggressionOrders'
import { useAiStore } from './aiStore'
import type { Intent } from './types'

function nameOf(id: string): string {
  return ownerDisplay(id).name
}

function describeTerms(terms: PeaceTerms, fromId: string): string {
  if (terms.kind === 'white') return 'White peace: every occupied world returns to its owner.'
  if (terms.kind === 'cede') return `You cede ${terms.bodies.join(', ')} to ${nameOf(fromId)}.`
  if (terms.kind === 'reparations') return `You pay ${nameOf(fromId)} ${Math.round(terms.share * 100)}% of your stockpile in reparations.`
  return `Terms with ${nameOf(fromId)}.`
}

// Whether the player may be offered peace in this war right now: not soon
// after any earlier offer, and less and less often the more they've declined.
// Pure, so it can be tested without the stores.
export function mayOfferPeaceToPlayer(
  simDays: number,
  record: { lastOfferSimDays: number; declines: number } | undefined,
  lastAnyOfferSimDays: number | null,
): boolean {
  if (lastAnyOfferSimDays !== null && simDays - lastAnyOfferSimDays < AI_PLAYER_OFFER_MIN_GAP_DAYS) return false
  if (!record) return true
  const cooldown = Math.min(AI_PLAYER_OFFER_MAX_COOLDOWN_DAYS, AI_PLAYER_OFFER_COOLDOWN_DAYS * 2 ** record.declines)
  return simDays - record.lastOfferSimDays >= cooldown
}

// An AI empire offering the player peace: the player decides, through the
// usual confirmation dialog, and the game holds still until they do. Skipped
// if another decision is already on screen or the throttle says it's too soon
// (see mayOfferPeaceToPlayer) — the Diplomat will offer again later.
function offerPeaceToPlayer(fromId: string, warId: string, terms: PeaceTerms, simDays: number): void {
  const confirm = useConfirmStore.getState()
  if (confirm.pending) return
  const ai = useAiStore.getState()
  if (!mayOfferPeaceToPlayer(simDays, ai.playerOffers[warId], ai.lastPlayerOfferSimDays)) return
  ai.recordPlayerOffer(warId, simDays)
  const diplomacy = useDiplomacyStore.getState()
  diplomacy.pushEvent('peace-offered', [fromId], `${nameOf(fromId)} offers peace`, simDays)
  confirm.requestConfirm({
    title: `Peace offer from ${nameOf(fromId)}`,
    body: 'Decline to fight on.',
    effects: [describeTerms(terms, fromId), 'Every other occupation between you ends, and a two-year truce begins.'],
    confirmLabel: 'Accept peace',
    pausesGame: true,
    onCancel: () => useAiStore.getState().recordPlayerDecline(warId),
    onConfirm: () => {
      if (useDiplomacyStore.getState().wars.some((w) => w.id === warId)) {
        makePeace(warId, terms, fromId, useGameTimeStore.getState().simDays)
      }
    },
  })
}

export function executeIntents(countryId: string, intents: Intent[], simDays: number, playerCountryId: string | null): void {
  // Fleet reorganisation first, so moves below carry the right ships: a
  // move order moves the ship's whole fleet.
  const ordered = [
    ...intents.filter((i) => i.kind === 'split-fleet' || i.kind === 'merge-fleets'),
    ...intents.filter((i) => i.kind !== 'split-fleet' && i.kind !== 'merge-fleets'),
  ]
  const movedFleets = new Set<string>()
  for (const intent of ordered) {
    switch (intent.kind) {
      case 'declare-war':
        declareWarOn(countryId, intent.targetId, simDays)
        break
      case 'propose-peace': {
        const war = useDiplomacyStore.getState().wars.find((w) => w.id === intent.warId)
        if (!war) break
        const other = war.attackerId === countryId ? war.defenderId : war.attackerId
        if (other === playerCountryId) offerPeaceToPlayer(countryId, intent.warId, intent.terms, simDays)
        else proposePeace(intent.warId, countryId, intent.terms, simDays)
        break
      }
      case 'attack-ship': {
        // Its own ships only; the order waits on its comms like any other.
        const ships = useShipStore.getState().ships
        const own = intent.shipIds.filter((id) => ships.find((s) => s.id === id)?.ownerId === countryId)
        if (own.length > 0) sendAttackOrder(own, intent.targetShipId)
        break
      }
      case 'adjust-opinion':
        useDiplomacyStore.getState().adjustOpinion(countryId, intent.otherId, intent.delta)
        break
      case 'build-ship':
        useShipyardStore.getState().queueBuild(countryId, intent.classId, simDays)
        break
      case 'build-starbase': {
        // The ship builds where it rests, paid from its hold.
        const ship = useShipStore.getState().ships.find((s) => s.id === intent.shipId)
        if (ship?.ownerId === countryId) queueShipCommand(ship.id, { kind: 'build-starbase' })
        break
      }
      case 'research-tech':
        useTechStore.getState().researchNode(countryId, intent.techId)
        break
      case 'survey-system': {
        const ship = useShipStore.getState().ships.find((s) => s.id === intent.shipId)
        if (ship?.ownerId === countryId) queueShipCommand(ship.id, { kind: 'survey' })
        break
      }
      case 'load-cargo': {
        const ship = useShipStore.getState().ships.find((s) => s.id === intent.shipId)
        if (ship?.ownerId === countryId) queueShipCommand(ship.id, { kind: 'load', want: intent.want })
        break
      }
      case 'transfer-cargo': {
        const ship = useShipStore.getState().ships.find((s) => s.id === intent.fromShipId)
        if (ship?.ownerId === countryId) queueShipCommand(ship.id, { kind: 'transfer', toShipId: intent.toShipId, want: intent.want })
        break
      }
      case 'recruit-army':
        useArmyStore.getState().recruitArmy(countryId, intent.bodyName, 'assault', simDays)
        break
      case 'move-ship': {
        const { ships } = useShipStore.getState()
        const ship = ships.find((s) => s.id === intent.shipId)
        if (!ship || ship.ownerId !== countryId) break
        // The whole fleet goes, together; once per fleet per pass.
        if (movedFleets.has(ship.fleetId)) break
        movedFleets.add(ship.fleetId)
        const destination: MoveDestination = intent.bodyName ? { kind: 'body', systemId: intent.systemId, bodyName: intent.bodyName } : { kind: 'star', starId: intent.systemId }
        // The order goes out as a signal from the capital (queueFleetMoveOrder):
        // instant at Hyper Comms or when the fleet is at home, else it lands
        // after the delay to wherever the fleet is.
        queueFleetMoveOrder(fleetMembersOf(ship, ships), destination)
        break
      }
      case 'split-fleet': {
        const { ships, splitFleet } = useShipStore.getState()
        const own = intent.shipIds.filter((id) => ships.find((s) => s.id === id)?.ownerId === countryId)
        if (own.length > 0) splitFleet(own)
        break
      }
      case 'merge-fleets': {
        const { ships, mergeFleets } = useShipStore.getState()
        const owns = (fleetId: string) => ships.some((s) => s.fleetId === fleetId && s.ownerId === countryId)
        if (owns(intent.intoFleetId) && owns(intent.fromFleetId)) mergeFleets(intent.intoFleetId, intent.fromFleetId)
        break
      }
      case 'embark':
        useArmyStore.getState().embark(intent.armyIds, intent.shipId)
        break
      case 'land':
        useArmyStore.getState().land(intent.shipId, intent.dropNode)
        break
      case 'set-bombard': {
        const ship = useShipStore.getState().ships.find((s) => s.id === intent.shipId)
        if (ship?.ownerId === countryId) queueBombard(ship, intent.stance)
        break
      }
      case 'set-patrol': {
        const ship = useShipStore.getState().ships.find((s) => s.id === intent.shipId)
        if (ship?.ownerId === countryId) queuePatrol(ship, intent.on)
        break
      }
      case 'colonize-body': {
        // Founds it where it orbits, else flies there and founds it on arrival
        // (the same arrival command the player's Colonize order sets).
        const ships = useShipStore.getState().ships
        const ship = ships.find((s) => s.id === intent.shipId)
        if (ship?.ownerId !== countryId) break
        const command = { kind: 'colonize' as const, bodyName: intent.bodyName }
        if (ship.location.kind === 'orbiting' && ship.location.bodyName === intent.bodyName) {
          queueShipCommand(ship.id, command)
          break
        }
        useShipStore.getState().setArrivalCommand(ship.id, { starId: intent.systemId, bodyName: intent.bodyName, command })
        queueFleetMoveOrder(fleetMembersOf(ship, ships), { kind: 'body', systemId: intent.systemId, bodyName: intent.bodyName })
        break
      }
    }
  }
}
