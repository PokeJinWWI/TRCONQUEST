// Truthful jump-risk text: the tips and panel rows are built from the real computed chance
// (scene/jumpWarning.ts, scene/jumpConfirm.ts), and a "Survey system" order passes through the
// same confirmation as a move. Run:  npx tsx tests/jumpRiskText.test.ts
import { JUMP_WARN_LOSS, formatLossPercent, jumpRiskRow, jumpRiskTipText, saferJumpHint } from '../src/scene/jumpWarning'
import { jumpRiskLine } from '../src/scene/jumpConfirm'
import { orderSelectedToSurvey } from '../src/scene/shipCommands'
import { hyperdriveJumpChance, jumpIsCharted, setJumpRoll } from '../src/scene/shipPhysics'
import { spawnOwnedShip } from '../src/scene/shipyardLogic'
import { useConfirmStore } from '../src/state/confirmStore'
import { useGameTimeStore } from '../src/state/gameTimeStore'
import { useHyperlaneStore } from '../src/state/hyperlaneStore'
import { usePlayerStore } from '../src/state/playerStore'
import { useShipStore } from '../src/state/shipStore'
import { useSurveyStore } from '../src/state/surveyStore'
import { useTechStore } from '../src/state/techStore'
import { useTerritoryStore } from '../src/state/territoryStore'
import { getStarsForNeighborhood } from '../src/data/starData'
import { systemBodies } from '../src/scene/territory'
import { safeJumps } from './testWarp'

safeJumps()

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

