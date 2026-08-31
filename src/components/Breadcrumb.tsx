import { useViewStore } from '../state/viewStore'

export function Breadcrumb() {
  const level = useViewStore((s) => s.level)
  const selectedStarId = useViewStore((s) => s.selectedStarId)
  const enterGalactic = useViewStore((s) => s.enterGalactic)
  const enterInterstellar = useViewStore((s) => s.enterInterstellar)
  const enterSystem = useViewStore((s) => s.enterSystem)

  return (
    <nav className="breadcrumb">
      <button type="button" className="crumb" onClick={enterGalactic} disabled={level === 'galactic'}>
        GALAXY
      </button>
      <span className="crumb-sep">›</span>
      <button type="button" className="crumb" onClick={() => enterInterstellar()} disabled={level === 'interstellar'}>
        INTERSTELLAR
      </button>
      {(level === 'system' || level === 'satellite' || level === 'combat') && (
        <>
          <span className="crumb-sep">›</span>
          <button
            type="button"
            className="crumb"
            onClick={() => enterSystem(selectedStarId)}
            disabled={level === 'system'}
          >
            SYSTEM
          </button>
        </>
      )}
      {level === 'satellite' && (
        <>
          <span className="crumb-sep">›</span>
          <button type="button" className="crumb" disabled>
            SATELLITE
          </button>
        </>
      )}
      {/* Combat isn't reached by zooming in on anything, so it hangs off
          SYSTEM (where the fight is physically happening) rather than
          extending the satellite chain. Styled hot to match the tactical
          clock — both signal "you are in a fight." */}
      {level === 'combat' && (
        <>
          <span className="crumb-sep">›</span>
          <button type="button" className="crumb crumb-combat" disabled>
            COMBAT
          </button>
        </>
      )}
    </nav>
  )
}
