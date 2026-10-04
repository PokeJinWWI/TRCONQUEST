import { useEffect } from 'react'
import { useCombatStore } from '../state/combatStore'
import { useGameTimeStore } from '../state/gameTimeStore'
import { useShipStore } from '../state/shipStore'
import { useShipDeconstructionStore } from '../state/shipDeconstructionStore'
import { stepDeconstructions } from '../scene/shipDeconstruction'

// One step of every deconstruction up to `simDays`: removes each ship whose bar has
// emptied. Exported so a headless run (tests) can drive it without React.
export function resolveShipDeconstructions(simDays: number): void {
  const { jobs, setJobs } = useShipDeconstructionStore.getState()
  if (jobs.length === 0) return
  const engaged = new Set<string>()
  for (const e of useCombatStore.getState().engagements) for (const p of e.participants) engaged.add(p.shipId)
  const live = new Set(useShipStore.getState().ships.map((s) => s.id))
  const step = stepDeconstructions(jobs, simDays, engaged, live)
  if (step.finished.length === 0 && step.jobs.length === jobs.length) return
  setJobs(step.jobs)
  for (const done of step.finished) useShipStore.getState().removeShip(done.shipId)
}

// Runs the scrapping off the game clock, whichever view is mounted.
export function useShipDeconstructionResolver() {
  useEffect(() => {
    resolveShipDeconstructions(useGameTimeStore.getState().simDays)
    return useGameTimeStore.subscribe((state) => resolveShipDeconstructions(state.simDays))
  }, [])
}
