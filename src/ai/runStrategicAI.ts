// One tick of the strategic AI: every AI empire whose planning time has come
// plans from a fresh snapshot and acts. Called by hooks/useStrategicAI off
// the game clock, and directly by tests to run the AI headless.
import { AI_PLAN_INTERVAL_DAYS } from '../data/aiData'
import { COUNTRIES } from '../data/countryData'
import { runsStrategicAI } from '../data/countryRoster'
import { usePlayerStore } from '../state/playerStore'
import { useAiStore } from './aiStore'
import { captureSnapshot } from './snapshot'
import { planEmpire } from './coordinator'
import { executeIntents } from './executor'

export function runStrategicAI(simDays: number): void {
  const playerCountryId = usePlayerStore.getState().selectedCountryId
  const ai = useAiStore.getState()
  const empires = COUNTRIES.filter((c) => runsStrategicAI(c.id, playerCountryId))
  empires.forEach((country, index) => {
    const next = ai.nextPlanSimDays[country.id]
    if (next === undefined) {
      // First sight of this empire: schedule its first plan, staggered so
      // empires don't all think in the same frame.
      useAiStore.getState().setNextPlan(country.id, simDays + ((index + 1) * AI_PLAN_INTERVAL_DAYS) / empires.length)
      return
    }
    if (simDays < next) return
    // Each empire reads the world as the previous one left it. A big clock
    // jump still means one plan, not a backlog of them.
    const snap = captureSnapshot(simDays)
    const plan = planEmpire(country.id, snap, useAiStore.getState().memoryFor(country.id))
    executeIntents(country.id, plan.intents, simDays, playerCountryId)
    useAiStore.getState().setMemory(country.id, plan.memory)
    useAiStore.getState().setNextPlan(country.id, simDays + AI_PLAN_INTERVAL_DAYS)
  })
}
