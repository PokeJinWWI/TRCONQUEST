import { DraggableWindow } from './DraggableWindow'
import { ComplexBuildingCard } from './BuildingsPanel'
import { useBuildingDetailStore } from '../state/buildingDetailStore'
import { useEconomyStore } from '../state/economyStore'
import { usePlayerStore } from '../state/playerStore'
import { RECIPES } from '../economy/recipes'

// The floating building-detail window opened from the Good Detail panel (or
// anywhere via buildingDetailStore). Finds the world + building + owner country
// from the live economy and shows the same ComplexBuildingCard the planet screen
// uses, in a draggable window.
export function BuildingDetailWindow() {
  const worldId = useBuildingDetailStore((s) => s.worldId)
  const buildingId = useBuildingDetailStore((s) => s.buildingId)
  const close = useBuildingDetailStore((s) => s.close)
  const worlds = useEconomyStore((s) => s.worlds)
  const countries = useEconomyStore((s) => s.countries)
  const playerId = usePlayerStore((s) => s.selectedCountryId)

  if (!worldId || !buildingId) return null
  const world = worlds.find((w) => w.id === worldId)
  const b = world?.buildings.find((x) => x.id === buildingId)
  if (!world || !b) return null
  const country = countries.find((c) => c.id === world.ownerId)
  const label = RECIPES[b.recipeId]?.label ?? b.recipeId

  return (
    <DraggableWindow title={`${label} — ${world.name}`} memoryKey="building" anchor="right" onClose={close}>
      <div className="econ-panel">
        <ComplexBuildingCard b={b} world={world} country={country} owned={!!playerId && world.ownerId === playerId} onClose={close} />
      </div>
    </DraggableWindow>
  )
}
