// Diplomacy: declaring war, truces, war score, exhaustion, peace acceptance
// and what signing a peace actually does (see src/state/diplomacyStore.ts,
// src/scene/warScore.ts, src/scene/peace.ts).
//
// Run:  npx tsx tests/diplomacy.test.ts

import { pairKey, TRUCE_DAYS, BATTLE_SCORE_MAX, BODY_VALUE_CAPITAL, BODY_VALUE_WORLD, BODY_VALUE_OUTPOST } from '../src/data/diplomacyData'
import { atWar, relationIn, useDiplomacyStore } from '../src/state/diplomacyStore'
import { useTerritoryStore } from '../src/state/territoryStore'
import { useArmyStore } from '../src/state/armyStore'
import { useEconomyStore, worldByName } from '../src/state/economyStore'
import { seedBodyOwners, isOccupied } from '../src/scene/territory'
import { battleScore, cessionCost, evaluatePeace, occupiedShare, scoreFor, warExhaustion, warScore } from '../src/scene/warScore'
import { declareWarOn, liveBodyValue, makePeace, proposePeace, recordLoss } from '../src/scene/peace'

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
  useTerritoryStore.getState().reset()
  useArmyStore.getState().reset()
}
const war = (a: string, b: string) => useDiplomacyStore.getState().wars.find((w) => (w.attackerId === a && w.defenderId === b) || (w.attackerId === b && w.defenderId === a))!

console.log('\n=== 1. Declaring war, and truces ===')
{
  fresh()
  check('pair keys are order-independent', pairKey(MARS, VENUS) === pairKey(VENUS, MARS))
  check('nations start at peace', !atWar(MARS, VENUS))
  const r = declareWarOn(MARS, VENUS, 100)
  check('Mars declares war on Venus', r.ok && atWar(MARS, VENUS) && atWar(VENUS, MARS))
  check('...which is logged', useDiplomacyStore.getState().events.some((e) => e.kind === 'war-declared' && e.countryIds[0] === MARS))
  check("...and doesn't drag in Orion", !atWar(MARS, ORION) && !atWar(VENUS, ORION))
  check("can't declare twice", !declareWarOn(MARS, VENUS, 101).ok)
  check("can't declare on yourself", !declareWarOn(MARS, MARS, 101).ok)
  check('opinion falls', relationIn(useDiplomacyStore.getState().relations, MARS, VENUS).opinion < 0)

  makePeace(war(MARS, VENUS).id, { kind: 'white' }, MARS, 200)
  check('white peace ends the war', !atWar(MARS, VENUS) && useDiplomacyStore.getState().wars.length === 0)
  check('...and starts a truce', !declareWarOn(VENUS, MARS, 200 + TRUCE_DAYS - 1).ok)
  check('...that expires', declareWarOn(VENUS, MARS, 200 + TRUCE_DAYS).ok)
}

console.log('\n=== 2. Body values ===')
{
  check('a capital is worth the most', liveBodyValue('Venus') === BODY_VALUE_CAPITAL && liveBodyValue('Mars') === BODY_VALUE_CAPITAL)
  check('an inhabited world next', liveBodyValue('Luna') === BODY_VALUE_WORLD, `${liveBodyValue('Luna')}`)
  check('a bare rock least', liveBodyValue('Phobos') === BODY_VALUE_OUTPOST)
}

console.log('\n=== 3. War score from occupation and battles ===')
{
  fresh()
  declareWarOn(MARS, VENUS, 0)
  const w = war(MARS, VENUS)
  const owners = seedBodyOwners()
  check('an even war scores 0', warScore(w, owners, {}, liveBodyValue) === 0)

  // Venus owns only Venus: occupying it is 100% of its territory.
  check("occupying Venus's only world is its whole territory", occupiedShare(VENUS, MARS, owners, { Venus: MARS }, liveBodyValue) === 100)
  check('...so Mars (the attacker) scores +100', warScore(w, owners, { Venus: MARS }, liveBodyValue) === 100)
  check('...which Venus reads as -100', scoreFor(w, VENUS, owners, { Venus: MARS }, liveBodyValue) === -100)

  const phobosShare = occupiedShare(MARS, VENUS, owners, { Phobos: VENUS }, liveBodyValue)
  const marsTotal = BODY_VALUE_CAPITAL + BODY_VALUE_WORLD + 2 * BODY_VALUE_OUTPOST
  check("Venus taking Phobos is a small share of Mars", Math.abs(phobosShare - (100 * BODY_VALUE_OUTPOST) / marsTotal) < 1e-9, `${phobosShare.toFixed(1)}%`)
  check("...and pulls Mars's score negative", warScore(w, owners, { Phobos: VENUS }, liveBodyValue) < 0)

  const withBattles = { ...w, battleBalance: 3440 }
  const b = battleScore(withBattles)
  check('sinking a whole starting navy is worth a chunk of score', b > 20 && b < BATTLE_SCORE_MAX, b.toFixed(1))
  check('battles alone can never win a war outright', battleScore({ ...w, battleBalance: 1e9 }) <= BATTLE_SCORE_MAX)
}

