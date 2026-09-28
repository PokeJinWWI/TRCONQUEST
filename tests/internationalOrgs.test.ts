// International organizations: composable pillars (economic-market,
// defense-pact, joint-command, political-forum, cultural) blending Stellaris
// federations and Vic3 power blocs. See src/state/internationalOrgStore.ts.
//
// Run:  npx tsx tests/internationalOrgs.test.ts

import { useInternationalOrgStore, orgsOf, shareOrgPillar, canCommand } from '../src/state/internationalOrgStore'

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

console.log('\n=== 1. Founding, joining and leaving ===')
{
  useInternationalOrgStore.getState().reset()
  const orgId = useInternationalOrgStore.getState().founded(MARS, 'common-market', 'The Common Market', 0)
  check('the founder is a member and leader', orgsOf(useInternationalOrgStore.getState().orgs, MARS)[0]?.leaderId === MARS)
  check('preset pillars carried over', orgsOf(useInternationalOrgStore.getState().orgs, MARS)[0]?.pillars.includes('economic-market'))

  useInternationalOrgStore.getState().join(orgId, VENUS)
  check('Venus can join', orgsOf(useInternationalOrgStore.getState().orgs, VENUS).length === 1)
  check('Mars and Venus now share the economic-market pillar', shareOrgPillar(useInternationalOrgStore.getState().orgs, MARS, VENUS, 'economic-market'))
  check('but not defense-pact (not in this preset)', !shareOrgPillar(useInternationalOrgStore.getState().orgs, MARS, VENUS, 'defense-pact'))
  check('an outsider shares nothing', !shareOrgPillar(useInternationalOrgStore.getState().orgs, MARS, ORION, 'economic-market'))

  useInternationalOrgStore.getState().leave(orgId, VENUS)
  check('leaving removes membership', orgsOf(useInternationalOrgStore.getState().orgs, VENUS).length === 0)
  check('the org survives with its founder', orgsOf(useInternationalOrgStore.getState().orgs, MARS).length === 1)
}

console.log('\n=== 2. Leadership succession and disbanding ===')
{
  useInternationalOrgStore.getState().reset()
  const orgId = useInternationalOrgStore.getState().founded(MARS, 'defense-alliance', 'The Alliance', 0)
  useInternationalOrgStore.getState().join(orgId, VENUS)
  useInternationalOrgStore.getState().leave(orgId, MARS)
  check('leadership passes to a remaining member when the leader leaves', useInternationalOrgStore.getState().orgs.find((o) => o.id === orgId)?.leaderId === VENUS)

  useInternationalOrgStore.getState().leave(orgId, VENUS)
  check('an org with no members left is gone', useInternationalOrgStore.getState().orgs.find((o) => o.id === orgId) === undefined)
}

console.log('\n=== 3. Joint command delegation ===')
{
  useInternationalOrgStore.getState().reset()
  const orgId = useInternationalOrgStore.getState().founded(MARS, 'defense-alliance', 'NATO-style Alliance', 0)
  useInternationalOrgStore.getState().join(orgId, VENUS)
  check('a leader can always command its own fleets', canCommand(useInternationalOrgStore.getState().orgs, MARS, MARS))
  check('without delegation the leader cannot command a member', !canCommand(useInternationalOrgStore.getState().orgs, MARS, VENUS))

  useInternationalOrgStore.getState().setDelegatedCommand(orgId, VENUS, true)
  check('once delegated, the leader can command that member', canCommand(useInternationalOrgStore.getState().orgs, MARS, VENUS))
  check('but not a non-member', !canCommand(useInternationalOrgStore.getState().orgs, MARS, ORION))

  useInternationalOrgStore.getState().leave(orgId, VENUS)
  check('leaving clears delegated command', !canCommand(useInternationalOrgStore.getState().orgs, MARS, VENUS))

  const noCommandOrgId = useInternationalOrgStore.getState().founded(LALANDE, 'common-market', 'No-command Market', 0)
  useInternationalOrgStore.getState().join(noCommandOrgId, ORION)
  useInternationalOrgStore.getState().setDelegatedCommand(noCommandOrgId, ORION, true)
  check('delegation is meaningless without the joint-command pillar', !canCommand(useInternationalOrgStore.getState().orgs, LALANDE, ORION))
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`)
process.exit(failures === 0 ? 0 : 1)
