// The Developer: the strategic AI's seventh agent. It keeps what the empire has already built working and
// safe: it joins cut-off sites to their hubs, puts a defense platform over a world an enemy fleet is leaning
// on, and gives an overcrowded world a second settlement. Like every agent it is a pure function that returns
// intents; the executor carries them out through the player's own rules (scene/aiDevelopment.ts), so the AI
// pays what the player pays and is refused what the player is refused.
import type { AiSnapshot, Blackboard } from './blackboard'
import type { AgentOutput } from './types'

// At most this many of each kind of job per planning pass.
const MAX_CONNECTIONS_PER_PASS = 1
const MAX_PLATFORMS_PER_PASS = 1
const MAX_SETTLEMENTS_PER_PASS = 1
// A site this well connected is left alone.
export const AI_CONNECTED_ENOUGH = 0.9

export function developer(bb: Blackboard, snap: AiSnapshot): AgentOutput {
  const dev = snap.development
  if (!dev) return { intents: [] }
  const id = bb.countryId
  const intents: AgentOutput['intents'] = []
  // The worst-off site first: the freight it loses is what a road would give back.
  for (const site of dev.isolatedSitesOf(id).filter((s) => s.access < AI_CONNECTED_ENOUGH).slice(0, MAX_CONNECTIONS_PER_PASS)) intents.push({ kind: 'connect-site', siteId: site.siteId })
  for (const body of dev.threatenedBodiesOf(id).slice(0, MAX_PLATFORMS_PER_PASS)) intents.push({ kind: 'build-defense-platform', bodyName: body })
  for (const siteId of dev.settlementOpeningsOf(id).slice(0, MAX_SETTLEMENTS_PER_PASS)) intents.push({ kind: 'found-settlement', siteId })
  return { intents }
}
