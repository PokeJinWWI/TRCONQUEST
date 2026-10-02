// Attacking a ship of a nation you are not at war with (src/scene/aggression.ts,
// src/scene/aggressionOrders.ts): the warning by allegiance, the local fight,
// the consequences once the news reaches the victim, and the AI's first strike.
//
// Run:  npx tsx tests/aggression.test.ts

import { COUNTRIES } from '../src/data/countryData'
import { FRIENDLY_ROGUE_ID } from '../src/data/countryRoster'
import { AI_WAR_GRACE_DAYS } from '../src/data/aiData'
import { OPINION_ON_WAR_DECLARED, TRUCE_DAYS, pairKey } from '../src/data/diplomacyData'
import { commsTierFor } from '../src/data/commsData'
import { usePlayerStore } from '../src/state/playerStore'
import { useShipStore, type ShipInstance, type ShipLocation } from '../src/state/shipStore'
import { useArmyStore } from '../src/state/armyStore'
import { useTerritoryStore } from '../src/state/territoryStore'
import { useDiplomacyStore, atWar, relationIn } from '../src/state/diplomacyStore'
import { useResourceStore } from '../src/state/resourceStore'
import { useShipyardStore } from '../src/state/shipyardStore'
import { useTechStore } from '../src/state/techStore'
import { useStarbaseStore } from '../src/state/starbaseStore'
import { useTreatyStore } from '../src/state/treatyStore'
import { useCombatStore } from '../src/state/combatStore'
import { useConfirmStore } from '../src/state/confirmStore'
import { useGameTimeStore } from '../src/state/gameTimeStore'
import { useAiStore } from '../src/ai/aiStore'
import { seedStrategicResources, spawnOwnedShip } from '../src/scene/shipyardLogic'
import { setUpNewGame } from '../src/scene/gameSetup'
import { declareWarOn } from '../src/scene/peace'
import { syncEngagements } from '../src/scene/combatResolution'
import { commsDelayToLocation } from '../src/scene/commsVisual'
import { attackPrompt, attackTargetOf, hostileAtFn, isNewsSuppressed, localAggressions, newsDelayDays } from '../src/scene/aggression'
import { attackCheck, orderSelectedToAttack, resolveAggressionNews, sendAttackOrder } from '../src/scene/aggressionOrders'
import { resolveSpaceCombat } from '../src/hooks/useCombatResolver'
import { resolveCommsSignals } from '../src/hooks/useCommsResolver'
import { buildBlackboard, shipPower } from '../src/ai/blackboard'
import { captureSnapshot } from '../src/ai/snapshot'
import { strategist, strikeUnderWay, surpriseStrike } from '../src/ai/strategist'
import { executeIntents } from '../src/ai/executor'
import type { Intent } from '../src/ai/types'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const MARS = 'imperial-state-of-mars'
const VENUS = 'republic-of-venus'
const ORION = 'orion-republic'
const LALANDE = 'kingdom-of-lalande'
const FAR: ShipLocation = { kind: 'star', starId: 'alpha-centauri', offset: [0, 0, 0] }
const FAR_KEY = 'star:alpha-centauri'

function freshWorld(player: string) {
  useShipStore.setState({ ships: [], selectedShipId: null, selectedShipIds: [] })
  useArmyStore.getState().reset()
  useTerritoryStore.getState().reset()
  useDiplomacyStore.getState().reset()
  useAiStore.getState().reset()
  useCombatStore.setState({ engagements: [] })
  useConfirmStore.setState({ pending: null })
  useTreatyStore.setState({ treaties: [] })
  useShipyardStore.setState({ ordersByCountry: {} })
  useResourceStore.setState({ byCountry: {} })
  useTechStore.setState({ byCountry: {} })
  useStarbaseStore.setState({ starbases: [] })
  useGameTimeStore.setState({ simDays: 0 })
  usePlayerStore.setState({ selectedCountryId: player })
  setUpNewGame()
  for (const c of COUNTRIES) seedStrategicResources(c.id)
}

