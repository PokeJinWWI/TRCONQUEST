import { useTechStore, DEFAULT_RESEARCHED } from '../src/state/techStore'

// Nations start with Hyper Comms (zero delay). Tests about signal delay put the
// four nations on Warp Comms instead.
export function warpCommsOnly(): void {
  const researched = () => new Set([...DEFAULT_RESEARCHED.filter((t) => t !== 'hyper-comms'), 'warp-comms'])
  const state = () => ({ researchPoints: { physics: 0, society: 0, engineering: 0 }, researched: researched() })
  useTechStore.setState({ byCountry: Object.fromEntries(['imperial-state-of-mars', 'republic-of-venus', 'orion-republic', 'kingdom-of-lalande'].map((id) => [id, state()])) })
}
