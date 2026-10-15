import { Bi } from '../Bi'
import { useMemo } from 'react'
import { STARS } from '../../data/starData'
import { systemView } from '../../scene/territoryView'
import { useGameTimeStore } from '../../state/gameTimeStore'
import { useJurisdictionStore } from '../../state/jurisdictionStore'
import { useStarbaseStore } from '../../state/starbaseStore'
import { useTerritoryStore } from '../../state/territoryStore'

// A star's territorial picture (the star panel): who governs the SYSTEM (nobody just because they hold a Starbase),
// who has claims, whose Starbases stand there, and who governs each body.
export function SystemTerritoryRows({ starName }: { starName: string }) {
  const starId = STARS.find((s) => s.name === starName)?.id
  const claims = useJurisdictionStore((s) => s.claims)
  const owners = useTerritoryStore((s) => s.bodyOwner)
  const starbases = useStarbaseStore((s) => s.starbases)
  // Only whole days matter, and only for a Starbase finishing.
  const day = useGameTimeStore((s) => Math.floor(s.simDays / 30))
  const view = useMemo(() => (starId ? systemView(starId) : null), [starId, claims, owners, starbases, day])
  if (!view) return null
  return (
    <>
      <div className="inspect-divider" />
      <div className="inspect-row" title="The recognized system-wide sovereign. A Starbase is a foothold, never a title.">
        <span className="inspect-label"><Bi en="System governed by" /></span>
        <span className="inspect-value">{view.sovereign ?? 'nobody'}</span>
      </div>
      <div className="inspect-status">{view.note}</div>
      {view.claimants.length > 0 && (
        <div className="inspect-row" title="Provisional claims on the whole system">
          <span className="inspect-label"><Bi en="Claimed by" /></span>
          <span className="inspect-value">{view.claimants.join(', ')}</span>
        </div>
      )}
      {view.presence.length > 0 && (
        <div className="inspect-row" title="Finished Starbases here: a logistical and military foothold with no sovereignty">
          <span className="inspect-label"><Bi en="Starbases of" /></span>
          <span className="inspect-value">{view.presence.join(', ')}</span>
        </div>
      )}
      {view.bodies.length > 0 && (
        <>
          <div className="inspect-divider" />
          <div className="inspect-status" title="Who holds title to each world of this system">Who governs each world</div>
        </>
      )}
      {view.bodies.map((b) => (
        <div key={b.body} className="inspect-row">
          <span className="inspect-label">{b.body}</span>
          <span className="inspect-value">{b.sovereign}</span>
        </div>
      ))}
    </>
  )
}
