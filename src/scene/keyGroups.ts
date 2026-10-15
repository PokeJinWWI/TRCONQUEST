// The Ground panel's key-node list as groups (pure).
import { KEY_KIND_LABEL } from './keyNames'

// The key-node list as groups: by kind (each folded or open on its own), or one flat list ordered by name or by holder.
const KIND_ORDER = ['capital', 'city', 'spaceport', 'fortress', 'outpost'] as const
export function groupKeyNodes<T extends { kind: string; node: number }>(items: readonly T[], sort: 'type' | 'name' | 'holder', labelOf: (k: T) => string, holderName: (k: T) => string): { key: string; label: string | null; items: T[] }[] {
  const byName = (a: T, b: T) => labelOf(a).localeCompare(labelOf(b))
  if (sort === 'name') return [{ key: 'all', label: null, items: [...items].sort(byName) }]
  if (sort === 'holder') return [{ key: 'all', label: null, items: [...items].sort((a, b) => holderName(a).localeCompare(holderName(b)) || byName(a, b)) }]
  const kinds = [...new Set([...KIND_ORDER.filter((k) => items.some((i) => i.kind === k)), ...items.map((i) => i.kind)])]
  return kinds.map((kind) => ({ key: kind, label: KEY_KIND_LABEL[kind as keyof typeof KEY_KIND_LABEL] ?? kind, items: items.filter((i) => i.kind === kind).sort(byName) }))
}
