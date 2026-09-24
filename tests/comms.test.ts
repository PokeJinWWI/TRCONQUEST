// FTL Communications — tier/delay math, comms-delayed strategic orders, and
// the "visual" (delayed-view) reconstruction layer. See src/data/commsData.ts
// and src/scene/commsVisual.ts for what's under test, and this session's own
// plan for the "simulation vs visual" design this exists to verify.
//
// Run:  npx tsx tests/comms.test.ts

import { commsDelayDaysForDistanceKm, commsTierFor, WARP_COMMS_SPEED_C, HYPER_COMMS_TECH_ID, WARP_COMMS_TECH_ID } from '../src/data/commsData'
import {
  commsDelayToLocation,
  shipCommsDelayDays,
  playerCommsDelayToShip,
  commsInstantContact,
  visualShipSnapshot,
  visualShipRenderPosition,
  queueMoveOrder,
  applyMoveDestination,
} from '../src/scene/commsVisual'
import { STARS, starScenePosition } from '../src/data/starData'
import { COUNTRIES } from '../src/data/countryData'
import { SHIP_CLASSES } from '../src/data/shipData'
import { useShipStore, pristineCombatState, type ShipInstance, type ShipHistoryEntry } from '../src/state/shipStore'
import { useGameTimeStore } from '../src/state/gameTimeStore'
import { usePlayerStore } from '../src/state/playerStore'
import { useTechStore } from '../src/state/techStore'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const SPEED_OF_LIGHT_KM_S = 299_792.458
const SECONDS_PER_DAY = 86_400
const LY_IN_KM = SPEED_OF_LIGHT_KM_S * SECONDS_PER_DAY * 365.25

// These tests play as Mars (they set the player's nation to it where it
// matters), so a 'player' ship is a Mars ship. Anything else is taken as a
// real owner nation id.
const PLAYER_NATION = 'imperial-state-of-mars'
function makeShip(id: string, role: string, overrides: Partial<ShipInstance> = {}): ShipInstance {
  const cls = SHIP_CLASSES.find((c) => c.id === 'destroyer')!
  return {
    id,
    classId: 'destroyer',
    name: `Destroyer ${id}`,
    ownerId: role === 'player' ? PLAYER_NATION : role,
    location: { kind: 'orbiting', systemId: 'sol', bodyName: 'Earth', periodDays: 20, phaseDeg: 0, inclinationDeg: 0 },
    order: null,
    hyperdriveReadySimDays: 0,
    warpReadySimDays: 0,
    warpEnabled: true,
    warpWhenReady: false,
    chaffAutoDeploy: true,
    pendingHyperdriveJump: null,
    followingShipId: null,
    combat: pristineCombatState(cls.combat),
    stance: 'balanced',
    fleetId: `solo-${id}`,
    ...overrides,
  }
}

console.log('\n=== 1. commsDelayDaysForDistanceKm: the three tiers ===')
{
  const oneLy = LY_IN_KM
  check('zero distance is zero delay at every tier', commsDelayDaysForDistanceKm(0, 'light') === 0 && commsDelayDaysForDistanceKm(0, 'warp') === 0)
  check('hyper tier is ALWAYS zero delay, any distance', commsDelayDaysForDistanceKm(oneLy * 1000, 'hyper') === 0)
  const lightDelay = commsDelayDaysForDistanceKm(oneLy, 'light')
  check('light speed covers exactly 1 ly in exactly 1 year (365.25 days)', Math.abs(lightDelay - 365.25) < 0.01, `${lightDelay.toFixed(2)}d`)
  const warpDelay = commsDelayDaysForDistanceKm(oneLy, 'warp')
  check(
    `warp tier covers the same 1 ly in 1/${WARP_COMMS_SPEED_C}th the light-speed time`,
    Math.abs(warpDelay - lightDelay / WARP_COMMS_SPEED_C) < 0.001,
    `${warpDelay.toFixed(3)}d vs light's ${lightDelay.toFixed(1)}d`,
  )
  check('warp is meaningfully faster than light but still not zero', warpDelay > 0 && warpDelay < lightDelay)
}

