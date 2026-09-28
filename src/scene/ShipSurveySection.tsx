import { useThrottledSimDays } from '../hooks/useThrottledSimDays'
import { resolveShipClass } from '../state/shipClassResolver'
import type { ShipInstance } from '../state/shipStore'
import { useShipStore } from '../state/shipStore'
import { useSurveyStore } from '../state/surveyStore'
import { useTerritoryStore } from '../state/territoryStore'
import { STARS } from '../data/starData'
import { SURVEY_DAYS_PER_BODY } from '../data/surveyData'
import { queueShipCommand } from './shipCommands'
import { restingStarId, surveyProgress, systemIntelStatus } from './surveyLogic'

// The Science Ship's part of ShipPanel: what the star it is resting at looks
// like to the player (from the KNOWN layer, so it lags by signal time), its
// survey progress, and the Survey / Stop buttons. A separate component so it
// keeps its own hooks clear of ShipPanel's early return.
export function ShipSurveySection({ ship }: { ship: ShipInstance }) {
  const known = useSurveyStore((s) => s.known[ship.ownerId])
  const owners = useTerritoryStore((s) => s.bodyOwner)
  const simDays = useThrottledSimDays()
  const setSurveyJob = useShipStore((s) => s.setSurveyJob)

  if (resolveShipClass(ship.classId)?.role !== 'science') return null
  const star = restingStarId(ship)
  const starName = star ? (STARS.find((s) => s.id === star)?.name ?? star) : null
  const status = star ? systemIntelStatus(known, ship.ownerId, star, owners) : null
  const progress = star ? surveyProgress(known, ship.ownerId, star, owners) : null
  const pendingOf = (kind: 'survey' | 'explore') => (ship.pendingCommands ?? []).find((p) => p.command.kind === kind)
  const pendingSurvey = pendingOf('survey')
  const pendingExplore = pendingOf('explore')
  const surveying = !!ship.surveyJob
  const fullySurveyed = !!progress && progress.total > 0 && progress.done === progress.total

  // Being at the star is all either order needs: they never wait on what the
  // player has heard back (a system doesn't have to be explored to be surveyed).
  let text: string
  if (!star) text = 'Under way: it can explore and survey a system it is at'
  else if (status === 'unexplored') text = `${starName}: not explored${progress!.done > 0 ? `, ${progress!.done} / ${progress!.total} bodies surveyed` : ''}`
  else if (fullySurveyed) text = `${starName}: explored, fully surveyed (${progress!.total} bodies)`
  else text = `${starName}: explored, ${progress!.done} / ${progress!.total} bodies surveyed`

  const canExplore = !!star && status === 'unexplored' && !pendingExplore
  const canSurvey = !!star && !fullySurveyed && !surveying && !pendingSurvey
  const inTransit = (p: NonNullable<typeof pendingSurvey>) => `${Math.max(0, Math.ceil(p.arrivesSimDays - simDays))}d`
  return (
    <>
      <div className="inspect-row">
        <span className="inspect-label">Survey</span>
        <span className="inspect-value">{text}</span>
      </div>
      {!star && ship.arrivalCommand && (
        <div className="inspect-row">
          <span className="inspect-label">On arrival</span>
          <span className="inspect-value">
            {ship.arrivalCommand.command.kind === 'explore' ? 'Explore' : ship.arrivalCommand.command.kind === 'survey' ? 'Survey' : 'Build a Starbase at'} {STARS.find((s) => s.id === ship.arrivalCommand!.starId)?.name}
          </span>
        </div>
      )}
      {surveying && (
        <div className="inspect-row">
          <span className="inspect-label">Working</span>
          <span className="inspect-value">
            One body every {SURVEY_DAYS_PER_BODY} days
            <button type="button" className="ship-panel-unfollow-btn" onClick={() => setSurveyJob(ship.id, null)}>
              Stop
            </button>
          </span>
        </div>
      )}
      {(pendingSurvey || pendingExplore) && (
        <div className="inspect-row">
          <span className="inspect-label">Order</span>
          <span className="inspect-value">
            {pendingExplore ? `Explore in transit (${inTransit(pendingExplore)})` : `Survey in transit (${inTransit(pendingSurvey!)})`}
          </span>
        </div>
      )}
      <div className="ship-panel-btn-row">
        <button
          type="button"
          className="detail-view-btn"
          disabled={!canExplore}
          title={canExplore ? 'Reveal this system: its owner, borders and worlds' : !star ? 'Reach a star first' : pendingExplore ? 'Order already on its way' : 'Already explored'}
          onClick={() => queueShipCommand(ship.id, { kind: 'explore' })}
        >
          Explore system
        </button>
        <button
          type="button"
          className="detail-view-btn"
          disabled={!canSurvey}
          title={canSurvey ? `Survey every body here, ${SURVEY_DAYS_PER_BODY} days each` : !star ? 'Reach a star first' : fullySurveyed ? 'Already fully surveyed' : 'Already surveying'}
          onClick={() => queueShipCommand(ship.id, { kind: 'survey' })}
        >
          Survey system
        </button>
      </div>
    </>
  )
}
