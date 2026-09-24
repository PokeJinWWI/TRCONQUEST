// The only part of the strategic AI that changes the world: carries out one
// empire's intents through the same store actions and rules the player's UI
// uses. Anything a rule refuses (unaffordable, orbit not clear, …) is simply
// dropped — the agents will reassess next pass.
import { ownerDisplay } from '../data/countryRoster'
import type { PeaceTerms } from '../data/diplomacyData'
import { useDiplomacyStore } from '../state/diplomacyStore'
import { useShipyardStore } from '../state/shipyardStore'
import { useArmyStore } from '../state/armyStore'
import { useShipStore } from '../state/shipStore'
import { useConfirmStore } from '../state/confirmStore'
import { useGameTimeStore } from '../state/gameTimeStore'
import { applyFleetMove, fleetMembersOf } from '../scene/commsVisual'
import { planMoveUnchecked } from '../scene/shipPhysics'
import { declareWarOn, makePeace, proposePeace } from '../scene/peace'
import type { Intent } from './types'

function nameOf(id: string): string {
  return ownerDisplay(id).name
}

function describeTerms(terms: PeaceTerms, fromId: string): string {
  return terms.kind === 'white'
    ? 'White peace: every occupied world returns to its owner.'
    : `You cede ${terms.bodies.join(', ')} to ${nameOf(fromId)}.`
}

// An AI empire offering the player peace: the player decides, through the
// usual confirmation dialog. Skipped if another decision is already on screen
// (the Diplomat will offer again after its cooldown).
function offerPeaceToPlayer(fromId: string, warId: string, terms: PeaceTerms, simDays: number): void {
  const confirm = useConfirmStore.getState()
  if (confirm.pending) return
  const diplomacy = useDiplomacyStore.getState()
  diplomacy.pushEvent('peace-offered', [fromId], `${nameOf(fromId)} offers peace`, simDays)
  confirm.requestConfirm({
    title: `Peace offer from ${nameOf(fromId)}`,
    body: 'Decline to fight on.',
    effects: [describeTerms(terms, fromId), 'Every other occupation between you ends, and a two-year truce begins.'],
    confirmLabel: 'Accept peace',
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
      case 'adjust-opinion':
        useDiplomacyStore.getState().adjustOpinion(countryId, intent.otherId, intent.delta)
        break
      case 'build-ship':
        useShipyardStore.getState().queueBuild(countryId, intent.classId, simDays)
        break
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
        const destination = { kind: 'body' as const, systemId: intent.systemId, bodyName: intent.bodyName }
        applyFleetMove(fleetMembersOf(ship, ships), destination, simDays, planMoveUnchecked)
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
    }
  }
}