console.log('\n=== 2. commsTierFor: reading a researched set ===')
{
  check('nothing researched -> light', commsTierFor(new Set()) === 'light')
  check('only Warp Comms -> warp', commsTierFor(new Set([WARP_COMMS_TECH_ID])) === 'warp')
  check('Hyper Comms researched -> hyper, regardless of what else is set', commsTierFor(new Set([WARP_COMMS_TECH_ID, HYPER_COMMS_TECH_ID])) === 'hyper')
  check('Hyper Comms alone (no Warp Comms) still -> hyper', commsTierFor(new Set([HYPER_COMMS_TECH_ID])) === 'hyper')
}

console.log('\n=== 3. commsDelayToLocation: real distance, in-system vs interstellar ===')
{
  const mars = COUNTRIES.find((c) => c.id === 'imperial-state-of-mars')!
  check('Imperial State of Mars capitals at Sol/Mars (test setup sanity)', mars.capitalStarId === 'sol' && mars.capitalBodyName === 'Mars')

  // A ship resting at the capital itself — zero distance, zero delay at
  // every tier, even light speed with no comms tech at all.
  const atCapital = commsDelayToLocation({ kind: 'orbiting', systemId: 'sol', bodyName: 'Mars', periodDays: 20, phaseDeg: 0, inclinationDeg: 0 }, 'sol', 'Mars', 0, 'light')
  check('a ship AT the capital has ~zero delay even on light speed', atCapital < 0.01, `${atCapital.toFixed(4)}d`)

  // A ship in a different system entirely (Alpha Centauri, ~4.37 ly from
  // Sol) — should land close to the real light-speed travel time for that
  // real distance, confirming the interstellar leg is actually being used.
  const alphaCentauri = STARS.find((s) => s.id === 'alpha-centauri')!
  const toAlphaCentauri = commsDelayToLocation({ kind: 'star', starId: 'alpha-centauri', offset: [0, 0, 0] }, 'sol', 'Mars', 0, 'light')
  const expectedYears = alphaCentauri.distanceLy
  check(
    `a ship at Alpha Centauri (${alphaCentauri.distanceLy} ly away) gets a real multi-year light-speed delay`,
    Math.abs(toAlphaCentauri / 365.25 - expectedYears) < 0.5,
    `${(toAlphaCentauri / 365.25).toFixed(2)}y vs real ${expectedYears}ly`,
  )
  check('...and it is dramatically less on the warp tier', commsDelayToLocation({ kind: 'star', starId: 'alpha-centauri', offset: [0, 0, 0] }, 'sol', 'Mars', 0, 'warp') < toAlphaCentauri / 100)
  check('...and exactly zero on the hyper tier, same real distance', commsDelayToLocation({ kind: 'star', starId: 'alpha-centauri', offset: [0, 0, 0] }, 'sol', 'Mars', 0, 'hyper') === 0)

  // Same-system, different body — a real but small (sub-day) delay, nowhere
  // near the interstellar figure above, since Earth/Mars orbital distances
  // are AU-scale, not light-year-scale.
  const marsToEarth = commsDelayToLocation({ kind: 'orbiting', systemId: 'sol', bodyName: 'Earth', periodDays: 20, phaseDeg: 0, inclinationDeg: 0 }, 'sol', 'Mars', 0, 'light')
  check('an in-system delay (Mars capital to Earth) is real but small — well under a day', marsToEarth > 0 && marsToEarth < 1, `${marsToEarth.toFixed(4)}d`)
  check('...and MUCH smaller than the interstellar figure above', marsToEarth < toAlphaCentauri / 1000)
}

console.log('\n=== 4. commsInstantContact ===')
{
  check('exactly zero delay is instant contact', commsInstantContact(0))
  check('any real positive delay is NOT instant contact', !commsInstantContact(0.5))
  check('a vanishingly small floating-point residue still counts as instant', commsInstantContact(1e-12))
}

