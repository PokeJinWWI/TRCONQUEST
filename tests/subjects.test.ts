// Subject nations: suzerain-subject relationships that constrain foreign
// policy without touching territory ownership. See src/state/subjectStore.ts.
//
// Run:  npx tsx tests/subjects.test.ts

import { useSubjectStore, subjectionOf, suzerainOf, subjectsOf, isSubjectOf } from '../src/state/subjectStore'
import { bindsForeignPolicy, paysTribute } from '../src/data/subjectData'

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

console.log('\n=== 1. Establishing and releasing a subject ===')
{
  useSubjectStore.getState().reset()
  useSubjectStore.getState().establishSubject(MARS, VENUS, 'vassal', 100)
  const sub = subjectionOf(useSubjectStore.getState().subjections, VENUS)
  check('Venus is now a subject of Mars', sub?.suzerainId === MARS && sub.type === 'vassal')
  check('suzerainOf finds it', suzerainOf(useSubjectStore.getState().subjections, VENUS) === MARS)
  check('isSubjectOf is order-independent', isSubjectOf(VENUS, MARS) && isSubjectOf(MARS, VENUS))
  check('a fresh nation has no suzerain', suzerainOf(useSubjectStore.getState().subjections, ORION) === undefined)

  useSubjectStore.getState().releaseSubject(VENUS, 200)
  check('releasing grants independence', subjectionOf(useSubjectStore.getState().subjections, VENUS) === undefined)
}

console.log('\n=== 2. Multiple subjects, type changes, and separate markets ===')
{
  useSubjectStore.getState().reset()
  useSubjectStore.getState().establishSubject(MARS, VENUS, 'vassal', 0)
  useSubjectStore.getState().establishSubject(MARS, ORION, 'tributary', 0)
  check('Mars has two subjects', subjectsOf(useSubjectStore.getState().subjections, MARS).length === 2)

  useSubjectStore.getState().changeSubjectType(VENUS, 'protectorate')
  check('subject type can change', subjectionOf(useSubjectStore.getState().subjections, VENUS)?.type === 'protectorate')

  check('a fresh subjection shares the suzerain\'s market by default', subjectionOf(useSubjectStore.getState().subjections, VENUS)?.separateMarket === false)
  useSubjectStore.getState().setSeparateMarket(VENUS, true)
  check('the suzerain can grant a separate market', subjectionOf(useSubjectStore.getState().subjections, VENUS)?.separateMarket === true)

  useSubjectStore.getState().establishSubject(MARS, VENUS, 'client-state', 50)
  check('re-establishing replaces the old subjection rather than duplicating it', subjectsOf(useSubjectStore.getState().subjections, MARS).length === 2)
}

console.log('\n=== 3. Subject-type policy rules ===')
{
  check('a vassal has no independent foreign policy', bindsForeignPolicy('vassal'))
  check('a protectorate does', !bindsForeignPolicy('protectorate'))
  check('a client-state does', !bindsForeignPolicy('client-state'))
  check('vassals and tributaries owe tribute', paysTribute('vassal') && paysTribute('tributary'))
  check('protectorates, client-states and autonomous regions do not', !paysTribute('protectorate') && !paysTribute('client-state') && !paysTribute('autonomous-region'))
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`)
process.exit(failures === 0 ? 0 : 1)