console.log('\n=== 4. Exhaustion ===')
{
  fresh()
  declareWarOn(MARS, VENUS, 0)
  const w = war(MARS, VENUS)
  check('starts at zero', warExhaustion(w, MARS, 0) === 0)
  check('grows with time', warExhaustion(w, MARS, 365.25) > 15)
  recordLoss(MARS, [VENUS, ORION], 1600)
  const after = war(MARS, VENUS)
  check('losses add exhaustion to the side that lost them', warExhaustion(after, MARS, 0) > 0 && warExhaustion(after, VENUS, 0) === 0)
  check("...and swing battle balance to the other side (Mars attacked, so negative)", after.battleBalance === -1600)
  check("a loss to a nation you're not at war with charges nothing", (() => {
    recordLoss(ORION, [MARS], 500)
    return useDiplomacyStore.getState().wars.length === 1 && war(MARS, VENUS).battleBalance === -1600
  })())
  check('capped at 100', warExhaustion(w, MARS, 365.25 * 50) === 100)
}

console.log('\n=== 5. Peace acceptance ===')
{
  fresh()
  declareWarOn(MARS, VENUS, 0)
  const w = war(MARS, VENUS)
  const owners = seedBodyOwners()
  const venusHeld = { Venus: MARS }

  check('an even war: white peace is accepted', evaluatePeace(w, MARS, { kind: 'white' }, owners, {}, liveBodyValue, 10).accept)
  check('a side that is winning big refuses white peace', !evaluatePeace(w, VENUS, { kind: 'white' }, owners, venusHeld, liveBodyValue, 10).accept)
  // Venus is ahead but worn out; Mars offers white peace.
  const exhaustedWinner = { ...w, exhaustion: { ...w.exhaustion, [VENUS]: 80 * 70 } }
  const phobosHeld = { Phobos: VENUS, Deimos: VENUS, Luna: VENUS }
  const marsScoreDown = scoreFor(exhaustedWinner, VENUS, owners, phobosHeld, liveBodyValue)
  check('a fresh side that is ahead refuses white peace', !evaluatePeace(w, MARS, { kind: 'white' }, owners, phobosHeld, liveBodyValue, 10).accept, `Venus score ${marsScoreDown.toFixed(0)}`)
  check("...but an exhausted one takes it unless winning overwhelmingly", evaluatePeace(exhaustedWinner, MARS, { kind: 'white' }, owners, phobosHeld, liveBodyValue, 10).accept)

  check('Mars can demand Venus when it holds it', evaluatePeace(w, MARS, { kind: 'cede', bodies: ['Venus'] }, owners, venusHeld, liveBodyValue, 10).accept)
  const notHeld = evaluatePeace(w, MARS, { kind: 'cede', bodies: ['Venus'] }, owners, {}, liveBodyValue, 10)
  check("...but can't demand what it doesn't occupy", !notHeld.accept, notHeld.reason)
  check('cession cost is the share of territory demanded', cessionCost(['Phobos'], MARS, owners, liveBodyValue) > 0 && cessionCost(['Venus'], VENUS, owners, liveBodyValue) === 100)

  // Venus holds Phobos only — ~7% of Mars — so it can demand Phobos but not
  // more than its score covers.
  const phobos = { Phobos: VENUS }
  check('Venus can take Phobos with a matching score', evaluatePeace(w, VENUS, { kind: 'cede', bodies: ['Phobos'] }, owners, phobos, liveBodyValue, 10).accept)
  const losingBattles = { ...w, battleBalance: 2000 } // Mars won the battles
  const refused = evaluatePeace(losingBattles, VENUS, { kind: 'cede', bodies: ['Phobos'] }, owners, phobos, liveBodyValue, 10)
  check("...but not if Mars's battle wins outweigh it", !refused.accept, refused.reason)
}