console.log('\n=== 5. visualShipSnapshot: reconstructing a past state from history ===')
{
  const cls = SHIP_CLASSES.find((c) => c.id === 'destroyer')!
  const freshCombat = pristineCombatState(cls.combat)
  const damagedCombat = { ...freshCombat, shieldHp: freshCombat.shieldHp * 0.4 }
  const history: ShipHistoryEntry[] = [
    { simDays: 0, location: { kind: 'orbiting', systemId: 'sol', bodyName: 'Earth', periodDays: 20, phaseDeg: 0, inclinationDeg: 0 }, order: null, combat: freshCombat },
    { simDays: 10, location: { kind: 'orbiting', systemId: 'sol', bodyName: 'Mars', periodDays: 20, phaseDeg: 0, inclinationDeg: 0 }, order: null, combat: damagedCombat },
  ]
  const ship = makeShip('p1', 'player', { history, location: { kind: 'orbiting', systemId: 'sol', bodyName: 'Venus', periodDays: 20, phaseDeg: 0, inclinationDeg: 0 } })

  const asOf5 = visualShipSnapshot(ship, 15, 20) // simDays=20, delay=15 -> asOf=5, between the two entries
  check('looking back to a time between two entries returns the OLDER (still-valid-then) one', (asOf5.location as { bodyName?: string }).bodyName === 'Earth')

  const asOf12 = visualShipSnapshot(ship, 8, 20) // asOf=12, past the second entry
  check('looking back to a time past the newest entry returns that newest one', (asOf12.location as { bodyName?: string }).bodyName === 'Mars')
  check('...including its combat state, not the live ship.combat', asOf12.combat.shieldHp === damagedCombat.shieldHp)

  const wayBack = visualShipSnapshot(ship, 1000, 1005) // asOf way before any entry
  check('looking back further than any held history falls back to the OLDEST entry, not live truth', (wayBack.location as { bodyName?: string }).bodyName === 'Earth')

  const noHistoryShip = makeShip('p2', 'player')
  const liveSnap = visualShipSnapshot(noHistoryShip, 50, 100)
  check('a ship with no history at all falls back to its own live state', liveSnap.location === noHistoryShip.location && liveSnap.combat === noHistoryShip.combat)

  const zeroDelaySnap = visualShipSnapshot(ship, 0, 20)
  check('zero delay always returns live state, even with history present', zeroDelaySnap.location === ship.location)
}

console.log('\n=== 6. visualShipRenderPosition matches getShipRenderPosition at zero delay ===')
{
  const ship = makeShip('p1', 'player')
  const delayed = visualShipRenderPosition(ship, 0, 100)
  check('zero delay is a pure passthrough (same space/systemId)', delayed.space === 'system')
}

