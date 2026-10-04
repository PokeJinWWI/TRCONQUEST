// Selection in the galactic view, the pure part (src/scene/galacticSelection.ts).
// Run:  npx tsx tests/galacticSelection.test.ts
import { galacticPanels, homeBadgeLeadId } from '../src/scene/galacticSelection'
import { pickInBox, type BoxCandidate } from '../src/scene/boxSelect'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

console.log('\n=== Which panels the galactic view shows ===')
{
  check('nothing selected: no panel', !galacticPanels(null, null).ship && !galacticPanels(null, null).cluster)
  check('a selected ship opens the ship panel (the bug: it never did here)', galacticPanels('s1', null).ship)
  check('...and not the cluster window', !galacticPanels('s1', null).cluster)
  check('a selected cluster opens its window only', !galacticPanels(null, 'arm3-227').ship && galacticPanels(null, 'arm3-227').cluster)
  check('both together: ship panel and the cluster window (it carries the jump-risk line)', galacticPanels('s1', 'arm3-227').ship && galacticPanels('s1', 'arm3-227').cluster)
}

console.log('\n=== The Solar Neighbourhood badge stands for its first ship ===')
{
  check('no ships inside: no lead', homeBadgeLeadId([]) === null)
  check('the first ship leads', homeBadgeLeadId([{ id: 'a' }, { id: 'b' }]) === 'a')
  // The badge opts into the box by this id (data-select-ship), so a box over it takes that ship.
  const lead = homeBadgeLeadId([{ id: 'a' }, { id: 'b' }])!
  const candidates: BoxCandidate[] = [
    { kind: 'ship', id: lead, rect: { left: 100, top: 100, right: 140, bottom: 118 } },
    { kind: 'ship', id: 'far', rect: { left: 500, top: 500, right: 514, bottom: 514 } },
  ]
  const picked = pickInBox({ left: 80, top: 80, right: 200, bottom: 200 }, candidates)
  check('a box over the badge selects the lead, not what is outside the box', picked.ships.length === 1 && picked.ships[0] === 'a')
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`)
if (failures > 0) process.exit(1)
