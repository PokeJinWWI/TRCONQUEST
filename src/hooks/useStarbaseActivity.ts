import { useGameTimeStore } from '../state/gameTimeStore'
import { useStarbaseStore } from '../state/starbaseStore'
import { starbaseActivityKey } from '../scene/starbaseLogic'

// Re-renders only when a Starbase finishes building (or is lost) — never on
// every clock tick. A view that needs Starbase claims reads this, and reads
// the clock through getState() inside the computation it guards, not through a
// simDays subscription: subscribing a whole scene to simDays re-rendered every
// star, border and marker on it 60 times a second.
export function useStarbaseActivityKey(): string {
  const starbases = useStarbaseStore((s) => s.starbases)
  return useGameTimeStore((s) => starbaseActivityKey(starbases, s.simDays))
}