const shipOf = (id: string) => useShipStore.getState().ships.find((s) => s.id === id)!
const capitalOf = (owner: string) => COUNTRIES.find((c) => c.id === owner)!
function spawnAt(owner: string, classId: string, location?: ShipLocation): string {
  const c = capitalOf(owner)
  const id = spawnOwnedShip(classId, owner, c.capitalStarId, c.capitalBodyName)!
  if (location) useShipStore.setState((s) => ({ ships: s.ships.map((x) => (x.id === id ? { ...x, location } : x)) }))
  return id
}
function select(ids: string[]) {
  useShipStore.setState({ selectedShipIds: ids, selectedShipId: ids[0] ?? null })
}
const setClock = (d: number) => useGameTimeStore.setState({ simDays: d })
const opinion = (a: string, b: string) => relationIn(useDiplomacyStore.getState().relations, a, b).opinion
const fightAt = (key: string) => useCombatStore.getState().engagements.find((e) => e.locationKey === key)
const has = (intents: Intent[], kind: Intent['kind']) => intents.some((i) => i.kind === kind)

console.log('\n=== 1. The warning goes by allegiance ===')
{
  const war = (a: string, b: string) => pairKey(a, b) === pairKey(MARS, ORION)
  const ally = (a: string, b: string) => pairKey(a, b) === pairKey(MARS, LALANDE)
  check('an enemy: no warning', attackPrompt(MARS, ORION, war, ally) === 'hostile')
  check('an ally: warned', attackPrompt(MARS, LALANDE, war, ally) === 'allied')
  check('the friendly irregulars count as allied', attackPrompt(MARS, FRIENDLY_ROGUE_ID, war, ally) === 'allied')
  check('anyone else: warned as neutral', attackPrompt(MARS, VENUS, war, ally) === 'neutral')
  check('never your own', attackPrompt(MARS, MARS, war, ally) === 'own')

  freshWorld(MARS)
  const mine = spawnAt(MARS, 'cruiser', FAR)
  const mine2 = spawnAt(MARS, 'cruiser', FAR)
  const transport = useShipStore.getState().ships.find((s) => s.ownerId === MARS && shipPower(s) === 0)!
  const theirs = spawnAt(VENUS, 'cruiser', FAR)
  select([mine])
  const own = attackCheck(mine2)
  check('attacking your own ship is refused with the reason', !own.ok && own.reason === 'That is your own ship')
  check('...and gives no order', orderSelectedToAttack(mine2) === null && !useConfirmStore.getState().pending)
  check('a neutral ship can be attacked', attackCheck(theirs).ok)
  select([transport.id])
  // The transport's fleet is the starting navy, which is armed; alone it is not.
  useShipStore.setState((s) => ({ ships: s.ships.map((x) => (x.id === transport.id ? { ...x, fleetId: 'lone-transport' } : x)) }))
  const unarmed = attackCheck(theirs)
  check('unarmed ships cannot attack, with the reason', !unarmed.ok && unarmed.reason === 'None of the selected ships is armed')
}

console.log('\n=== 2. A hostile target: attacked at once, no prompt ===')
{
  freshWorld(MARS)
  declareWarOn(MARS, ORION, 0)
  const mine = spawnAt(MARS, 'cruiser', FAR)
  const theirs = useShipStore.getState().ships.find((s) => s.ownerId === ORION)!
  setClock(10)
  select([mine])
  check('the order is an act of war', orderSelectedToAttack(theirs.id) === 'hostile')
  check('...with no confirmation asked', useConfirmStore.getState().pending === null)
  check('...sent as a signal from the capital (comms delay)', (shipOf(mine).pendingCommands ?? []).some((p) => p.command.kind === 'attack' && p.arrivesSimDays > 10))
}

