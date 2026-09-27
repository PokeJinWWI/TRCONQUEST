import { CITY_NAMES, type CityName } from '../data/cityNames'
import { getCountry } from '../data/countryData'
import { seedBodyOwners } from './territory'
import { arc, nodePoint, surfaceMesh } from './surfaceMesh'
import { lonLatOf } from './mapProjection'
import { regionAt } from './bodyTopography'
import type { BodySurface, KeySlot } from './planetTerrain'

// Names and roles for a world's key nodes. A world's cities are named from its
// FOUNDING nation's list (data/cityNames.ts; its capital from the country's
// capitalCityName), so a conquered city keeps its name. Deterministic per
// world; a nation without a list (the sandbox factions, the unowned) keeps the
// plain kind labels.

export const KEY_KIND_LABEL: Record<KeySlot['kind'], string> = { capital: 'Capital', city: 'City', spaceport: 'Spaceport', outpost: 'Outpost', fortress: 'Fortress' }

// What a key node does for whoever holds it — the ground war's rules
// (groundResolution.ts, groundLogic.ts), in a line.
export const KEY_ROLE: Record<KeySlot['kind'], string> = {
  capital: 'The seat of government. Hold every key node, with no enemy on any, to take the world.',
  city: 'A city. Hold every key node, with no enemy on any, to take the world.',
  spaceport: 'Where new armies raised here muster. Hold every key node to take the world.',
  outpost: 'The settlement on this body. Hold it, with no enemy on it, to take the body.',
  fortress: 'A fortress: a key node of its own, and its holder’s units near it defend much better.',
}
export const KEY_HOLD_BONUS = 'Units standing on a key node their nation holds defend 25% better.'

export interface KeyName {
  name: string | null // the place's own name, when it has one
  native?: string // in its own script (Mars's kanji)
  label: string // what to show: "Akakyō (capital)", "Kythera Spaceport", "Rakuyō", or the kind
}

let founders: Record<string, string> | null = null
const founderOf = (bodyName: string) => (founders ??= seedBodyOwners())[bodyName]

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

const cache = new Map<string, Map<number, KeyName>>()

// Every key node's name on this surface.
export function keyNamesOf(surface: BodySurface): Map<number, KeyName> {
  const key = `${surface.bodyName}|${surface.keySlots.map((k) => `${k.node}${k.kind[0]}${k.name ?? ''}${k.site ?? ''}`).join(',')}`
  const hit = cache.get(key)
  if (hit) return hit
  const out = new Map<number, KeyName>()
  const nation = founderOf(surface.bodyName)
  const country = nation ? getCountry(nation) : undefined
  const list: CityName[] = (nation && CITY_NAMES[nation]) || []
  const capitalName = country?.capitalBodyName === surface.bodyName ? country.capitalCityName : undefined
  const pool = list.filter((c) => c.name !== capitalName)
  let next = pool.length > 0 ? hash(surface.bodyName) % pool.length : 0
  const take = (): CityName | null => {
    if (pool.length === 0) return null
    const c = pool[next % pool.length]
    next++
    return c
  }
  // Settlements first (so the names don't shift if a fortress or another
  // spaceport is added later).
  for (const slot of surface.keySlots) {
    if (slot.kind === 'fortress' || slot.site) continue
    if (slot.kind === 'capital' && capitalName) {
      out.set(slot.node, { name: capitalName, native: country?.capitalCityNative, label: `${capitalName} (capital)` })
      continue
    }
    const c = take()
    if (!c) {
      out.set(slot.node, { name: null, label: KEY_KIND_LABEL[slot.kind] })
      continue
    }
    const label = slot.kind === 'spaceport' ? `${c.name} Spaceport` : slot.kind === 'outpost' ? `${c.name} Outpost` : slot.kind === 'capital' ? `${c.name} (capital)` : c.name
    out.set(slot.node, { name: c.name, native: c.native, label })
  }
  // A fortress is named for the settlement it guards (the nearest).
  for (const slot of surface.keySlots) {
    if (slot.kind !== 'fortress') continue
    if (slot.name) {
      out.set(slot.node, { name: slot.name, label: slot.name })
      continue
    }
    const guarded = nearestSettlement(surface, slot.node, Infinity)
    const name = guarded ? out.get(guarded.node)?.name : null
    out.set(slot.node, { name: null, label: name ? `${name} Fortress` : KEY_KIND_LABEL.fortress })
  }
  // The world's other spaceports: named for the settlement they serve and the
  // direction they lie from it ("Akakyō North Spaceport"), a strategic outlier
  // for its region ("Tharsis Launch Complex"); a numeral where one repeats.
  const used = new Set([...out.values()].map((n) => n.label))
  const unique = (label: string) => {
    let l = label
    for (let n = 2; used.has(l); n++) l = `${label} ${ROMAN[n] ?? n}`
    used.add(l)
    return l
  }
  for (const slot of surface.keySlots) {
    if (!slot.site) continue
    const region = slot.site === 'outlier' ? regionAt(surface.bodyName, slot.node) : null
    if (region) {
      out.set(slot.node, { name: null, label: unique(`${region} Launch Complex`) })
      continue
    }
    const near = nearestSettlement(surface, slot.node, Infinity)
    const town = near ? out.get(near.node)?.name : null
    out.set(slot.node, { name: null, label: unique(town && near ? `${town} ${compass(near.node, slot.node)} Spaceport` : KEY_KIND_LABEL.spaceport) })
  }
  cache.set(key, out)
  return out
}

const ROMAN: Record<number, string> = { 2: 'II', 3: 'III', 4: 'IV', 5: 'V', 6: 'VI' }

// Which way `to` lies from `from`, as one of eight compass points.
function compass(from: number, to: number): string {
  const a = lonLatOf(nodePoint(from))
  const b = lonLatOf(nodePoint(to))
  let dLon = b.lon - a.lon
  if (dLon > Math.PI) dLon -= 2 * Math.PI
  if (dLon < -Math.PI) dLon += 2 * Math.PI
  const angle = Math.atan2(b.lat - a.lat, dLon * Math.cos((a.lat + b.lat) / 2))
  const names = ['East', 'Northeast', 'North', 'Northwest', 'West', 'Southwest', 'South', 'Southeast']
  return names[((Math.round(angle / (Math.PI / 4)) % 8) + 8) % 8]
}

export function keyNameOf(surface: BodySurface, slot: Pick<KeySlot, 'node' | 'kind'>): KeyName {
  return keyNamesOf(surface).get(slot.node) ?? { name: null, label: KEY_KIND_LABEL[slot.kind] }
}

// The settlement (not a fortress) nearest a node, within `maxCells` map cells.
export function nearestSettlement(surface: BodySurface, node: number, maxCells: number): KeySlot | null {
  const cell = surfaceMesh().fineSpacingRad
  let best: KeySlot | null = null
  let bestD = Infinity
  for (const k of surface.keySlots) {
    if (k.kind === 'fortress' || k.site) continue
    const d = arc(nodePoint(k.node), nodePoint(node)) / cell
    if (d <= maxCells && d < bestD) {
      best = k
      bestD = d
    }
  }
  return best
}

// Which city a stretch of urban ground belongs to (its key node's name), or null.
export function cityOfNode(surface: BodySurface, node: number): KeyName | null {
  const k = nearestSettlement(surface, node, 2.6)
  return k ? keyNameOf(surface, k) : null
}
