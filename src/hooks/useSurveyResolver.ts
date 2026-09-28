import { useEffect } from 'react'
import { useGameTimeStore } from '../state/gameTimeStore'
import { useShipStore } from '../state/shipStore'
import { useSurveyStore } from '../state/surveyStore'
import { useTerritoryStore } from '../state/territoryStore'
import { resolveShipClass } from '../state/shipClassResolver'
import { reportDelayDays } from '../scene/shipCommands'
import { restingStarId, stepSurveyJob, unsurveyedBodies } from '../scene/surveyLogic'

// Science ships work through their survey job (exploring is its own command,
// see scene/shipCommands.ts), writing what they find to the survey store's
// `discovered` layer and posting a report that reaches the nation's `known`
// layer after the signal delay (scene/surveyLogic.ts has the rules; this is the
// store I/O).
export function resolveSurvey(simDays: number): void {
  const survey = useSurveyStore.getState()
  const owners = useTerritoryStore.getState().bodyOwner
  const { ships, setSurveyJob } = useShipStore.getState()

  for (const ship of ships) {
    if (resolveShipClass(ship.classId)?.role !== 'science') continue
    const star = restingStarId(ship)

    // A job only runs while the ship stays put at its star.
    if (ship.surveyJob && ship.surveyJob.starId !== star) {
      setSurveyJob(ship.id, null)
      continue
    }
    if (!star) continue

    const job = ship.surveyJob
    if (!job) continue
    const remaining = unsurveyedBodies(useSurveyStore.getState().discovered[ship.ownerId], ship.ownerId, star, owners)
    const step = stepSurveyJob(job, simDays, remaining)
    const delay = step.completed.length > 0 ? reportDelayDays(ship.ownerId, ship, simDays) : 0
    for (const c of step.completed) {
      survey.discover(ship.ownerId, { kind: 'surveyed', bodyName: c.bodyName }, c.atSimDays + delay, simDays)
    }
    if (step.finished) setSurveyJob(ship.id, null)
    else if (step.done !== job.done) setSurveyJob(ship.id, { ...job, done: step.done })
  }
  survey.deliverReports(simDays)
}

export function useSurveyResolver() {
  useEffect(() => {
    resolveSurvey(useGameTimeStore.getState().simDays)
    return useGameTimeStore.subscribe((state) => resolveSurvey(state.simDays))
  }, [])
}
