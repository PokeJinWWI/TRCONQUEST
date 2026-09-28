// Trade policy: per-nation tariffs and import/export subventions, plus
// blanket embargoes and the shared-market bypass (orgs' economic-market
// pillar, or a subject that hasn't been granted a separate market). See
// src/state/tradePolicyStore.ts.
//
// Run:  npx tsx tests/tradePolicy.test.ts

import { useTradePolicyStore, tradePolicyOf, isEmbargoed, inSharedMarket } from '../src/state/tradePolicyStore'
import { useSubjectStore } from '../src/state/subjectStore'
import { useInternationalOrgStore } from '../src/state/internationalOrgStore'

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

console.log('\n=== 1. Tariffs and subventions per good ===')
{
  useTradePolicyStore.getState().reset()
  check('a fresh nation has no tariffs', Object.keys(tradePolicyOf(useTradePolicyStore.getState().policies, MARS).tariffs).length === 0)

  useTradePolicyStore.getState().setTariff(MARS, 'steel', 0.2)
  useTradePolicyStore.getState().setImportSubvention(MARS, 'grain', 0.5)
  useTradePolicyStore.getState().setExportSubvention(MARS, 'weapons', 0.3)
  const policy = tradePolicyOf(useTradePolicyStore.getState().policies, MARS)
  check('tariff set', policy.tariffs.steel === 0.2)
  check('import subvention set', policy.importSubventions.grain === 0.5)
  check('export subvention set', policy.exportSubventions.weapons === 0.3)
  check('an untouched nation is unaffected', Object.keys(tradePolicyOf(useTradePolicyStore.getState().policies, VENUS).tariffs).length === 0)
}

console.log('\n=== 2. Embargoes ===')
{
  useTradePolicyStore.getState().reset()
  check('nobody starts embargoed', !isEmbargoed(useTradePolicyStore.getState().embargoes, MARS, VENUS))
  useTradePolicyStore.getState().declareEmbargo(MARS, VENUS)
  check('an embargo is symmetric regardless of who declared it', isEmbargoed(useTradePolicyStore.getState().embargoes, MARS, VENUS) && isEmbargoed(useTradePolicyStore.getState().embargoes, VENUS, MARS))
  check('a third nation is unaffected', !isEmbargoed(useTradePolicyStore.getState().embargoes, MARS, ORION))
  useTradePolicyStore.getState().liftEmbargo(MARS, VENUS)
  check('lifting clears it', !isEmbargoed(useTradePolicyStore.getState().embargoes, MARS, VENUS))
}

console.log('\n=== 3. Shared markets bypass tariffs ===')
{
  useTradePolicyStore.getState().reset()
  useSubjectStore.getState().reset()
  useInternationalOrgStore.getState().reset()

  check('unrelated nations are not in a shared market', !inSharedMarket(MARS, VENUS))

  const orgId = useInternationalOrgStore.getState().founded(MARS, 'common-market', 'The Common Market', 0)
  useInternationalOrgStore.getState().join(orgId, VENUS)
  check('fellow economic-market members share a market', inSharedMarket(MARS, VENUS))
  check('a non-member does not', !inSharedMarket(MARS, ORION))

  useSubjectStore.getState().establishSubject(MARS, ORION, 'vassal', 0)
  check('a subject with no separate market shares its suzerain\'s market', inSharedMarket(MARS, ORION))
  useSubjectStore.getState().setSeparateMarket(ORION, true)
  check('granting a separate market ends that', !inSharedMarket(MARS, ORION))
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`)
process.exit(failures === 0 ? 0 : 1)