console.log('\n=== 6. Signing a peace: cessions, returns, and armies going home ===')
{
  fresh()
  declareWarOn(MARS, VENUS, 0)
  const territory = useTerritoryStore.getState()
  territory.occupyBody('Venus', MARS)
  territory.occupyBody('Phobos', VENUS)
  const add = useArmyStore.getState().addArmy
  const onVenus = add({ ownerId: MARS, kind: 'assault', strength: 60, maxStrength: 100, location: { kind: 'body', bodyName: 'Venus' } })
  const onPhobos = add({ ownerId: VENUS, kind: 'assault', strength: 80, maxStrength: 100, location: { kind: 'body', bodyName: 'Phobos' } })

  const partial = proposePeace(war(MARS, VENUS).id, MARS, { kind: 'cede', bodies: ['Venus'] }, 50)
  check("taking ALL of Venus needs a full 100 — holding it while losing Phobos isn't enough", !partial.accept, partial.reason)
  recordLoss(VENUS, [MARS], 2000) // Mars wins the space war too
  const verdict = proposePeace(war(MARS, VENUS).id, MARS, { kind: 'cede', bodies: ['Venus'] }, 50)
  check('Mars, holding Venus and winning in space, has its demand accepted', verdict.accept, verdict.reason)
  const t = useTerritoryStore.getState()
  check('Venus now belongs to Mars', t.bodyOwner['Venus'] === MARS && !isOccupied('Venus', t.bodyOwner, t.bodyController))
  check("...and so does its economy", worldByName(useEconomyStore.getState().worlds, 'Venus')?.ownerId === MARS)
  check('Phobos, not part of the deal, goes back to Mars', t.bodyOwner['Phobos'] === MARS && !isOccupied('Phobos', t.bodyOwner, t.bodyController))
  const armies = useArmyStore.getState().armies
  const venusArmy = armies.find((a) => a.id === onPhobos)
  check("Mars's occupation army stays on its new world", armies.find((a) => a.id === onVenus)?.location.kind === 'body' && (armies.find((a) => a.id === onVenus)!.location as { bodyName: string }).bodyName === 'Venus')
  check("Venus's army on Phobos has nowhere of its own to go (its capital is gone) — it disbands", !venusArmy)
  check('the war is over, with a truce', !atWar(MARS, VENUS) && !declareWarOn(VENUS, MARS, 60).ok)
  check('the log records the cession and the peace', ['body-ceded', 'peace-signed'].every((k) => useDiplomacyStore.getState().events.some((e) => e.kind === k)))
}

console.log('\n=== 7. A refused peace changes nothing ===')
{
  fresh()
  declareWarOn(MARS, VENUS, 0)
  useTerritoryStore.getState().occupyBody('Venus', MARS)
  const verdict = proposePeace(war(MARS, VENUS).id, VENUS, { kind: 'white' }, 10)
  check('Mars, winning, refuses white peace', !verdict.accept, verdict.reason)
  check('...the war goes on', atWar(MARS, VENUS))
  check('...and the refusal is logged', useDiplomacyStore.getState().events.some((e) => e.kind === 'peace-rejected'))

  // A white peace returns every occupation and sends armies home.
  const home = useArmyStore.getState().addArmy({ ownerId: MARS, kind: 'assault', strength: 50, maxStrength: 100, location: { kind: 'body', bodyName: 'Venus' } })
  makePeace(war(MARS, VENUS).id, { kind: 'white' }, MARS, 20)
  const t = useTerritoryStore.getState()
  check('white peace hands Venus back', !isOccupied('Venus', t.bodyOwner, t.bodyController) && t.bodyOwner['Venus'] === VENUS)
  const army = useArmyStore.getState().armies.find((a) => a.id === home)
  check("...and Mars's army there goes home to Mars", army?.location.kind === 'body' && (army.location as { bodyName: string }).bodyName === 'Mars')
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`)
process.exit(failures === 0 ? 0 : 1)
