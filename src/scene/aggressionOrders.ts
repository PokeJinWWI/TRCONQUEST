// Store side of scene/aggression.ts: giving the attack order (with its warning
// when the target is not an enemy), recording the incident when the fight
// opens, and applying the consequences when the news arrives.
import { useShipStore, type ShipInstance } from '../state/shipStore'
import { useGameTimeStore } from '../state/gameTimeStore'
import { useDiplomacyStore, atWar, relationIn } from '../state/diplomacyStore'
import { useTerritoryStore } from '../state/territoryStore'
import { useStarbaseStore } from '../state/starbaseStore'
import { useTechStore } from '../state/techStore'
import { useTreatyStore, isAllyOf, treatiesBetween } from '../state/treatyStore'
import { useConfirmStore } from '../state/confirmStore'
import { combatPlaceOf } from '../state/combatStore'
import { isPlayerOwned, playerCountryId } from '../state/shipRelations'
import { commsTierFor } from '../data/commsData'
import { ownerDisplay } from '../data/countryRoster'
import { OPINION_ON_WAR_DECLARED, SKIRMISH_LAPSE_DAYS } from '../data/diplomacyData'
import { describeArticle } from '../data/treatyData'
import type { Engagement } from '../state/combatStore'
import type { NationContext } from './combatResolution'
import { isArmed } from './armyLogic'
import { fleetMembersOf } from './commsVisual'
import { queueShipCommand } from './shipCommands'
import { declareWarOn } from './peace'
import { cancelTreaty } from './treaties'
import {
  attackPrompt,
  dueIncidents,
  hostileAtFn,
  localAggressions,
  newsDelayDays,
  unrecordedAggressions,
  type AttackPrompt,
  type LocalAggression,
} from './aggression'

function nameOf(countryId: string): string {
  return ownerDisplay(countryId).name
}

// Sends the attack order to these ships and their fleets: a signal from their
// owner's capital like any other command (queueShipCommand), for the player
// and the AI alike. Unarmed hulls are left out.
export function sendAttackOrder(shipIds: string[], targetShipId: string): void {
  const ships = useShipStore.getState().ships
  const sent = new Set<string>()
  for (const id of shipIds) {
    const ship = ships.find((s) => s.id === id)
    if (!ship) continue
    for (const member of fleetMembersOf(ship, ships)) {
      if (sent.has(member.id) || member.id === targetShipId || !isArmed(member)) continue
      sent.add(member.id)
      queueShipCommand(member.id, { kind: 'attack', targetShipId })
    }
  }
}

function selectedOwnShips(): ShipInstance[] {
  const store = useShipStore.getState()
  return store.ships.filter((s) => store.selectedShipIds.includes(s.id) && isPlayerOwned(s))
}

// Whether the player's selection can attack this ship, and why not.
export function attackCheck(targetShipId: string): { ok: true } | { ok: false; reason: string } {
  const target = useShipStore.getState().ships.find((s) => s.id === targetShipId)
  if (!target) return { ok: false, reason: 'That ship is gone' }
  if (isPlayerOwned(target)) return { ok: false, reason: 'That is your own ship' }
  const ships = useShipStore.getState().ships
  if (!selectedOwnShips().some((s) => fleetMembersOf(s, ships).some(isArmed))) return { ok: false, reason: 'None of the selected ships is armed' }
  return { ok: true }
}

function signalTimeText(days: number): string {
  if (days < 1 / 24) return 'almost at once'
  if (days < 1) return `in about ${Math.max(1, Math.round(days * 24))} hours`
  return `in about ${Math.round(days)} days`
}

// The victim's news delay from where `target` is now, or null if it holds no
// territory. Only an estimate for a target under way: the news starts from
// wherever the fight opens.
function newsDelayFrom(target: ShipInstance, simDays: number): number | null {
  const tier = commsTierFor(useTechStore.getState().stateFor(target.ownerId).researched)
  return newsDelayDays(target.location, target.ownerId, useTerritoryStore.getState().bodyOwner, useStarbaseStore.getState().starbases, tier, simDays)
}

