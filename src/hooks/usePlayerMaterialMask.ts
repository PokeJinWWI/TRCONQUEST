import { useMemo } from 'react'
import { obfuscateMaterials, type MaterialId } from '../data/materials'
import { useMaterialStore } from '../state/materialStore'
import { usePlayerStore } from '../state/playerStore'

// The research UI's text filter: names an undiscovered material "???" (data/
// materials.obfuscateMaterials). Player only and the research UI only: every other
// screen, and the AI, read the real names. The sandbox masks nothing.
export function usePlayerMaterialMask(): (text: string) => string {
  const playerId = usePlayerStore((s) => s.selectedCountryId)
  const sandbox = usePlayerStore((s) => s.sandbox)
  // A joined string, not the array: a primitive does not re-render on every store write.
  const key = useMaterialStore((s) => (playerId ? (s.discovered[playerId] ?? []).join(',') : ''))
  return useMemo(() => {
    if (!playerId || sandbox) return (text: string) => text
    const found = new Set(key.split(',').filter(Boolean) as MaterialId[])
    return (text: string) => obfuscateMaterials(text, found)
  }, [playerId, sandbox, key])
}
