// A click on a tech in the Sandbox (Technology panel and tree view): flips it for every sandbox faction
// (techStore.toggleTech). Un-researching something other techs stand on asks first, naming what goes with it.
import { SANDBOX_PLAYER_ID } from '../data/countryRoster'
import { findTech, unresearchEffects, unresearchPlan } from '../data/techData'
import { useConfirmStore } from '../state/confirmStore'
import { useTechStore } from '../state/techStore'

export function requestToggleTech(nodeId: string): void {
  const store = useTechStore.getState()
  const plan = unresearchPlan(nodeId, store.stateFor(SANDBOX_PLAYER_ID).researched)
  const effects = unresearchEffects(plan)
  if (effects.length === 0) {
    store.toggleTech(nodeId)
    return
  }
  useConfirmStore.getState().requestConfirm({
    title: `Un-research ${findTech(nodeId)?.name ?? nodeId}?`,
    effects: [...effects, 'Ships, designs and buildings already made are kept; new ones that need these techs are blocked until they are researched again.'],
    confirmLabel: 'Un-research',
    onConfirm: () => useTechStore.getState().toggleTech(nodeId),
  })
}
