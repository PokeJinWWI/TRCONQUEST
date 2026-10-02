// Runs the economy off the main thread (economy/economyWorker.ts), so a month's
// tick never blocks a frame:
//   - the four nations' advance is a request to the worker (state in, state out;
//     ~300 KB each way), answered as a promise;
//   - the 20 empires' simulation is RESIDENT in the worker (economy/empireSim.ts):
//     advanced alongside, never posted back whole, reporting small summaries to
//     `onEmpireUpdate` and one empire in full on demand (`requestEmpireSnapshot`).
// Where there is no Worker (the Node tests, headless runs) `runOffThread` returns
// null, the caller runs the same pure function inline and the empire simulation
// runs in-process (`advanceEmpiresInline`). One request at a time: the store
// queues the rest (economyStore.advance).
import type { EconomyStepInput, EconomyStepOutput } from '../economy/economyStep'
import { EmpireSim, type EmpireSnapshot, type EmpireUpdate } from '../economy/empireSim'
import type { WorkerRequest } from '../economy/economyWorker'

interface Pending {
  resolve: (value: never) => void
  reject: (error: Error) => void
}

// A stand-in for the worker's nations advance (tests drive the in-flight path
// with it: Node has no browser Worker). Absent = the real worker where there is one.
type Runner = (input: EconomyStepInput, empireSteps: number) => Promise<EconomyStepOutput>
let runner: Runner | null = null
export function setEconomyRunner(next: Runner | null): void {
  runner = next
}

let worker: Worker | null = null
// Set once the worker has failed: everything runs in-process from then on.
let workerBroken = false
let nextId = 0
const pending = new Map<number, Pending>()
let empireListener: ((update: EmpireUpdate) => void) | null = null
const inlineEmpires = new EmpireSim()

export function workerAvailable(): boolean {
  return !workerBroken && typeof Worker !== 'undefined' && typeof window !== 'undefined'
}

// Whoever shows the empires' numbers hears each month's update here.
export function onEmpireUpdate(listener: ((update: EmpireUpdate) => void) | null): void {
  empireListener = listener
}

function startWorker(): Worker {
  const w = new Worker(new URL('../economy/economyWorker.ts', import.meta.url), { type: 'module' })
  w.onmessage = (e: MessageEvent<{ type: string; id?: number; output?: EconomyStepOutput; update?: EmpireUpdate; snapshot?: EmpireSnapshot | null; error?: string }>) => {
    const msg = e.data
    if (msg.type === 'empires') {
      if (msg.update) empireListener?.(msg.update)
      return
    }
    const request = msg.id !== undefined ? pending.get(msg.id) : undefined
    if (!request) return
    pending.delete(msg.id!)
    if (msg.type === 'error') request.reject(new Error(msg.error))
    else request.resolve((msg.type === 'nations' ? msg.output : msg.snapshot) as never)
  }
  w.onerror = (e) => failAll(new Error(e.message || 'economy worker error'))
  return w
}

// A crashed worker takes the empire simulation resident in it down too: nothing
// that is in flight may wait forever, and the empires stop (the four nations carry
// on, inline) rather than restart from month 0 on the main thread.
function failAll(error: Error): void {
  console.warn('economy worker failed; the empire economies are stopped:', error.message)
  worker?.terminate()
  worker = null
  workerBroken = true
  const all = [...pending.values()]
  pending.clear()
  for (const p of all) p.reject(error)
}

function post(message: WorkerRequest): void {
  worker ??= startWorker()
  worker.postMessage(message)
}

// One advance of the four nations on the worker (and `empireSteps` months of the
// empires beside it); null when there is no Worker to use.
export function runOffThread(input: EconomyStepInput, empireSteps: number): Promise<EconomyStepOutput> | null {
  if (runner) return runner(input, empireSteps)
  if (!workerAvailable()) return null
  const id = ++nextId
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve: resolve as Pending['resolve'], reject })
    try {
      post({ type: 'advance', id, input, empireSteps })
    } catch (error) {
      pending.delete(id)
      failAll(error instanceof Error ? error : new Error(String(error)))
      reject(error instanceof Error ? error : new Error(String(error)))
    }
  })
}

export function startEmpires(): void {
  if (workerAvailable() && !runner) post({ type: 'empires-start' })
  else inlineEmpires.start()
}

export function stopEmpires(): void {
  if (worker) post({ type: 'empires-stop' })
  inlineEmpires.stop()
}

// The empire months, run in-process (no Worker): the update, or null if the
// empires are not running.
export function advanceEmpiresInline(steps: number): EmpireUpdate | null {
  return inlineEmpires.advance(steps)
}

export function empiresRunningInline(): boolean {
  return inlineEmpires.running
}

// One empire in full, as of the last month.
export function requestEmpireSnapshot(empireId: string): Promise<EmpireSnapshot | null> {
  if (!workerAvailable() || runner || inlineEmpires.running) return Promise.resolve(inlineEmpires.snapshot(empireId))
  const id = ++nextId
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve: resolve as Pending['resolve'], reject })
    post({ type: 'snapshot', id, empireId })
  })
}
