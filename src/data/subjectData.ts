// Subject nations: a suzerain-subject relationship short of annexation. Does
// NOT change territory ownership (bodyOwner is untouched) — it constrains the
// subject's own foreign policy and, for tributary/client-state, ties an
// ongoing payment. See state/subjectStore.ts for the live state.

export type SubjectType = 'vassal' | 'protectorate' | 'tributary' | 'client-state' | 'autonomous-region'

export interface Subjection {
  suzerainId: string
  subjectId: string
  type: SubjectType
  sinceSimDays: number
  // False (default): the subject is folded into the suzerain's market — no
  // tariffs between them (see inSharedMarket in state/tradePolicyStore.ts).
  // True: the suzerain has granted it a separate market of its own.
  separateMarket: boolean
}

// Whether this subject type binds the subject to the suzerain's wars and
// forbids it from declaring war or joining an international organization on
// its own. Vassals have no independent foreign policy; everyone looser does.
export function bindsForeignPolicy(type: SubjectType): boolean {
  return type === 'vassal'
}

// Whether this subject type owes the suzerain a recurring tribute payment.
export function paysTribute(type: SubjectType): boolean {
  return type === 'vassal' || type === 'tributary'
}

// Tribute as a share of the subject's monthly tax revenue, by type.
export const TRIBUTE_SHARE: Record<SubjectType, number> = {
  vassal: 0.25,
  protectorate: 0,
  tributary: 0.15,
  'client-state': 0,
  'autonomous-region': 0,
}

// A subject offer is accepted when the suzerain's power over the target
// exceeds this multiple (mirrors evaluatePeace's threshold-based acceptance).
export const SUBJECT_OFFER_MIN_POWER_RATIO = 2.5
// ...and the target doesn't already dislike the suzerain past this opinion.
export const SUBJECT_OFFER_MIN_OPINION = -40
