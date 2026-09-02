// The one place a ship's classId is turned into an actual ShipClass — every
// call site that used to do `SHIP_CLASSES.find((c) => c.id === classId)`
// directly now goes through here instead, so a player-built custom design
// (see shipDesignStore.ts) is visible everywhere a preset already was,
// without every one of those call sites needing to know the design store
// exists. Presets are checked first and are the overwhelmingly common case,
// so this stays as cheap as the old direct lookup for every existing hull.
import { SHIP_CLASSES, type ShipClass } from '../data/shipData'
import { HULL_CHASSES, designToShipClass } from '../data/hullChassis'
import { useShipDesignStore } from './shipDesignStore'

const DESIGN_ID_PREFIX = 'design:'

export function resolveShipClass(classId: string): ShipClass | null {
  const preset = SHIP_CLASSES.find((c) => c.id === classId)
  if (preset) return preset

  if (!classId.startsWith(DESIGN_ID_PREFIX)) return null
  const designId = classId.slice(DESIGN_ID_PREFIX.length)
  const design = useShipDesignStore.getState().designs.find((d) => d.id === designId)
  if (!design) return null
  const chassis = HULL_CHASSES.find((c) => c.id === design.chassisId)
  if (!chassis) return null
  return designToShipClass(design, chassis)
}
