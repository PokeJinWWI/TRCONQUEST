// How short of hands (positive) or short of work (negative) a nation is, -1..1, from the last month's labour reports (Complex mode;
// Simple mode reports 0). The AI's appetite for a migration treaty (scene/treaties.bundleCostForReceiver) and the Population tab read it.
import { useEconomyStore } from '../state/economyStore'
import { isAbstractEconomy } from '../state/playerStore'

export function labourPressureOf(nationId: string): number {
  if (isAbstractEconomy()) return 0
  const { worlds, worldReports } = useEconomyStore.getState()
  let jobs = 0
  let workers = 0
  for (const w of worlds) {
    if (w.ownerId !== nationId) continue
    const labor = worldReports[w.id]?.labor
    if (!labor) continue
    for (const [cls, l] of Object.entries(labor)) {
      if (cls === 'investor' || cls === 'subsistence') continue
      jobs += l.jobs
      workers += l.workers
    }
  }
  return workers > 0 ? Math.max(-1, Math.min(1, (jobs - workers) / workers)) : 0
}
