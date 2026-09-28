// Treaties: the everyday Victoria-3-style agreements (embassy, non-aggression
// pact, trade agreement, alliance, guarantee of independence, treaty port) —
// distinct from a war's peace terms and from a full international
// organization. A treaty bundles any number of articles at once, in either
// direction, and acceptance weighs the whole bundle together. See
// src/scene/treaties.ts, src/state/treatyStore.ts, src/data/treatyData.ts.
//
// Run:  npx tsx tests/treaties.test.ts

import { useDiplomacyStore, relationIn } from '../src/state/diplomacyStore'
import { useTreatyStore, treatiesOf, isNonAggression, isGuarantorOf, isAllyOf, hasTradeAgreement, treatyPortOperatorOf } from '../src/state/treatyStore'
import { isBinding, type Treaty } from '../src/data/treatyData'
import { inSharedMarket } from '../src/state/tradePolicyStore'
import { useTerritoryStore } from '../src/state/territoryStore'
import { spaceportSitesOf } from '../src/state/nationEconomy'
import { usePlayerStore } from '../src/state/playerStore'
import { declareWarOn } from '../src/scene/peace'
import {
  bundleCostForReceiver,
  cancelTreaty,
  proposeAlliance,
  proposeEmbassy,
  proposeGuaranteeIndependence,
  proposeNonAggressionPact,
  proposeTradeAgreement,
  proposeTreaty,
  proposeTreatyPort,
} from '../src/scene/treaties'
import { useSubjectStore } from '../src/state/subjectStore'
import { useShipStore, pristineCombatState } from '../src/state/shipStore'
import { SHIP_CLASSES } from '../src/data/shipData'
import { useInternationalOrgStore } from '../src/state/internationalOrgStore'
import { hasInvestmentRights, hasMilitaryAccess } from '../src/state/treatyStore'

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

function fresh() {
  useDiplomacyStore.getState().reset()
  useTreatyStore.getState().reset()
}

function isBindingCheck(t: Treaty, simDays: number): boolean {
  return isBinding(t, simDays)
}

function relationBetween(a: string, b: string): number {
  return relationIn(useDiplomacyStore.getState().relations, a, b).opinion
}

function makeShip(id: string, ownerId: string) {
  const cls = SHIP_CLASSES.find((c) => c.id === 'corvette')!
  return {
    id,
    classId: 'corvette',
    name: `Corvette ${id}`,
    ownerId,
    location: { kind: 'orbiting' as const, systemId: 'sol', bodyName: 'Earth', periodDays: 20, phaseDeg: 0, inclinationDeg: 0 },
    order: null,
    hyperdriveReadySimDays: 0,
    warpReadySimDays: 0,
    warpEnabled: true,
    warpWhenReady: false,
    chaffAutoDeploy: true,
    pendingHyperdriveJump: null,
    followingShipId: null,
    combat: pristineCombatState(cls.combat),
    stance: 'balanced' as const,
    fleetId: `solo-${id}`,
  }
}

console.log('\n=== 1. A single article behaves like it used to ===')
{
  check('an embassy alone is a trivial ask', bundleCostForReceiver([{ kind: 'embassy' }], VENUS) < -40)
  check('an alliance alone needs real warmth', bundleCostForReceiver([{ kind: 'alliance' }], VENUS) === 40)
}

console.log('\n=== 2. Proposing an embassy (low bar, always-ish accepted) ===')
{
  fresh()
  const r = proposeEmbassy(MARS, VENUS, 0)
  check('an embassy is signed', r.ok)
  check('it shows up for both sides', treatiesOf(useTreatyStore.getState().treaties, MARS).length === 1 && treatiesOf(useTreatyStore.getState().treaties, VENUS).length === 1)
  check('signing one nudges opinion up', useDiplomacyStore.getState().relations[Object.keys(useDiplomacyStore.getState().relations)[0]].opinion > 0)
}

console.log('\n=== 3. Non-aggression pact blocks war ===')
{
  fresh()
  check('nobody starts with an NAP', !isNonAggression(MARS, VENUS))
  const r = proposeNonAggressionPact(MARS, VENUS, 0)
  check('an NAP is signed between two nations with neutral opinion', r.ok, r.ok ? '' : r.reason)
  check('isNonAggression sees it', isNonAggression(MARS, VENUS) && isNonAggression(VENUS, MARS))
  const war = declareWarOn(MARS, VENUS, 10)
  check("...and it blocks a war declaration", !war.ok, war.reason)
  check("...but doesn't affect an unrelated pair", declareWarOn(MARS, ORION, 10).ok)

  cancelTreaty(r.ok ? r.treatyId : '', MARS, 20)
  check('cancelling it removes the NAP', !isNonAggression(MARS, VENUS))
  check('breaking it costs opinion with the other side', useDiplomacyStore.getState().relations[Object.keys(useDiplomacyStore.getState().relations)[0]].opinion < 0)
  check('war is possible again once the NAP is gone', declareWarOn(MARS, VENUS, 20).ok)
}