console.log('\n=== 3. The fight is local ===')
{
  freshWorld(MARS)
  const a = spawnAt(MARS, 'cruiser', FAR)
  const v = spawnAt(VENUS, 'cruiser', FAR)
  const ships = () => useShipStore.getState().ships
  check('neutrals resting together do not fight', syncEngagements(ships(), [], 0).length === 0)
  useShipStore.getState().setAttackTarget(a, v)
  check('the attack rides on the follow', attackTargetOf(shipOf(a)) === v)
  const aggressions = localAggressions(ships(), atWar)
  check('contact is one unprovoked attack', aggressions.length === 1 && aggressions[0].aggressorId === MARS && aggressions[0].victimId === VENUS && aggressions[0].locationKey === FAR_KEY)
  const synced = syncEngagements(ships(), [], 0, undefined, { hostileAt: hostileAtFn(atWar, aggressions, [], new Set()) })
  check('it opens a fight there', synced.length === 1 && synced[0].locationKey === FAR_KEY)
  const sides = synced[0].participants
  check('...both sides hostile to each other', sides.length === 2 && sides.every((p) => p.hostileSides.length === 1))
  check('...and nowhere else (the navies at home stay at peace)', synced.every((e) => e.locationKey === FAR_KEY) && !atWar(MARS, VENUS))
  useShipStore.getState().setFollowing(a, v)
  check('a plain Move (follow) cancels the attack', attackTargetOf(shipOf(a)) === null && localAggressions(ships(), atWar).length === 0)
}

