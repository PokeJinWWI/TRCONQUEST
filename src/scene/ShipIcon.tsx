import type { CSSProperties, MouseEventHandler } from 'react'
import { resolveShipClass } from '../state/shipClassResolver'
import type { ShipClass } from '../data/shipData'

// A ship's map icon: its silhouette says what it is, its colour says whose it
// is (relation to the player). Warships are the triangle; each civilian role
// has its own shape so a science ship, a hauler and a builder read apart at a
// glance. Shapes are clip-paths in App.css (.ship-role-*), drawn on an inner
// span so the glow (a filter on the outer one) isn't clipped away.
export type ShipRole = ShipClass['role']

// What the shape/legend says each role is (also the tooltip).
export const SHIP_ROLE_SHAPES: Record<ShipRole, string> = {
  warship: 'Triangle: warship',
  transport: 'Arrowhead: troop transport',
  civilian: 'Circle: civilian ship',
  science: 'Diamond: science ship',
  construction: 'Hexagon: construction ship',
  cargo: 'Bar: cargo ship',
  colony: 'House: colony ship',
}

export function roleOfClass(classId: string): ShipRole {
  return resolveShipClass(classId)?.role ?? 'warship'
}

// Icon pixel sizes per view: bigger where ships are small on the map and hard to
// hit (interstellar space), the plain size inside a system.
export const SHIP_ICON_SIZE = { system: 10, interstellar: 14 } as const

export function ShipIcon({
  role,
  color,
  size = SHIP_ICON_SIZE.system,
  inline = false,
  onClick,
}: {
  role: ShipRole
  color: string
  size?: number
  // In the flow of a line of text (a presence badge) rather than hung off a marker.
  inline?: boolean
  onClick?: MouseEventHandler<HTMLSpanElement>
}) {
  return (
    <span
      className={`ship-marker-icon ship-role-${role}${inline ? ' inline' : ''}`}
      style={{ '--ship-color': color, '--ship-size': `${size}px` } as CSSProperties}
      data-tooltip={SHIP_ROLE_SHAPES[role]}
      onClick={onClick}
    >
      <span className="ship-shape" />
    </span>
  )
}
