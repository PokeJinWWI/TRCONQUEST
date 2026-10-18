import { UNCONTACTED_AT_START } from '../data/contactData'
import { pairKey } from '../data/diplomacyData'

// First contact between nations (pure). A pair is in contact if neither of them starts out
// uncontacted (data/contactData.ts), or once they have met: each had a ship, a Starbase or a
// world in the same star system. Contact is permanent and pairwise: meeting Mars tells Jinshan
// nothing about Venus.

export function inContact(a: string, b: string, met: ReadonlySet<string>): boolean {
  if (a === b) return true
  if (!UNCONTACTED_AT_START.includes(a) && !UNCONTACTED_AT_START.includes(b)) return true
  return met.has(pairKey(a, b))
}

// One nation present in one star system: a ship there, a Starbase there, or a world it owns there.
export interface Presence {
  starId: string
  nation: string
}

// Every nation in each system.
export function presenceBySystem(entries: readonly Presence[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  for (const e of entries) {
    const here = out.get(e.starId)
    if (here) here.add(e.nation)
    else out.set(e.starId, new Set([e.nation]))
  }
  return out
}

export interface NewContact {
  a: string
  b: string
  starId: string
}

// The pairs that meet for the first time: two nations in one system who are not yet in contact. Each pair once,
// at the first system (in id order) where it is found.
export function newContacts(presence: ReadonlyMap<string, ReadonlySet<string>>, met: ReadonlySet<string>): NewContact[] {
  const found = new Map<string, NewContact>()
  for (const starId of [...presence.keys()].sort()) {
    const here = [...(presence.get(starId) ?? [])].sort()
    for (let i = 0; i < here.length; i++)
      for (let j = i + 1; j < here.length; j++) {
        if (inContact(here[i], here[j], met)) continue
        const key = pairKey(here[i], here[j])
        if (!found.has(key)) found.set(key, { a: here[i], b: here[j], starId })
      }
  }
  return [...found.values()]
}

// Every pair of the given nations that is NOT in contact, as pairKeys.
export function uncontactedPairs(nations: readonly string[], met: ReadonlySet<string>): string[] {
  const out: string[] = []
  for (let i = 0; i < nations.length; i++)
    for (let j = i + 1; j < nations.length; j++) if (!inContact(nations[i], nations[j], met)) out.push(pairKey(nations[i], nations[j]))
  return out
}
