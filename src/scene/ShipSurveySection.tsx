import { useThrottledSimDays } from '../hooks/useThrottledSimDays'
import { resolveShipClass } from '../state/shipClassResolver'
import type { ShipInstance } from '../state/shipStore'
import { useShipStore } from '../state/shipStore'
import { useSurveyStore } from '../state/surveyStore'
import { useTerritoryStore } from '../state/territoryStore'
import { findStar } from '../data/starData'
import { SURVEY_DAYS_PER_BODY } from '../data/surveyData'
import { queueShipCommand } from './shipCommands'
import { surveyProgress, systemOfShip } from './surveyLogic'

// The Science Ship's part of ShipPanel: survey progress of the system it is in
// (from the KNOWN layer, so it lags by signal time), what its survey job is
// doing, and the Survey / Stop buttons. Exploring needs no button: entering a
// system explores it. A separate component so it keeps its own hooks clear of
// ShipPanel's early return.
export function ShipSurveySection({ ship }: { ship: ShipInstance }) {
  const known = useSurveyStore((s) => s.known[ship.ownerId])
  const discovered = useSurveyStore((s) => s.discovered[ship.ownerId])
  const owners = useTerritoryStore((s) => s.bodyOwner)
  const simDays = useThrottledSimDays()
  const setSurveyJob = useShipStore((s) => s.setSurveyJob)

  if (resolveShipClass(ship.classId)?.role !== 'science') return null
  const star = systemOfShip(ship)
  const starName = star ? (findStar(star)?.name ?? star) : null
  const progress = star ? surveyProgress(known, ship.ownerId, star, owners) : null
  // What is actually left for the ship (it knows before the capital does).
  const left = star ? surveyProgress(discovered, ship.ownerId, star, owners) : null
  const pendingSurvey = (ship.pendingCommands ?? []).find((p) => p.command.kind === 'survey')
  const job = ship.surveyJob

  const text = !star
    ? 'In deep space'
    : progress!.total > 0 && progress!.done === progress!.total
      ? `${starName}: fully surveyed (${progress!.total} bodies)`
      : `${starName}: ${progress!.done} / ${progress!.total} bodies surveyed`

  let working: string | null = null
  if (job && job.bodies.length > 0) {
    const body = job.bodies[0]
    const more = job.bodies.length - 1
    const tail = more > 0 ? `, then ${more} more` : ''
    working =
      job.workingSinceSimDays === null
        ? `Flying to ${body} to survey it${tail}`
        : `Surveying ${body} (${Math.min(SURVEY_DAYS_PER_BODY, Math.floor(simDays - job.workingSinceSimDays))} / ${SURVEY_DAYS_PER_BODY} days)${tail}`
  }

  const nothingLeft = !!left && left.done === left.total
  const canSurvey = !!star && !nothingLeft && !job && !pendingSurvey
  const reason = !star ? 'Enter a system first' : nothingLeft ? 'Every body here is surveyed' : job ? 'Already surveying' : pendingSurvey ? 'Order already on its way' : ''
  return (
    <>
      <div className="inspect-row">
        <span className="inspect-label">Survey</span>
        <span className="inspect-value">{text}</span>
      </div>
      {working && (
        <div className="inspect-row">
          <span className="inspect-label">Working</span>
          <span className="inspect-value">
            {working}
            <button type="button" className="ship-panel-unfollow-btn" onClick={() => setSurveyJob(ship.id, null)}>
              Stop
            </button>
          </span>
        </div>
      )}
      {pendingSurvey && (
        <div className="inspect-row">
          <span className="inspect-label">Order</span>
          <span className="inspect-value">Survey in transit ({Math.max(0, Math.ceil(pendingSurvey.arrivesSimDays - simDays))}d)</span>
        </div>
      )}
      <div className="ship-panel-btn-row">
        <button
          type="button"
          className="detail-view-btn"
          disabled={!canSurvey}
          title={canSurvey ? `Fly to each unsurveyed body here and survey it, ${SURVEY_DAYS_PER_BODY} days each` : reason}
          onClick={() => queueShipCommand(ship.id, { kind: 'survey' })}
        >
          Survey system
        </button>
      </div>
      {!canSurvey && !job && !pendingSurvey && <div className="ship-panel-hint">Can't survey here: {reason}</div>}
      <div className="inspect-status">Right-click a planet or moon to survey just that one.</div>
    </>
  )
}