// The player's Attack: at once against an enemy, behind a plain warning of the
// consequences against anyone else. Returns what kind of attack it was.
export function orderSelectedToAttack(targetShipId: string): AttackPrompt | null {
  const viewer = playerCountryId()
  const target = useShipStore.getState().ships.find((s) => s.id === targetShipId)
  if (!viewer || !target || !attackCheck(targetShipId).ok) return null
  const prompt = attackPrompt(viewer, target.ownerId, atWar, isAllyOf)
  if (prompt === 'own') return prompt
  const send = () => sendAttackOrder(selectedOwnShips().map((s) => s.id), targetShipId)
  if (prompt === 'hostile') {
    send()
    return prompt
  }
  const simDays = useGameTimeStore.getState().simDays
  const nation = nameOf(target.ownerId)
  const delay = newsDelayFrom(target, simDays)
  const treaties = treatiesBetween(useTreatyStore.getState().treaties, viewer, target.ownerId)
  const effects = [
    `Your ships chase ${target.name} and open fire when they meet. Every ship of yours and of ${nation} in that place joins the fight.`,
    delay === null
      ? `${nation} holds no territory, so the news has nowhere to arrive: nothing follows beyond this fight.`
      : `The news reaches ${nation}'s nearest world or Starbase ${signalTimeText(delay)} (signal time from where ${target.name} is now). From then all of ${nation}'s ships are hostile to you: a skirmish, which lapses after ${SKIRMISH_LAPSE_DAYS} days without fighting or ends by peace.`,
    ...(delay === null ? [] : [`Their opinion of you drops by ${Math.abs(OPINION_ON_WAR_DECLARED)}.`]),
    ...(delay !== null && treaties.length > 0
      ? [`Your treaties with them are broken: ${treaties.map((t) => t.articles.map((a) => describeArticle(a, viewer, nameOf)).join(', ')).join('; ')}.`]
      : []),
    ...(delay !== null && simDays < relationIn(useDiplomacyStore.getState().relations, viewer, target.ownerId).truceUntilSimDays
      ? ['The truce between you ends.']
      : []),
  ]
  useConfirmStore.getState().requestConfirm({
    title: prompt === 'allied' ? `Attack your ally ${nation}?` : `Attack ${nation}?`,
    body: `${target.name} belongs to ${nation}, and you are not at war with them.`,
    effects,
    confirmLabel: 'Open fire',
    onConfirm: send,
  })
  return prompt
}

// What resolveSpaceCombat hands syncEngagements so an unprovoked attack is a
// fight where it happens. Null when nobody is attacking anybody (the usual
// case): hostility is then plain diplomacy.
export function aggressionContext(ships: ShipInstance[], engagements: Engagement[]): { context: NationContext; aggressions: LocalAggression[] } | null {
  const incidents = useDiplomacyStore.getState().incidents
  if (incidents.length === 0 && !ships.some((s) => s.attackTargetShipId)) return null
  const aggressions = localAggressions(ships, atWar)
  if (incidents.length === 0 && aggressions.length === 0) return null
  const openKeys = new Set(engagements.map((e) => e.locationKey))
  return { context: { hostileAt: hostileAtFn(atWar, aggressions, incidents, openKeys) }, aggressions }
}

// Puts each attack that just opened a fight on record, with the day its news
// reaches the victim; and forgets incidents nobody will ever hear of once their
// fight is over.
export function recordIncidents(aggressions: LocalAggression[], engagements: Engagement[], simDays: number): void {
  const diplomacy = useDiplomacyStore.getState()
  const openKeys = new Set(engagements.map((e) => e.locationKey))
  for (const a of unrecordedAggressions(aggressions, diplomacy.incidents)) {
    if (!openKeys.has(a.locationKey)) continue
    const tier = commsTierFor(useTechStore.getState().stateFor(a.victimId).researched)
    const delay = newsDelayDays(a.location, a.victimId, useTerritoryStore.getState().bodyOwner, useStarbaseStore.getState().starbases, tier, simDays)
    diplomacy.addIncident({
      aggressorId: a.aggressorId,
      victimId: a.victimId,
      locationKey: a.locationKey,
      place: combatPlaceOf(a.locationKey) ?? {},
      startedSimDays: simDays,
      newsArrivesSimDays: delay === null ? null : simDays + delay,
    })
  }
  for (const i of useDiplomacyStore.getState().incidents) {
    if (i.newsArrivesSimDays === null && !openKeys.has(i.locationKey)) diplomacy.removeIncident(i.id)
  }
}

// The consequences, once the news is in: the aggressor's treaties with the
// victim are broken, and the two are in a skirmish (the aggressor's war, truce
// or not), which makes every ship of each hostile to the other and costs the
// usual opinion. Exported so headless tests drive it.
export function resolveAggressionNews(simDays: number): void {
  const diplomacy = useDiplomacyStore.getState()
  if (diplomacy.incidents.length === 0) return
  for (const incident of dueIncidents(diplomacy.incidents, simDays)) {
    diplomacy.removeIncident(incident.id)
    const { aggressorId, victimId } = incident
    const where = incident.place.bodyName ?? ''
    diplomacy.pushEvent(
      'ship-attacked',
      [aggressorId, victimId],
      `${nameOf(aggressorId)} attacked ${nameOf(victimId)}'s ships${where ? ` at ${where}` : ''} without a declaration of war`,
      simDays,
      incident.place,
    )
    if (atWar(aggressorId, victimId)) continue
    for (const treaty of treatiesBetween(useTreatyStore.getState().treaties, aggressorId, victimId)) cancelTreaty(treaty.id, aggressorId, simDays)
    declareWarOn(aggressorId, victimId, simDays, 'skirmish', { ignoreTruce: true })
  }
}
