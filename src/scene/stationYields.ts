// What a nation's working stations yield each month, Simple mode (the strategic pool and the research trees live there; in Complex mode
// exotic matter and hyperium are economy goods and research has no income yet, so stations add nothing to them):
//   research lab  RESEARCH_LAB_POINTS physics research
//   refinery      hyperium synthesis: HYPERIUM_PER_REFINERY a month per module from EXOTIC_PER_HYPERIUM exotic matter each
import { RESEARCH_LAB_POINTS } from '../data/starbaseData'
import { HYPERIUM_SYNTHESIS_TECH_ID } from '../data/synthesisData'
import { useResourceStore } from '../state/resourceStore'
import { useGameTimeStore } from '../state/gameTimeStore'
import { useStarbaseStore } from '../state/starbaseStore'
import { useTechStore } from '../state/techStore'
import { stepSynthesis } from './extraction'
import { isStarbaseActive, onlineModulesOf, type Starbase } from './starbaseLogic'
import type { StarbaseModuleType } from '../data/starbaseData'

// How many of `module` a nation has working: built, powered, and the base finished and not destroyed.
export function workingModules(nationId: string, module: StarbaseModuleType, starbases: readonly Starbase[], simDays: number): number {
  let n = 0
  for (const sb of starbases) if (sb.ownerId === nationId && isStarbaseActive(sb, simDays)) n += onlineModulesOf(sb).filter((m) => m === module).length
  return n
}

export function applyStationMonth(nationId: string, months: number): void {
  if (months <= 0) return
  const starbases = useStarbaseStore.getState().starbases
  const now = useGameTimeStore.getState().simDays
  const labs = workingModules(nationId, 'research-lab', starbases, now)
  if (labs > 0) useTechStore.getState().grantResearch(nationId, 'physics', labs * RESEARCH_LAB_POINTS * months)
  const refineries = workingModules(nationId, 'refinery', starbases, now)
  if (refineries > 0 && useTechStore.getState().stateFor(nationId).researched.has(HYPERIUM_SYNTHESIS_TECH_ID)) {
    const res = useResourceStore.getState()
    const { hyperium, exoticUsed } = stepSynthesis(res.stateFor(nationId).amounts.exoticMatter ?? 0, months, refineries)
    if (hyperium > 0) {
      res.addAmount(nationId, 'exoticMatter', -exoticUsed)
      res.addAmount(nationId, 'hyperium', hyperium)
    }
  }
}