console.log('\n=== 7. queueMoveOrder / applyMoveDestination: comms-gated command latency ===')
{
  usePlayerStore.setState({ selectedCountryId: 'imperial-state-of-mars' })
  useGameTimeStore.setState({ simDays: 0, paused: false })
  useTechStore.setState({ byCountry: {} }) // nothing researched -> light speed tier

  // A ship out at Alpha Centauri, light-years from the Mars capital — a
  // move order issued to it should NOT apply immediately.
  const farShip = makeShip('far1', 'player', { location: { kind: 'star', starId: 'alpha-centauri', offset: [0, 0, 0] } })
  useShipStore.setState({ ships: [farShip] })
  queueMoveOrder(farShip, { kind: 'point', systemId: 'alpha-centauri', position: [1, 0, 0] })
  let stored = useShipStore.getState().ships.find((s) => s.id === 'far1')!
  check('a move order to a light-years-distant ship does NOT apply immediately', stored.order === null)
  check('...it queues as a pendingMoveOrder instead', !!stored.pendingMoveOrder)
  check('...with a real, multi-day (in fact multi-year) arrival deadline', (stored.pendingMoveOrder?.arrivesSimDays ?? 0) > 300)

  // Simulate useCommsResolver's own firing condition directly (the hook
  // itself isn't unit-testable outside React — same reasoning
  // useCombatResolver's own pure pieces are tested this way elsewhere).
  const arrivesAt = stored.pendingMoveOrder!.arrivesSimDays
  useGameTimeStore.setState({ simDays: arrivesAt - 1 })
  check(
    "a fetch one day before the deadline still hasn't fired (nothing in this test loop runs early)",
    useShipStore.getState().ships.find((s) => s.id === 'far1')!.pendingMoveOrder !== null,
  )
  useGameTimeStore.setState({ simDays: arrivesAt })
  const { setPendingMoveOrder } = useShipStore.getState()
  setPendingMoveOrder('far1', null)
  applyMoveDestination(stored, stored.pendingMoveOrder!.destination, arrivesAt)
  stored = useShipStore.getState().ships.find((s) => s.id === 'far1')!
  check('once simDays reaches the deadline and the resolver applies it, the order actually takes effect', stored.order !== null)

  // A ship right at the capital — instant contact even with no comms tech
  // researched (zero distance) — applies immediately, no queue at all.
  const homeShip = makeShip('home1', 'player', { location: { kind: 'orbiting', systemId: 'sol', bodyName: 'Mars', periodDays: 20, phaseDeg: 0, inclinationDeg: 0 } })
  useShipStore.setState({ ships: [homeShip] })
  useGameTimeStore.setState({ simDays: 0 })
  queueMoveOrder(homeShip, { kind: 'point', systemId: 'sol', position: [0.5, 0, 0] })
  const homeAfter = useShipStore.getState().ships.find((s) => s.id === 'home1')!
  check('a move order to a ship AT the capital applies immediately — no queue needed', homeAfter.order !== null && homeAfter.pendingMoveOrder == null)

  // With Hyper Comms researched, even the light-years-distant ship gets
  // instant contact.
  useTechStore.setState({ byCountry: { 'imperial-state-of-mars': { researchPoints: { physics: 0, society: 0, engineering: 0 }, researched: new Set([HYPER_COMMS_TECH_ID]) } } })
  const farShip2 = makeShip('far2', 'player', { location: { kind: 'star', starId: 'alpha-centauri', offset: [0, 0, 0] } })
  useShipStore.setState({ ships: [farShip2] })
  useGameTimeStore.setState({ simDays: 0 })
  queueMoveOrder(farShip2, { kind: 'point', systemId: 'alpha-centauri', position: [1, 0, 0] })
  const farAfter2 = useShipStore.getState().ships.find((s) => s.id === 'far2')!
  check('...Hyper Comms collapses the SAME light-years distance to instant, real order applies right away', farAfter2.order !== null && farAfter2.pendingMoveOrder == null)

  // Regression: a ship that ALREADY has a queued pendingMoveOrder (from an
  // earlier command issued under delay) and then gets a fresh order that
  // applies INSTANTLY — contact restored, or simply issued from right at
  // the capital — must have that stale queue cleared. Found live: without
  // this, useCommsResolver would later re-fire the old destination on top
  // of the ship's new, legitimate order.
  useTechStore.setState({ byCountry: {} }) // back to light speed
  const stale = makeShip('stale1', 'player', { location: { kind: 'star', starId: 'alpha-centauri', offset: [0, 0, 0] } })
  useShipStore.setState({ ships: [stale] })
  useGameTimeStore.setState({ simDays: 0 })
  queueMoveOrder(stale, { kind: 'point', systemId: 'alpha-centauri', position: [1, 0, 0] })
  check('setup: the first order queued as pending under light speed', useShipStore.getState().ships.find((s) => s.id === 'stale1')!.pendingMoveOrder !== null)
  useTechStore.setState({ byCountry: { 'imperial-state-of-mars': { researchPoints: { physics: 0, society: 0, engineering: 0 }, researched: new Set([HYPER_COMMS_TECH_ID]) } } })
  const staleShipNow = useShipStore.getState().ships.find((s) => s.id === 'stale1')!
  queueMoveOrder(staleShipNow, { kind: 'star', starId: 'sol' })
  const staleAfter = useShipStore.getState().ships.find((s) => s.id === 'stale1')!
  check('a fresh instant order clears the stale pendingMoveOrder rather than leaving it to fire later', staleAfter.pendingMoveOrder == null)
  check(
    "...and the ship's real order reflects the NEW destination, not the stale first one",
    staleAfter.order?.destination.kind === 'star' && staleAfter.order.destination.starId === 'sol',
  )

  // Clean up global store state so later sections (and any future test
  // file run in the same process) don't inherit this test's fixtures.
  useShipStore.setState({ ships: [] })
  useTechStore.setState({ byCountry: {} })
  usePlayerStore.setState({ selectedCountryId: null })
  useGameTimeStore.setState({ simDays: 0, paused: false })
}