console.log('\n=== 4. Guarantee of independence blocks the GUARANTOR specifically ===')
{
  fresh()
  const r = proposeGuaranteeIndependence(MARS, ORION, 0)
  check('Mars guarantees Orion', r.ok, r.ok ? '' : r.reason)
  check('isGuarantorOf sees it, direction matters', isGuarantorOf(MARS, ORION) && !isGuarantorOf(ORION, MARS))
  const marsAttacksOrion = declareWarOn(MARS, ORION, 10)
  check("Mars can't attack who it guarantees", !marsAttacksOrion.ok, marsAttacksOrion.reason)
  check('but Orion attacking Mars is unaffected by the guarantee', declareWarOn(ORION, MARS, 10).ok)
  fresh()
  proposeGuaranteeIndependence(MARS, ORION, 0)
  check('a THIRD nation can still attack the guaranteed one (no auto-block)', declareWarOn(VENUS, ORION, 10).ok)
}

console.log('\n=== 5. Alliance and trade agreement ===')
{
  fresh()
  const r = proposeAlliance(MARS, VENUS, 0)
  check('a fresh, neutral-opinion pair refuses an alliance (bar is high)', !r.ok, r.ok ? '' : r.reason)
  useDiplomacyStore.getState().adjustOpinion(MARS, VENUS, 60)
  const r2 = proposeAlliance(MARS, VENUS, 0)
  check('...but accepts once opinion is warm enough', r2.ok)
  check('isAllyOf sees it', isAllyOf(MARS, VENUS))

  fresh()
  check('no shared market before any agreement', !inSharedMarket(MARS, VENUS))
  const trade = proposeTradeAgreement(MARS, VENUS, 0)
  check('a trade agreement needs only neutral-or-better opinion', trade.ok)
  check('hasTradeAgreement sees it', hasTradeAgreement(MARS, VENUS))
  check('...and it puts them in a shared (tariff-free) market', inSharedMarket(MARS, VENUS))
  check('an unrelated pair is unaffected', !inSharedMarket(MARS, ORION))
}

console.log('\n=== 6. Treaty ports ===')
{
  usePlayerStore.setState({ economyModel: 'complex' })
  fresh()
  useTerritoryStore.getState().reset()
  const before = spaceportSitesOf('Mars')
  check('Mars has at least one spaceport site to cede in the fixture', before.length > 0)
  check("nobody starts operating another nation's port", !treatyPortOperatorOf('Mars'))

  const wrongOwner = proposeTreatyPort(VENUS, 'Mars', ORION, 0)
  check("can't cede a world you don't own", !wrongOwner.ok, wrongOwner.reason)

  const r = proposeTreatyPort(MARS, 'Mars', VENUS, 0)
  check('Mars cedes a treaty port on its own capital to Venus', r.ok, r.ok ? '' : r.reason)
  check('treatyPortOperatorOf now reports Venus', treatyPortOperatorOf('Mars') === VENUS)
  const after = spaceportSitesOf('Mars')
  check("the first site's operator shows Venus, flagged as a treaty port", after[0]?.operator === VENUS && after[0]?.operatorName.includes('treaty port'))

  const again = proposeTreatyPort(MARS, 'Mars', ORION, 10)
  check("can't cede the same port twice", !again.ok, again.reason)

  cancelTreaty(r.ok ? r.treatyId : '', MARS, 20)
  check('cancelling it hands operation back to the state', !treatyPortOperatorOf('Mars'))
}