console.log('\n=== 1. The text is built from the real number (pure) ===')
{
  check('a hair over the warning line never reads "5%"', formatLossPercent(0.0501) === '5.0%' && formatLossPercent(0.046) === '4.6%')
  const charted = jumpRiskTipText(0.046, true)
  const blind = jumpRiskTipText(0.185, false)
  check('the tip shows the real value, to a decimal below 10%', /Jump risk: 4\.6% chance/.test(charted) && /Jump risk: 19% chance|Jump risk: 18% chance|Jump risk: 18\.5%/.test(blind), `${charted} / ${blind}`)
  check('on a charted lane it says so and does NOT claim the destination\'s mass matters', /charted/.test(charted) && !/mass/.test(charted))
  check('on an uncharted jump it names distance AND mass, and what a charted lane does', /distance and the destination star's mass/.test(blind) && /fifth/.test(blind))
  const row = jumpRiskRow({ chance: 0.533, charted: false, destination: 'Sirius', elevated: false, mk: 1, maxMk: 5 })
  check('the panel row names the destination and the real value', row.label === 'Jump Risk to Sirius' && row.value === '53% (uncharted)')
  check('...with the hint what would help, from the real Mk data', /higher Hyperdrive Mk \(you have Mk 1 of 5\)/.test(row.hint ?? ''))
  check('...a hair-safe jump has no hint', jumpRiskRow({ chance: 0.03, charted: true, destination: 'x', elevated: false, mk: 5, maxMk: 5 }).hint === null)
  check('at the last Mk only a charted lane helps', saferJumpHint(0.3, 5, 5) === 'Safer only on a lane you have charted.')
  check('damage is flagged', /\(elevated\)/.test(jumpRiskRow({ chance: 0.2, charted: false, destination: 'x', elevated: true, mk: 1, maxMk: 5 }).value))
}

const MARS = 'imperial-state-of-mars'
const pending = () => useConfirmStore.getState().pending
function fresh() {
  usePlayerStore.setState({ selectedCountryId: MARS, sandbox: false })
  useGameTimeStore.setState({ simDays: 0, paused: false })
  useShipStore.setState({ ships: [] })
  useHyperlaneStore.setState({ lanes: {} })
  useSurveyStore.setState({ discovered: {}, known: {}, reports: [] })
  useTerritoryStore.getState().reset()
  useTechStore.setState({ byCountry: {} })
  useConfirmStore.setState({ pending: null })
  setJumpRoll(() => 1)
}

console.log('\n=== 2. The tip uses the real, lane-aware chance (live stores) ===')
{
  fresh()
  const sci = spawnOwnedShip('science-ship', MARS, 'sol', 'Mars')!
  const ship = () => useShipStore.getState().ships.find((s) => s.id === sci)!
  const blind = hyperdriveJumpChance(ship(), 'barnards-star', 0)!
  const line = jumpRiskLine([ship()], { kind: 'star', starId: 'barnards-star' })!
  check('uncharted: the tip carries the real chance and the distance-and-mass wording', line.includes(formatLossPercent(blind)) && /mass/.test(line) && !jumpIsCharted(ship(), 'barnards-star', 0), line)
  useHyperlaneStore.getState().addHyperlane(MARS, 'sol', 'barnards-star')
  const lane = hyperdriveJumpChance(ship(), 'barnards-star', 0)!
  const line2 = jumpRiskLine([ship()], { kind: 'star', starId: 'barnards-star' })!
  check('after charting the lane the tip shows the lower real value, with no mass claim', lane < blind && line2.includes(formatLossPercent(lane)) && jumpIsCharted(ship(), 'barnards-star', 0) && !/mass/.test(line2), line2)
  // A ship at the entry point of another cluster gets a tip for that cluster's stars (it used to be empty).
  const abroad = getStarsForNeighborhood('arm3-227')[0]
  useShipStore.getState().setShipLocation(sci, { kind: 'interstellar-point', position: [0, 0, 0], clusterId: 'arm3-227' })
  const far = jumpRiskLine([ship()], { kind: 'star', starId: abroad.id })
  check('a star of another cluster gets a tip from the entry point', !!far && /Jump risk: /.test(far), far ?? 'null')
}

console.log('\n=== 3. "Survey system" asks like a move when the jump is over the line ===')
{
  fresh()
  const sci = spawnOwnedShip('science-ship', MARS, 'sol', 'Mars')!
  useShipStore.getState().selectShip(sci)
  const chance = hyperdriveJumpChance(useShipStore.getState().ships[0], 'sirius', 0)!
  check('Sirius is well over the warning line', chance > JUMP_WARN_LOSS, formatLossPercent(chance))
  orderSelectedToSurvey('sirius')
  check('the order asks first (Risky jump) and nothing is sent yet', pending()?.title === 'Risky jump' && !useShipStore.getState().ships[0].surveyJob && (useShipStore.getState().ships[0].pendingCommands ?? []).length === 0)
  check('...naming the real chance', (pending()?.body ?? '').includes(formatLossPercent(chance)))
  useConfirmStore.getState().resolve(false)
  check('declining sends nothing', !useShipStore.getState().ships[0].surveyJob && (useShipStore.getState().ships[0].pendingCommands ?? []).length === 0 && pending() === null)
  orderSelectedToSurvey('sirius')
  useConfirmStore.getState().resolve(true)
  check('confirming sends the survey', !!useShipStore.getState().ships[0].surveyJob || (useShipStore.getState().ships[0].pendingCommands ?? []).length === 1)
  // A body of that system goes through the same question.
  useShipStore.getState().setSurveyJob(sci, null)
  useShipStore.getState().setShipLocation(sci, { kind: 'star', starId: 'sol', offset: [0, 0, 0] })
  useShipStore.setState((s) => ({ ships: s.ships.map((x) => ({ ...x, pendingCommands: [] })) }))
  orderSelectedToSurvey('sirius', systemBodies('sirius')[0])
  check('"Survey <body>" asks the same question', pending()?.title === 'Risky jump')
  useConfirmStore.getState().resolve(false)
  // Under the line there is no question.
  useShipStore.getState().setShipLocation(sci, { kind: 'star', starId: 'sol', offset: [0, 0, 0] })
  useHyperlaneStore.getState().addHyperlane(MARS, 'sol', 'alpha-centauri')
  const lane = hyperdriveJumpChance(useShipStore.getState().ships[0], 'alpha-centauri', 0)!
  orderSelectedToSurvey('alpha-centauri')
  check('a jump at or under the line is sent without asking', lane <= JUMP_WARN_LOSS && pending() === null && (!!useShipStore.getState().ships[0].surveyJob || (useShipStore.getState().ships[0].pendingCommands ?? []).length > 0), formatLossPercent(lane))
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`)
process.exit(failures === 0 ? 0 : 1)
