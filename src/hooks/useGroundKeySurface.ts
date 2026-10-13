import { useMemo, useRef } from 'react'
import { useTerritoryStore } from '../state/territoryStore'
import { groundPortSurface, useDefenseStore } from '../state/defenseStore'
import { useGameTimeStore } from '../state/gameTimeStore'
import { useEconomyStore } from '../state/economyStore'
import { useAbstractEconomyStore } from '../state/abstractEconomyStore'
import { useColonyStore } from '../state/colonyStore'
import { useLocationStore } from '../state/locationStore'
import { usePlacementStore } from '../state/placementStore'
import { useStructureStore } from '../state/structureStore'
import { useZoneStore } from '../state/zoneStore'
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
  // What the districts drawn on the ground depend on (scene/footprintState) and the ports the player placed.
  const placed = usePlacementStore((s) => s.placed)
  const levels = usePlacementStore((s) => s.levels)
  const seeded = usePlacementStore((s) => s.seeded[bodyName])
  const zones = useZoneStore((s) => s.zones)
  const reserves = useZoneStore((s) => s.reserves)
  const custom = useLocationStore((s) => s.custom)
  const established = useLocationStore((s) => s.established)
  const ports = useStructureStore((s) => s.ports[bodyName])
  const activeKey = useGameTimeStore((t) =>
    installations
      .filter((i) => i.bodyName === bodyName && isActive(i, t.simDays))
      .map((i) => i.id)
      .join(),
  )
  const prev = useRef<BodySurface | null>(null)
  const next = useMemo(() => {
    const surface = groundPortSurface(bodyName, owners)
    if (!surface || !withInstallations || installations.length === 0) return surface
    return withInstallationKeys(surface, installations, useGameTimeStore.getState().simDays)
  }, [bodyName, owners, complexWorlds, simpleWorld, installations, activeKey, withInstallations, outpostNode, placed, levels, seeded, zones, reserves, custom, established, ports])
  // The same ground is the same object: the economy's month (and many other inputs above) rebuild the surface with nothing on
  // the ground changed, and every new object makes the globe recolour all of its nodes.
  if (next && prev.current && sameGround(prev.current, next)) return prev.current
  prev.current = next
  return next
}

const slotSig = (s: BodySurface) => s.keySlots.map((k) => `${k.node}${k.kind}${k.name ?? ''}${k.site ?? ''}${k.operator ?? ''}`).join(',')
function sameGround(a: BodySurface, b: BodySurface): boolean {
  return a === b || (a.bodyName === b.bodyName && a.terrain === b.terrain && a.landValue === b.landValue && slotSig(a) === slotSig(b))
}
