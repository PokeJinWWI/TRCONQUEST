// International organizations: a composable blend of Stellaris federations
// (democratic, can share a fleet command) and Vic3 power blocs (authoritarian,
// economic integration). Real-world analogues (EU/NATO/UN/WTO/OIF) are just
// PRESETS built from the same small set of pillars, not separate systems —
// a custom org can mix pillars freely. See state/internationalOrgStore.ts for
// the live state.

export type OrgPillar =
  | 'economic-market' // members trade with each other tariff-free (see tradePolicyStore's inSharedMarket)
  | 'common-external-tariff' // members share one tariff schedule toward non-members
  | 'defense-pact' // an attack on one member is a call to arms for the rest
  | 'joint-command' // (needs defense-pact) a member may delegate its fleets to the org leader
  | 'political-forum' // opinion bonus among members; weighs in AI war/peace evaluation; mediation
  | 'cultural' // minor opinion/relations bonus only

export type AuthorityModel = 'democratic' | 'authoritarian' | 'hybrid'

export interface OrgPreset {
  id: string
  name: string
  pillars: OrgPillar[]
  authorityModel: AuthorityModel
}

export const ORG_PRESETS: OrgPreset[] = [
  { id: 'common-market', name: 'Common Market (EU-style)', pillars: ['economic-market', 'political-forum'], authorityModel: 'democratic' },
  { id: 'defense-alliance', name: 'Defense Alliance (NATO-style)', pillars: ['defense-pact', 'joint-command'], authorityModel: 'hybrid' },
  { id: 'assembly', name: 'Assembly (UN-style)', pillars: ['political-forum'], authorityModel: 'democratic' },
  { id: 'trade-organization', name: 'Trade Organization (WTO-style)', pillars: ['economic-market', 'common-external-tariff'], authorityModel: 'democratic' },
  { id: 'cultural-union', name: 'Cultural Union (OIF-style)', pillars: ['cultural'], authorityModel: 'democratic' },
  { id: 'power-bloc', name: 'Power Bloc', pillars: ['economic-market', 'common-external-tariff', 'defense-pact', 'joint-command'], authorityModel: 'authoritarian' },
  { id: 'custom', name: 'Custom Organization', pillars: [], authorityModel: 'hybrid' },
]

export function getOrgPreset(id: string): OrgPreset {
  return ORG_PRESETS.find((p) => p.id === id) ?? ORG_PRESETS[ORG_PRESETS.length - 1]
}

export interface InternationalOrg {
  id: string
  presetId: string
  name: string
  leaderId: string
  memberIds: string[]
  pillars: OrgPillar[]
  authorityModel: AuthorityModel
  foundedSimDays: number
  // memberId -> has this member delegated its fleets to the leader's command.
  // Only meaningful with the joint-command pillar; absent/false = no change
  // to that member's command (opt-in, default off).
  delegatedCommand: Record<string, boolean>
}

// Opinion bonus applied between two members of a shared political-forum or
// cultural org, per tick that AI opinion drift runs (diplomat.ts).
export const POLITICAL_FORUM_OPINION_BONUS = 4
export const CULTURAL_OPINION_BONUS = 2
