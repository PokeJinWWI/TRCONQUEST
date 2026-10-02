// Observer mode's pure view helpers (src/scene/observerView.ts) and its store: a
// view override that shows every empire and lane and never writes game state.
//
// Run:  npx tsx tests/observer.test.ts
import { galaxyEmpires } from '../src/data/generatedEmpires'
import { generatedStarsFor } from '../src/data/galaxyGen'
import { STARS, getStarsForNeighborhood } from '../src/data/starData'
import { ownerInfoOf } from '../src/data/ownerInfo'
import { empireClaimsByStar, empireClusterClaims, empireMarkers, laneSegments } from '../src/scene/observerView'
import { useObserverStore } from '../src/state/observerStore'
import { useHyperlaneStore } from '../src/state/hyperlaneStore'
import { useTerritoryStore } from '../src/state/territoryStore'
import { useSurveyStore } from '../src/state/surveyStore'
import { useDiplomacyStore } from '../src/state/diplomacyStore'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const empires = galaxyEmpires()
const e = empires[0]
const stars = getStarsForNeighborhood(e.clusterId)

console.log('\n=== Observer mode ===')
check('off by default', useObserverStore.getState().on === false)
const claims = empireClaimsByStar(stars)
check('every system an empire owns is claimed by it', e.ownedStarIds.every((id) => { const c = claims.get(id); return c?.kind === 'owned' && c.countryId === e.id }))
check('no other system is claimed', claims.size === stars.filter((s) => empires.some((x) => x.ownedStarIds.includes(s.id))).length)
check('our own neighbourhood has no empire claims', empireClaimsByStar(STARS).size === 0)
const clusters = empireClusterClaims()
check('a claim per neighbourhood with an empire (two empires: contested)', clusters.size === new Set(empires.map((x) => x.clusterId)).size && [...clusters.values()].every((c) => c.kind !== 'unclaimed'))
check('owner info finds nations and empires', ownerInfoOf('orion-republic')?.name === 'Orion Republic' && ownerInfoOf(e.id)?.color === e.color && ownerInfoOf('nobody') === undefined)
const m = empireMarkers(stars)
check('one marker per owned star, one buffer', m.positions.length === claims.size * 3 && m.colors.length === m.positions.length)

useHyperlaneStore.setState({ lanes: [] })
const a = STARS[0].id
const b = STARS[1].id
useHyperlaneStore.getState().addHyperlane(a, b)
const seg = laneSegments(useHyperlaneStore.getState().lanes, STARS)
check('lanes become one segment buffer (2 points each)', seg.length === 6)
check('a lane outside the neighbourhood shown draws nothing', laneSegments(useHyperlaneStore.getState().lanes, generatedStarsFor(e.clusterId)).length === 0)

// A view override: nothing it reads is written.
const before = JSON.stringify([useHyperlaneStore.getState().lanes, useTerritoryStore.getState().bodyOwner, useSurveyStore.getState().known, useDiplomacyStore.getState().relations])
useObserverStore.getState().setOn(true)
empireClaimsByStar(stars)
empireClusterClaims()
empireMarkers(stars)
laneSegments(useHyperlaneStore.getState().lanes, STARS)
check('turning it on and drawing writes no game state or knowledge', before === JSON.stringify([useHyperlaneStore.getState().lanes, useTerritoryStore.getState().bodyOwner, useSurveyStore.getState().known, useDiplomacyStore.getState().relations]))
useObserverStore.getState().setOn(false)
check('off again', useObserverStore.getState().on === false)

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
