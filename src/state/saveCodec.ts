// Turns store state into plain JSON and back. Pure.
//
// State is plain data, with three things JSON lacks: Set, Map and undefined.
//  - functions (a store's actions) are dropped;
//  - undefined fields are dropped (an absent field means the same to every reader);
//  - Set / Map are written as {"$set": [...]} / {"$map": [[k, v], ...]};
//  - anything else that is not plain data (a class instance, a Date, NaN,
//    Infinity) THROWS, naming the path, so a store that cannot be saved is found
//    by the round-trip test rather than saved wrongly.
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

export function encode(value: unknown, path = '$'): Json | undefined {
  if (value === undefined || typeof value === 'function') return undefined
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`save: non-finite number at ${path}`)
    return value
  }
  if (typeof value !== 'object') throw new Error(`save: unsupported ${typeof value} at ${path}`)
  if (Array.isArray(value)) return value.map((item, i) => encode(item, `${path}[${i}]`) ?? null)
  if (value instanceof Set) return { $set: [...value].map((item, i) => encode(item, `${path}{${i}}`) ?? null) }
  if (value instanceof Map) return { $map: [...value].map(([k, v], i) => [encode(k, `${path}<k${i}>`) ?? null, encode(v, `${path}<v${i}>`) ?? null]) }
  if (!isPlainObject(value)) throw new Error(`save: ${(value as object).constructor?.name ?? 'object'} instance at ${path} is not plain data`)
  const out: { [key: string]: Json } = {}
  for (const [key, item] of Object.entries(value)) {
    if (key === '$set' || key === '$map') throw new Error(`save: reserved key ${key} at ${path}`)
    const encoded = encode(item, `${path}.${key}`)
    if (encoded !== undefined) out[key] = encoded
  }
  return out
}

export function decode(json: Json): unknown {
  if (json === null || typeof json !== 'object') return json
  if (Array.isArray(json)) return json.map(decode)
  if ('$set' in json) return new Set((json.$set as Json[]).map(decode))
  if ('$map' in json) return new Map((json.$map as Json[][]).map(([k, v]) => [decode(k), decode(v)]))
  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(json)) out[key] = decode(item)
  return out
}

// Structural equality for round-trip checks (understands Set and Map).
export function sameData(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a === 'function' && typeof b === 'function') return true
  if (a === undefined || b === undefined) return a === b
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false
  if (a instanceof Set || b instanceof Set) {
    if (!(a instanceof Set) || !(b instanceof Set) || a.size !== b.size) return false
    return [...a].every((item) => b.has(item))
  }
  if (a instanceof Map || b instanceof Map) {
    if (!(a instanceof Map) || !(b instanceof Map) || a.size !== b.size) return false
    return [...a].every(([k, v]) => b.has(k) && sameData(v, b.get(k)))
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const keys = (o: object) => Object.keys(o).filter((k) => (o as Record<string, unknown>)[k] !== undefined && typeof (o as Record<string, unknown>)[k] !== 'function')
  const ka = keys(a)
  const kb = keys(b)
  if (ka.length !== kb.length) return false
  return ka.every((k) => sameData((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
}