console.log('\n=== 8. playerCommsDelayToShip: no country selected is always instant ===')
{
  usePlayerStore.setState({ selectedCountryId: null })
  const ship = makeShip('p1', 'player', { location: { kind: 'star', starId: 'alpha-centauri', offset: [0, 0, 0] } })
  const delay = playerCommsDelayToShip(ship, 0)
  check('with no country selected (e.g. main menu), delay is 0 rather than throwing', delay === 0)
}

console.log('\n=== 9. shipCommsDelayDays: a ship mid-order uses its LIVE position, not its stale .location (regression) ===')
{
  // Found live: ship.location is frozen at wherever a ship DEPARTED from
  // (setShipOrder never touches it) until the order completes — so a ship
  // reported "right next to Alpha Centauri" (per its actual, in-progress
  // order) was showing a sub-hour delay, as if still sitting at the capital,
  // and only snapped to the real multi-year figure once it physically
  // arrived and .location finally updated.
  const alphaCentauriPos = starScenePosition(STARS.find((s) => s.id === 'alpha-centauri')!)
  const ship = makeShip('mover1', 'player', {
    location: { kind: 'star', starId: 'sol', offset: [0, 0, 0] }, // stale — still says "at Sol" for the whole trip
    order: {
      destination: { kind: 'star', starId: 'alpha-centauri' },
      departSimDays: 0,
      arrivalSimDays: 10,
      space: 'interstellar',
      startPosition: [0, 0, 0],
      endPosition: alphaCentauriPos,
      usedWarp: true,
    },
  })

  const delayAtDeparture = shipCommsDelayDays(ship, 'sol', 'Mars', 0, 'light')
  check('at the moment of departure, delay is small — the ship really is still at the capital', delayAtDeparture < 1)

  const delayAtArrival = shipCommsDelayDays(ship, 'sol', 'Mars', 10, 'light')
  const alphaCentauri = STARS.find((s) => s.id === 'alpha-centauri')!
  check(
    `once the ship has actually reached Alpha Centauri per its ORDER (even though .location still claims Sol), delay reflects the real ${alphaCentauri.distanceLy}ly distance`,
    Math.abs(delayAtArrival / 365.25 - alphaCentauri.distanceLy) < 0.5,
    `${(delayAtArrival / 365.25).toFixed(2)}y`,
  )
  check("...not the near-zero figure ship.location alone would give — the bug this regression guards", delayAtArrival > delayAtDeparture * 100)

  // Same shape via the full player-facing wrapper, tech/country set up.
  usePlayerStore.setState({ selectedCountryId: 'imperial-state-of-mars' })
  useTechStore.setState({ byCountry: {} })
  const playerDelay = playerCommsDelayToShip(ship, 10)
  check('playerCommsDelayToShip agrees with the lower-level function for the same mid-order ship', Math.abs(playerDelay - delayAtArrival) < 0.01)
  usePlayerStore.setState({ selectedCountryId: null })
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`)
process.exit(failures === 0 ? 0 : 1)
