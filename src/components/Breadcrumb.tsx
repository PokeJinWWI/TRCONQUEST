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
      <button type="button" className="crumb" onClick={enterInterstellar} disabled={level === 'interstellar'}>
        INTERSTELLAR
      </button>
      {(level === 'system' || level === 'satellite') && (
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
    </nav>
  )
}