console.log('\n=== 7. Bundling several articles into one treaty, either direction ===')
{
  usePlayerStore.setState({ economyModel: 'complex' })
  fresh()
  useTerritoryStore.getState().reset()

  // A lone guarantee (Mars protects Venus) is cheap for Venus to accept —
  // but demanding Venus ALSO cede a port on top makes the whole bundle a
  // much harder ask, even though the guarantee article alone was easy.
  const guaranteeOnly = proposeTreaty(MARS, VENUS, [{ kind: 'guarantee-independence', guarantorId: MARS, guaranteedId: VENUS }], 10, 0)
  check('a lone guarantee is an easy accept', guaranteeOnly.ok)
  cancelTreaty(guaranteeOnly.ok ? guaranteeOnly.treatyId : '', MARS, 0)

  const guaranteePlusPort = proposeTreaty(
    MARS,
    VENUS,
    [
      { kind: 'guarantee-independence', guarantorId: MARS, guaranteedId: VENUS },
      { kind: 'treaty-port', sourceId: VENUS, targetId: MARS, bodyName: 'Venus' },
    ],
    10,
    0,
  )
  check('bundling in a demand for Venus to cede its own port makes the same guarantee too much to ask', !guaranteePlusPort.ok, guaranteePlusPort.ok ? '' : guaranteePlusPort.reason)

  // The same bundle works once Mars ALSO offers something Venus values (a
  // treaty port of Mars's own, given to Venus) — sweetening it back down.
  const sweetened = proposeTreaty(
    MARS,
    VENUS,
    [
      { kind: 'guarantee-independence', guarantorId: MARS, guaranteedId: VENUS },
      { kind: 'treaty-port', sourceId: VENUS, targetId: MARS, bodyName: 'Venus' },
      { kind: 'treaty-port', sourceId: MARS, targetId: VENUS, bodyName: 'Mars' },
    ],
    25,
    0,
    'Grand Bargain',
  )
  check('a sweetener in the same bundle can offset the demand', sweetened.ok, sweetened.ok ? '' : sweetened.reason)
  if (sweetened.ok) {
    const t = useTreatyStore.getState().treaties.find((x) => x.id === sweetened.treatyId)
    check('the signed treaty carries all three articles together', t?.articles.length === 3)
    check('a custom name is kept', t?.name === 'Grand Bargain')
    check('the chosen duration is kept', t?.durationYears === 25)
    check('Mars now operates a port on Venus AND Venus operates one on Mars — genuinely two-way', treatyPortOperatorOf('Venus') === MARS && treatyPortOperatorOf('Mars') === VENUS)
    check('the guarantee from the SAME treaty is also in effect', isGuarantorOf(MARS, VENUS))
  }

  const invalid = proposeTreaty(MARS, VENUS, [{ kind: 'guarantee-independence', guarantorId: MARS, guaranteedId: ORION }], 10, 10)
  check('an article naming a third party outside the treaty is refused', !invalid.ok, invalid.reason)
}

console.log('\n=== 8. Multiple separate treaties, naming, and duration/binding ===')
{
  fresh()
  const t1 = proposeTreaty(MARS, VENUS, [{ kind: 'embassy' }], 5, 0)
  const t2 = proposeTreaty(MARS, VENUS, [{ kind: 'non-aggression-pact' }], 10, 5, 'The Sol Accord')
  check('two separate treaties can coexist between the same pair', t1.ok && t2.ok && treatiesOf(useTreatyStore.getState().treaties, MARS).length === 2)
  check('an unnamed treaty gets a sensible default name', useTreatyStore.getState().treaties.find((t) => t.id === (t1.ok ? t1.treatyId : ''))?.name === 'Embassy')
  check('a named treaty keeps its custom name', useTreatyStore.getState().treaties.find((t) => t.id === (t2.ok ? t2.treatyId : ''))?.name === 'The Sol Accord')

  const treaty = useTreatyStore.getState().treaties.find((t) => t.id === (t1.ok ? t1.treatyId : ''))!
  check('a fresh treaty is still binding', isBindingCheck(treaty, 100))
  check('cancelling while binding costs opinion', (() => {
    const before = relationBetween(MARS, VENUS)
    cancelTreaty(treaty.id, MARS, 100)
    return relationBetween(MARS, VENUS) < before
  })())

  const t3 = proposeTreaty(MARS, ORION, [{ kind: 'embassy' }], 5, 0)
  const treaty3 = useTreatyStore.getState().treaties.find((t) => t.id === (t3.ok ? t3.treatyId : ''))!
  check('once its term is up, it is no longer binding', !isBindingCheck(treaty3, 5 * 365 + 1))
  check('withdrawing after the term is free', (() => {
    const before = relationBetween(MARS, ORION)
    cancelTreaty(treaty3.id, MARS, 5 * 365 + 1)
    return relationBetween(MARS, ORION) === before
  })())
}

