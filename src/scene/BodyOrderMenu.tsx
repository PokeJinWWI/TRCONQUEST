import { useCallback, useState, type ReactElement } from 'react'
import { ContextMenu, type ContextMenuItem } from './StarContextMenu'
import { lastPointerDown } from './dragGuard'
import { canColonize, orderSelectedToColonize } from './colonies'
import { resolveShipClass } from '../state/shipClassResolver'
import { isPlayerOwned } from '../state/shipRelations'
import { useShipStore } from '../state/shipStore'
import { bodyStarId } from './territory'
import { orderSelectedToSurvey } from './shipCommands'
import { isBodySurveyed } from './surveyLogic'
import { useSurveyStore } from '../state/surveyStore'
import { useTerritoryStore } from '../state/territoryStore'
import { SURVEY_DAYS_PER_BODY } from '../data/surveyData'

// Everything a right-click on a body offers beyond "Move to": Survey (Science
// Ships) and Colonize (Colony Ships). Empty when nothing selected can do either,
// and the scene then just moves.
export function bodyMenuItems(systemId: string, bodyName: string): ContextMenuItem[] {
  return [surveyMenuItem(bodyName), colonizeMenuItem(systemId, bodyName)].filter((i): i is ContextMenuItem => !!i)
}

// "Survey <body>" for the player's selected Science Ships, or null if none is
// selected: greyed out once the body is surveyed.
export function surveyMenuItem(bodyName: string): ContextMenuItem | null {
  const store = useShipStore.getState()
  const science = store.ships.filter((s) => store.selectedShipIds.includes(s.id) && isPlayerOwned(s) && resolveShipClass(s.classId)?.role === 'science')
  const starId = bodyStarId(bodyName)
  if (science.length === 0 || !starId) return null
  const owner = science[0].ownerId
  const done = isBodySurveyed(useSurveyStore.getState().discovered[owner], owner, bodyName, useTerritoryStore.getState().bodyOwner)
  return {
    label: `Survey ${bodyName}`,
    disabled: done,
    title: done ? `${bodyName} is already surveyed` : `Fly there and survey it (${SURVEY_DAYS_PER_BODY} days in orbit)`,
    onClick: () => orderSelectedToSurvey(starId, bodyName),
  }
}

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
    label: `Colonize ${bodyName}`,
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
