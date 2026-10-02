// The Web Worker entry: the economy off the main thread.
//
//   advance   one advance of the four nations' economy (EconomyStepInput in,
//             EconomyStepOutput back), then, if asked, the same number of months
//             of the RESIDENT empire simulation (empireSim.ts), whose small
//             summaries are posted as a separate message;
//   empires-start / empires-stop   the empire simulation's life;
//   snapshot  one empire in full, for whatever observes it.
//
// All the logic is economyStep.runEconomySteps and empireSim.EmpireSim; this file
// only moves messages, so the worker and the synchronous fallback cannot differ.
import { runEconomySteps, type EconomyStepInput } from './economyStep'
import { EmpireSim } from './empireSim'

export type WorkerRequest =
  | { type: 'advance'; id: number; input: EconomyStepInput; empireSteps: number }
  | { type: 'empires-start' }
  | { type: 'empires-stop' }
  | { type: 'snapshot'; id: number; empireId: string }

const scope = self as unknown as {
  onmessage: ((e: { data: WorkerRequest }) => void) | null
  postMessage: (message: unknown) => void
}
const empires = new EmpireSim()

scope.onmessage = (e) => {
  const req = e.data
  try {
    if (req.type === 'advance') {
      scope.postMessage({ type: 'nations', id: req.id, output: runEconomySteps(req.input) })
      const update = empires.advance(req.empireSteps)
      if (update) scope.postMessage({ type: 'empires', update })
    } else if (req.type === 'empires-start') empires.start()
    else if (req.type === 'empires-stop') empires.stop()
    else if (req.type === 'snapshot') scope.postMessage({ type: 'snapshot', id: req.id, snapshot: empires.snapshot(req.empireId) })
  } catch (error) {
    scope.postMessage({ type: 'error', id: 'id' in req ? req.id : -1, error: error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error) })
  }
}
