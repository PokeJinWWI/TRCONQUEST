// Where saves are kept: named slots in the browser's IndexedDB, and files the
// player downloads / loads (`.trsave.json.gz`). The save itself is state/saveGame's
// plain `SaveFile`; this file only packs it (gzip where the browser can) and stores it.
import { SAVE_FORMAT, SaveError, type SaveFile } from './saveGame'

export const SAVE_EXTENSION = '.trsave.json.gz'

export interface SlotInfo {
  id: string
  label: string
  savedAt: string
  bytes: number
}

const gzipOk = () => typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined'

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream as unknown as ReadableWritablePair<Uint8Array, Uint8Array>))
  return new Uint8Array(await out.arrayBuffer())
}

// JSON text -> bytes, gzipped when the browser can.
export async function packSave(file: SaveFile): Promise<Uint8Array> {
  const raw = new TextEncoder().encode(JSON.stringify(file))
  return gzipOk() ? pipe(raw, new CompressionStream('gzip')) : raw
}

// Bytes (gzipped or plain JSON, told apart by the gzip magic number) -> a checked SaveFile.
export async function unpackSave(bytes: Uint8Array): Promise<SaveFile> {
  const zipped = bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b
  if (zipped && !gzipOk()) throw new SaveError('This browser cannot open compressed saves.')
  const raw = zipped ? await pipe(bytes, new DecompressionStream('gzip')) : bytes
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder().decode(raw))
  } catch {
    throw new SaveError('The save file is damaged (not valid JSON).')
  }
  if (!parsed || typeof parsed !== 'object' || (parsed as { format?: unknown }).format !== SAVE_FORMAT) throw new SaveError('This is not a Terra Relicta save file.')
  return parsed as SaveFile
}

// ---- IndexedDB slots ----------------------------------------------------------

const DB_NAME = 'trconquest'
const META = 'saveMeta'
const DATA = 'saveData'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new SaveError('This browser has no save storage.'))
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      req.result.createObjectStore(META, { keyPath: 'id' })
      req.result.createObjectStore(DATA)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(new SaveError(req.error?.message ?? 'Could not open save storage.'))
  })
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(new SaveError(tx.error?.message ?? 'Save storage failed.'))
    tx.onabort = () => reject(new SaveError(tx.error?.message ?? 'Save storage was full or blocked.'))
  })
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(new SaveError(req.error?.message ?? 'Save storage failed.'))
  })
}

export async function listSlots(): Promise<SlotInfo[]> {
  const db = await openDb()
  const all = await request(db.transaction(META).objectStore(META).getAll() as IDBRequest<SlotInfo[]>)
  db.close()
  return all.sort((a, b) => b.savedAt.localeCompare(a.savedAt))
}

// Writes (or overwrites) slot `id`.
export async function writeSlot(id: string, file: SaveFile): Promise<void> {
  const bytes = await packSave(file)
  const db = await openDb()
  const tx = db.transaction([META, DATA], 'readwrite')
  tx.objectStore(DATA).put(bytes, id)
  tx.objectStore(META).put({ id, label: file.label, savedAt: file.savedAt, bytes: bytes.length } satisfies SlotInfo)
  await done(tx)
  db.close()
}

export async function readSlot(id: string): Promise<SaveFile> {
  const db = await openDb()
  const bytes = await request(db.transaction(DATA).objectStore(DATA).get(id) as IDBRequest<Uint8Array | undefined>)
  db.close()
  if (!bytes) throw new SaveError('That save slot is empty.')
  return unpackSave(bytes)
}

export async function deleteSlot(id: string): Promise<void> {
  const db = await openDb()
  const tx = db.transaction([META, DATA], 'readwrite')
  tx.objectStore(DATA).delete(id)
  tx.objectStore(META).delete(id)
  await done(tx)
  db.close()
}

// ---- Files --------------------------------------------------------------------

export async function downloadSave(file: SaveFile, name: string): Promise<void> {
  const bytes = await packSave(file)
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/gzip' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `${name.replace(/[^\w.-]+/g, '_')}${SAVE_EXTENSION}`
  a.click()
  URL.revokeObjectURL(url)
}

export async function readSaveFile(file: File): Promise<SaveFile> {
  return unpackSave(new Uint8Array(await file.arrayBuffer()))
}
