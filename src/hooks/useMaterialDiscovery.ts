import { useEffect } from 'react'
import { depositBodies } from '../data/deposits'
import { discoveredMaterials } from '../data/materials'
import { isBodySurveyed } from '../scene/surveyLogic'
import { usePlayerStore } from '../state/playerStore'
import { useMaterialStore } from '../state/materialStore'
import { useResourceStore } from '../state/resourceStore'
import { useSurveyStore } from '../state/surveyStore'
import { useTerritoryStore } from '../state/territoryStore'

// Latches the materials the player's nation has discovered (data/materials.ts): it
// has surveyed a body that holds one (the survey layer the player's UI reads, plus
// every body of a system it owns a part of), or holds any in its stockpile. One pass,
// exported so a headless test can drive it without React. The sandbox has no
// nations, so nothing is discovered there (and nothing is masked: see
// hooks/usePlayerMaterialMask.ts).
export function resolveMaterialDiscovery(nationId: string): void {
  const known = useSurveyStore.getState().known[nationId]
  const owners = useTerritoryStore.getState().bodyOwner
  const stock = useResourceStore.getState().stateFor(nationId).amounts
  const found = discoveredMaterials((body) => isBodySurveyed(known, nationId, body, owners), (id) => stock[id] ?? 0, depositBodies())
  if (found.length > 0) useMaterialStore.getState().discover(nationId, found)
}

function resolvePlayer(): void {
  const { selectedCountryId, sandbox } = usePlayerStore.getState()
  if (selectedCountryId && !sandbox) resolveMaterialDiscovery(selectedCountryId)
}

export function useMaterialDiscovery() {
  useEffect(() => {
    resolvePlayer()
    const unsubs = [usePlayerStore.subscribe(resolvePlayer), useResourceStore.subscribe(resolvePlayer), useSurveyStore.subscribe(resolvePlayer), useTerritoryStore.subscribe(resolvePlayer)]
    return () => unsubs.forEach((u) => u())
  }, [])
}
