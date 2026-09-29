import { useMemo } from 'react'
import { useTerritoryStore } from '../state/territoryStore'
import { groundPortSurface, useDefenseStore } from '../state/defenseStore'
import { useGameTimeStore } from '../state/gameTimeStore'
import { useEconomyStore } from '../state/economyStore'
import { useAbstractEconomyStore } from '../state/abstractEconomyStore'
import { useColonyStore } from '../state/colonyStore'
import { isActive, withInstallationKeys } from '../scene/defenseLogic'
import type { BodySurface } from '../scene/planetTerrain'

// A world's ground map with every key node the war recognises, for the UI:
// the terrain's, the economy's spaceports and the installations' (the same
// surface as state/defenseStore.groundKeySurface). Re-derived only when one of
// those changes: owners, the world's economy (monthly), or which installations
// are active. `withInstallations: false` gives the terrain + spaceports only.
export function useGroundKeySurface(bodyName: string, withInstallations = true): BodySurface | null {
  const owners = useTerritoryStore((s) => s.bodyOwner)
  const complexWorlds = useEconomyStore((s) => s.worlds)
  const simpleWorld = useAbstractEconomyStore((s) => s.worlds[bodyName])
  const installations = useDefenseStore((s) => s.installations)
  const outpostNode = useColonyStore((s) => s.colonies[bodyName]?.outpostNode)
  const activeKey = useGameTimeStore((t) =>
    installations
      .filter((i) => i.bodyName === bodyName && isActive(i, t.simDays))
      .map((i) => i.id)
      .join(),
  )
  return useMemo(() => {
    const surface = groundPortSurface(bodyName, owners)
    if (!surface || !withInstallations || installations.length === 0) return surface
    return withInstallationKeys(surface, installations, useGameTimeStore.getState().simDays)
  }, [bodyName, owners, complexWorlds, simpleWorld, installations, activeKey, withInstallations, outpostNode])
}