console.log('\n=== 9. Defensive pact, investment rights, and military access ===')
{
  fresh()
  useDiplomacyStore.getState().adjustOpinion(MARS, VENUS, 25)
  const pact = proposeTreaty(MARS, VENUS, [{ kind: 'defensive-pact' }], 10, 0)
  check('a defensive pact needs less warmth than a full alliance', pact.ok)
  check('isAllyOf recognizes a defensive pact too', isAllyOf(MARS, VENUS))

  fresh()
  check('nobody starts with investment rights', !hasInvestmentRights(MARS, VENUS))
  const invest = proposeTreaty(MARS, VENUS, [{ kind: 'investment-rights', sourceId: MARS, targetId: VENUS }], 10, 0)
  check('Mars grants Venus investment rights', invest.ok, invest.ok ? '' : invest.reason)
  check('hasInvestmentRights sees it, direction matters', hasInvestmentRights(MARS, VENUS) && !hasInvestmentRights(VENUS, MARS))

  fresh()
  check('nobody starts with military access', !hasMilitaryAccess(MARS, VENUS))
  const access = proposeTreaty(MARS, VENUS, [{ kind: 'military-access', sourceId: MARS, targetId: VENUS }], 10, 0)
  check('Mars grants Venus military access', access.ok, access.ok ? '' : access.reason)
  check('hasMilitaryAccess sees it, direction matters', hasMilitaryAccess(MARS, VENUS) && !hasMilitaryAccess(VENUS, MARS))
}

console.log('\n=== 10. One-time articles: transfer subject, ship transfer, join organization ===')
{
  fresh()
  useSubjectStore.getState().reset()
  useShipStore.setState({ ships: [] })
  useInternationalOrgStore.getState().reset()

  useSubjectStore.getState().establishSubject(MARS, 'kingdom-of-luna', 'vassal', 0)
  const transfer = proposeTreaty(MARS, VENUS, [{ kind: 'transfer-subject', subjectId: 'kingdom-of-luna', fromSuzerainId: MARS, toSuzerainId: VENUS }], 5, 0)
  check('Mars transfers a subject to Venus', transfer.ok, transfer.ok ? '' : transfer.reason)
  check('the subject is now Venus\'s, instantly', useSubjectStore.getState().subjections.find((s) => s.subjectId === 'kingdom-of-luna')?.suzerainId === VENUS)
  const noSuchSubject = proposeTreaty(MARS, ORION, [{ kind: 'transfer-subject', subjectId: 'kingdom-of-luna', fromSuzerainId: MARS, toSuzerainId: ORION }], 5, 10)
  check("can't transfer a subject you no longer hold", !noSuchSubject.ok, noSuchSubject.reason)

  fresh()
  useShipStore.setState({ ships: [] })
  useShipStore.getState().spawnShip(makeShip('s1', MARS))
  const shipDeal = proposeTreaty(MARS, VENUS, [{ kind: 'ship-transfer', shipId: 's1', fromId: MARS, toId: VENUS }], 5, 0)
  check('Mars hands a ship to Venus', shipDeal.ok, shipDeal.ok ? '' : shipDeal.reason)
  check('the ship changes owner instantly', useShipStore.getState().ships.find((s) => s.id === 's1')?.ownerId === VENUS)
  const noSuchShip = proposeTreaty(MARS, ORION, [{ kind: 'ship-transfer', shipId: 's1', fromId: MARS, toId: ORION }], 5, 10)
  check("can't hand over a ship you no longer own", !noSuchShip.ok, noSuchShip.reason)

  fresh()
  useInternationalOrgStore.getState().reset()
  const orgId = useInternationalOrgStore.getState().founded(MARS, 'common-market', 'The Common Market', 0)
  const joinDeal = proposeTreaty(VENUS, MARS, [{ kind: 'join-power-bloc', orgId, leaderId: MARS, joiningId: VENUS }], 5, 0)
  check('Venus joins the org Mars leads, as one treaty article', joinDeal.ok, joinDeal.ok ? '' : joinDeal.reason)
  check('membership takes effect instantly', useInternationalOrgStore.getState().orgs.find((o) => o.id === orgId)?.memberIds.includes(VENUS))
  const wrongLeader = proposeTreaty(VENUS, ORION, [{ kind: 'join-power-bloc', orgId, leaderId: ORION, joiningId: VENUS }], 5, 10)
  check("can't join an org through someone who doesn't lead it", !wrongLeader.ok, wrongLeader.reason)
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`)
process.exit(failures === 0 ? 0 : 1)
