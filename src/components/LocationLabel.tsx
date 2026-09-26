import { STARS } from '../data/starData'
import { useViewStore } from '../state/viewStore'

export function LocationLabel() {
  const level = useViewStore((s) => s.level)
  const selectedStarId = useViewStore((s) => s.selectedStarId)
  const selectedBodyName = useViewStore((s) => s.selectedBodyName)

  if (level === 'galactic' || level === 'interstellar') return null

  const starName = STARS.find((s) => s.id === selectedStarId)?.name ?? selectedStarId

  const text =
    level === 'terrain' && selectedBodyName
      ? `${starName} System — ${selectedBodyName} · Terrain`
      : level === 'ground' && selectedBodyName
      ? `${starName} System — ${selectedBodyName} · Ground`
      : level === 'satellite' && selectedBodyName
        ? `${starName} System — ${selectedBodyName}`
        : `${starName} System`

  return <span className="location-label">{text}</span>
}