console.log('\n=== 4. The news travels, then the consequences ===')
{
  freshWorld(MARS)
  const mine = spawnAt(MARS, 'cruiser', FAR)
  const theirs = spawnAt(VENUS, 'cruiser', FAR)
  // A pact and a truce: the attack breaks both.
  useTreatyStore.getState().sign(MARS, VENUS, 'Pact', [{ kind: 'non-aggression-pact' }], 10, 0)
  useDiplomacyStore.setState((s) => ({ relations: { ...s.relations, [pairKey(MARS, VENUS)]: { status: 'peace', opinion: 0, truceUntilSimDays: TRUCE_DAYS } } }))
  check('a declaration would be refused (pact)', !declareWarOn(MARS, VENUS, 100).ok)

  setClock(100)
  select([mine])
  check('a neutral target asks first', orderSelectedToAttack(theirs) === 'neutral')
  const pending = useConfirmStore.getState().pending
  check('...with the consequences spelled out', !!pending && pending.effects.some((e) => e.includes('skirmish')) && pending.effects.some((e) => e.includes('treaties')) && pending.effects.some((e) => e.includes('truce')))
  check('nothing is ordered until confirmed', (shipOf(mine).pendingCommands ?? []).length === 0)
  useConfirmStore.getState().resolve(false)
  check('declining orders nothing', (shipOf(mine).pendingCommands ?? []).length === 0)
  orderSelectedToAttack(theirs)
  useConfirmStore.getState().resolve(true)
  const signal = (shipOf(mine).pendingCommands ?? [])[0]
  check('confirming sends the order as a signal', !!signal && signal.command.kind === 'attack' && signal.arrivesSimDays > 100)

  resolveSpaceCombat(100)
  check('no fight before the order arrives', !fightAt(FAR_KEY))
  const t1 = signal.arrivesSimDays
  setClock(t1)
  resolveCommsSignals(t1)
  check('the order arrives', attackTargetOf(shipOf(mine)) === theirs)
  resolveSpaceCombat(t1)
  check('the fight opens', !!fightAt(FAR_KEY))
  const incident = useDiplomacyStore.getState().incidents[0]
  const tier = commsTierFor(useTechStore.getState().stateFor(VENUS).researched)
  const expected = commsDelayToLocation(FAR, 'sol', 'Venus', t1, tier)
  check('an incident is recorded', !!incident && incident.aggressorId === MARS && incident.victimId === VENUS)
  check("the news takes the victim's signal time to its nearest territory", !!incident && Math.abs(incident.newsArrivesSimDays! - (t1 + expected)) < 1e-6 && expected > 1, `${expected.toFixed(2)} days`)
  resolveSpaceCombat(t1)
  check('one incident per fight', useDiplomacyStore.getState().incidents.length === 1)

  const arrive = incident.newsArrivesSimDays!
  resolveCommsSignals(arrive - 0.01)
  check('before it arrives: no war', !atWar(MARS, VENUS))
  check('...opinion untouched', opinion(MARS, VENUS) === 0)
  check('...the pact still stands', useTreatyStore.getState().treaties.length === 1)
  resolveCommsSignals(arrive)
  const war = useDiplomacyStore.getState().wars[0]
  check('when it arrives: every ship of each is hostile to the other', atWar(MARS, VENUS))
  check('...as a skirmish, the aggressor its attacker, truce or not', !!war && war.tier === 'skirmish' && war.attackerId === MARS)
  check('...opinion drops by the war amount (and the broken pact)', opinion(MARS, VENUS) <= OPINION_ON_WAR_DECLARED, `${opinion(MARS, VENUS)}`)
  check('...the pact is broken', useTreatyStore.getState().treaties.length === 0 && useDiplomacyStore.getState().events.some((e) => e.kind === 'treaty-broken'))
  check('...and it is reported, with the place', useDiplomacyStore.getState().events.some((e) => e.kind === 'ship-attacked' && e.place?.starId === 'alpha-centauri'))
  check('the incident is closed', useDiplomacyStore.getState().incidents.length === 0)

  const { bodyOwner } = useTerritoryStore.getState()
  const light = newsDelayDays(FAR, VENUS, bodyOwner, [], 'light', 0)!
  const warp = newsDelayDays(FAR, VENUS, bodyOwner, [], 'warp', 0)!
  check('light-speed news is far slower than Warp Comms', light > warp * 100, `${Math.round(light)} vs ${warp.toFixed(1)} days`)
  check('Hyper Comms: at once', newsDelayDays(FAR, VENUS, bodyOwner, [], 'hyper', 0) === 0)
  const base = { id: 'sb', starId: 'alpha-centauri', ownerId: VENUS, integrity: 1, readySimDays: 0 }
  check('a Starbase in the system hears at once', newsDelayDays(FAR, VENUS, bodyOwner, [base], 'light', 10)! < 1e-6)
  check('...not one still being built', newsDelayDays(FAR, VENUS, bodyOwner, [{ ...base, readySimDays: 500 }], 'light', 10) === light)
  check('a faction with no territory never hears', newsDelayDays(FAR, 'nobody', bodyOwner, [], 'warp', 0) === null)

  // The espionage hook: sabotaged comms, the news never gets out.
  freshWorld(MARS)
  useDiplomacyStore.getState().addIncident({ aggressorId: MARS, victimId: VENUS, locationKey: FAR_KEY, place: { starId: 'alpha-centauri' }, startedSimDays: 0, newsArrivesSimDays: 1, commsSabotaged: true })
  resolveAggressionNews(1000)
  check('sabotaged comms: the news never arrives', isNewsSuppressed(useDiplomacyStore.getState().incidents[0]) && !atWar(MARS, VENUS) && opinion(MARS, VENUS) === 0)
}

