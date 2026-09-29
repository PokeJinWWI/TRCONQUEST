import { useCallback, useState, type ReactElement } from 'react'
import { ContextMenu, type ContextMenuItem } from './StarContextMenu'
import { lastPointerDown } from './dragGuard'
import { canColonize, colonyCostFor, orderSelectedToColonize } from './colonies'
import { resolveShipClass } from '../state/shipClassResolver'
import { isPlayerOwned } from '../state/shipRelations'
import { useShipStore } from '../state/shipStore'
import { bodyStarId } from './territory'

// "Colonize <body>" for the player's selected Colony Ships, or null if none is
// selected: greyed out with the reason when it can't be done now.
export function colonizeMenuItem(systemId: string, bodyName: string): ContextMenuItem | null {
  const store = useShipStore.getState()
  const colonists = store.ships.filter((s) => store.selectedShipIds.includes(s.id) && isPlayerOwned(s) && resolveShipClass(s.classId)?.role === 'colony')
  if (colonists.length === 0 || !bodyStarId(bodyName)) return null
  const checks = colonists.map((s) => canColonize(s, bodyName, { anywhere: true }))
  const ok = checks.find((c) => c.ok)
  const refused = checks.find((c) => !c.ok)
  return {
    label: `Colonize ${bodyName} (${ok?.ok ? ok.cost : colonyCostFor(colonists[0].ownerId, bodyName)} influence)`,
    disabled: !ok,
    title: ok ? 'Fly there and found a micro-colony with the settlers aboard' : refused && !refused.ok ? refused.reason : undefined,
    onClick: () => orderSelectedToColonize(systemId, bodyName),
  }
}

// A right-click menu for a body, opened from a scene callback (no mouse event:
// it opens where the right-click went down).
export function useBodyOrderMenu(): { open: (title: string, items: ContextMenuItem[]) => void; element: ReactElement | null } {
  const [menu, setMenu] = useState<{ x: number; y: number; title: string; items: ContextMenuItem[] } | null>(null)
  const open = useCallback((title: string, items: ContextMenuItem[]) => {
    const at = lastPointerDown() ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 }
    setMenu({ x: at.x, y: at.y, title, items })
  }, [])
  const close = useCallback(() => setMenu(null), [])
  return { open, element: menu ? <ContextMenu x={menu.x} y={menu.y} title={menu.title} items={menu.items} onClose={close} /> : null }
}
