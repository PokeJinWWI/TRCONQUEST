import { useMemo } from 'react'
import { depositBodies } from '../data/deposits'
import { extractionRatePerMonth, type Yield } from '../scene/extraction'
import { controllerOf } from '../scene/territory'
import { useDepositStore } from '../state/depositStore'
import { usePlayerStore } from '../state/playerStore'
import { useTechStore } from '../state/techStore'
import { useTerritoryStore } from '../state/territoryStore'

const NONE: ReadonlySet<string> = new Set()

// What the player's nation draws a month from the deposits it holds, per material,
// and the deposit bodies it holds (for the HUD's "/mo" and the resource windows).
export function usePlayerExtraction(): { rate: Yield; held: string[] } {
  const playerId = usePlayerStore((s) => s.selectedCountryId)
  const owners = useTerritoryStore((s) => s.bodyOwner)
  const controllers = useTerritoryStore((s) => s.bodyController)
  const remaining = useDepositStore((s) => s.remaining)
  const techs = useTechStore((s) => (playerId ? s.stateFor(playerId).researched : NONE))
  return useMemo(() => {
    const held = playerId ? depositBodies().filter((b) => owners[b] === playerId && controllerOf(b, owners, controllers) === playerId) : []
    return { rate: extractionRatePerMonth(remaining, held, techs), held }
  }, [playerId, owners, controllers, remaining, techs])
}
