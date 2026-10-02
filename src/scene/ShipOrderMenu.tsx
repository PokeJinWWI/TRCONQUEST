import { useCallback, useState, type ReactElement } from 'react'
import { ContextMenu, type ContextMenuItem } from './StarContextMenu'
import { lastPointerDown } from './dragGuard'
import { canFollow } from './shipPhysics'
import { attackCheck, orderSelectedToAttack } from './aggressionOrders'
import { useShipStore } from '../state/shipStore'
import { useFleetStore } from '../state/fleetStore'

// What a right-click on another ship offers the selected one: Move (follow it,
// as a right-click always did) or Attack (any ship that isn't yours; see
// scene/aggression.ts). Attack is greyed out with the reason when it can't be done.
export function shipMenuItems(targetShipId: string): { title: string; items: ContextMenuItem[] } | null {
  const store = useShipStore.getState()
  const target = store.ships.find((s) => s.id === targetShipId)
  const selected = store.ships.find((s) => s.id === store.selectedShipId)
  if (!target || !selected || selected.id === target.id) return null
  const fleet = useFleetStore.getState().fleets.find((f) => f.id === target.fleetId)
  const fleetSize = store.ships.filter((s) => s.fleetId === target.fleetId).length
  const name = fleet && fleetSize > 1 ? fleet.name : target.name
  const follow = canFollow(selected, targetShipId)
  const attack = attackCheck(targetShipId)
  return {
    title: name,
    items: [
      {
        label: `Move to ${name}`,
        disabled: !follow,
        title: follow ? 'Follow it wherever it goes' : 'A ship cannot follow itself',
        onClick: () => store.setFollowing(selected.id, targetShipId),
      },
      {
        label: `Attack ${name}`,
        disabled: !attack.ok,
        title: attack.ok ? 'Chase it and open fire when they meet' : attack.reason,
        onClick: () => orderSelectedToAttack(targetShipId),
      },
    ],
  }
}

// A right-click menu for a ship marker, opened from a scene callback (no mouse
// event: it opens where the right-click went down).
export function useShipOrderMenu(): { open: (targetShipId: string) => void; element: ReactElement | null } {
  const [menu, setMenu] = useState<{ x: number; y: number; title: string; items: ContextMenuItem[] } | null>(null)
  const open = useCallback((targetShipId: string) => {
    const built = shipMenuItems(targetShipId)
    if (!built) return
    const at = lastPointerDown() ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 }
    setMenu({ x: at.x, y: at.y, ...built })
  }, [])
  const close = useCallback(() => setMenu(null), [])
  return { open, element: menu ? <ContextMenu x={menu.x} y={menu.y} title={menu.title} items={menu.items} onClose={close} /> : null }
}