console.log('\n=== 5. The AI strikes first only when its war logic says so ===')
{
  const late = AI_WAR_GRACE_DAYS + 1
  const plan = () => strategist(buildBlackboard(MARS, captureSnapshot(late)), captureSnapshot(late))
  const marsOrbit = () => useShipStore.getState().ships.find((s) => s.ownerId === MARS && s.location.kind === 'orbiting')!.location
  const setUp = (grudge: boolean) => {
    freshWorld(LALANDE)
    if (grudge) useDiplomacyStore.getState().adjustOpinion(MARS, VENUS, -60)
    for (let i = 0; i < 3; i++) spawnAt(MARS, 'cruiser')
  }

  setUp(true)
  const noContact = plan()
  check('no enemy ship within reach: it declares war as before', has(noContact.intents, 'declare-war') && !has(noContact.intents, 'attack-ship'))

  setUp(true)
  const visitor = spawnAt(VENUS, 'cruiser', marsOrbit())
  const out = plan()
  const strike = out.intents.find((i) => i.kind === 'attack-ship')
  check('a rival ship in its orbit, outgunned: a first strike instead', !!strike && strike.kind === 'attack-ship' && strike.targetShipId === visitor && !has(out.intents, 'declare-war'))
  check('...by its own idle warships there', !!strike && strike.kind === 'attack-ship' && strike.shipIds.length > 0 && strike.shipIds.every((id) => shipOf(id).ownerId === MARS))

  setUp(false)
  spawnAt(VENUS, 'cruiser', marsOrbit())
  const noGrudge = plan()
  check('no reason for war: no strike, however easy', noGrudge.intents.length === 0)

  setUp(true)
  spawnAt(VENUS, 'cruiser', marsOrbit())
  useDiplomacyStore.setState((s) => ({ relations: { ...s.relations, [pairKey(MARS, VENUS)]: { ...relationIn(s.relations, MARS, VENUS), truceUntilSimDays: late + 100 } } }))
  check('a truce: no strike', plan().intents.length === 0)

  // Outgunned where they meet: Mars's one cruiser in Venus's orbit, the Venusian navy around it.
  setUp(true)
  const venusOrbit = useShipStore.getState().ships.find((s) => s.ownerId === VENUS && s.location.kind === 'orbiting')!.location
  const scout = spawnAt(MARS, 'cruiser', venusOrbit)
  const bb = buildBlackboard(MARS, captureSnapshot(late))
  check('no local edge: no strike', surpriseStrike(bb, captureSnapshot(late), VENUS) === null, `${Math.round(bb.powerAt(MARS, 'Venus'))} vs ${Math.round(bb.powerAt(VENUS, 'Venus'))}`)
  check('...it declares war instead', has(plan().intents, 'declare-war'))
  void scout

  // Same rules as the player: the order is a signal, the fight is local, the news starts the war.
  setUp(true)
  const target = spawnAt(VENUS, 'cruiser', marsOrbit())
  setClock(late)
  executeIntents(MARS, plan().intents, late, LALANDE)
  check('the order reaches ships at the capital at once', useShipStore.getState().ships.some((s) => s.ownerId === MARS && attackTargetOf(s) === target))
  check('no war is declared', !atWar(MARS, VENUS))
  const again = plan()
  check('a strike under way is not ordered twice, nor war declared', strikeUnderWay(buildBlackboard(MARS, captureSnapshot(late)), captureSnapshot(late), VENUS) && again.intents.length === 0)
  resolveSpaceCombat(late)
  const incident = useDiplomacyStore.getState().incidents[0]
  check('the strike is an incident like the player\'s', !!incident && incident.aggressorId === MARS && incident.victimId === VENUS && incident.newsArrivesSimDays! > late)
  check('...still waiting on the news', plan().intents.length === 0 && !atWar(MARS, VENUS))
  resolveCommsSignals(incident.newsArrivesSimDays!)
  check('the news starts the war', atWar(MARS, VENUS) && useDiplomacyStore.getState().wars[0].attackerId === MARS)

  setUp(true)
  const farMars = spawnAt(MARS, 'cruiser', FAR)
  const farVenus = spawnAt(VENUS, 'cruiser', FAR)
  setClock(late)
  sendAttackOrder([farMars], farVenus)
  check("an AI's order to a distant ship waits on its comms", attackTargetOf(shipOf(farMars)) === null && (shipOf(farMars).pendingCommands ?? []).some((p) => p.command.kind === 'attack' && p.arrivesSimDays > late))
}

console.log(failures === 0 ? '\nAll aggression checks passed.' : `\n${failures} check(s) FAILED.`)
process.exit(failures === 0 ? 0 : 1)
