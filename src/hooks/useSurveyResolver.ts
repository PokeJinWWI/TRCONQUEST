import { useEffect } from 'react'
import { useGameTimeStore } from '../state/gameTimeStore'
import { useShipStore, type ShipInstance } from '../state/shipStore'
import { useSurveyStore } from '../state/surveyStore'
import { useTerritoryStore } from '../state/territoryStore'
import { useHyperlaneStore } from '../state/hyperlaneStore'
import { resolveShipClass } from '../state/shipClassResolver'
import { reportDelayDays } from '../scene/shipCommands'
import { isBodySurveyed, isExplored, stepSurveyJob, systemOfShip } from '../scene/surveyLogic'
import { planMoveUnchecked } from '../scene/shipPhysics'
import { bodyStarId } from '../scene/territory'

// Any ship entering a system explores it, and science ships work through their
// survey jobs, flying to each body in turn. What they find is written to the
// survey store's `discovered` layer at once and reaches the nation's `known`
// layer after the signal delay (scene/surveyLogic.ts has the rules; this is the
// store I/O).
export function resolveSurvey(simDays: number): void {
  const survey = useSurveyStore.getState()
  const owners = useTerritoryStore.getState().bodyOwner

  // Exploring: being in a system is enough. Ships at home share one answer.
  const explored = new Map<string, boolean>()
  for (const ship of useShipStore.getState().ships) {
    const starId = systemOfShip(ship)
    if (!starId) continue
    const key = `${ship.ownerId}|${starId}`
    if (explored.get(key)) continue
    const already = isExplored(useSurveyStore.getState().discovered[ship.ownerId], ship.ownerId, starId, owners)
    explored.set(key, true)
    if (!already) survey.discover(ship.ownerId, { kind: 'explored', starId }, simDays + reportDelayDays(ship.ownerId, ship, simDays), simDays)
  }

  for (const ship of useShipStore.getState().ships) {
    if (ship.surveyJob && resolveShipClass(ship.classId)?.role === 'science') advanceSurveyJob(ship, simDays)
  }
  survey.deliverReports(simDays)
}

// One step of one ship's survey job: fly on, keep working, or file a body.
export function advanceSurveyJob(ship: ShipInstance, simDays: number): void {
  const job = ship.surveyJob
  if (!job) return
  const { setSurveyJob, setShipOrder, setShipLocation, removeShip } = useShipStore.getState()
  const owners = useTerritoryStore.getState().bodyOwner
  const intel = useSurveyStore.getState().discovered[ship.ownerId]
  const remaining = job.bodies.filter((b) => !isBodySurveyed(intel, ship.ownerId, b, owners))
  const dest = ship.order?.destination
  const step = stepSurveyJob(job, remaining, {
    orbiting: !ship.order && ship.location.kind === 'orbiting' ? ship.location.bodyName : null,
    headingTo: dest?.kind === 'body' ? dest.bodyName : null,
  }, simDays)

  const changed = (next: typeof job) => next.workingSinceSimDays !== job.workingSinceSimDays || next.bodies.length !== job.bodies.length
  switch (step.kind) {
    case 'done':
      setSurveyJob(ship.id, null)
      return
    case 'wait':
      if (changed(step.job)) setSurveyJob(ship.id, step.job)
      return
    case 'surveyed': {
      const delay = reportDelayDays(ship.ownerId, ship, simDays)
      useSurveyStore.getState().discover(ship.ownerId, { kind: 'surveyed', bodyName: step.bodyName }, step.atSimDays + delay, simDays)
      setSurveyJob(ship.id, step.job)
      // Straight on to the next body.
      const after = useShipStore.getState().ships.find((s) => s.id === ship.id)
      if (after && step.job) advanceSurveyJob(after, simDays)
      return
    }
    case 'fly': {
      if (changed(step.job)) setSurveyJob(ship.id, step.job)
      const systemId = bodyStarId(step.bodyName)
      if (!systemId) {
        setSurveyJob(ship.id, null)
        return
      }
      // The ship's own flight under its standing job, not a fresh order: it
      // keeps the job (keepFollowing).
      const result = planMoveUnchecked(ship, { kind: 'body', systemId, bodyName: step.bodyName }, simDays)
      if (result.kind === 'order') setShipOrder(ship.id, result.order, result.warpReadyOverride, true)
      else if (result.kind === 'instant') {
        setShipLocation(ship.id, result.location, { hyperdriveReadySimDays: result.hyperdriveReadySimDays }, true)
        if (result.hyperlaneEstablished) useHyperlaneStore.getState().addHyperlane(...result.hyperlaneEstablished)
      } else if (result.kind === 'lost-in-hyperspace') removeShip(ship.id)
      // Waiting on a drive cooldown, the pause, or a fight: try again later.
      else if (result.kind !== 'on-cooldown' && result.kind !== 'paused' && result.kind !== 'engaged') setSurveyJob(ship.id, null)
      return
    }
  }
}

export function useSurveyResolver() {
  useEffect(() => {
    resolveSurvey(useGameTimeStore.getState().simDays)
    return useGameTimeStore.subscribe((state) => resolveSurvey(state.simDays))
  }, [])
}
