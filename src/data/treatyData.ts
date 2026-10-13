// Treaties: the Victoria 3-style everyday diplomatic agreements, distinct
// from a full international organization (data/internationalOrgData.ts) or a
// war's peace terms (diplomacyData.ts's PeaceTerms). A treaty is between a
// PAIR of nations, is named, runs for a chosen binding period, and bundles
// any number of ARTICLES — Victoria 3's own model: propose an embassy, a
// trade agreement AND a guarantee together as one package, in either
// direction, rather than one narrow "kind" per deal. Two nations can hold
// several separate treaties at once. See state/treatyStore.ts for the live
// state and scene/treaties.ts for how one is proposed (as a whole bundle),
// accepted, and broken.

export type ArticleKind =
  | 'embassy'
  | 'non-aggression-pact'
  | 'trade-agreement'
  | 'alliance'
  | 'defensive-pact'
  | 'guarantee-independence'
  | 'treaty-port'
  | 'investment-rights'
  | 'military-access'
  | 'transfer-subject'
  | 'ship-transfer'
  | 'join-power-bloc'
  // Territorial agreements (docs/territorial-design.md M9): each has a scope, parties and a defined effect.
  | 'construction-right'
  | 'access-right'
  | 'territorial-recognition'
  | 'territorial-transfer'
  | 'demilitarized-zone'
  // People may move between the two nations (economy/migration.ts), whatever their migration laws.
  | 'migration'

// A place a territorial article applies to (the same shape as scene/claims.Scope).
export interface TreatyScope {
  kind: 'system' | 'body' | 'region' | 'location' | 'orbit'
  id: string
}
export type AccessKind = 'transit' | 'dock' | 'basing'

// Mutual articles apply the same to both of the treaty's two nations, so they
// carry no direction. Directional articles name which of the treaty's two
// nations plays which role — and since a treaty can hold several articles,
// two directional articles pointing opposite ways is exactly how a real
// exchange ("I'll guarantee you if you give me a treaty port") gets built.
//
// Most articles are ONGOING (in effect until cancelled or the treaty
// expires) — see isInstantArticle for the few that instead fire once, the
// moment the treaty is signed, and leave nothing ongoing behind (a subject
// transfer, a ship handover, joining a bloc).
export type TreatyArticle =
  | { kind: 'embassy' }
  | { kind: 'non-aggression-pact' }
  | { kind: 'trade-agreement' }
  | { kind: 'alliance' }
  // Like an alliance, but a lesser commitment — mutual defense with a lower
  // bar to sign (Victoria 3's own "lower requirements than alliance").
  | { kind: 'defensive-pact' }
  // The guarantor commits to defending the guaranteed nation's independence.
  // Both ids must be the treaty's own two parties.
  | { kind: 'guarantee-independence'; guarantorId: string; guaranteedId: string }
  // sourceId cedes operating rights over one of its own spaceports (on
  // bodyName, which sourceId must own) to targetId — a foothold without any
  // territory changing hands. See state/nationEconomy.spaceportSitesOf,
  // which shows targetId as that spaceport's operator while this holds.
  | { kind: 'treaty-port'; sourceId: string; targetId: string; bodyName: string }
  // sourceId opens its territory to targetId's foreign investment even if
  // sourceId's own national policy is 'approval' or 'closed' for everyone
  // else. See state/treatyStore.hasInvestmentRights.
  | { kind: 'investment-rights'; sourceId: string; targetId: string }
  // sourceId permits targetId's fleets to be present in its territory
  // without that alone being treated as hostile. See
  // state/treatyStore.hasMilitaryAccess. Not yet consumed by fleet
  // movement/hostility checks — tracked and displayed, enforcement is a
  // follow-up.
  | { kind: 'military-access'; sourceId: string; targetId: string }
  // ONE-TIME: subjectId's suzerainty moves from fromSuzerainId to
  // toSuzerainId the moment this treaty is signed (both ids must be the
  // treaty's own two parties; subjectId itself need not be).
  | { kind: 'transfer-subject'; subjectId: string; fromSuzerainId: string; toSuzerainId: string }
  // ONE-TIME: shipId's ownership moves from fromId to toId the moment this
  // treaty is signed.
  | { kind: 'ship-transfer'; shipId: string; fromId: string; toId: string }
  // ONE-TIME: joiningId joins leaderId's international organization (orgId,
  // which leaderId must lead) the moment this treaty is signed.
  | { kind: 'join-power-bloc'; orgId: string; leaderId: string; joiningId: string }
  // ONGOING: sourceId (who governs the scope) lets targetId settle and build there, under its jurisdiction
  // (a construction permission, a settlement right or a resource concession). It ends with the treaty; what
  // targetId built stays targetId's.
  // ONGOING: people may migrate between sourceId and targetId (both ways when `mutual`, else only from sourceId to targetId), up to
  // `quota` millions a month when set. It ends with the treaty; people who already moved stay.
  | { kind: 'migration'; sourceId: string; targetId: string; mutual?: boolean; quota?: number }
  | { kind: 'construction-right'; sourceId: string; targetId: string; scope: TreatyScope }
  // ONGOING: sourceId lets targetId transit, dock at, or base forces in the scope.
  | { kind: 'access-right'; sourceId: string; targetId: string; scope: TreatyScope; access: AccessKind }
  // ONE-TIME: sourceId recognizes targetId's claim on the scope; a rival claim of sourceId's own is withdrawn
  // and targetId's claim becomes recognized.
  | { kind: 'territorial-recognition'; sourceId: string; targetId: string; scope: TreatyScope }
  // ONE-TIME: fromId, who governs the scope, transfers its sovereignty to toId. Assets, settlements and
  // people stay where they are.
  | { kind: 'territorial-transfer'; fromId: string; toId: string; scope: TreatyScope }
  // ONGOING, mutual: neither side builds military assets (defense platforms, fortresses) in the scope.
  | { kind: 'demilitarized-zone'; scope: TreatyScope }

export function isInstantArticle(kind: ArticleKind): boolean {
  return kind === 'transfer-subject' || kind === 'ship-transfer' || kind === 'join-power-bloc' || kind === 'territorial-recognition' || kind === 'territorial-transfer'
}

// A treaty's chosen binding period, in years — Victoria 3's own five options.
export const TREATY_DURATIONS_YEARS = [5, 10, 15, 25, 99] as const
export type TreatyDurationYears = (typeof TREATY_DURATIONS_YEARS)[number]
export const DAYS_PER_YEAR = 365

export interface Treaty {
  id: string
  name: string
  a: string
  b: string
  articles: TreatyArticle[]
  signedSimDays: number
  durationYears: TreatyDurationYears
}

export function expiresSimDays(t: Treaty): number {
  return t.signedSimDays + t.durationYears * DAYS_PER_YEAR
}

// Once the binding period is up, either side can walk away for free —
// before that, breaking it costs opinion (see scene/treaties.cancelTreaty).
export function isBinding(t: Treaty, simDays: number): boolean {
  return simDays < expiresSimDays(t)
}

// The two nations a treaty is between.
export function treatyParties(t: Treaty): [string, string] {
  return [t.a, t.b]
}

// How much opinion `forId` needs to have of the other party to go along with
// THIS article, given the role `forId` plays in it — 0 if `forId` has no
// burden in this article at all (it's on the receiving end of a favor, e.g.
// the target of a treaty port). A mutual article burdens both sides equally.
// This is what a treaty's total acceptance score is built from (see
// scene/treaties.bundleCostForReceiver) — summed across every article in the
// bundle, so a burden in one article can be offset by a sweetener in
// another, even a one-time one like handing over a ship.
export function articleCostFor(article: TreatyArticle, forId: string): number {
  switch (article.kind) {
    case 'embassy':
      return MUTUAL_ARTICLE_COST.embassy
    case 'non-aggression-pact':
      return MUTUAL_ARTICLE_COST['non-aggression-pact']
    case 'trade-agreement':
      return MUTUAL_ARTICLE_COST['trade-agreement']
    case 'alliance':
      return MUTUAL_ARTICLE_COST.alliance
    case 'defensive-pact':
      return MUTUAL_ARTICLE_COST['defensive-pact']
    case 'guarantee-independence':
      // Being GUARANTEED costs little (you're the one being protected); being
      // the GUARANTOR is a real commitment (you may be dragged into their wars).
      if (forId === article.guaranteedId) return GUARANTEE_GUARANTEED_COST
      if (forId === article.guarantorId) return GUARANTEE_GUARANTOR_COST
      return 0
    case 'treaty-port':
      // Receiving a foreign concession costs nothing; CEDING your own port is
      // the real ask.
      if (forId === article.targetId) return TREATY_PORT_RECEIVE_COST
      if (forId === article.sourceId) return TREATY_PORT_CEDE_COST
      return 0
    case 'investment-rights':
      if (forId === article.targetId) return INVESTMENT_RIGHTS_RECEIVE_COST
      if (forId === article.sourceId) return INVESTMENT_RIGHTS_GRANT_COST
      return 0
    case 'military-access':
      if (forId === article.targetId) return MILITARY_ACCESS_RECEIVE_COST
      if (forId === article.sourceId) return MILITARY_ACCESS_GRANT_COST
      return 0
    case 'transfer-subject':
      if (forId === article.toSuzerainId) return TRANSFER_SUBJECT_RECEIVE_COST
      if (forId === article.fromSuzerainId) return TRANSFER_SUBJECT_GIVE_COST
      return 0
    case 'ship-transfer':
      if (forId === article.toId) return SHIP_TRANSFER_RECEIVE_COST
      if (forId === article.fromId) return SHIP_TRANSFER_GIVE_COST
      return 0
    case 'join-power-bloc':
      // The bloc leader is only ever glad of a new member; the one being
      // asked to join and subordinate its foreign policy bears the real cost.
      if (forId === article.leaderId) return JOIN_BLOC_LEADER_COST
      if (forId === article.joiningId) return JOIN_BLOC_JOINER_COST
      return 0
    case 'migration':
      // Accepting the other's people is the burden; sending your own is a small one (you may lose workers).
      if (forId === article.targetId) return MIGRATION_ACCEPT_COST
      if (forId === article.sourceId) return article.mutual ? MIGRATION_ACCEPT_COST : MIGRATION_SEND_COST
      return 0
    case 'construction-right':
      if (forId === article.targetId) return CONSTRUCTION_RIGHT_RECEIVE_COST
      if (forId === article.sourceId) return CONSTRUCTION_RIGHT_GRANT_COST
      return 0
    case 'access-right':
      if (forId === article.targetId) return ACCESS_RIGHT_COST[article.access].receive
      if (forId === article.sourceId) return ACCESS_RIGHT_COST[article.access].grant
      return 0
    case 'territorial-recognition':
      if (forId === article.targetId) return RECOGNITION_RECEIVE_COST
      if (forId === article.sourceId) return RECOGNITION_GRANT_COST
      return 0
    case 'territorial-transfer':
      if (forId === article.toId) return TERRITORY_TRANSFER_RECEIVE_COST
      if (forId === article.fromId) return TERRITORY_TRANSFER_GIVE_COST
      return 0
    case 'demilitarized-zone':
      return DEMILITARIZED_ZONE_COST
  }
}

// Sum of every article's cost for `forId` — the opinion `forId` needs of the
// proposer to accept the WHOLE bundle. See scene/treaties.proposeTreaty for
// the actual accept/reject call.
export function bundleCostFor(articles: TreatyArticle[], forId: string): number {
  return articles.reduce((sum, a) => sum + articleCostFor(a, forId), 0)
}

// Mutual articles' cost — same threshold this project used before bundling
// existed, kept as-is so a lone article behaves exactly like it used to.
const MUTUAL_ARTICLE_COST: Record<'embassy' | 'non-aggression-pact' | 'trade-agreement' | 'alliance' | 'defensive-pact', number> = {
  embassy: -50,
  'non-aggression-pact': -10,
  'trade-agreement': 0,
  alliance: 40,
  // Lower bar than a full alliance — a real but lesser commitment.
  'defensive-pact': 20,
}
const GUARANTEE_GUARANTEED_COST = -20
// Guaranteeing someone else costs about what an alliance does — you're
// taking on a similar obligation to come to their defense.
const GUARANTEE_GUARANTOR_COST = 40
const TREATY_PORT_RECEIVE_COST = -40
// Ceding a port is a real concession, but well short of a full alliance.
const TREATY_PORT_CEDE_COST = 25
const INVESTMENT_RIGHTS_RECEIVE_COST = -30
const INVESTMENT_RIGHTS_GRANT_COST = 15
const MILITARY_ACCESS_RECEIVE_COST = -30
const MILITARY_ACCESS_GRANT_COST = 15
const TRANSFER_SUBJECT_RECEIVE_COST = -30
const TRANSFER_SUBJECT_GIVE_COST = 25
const SHIP_TRANSFER_RECEIVE_COST = -30
// Handing over one ship is a modest ask, well below ceding a whole world.
const SHIP_TRANSFER_GIVE_COST = 10
const JOIN_BLOC_LEADER_COST = -40
const JOIN_BLOC_JOINER_COST = 30
// Taking in another nation's people is a modest burden; having an outlet for your own is a small sweetener (the AI weighs both by its
// own labour shortage or unemployment: scene/treaties.migrationAppetite).
const MIGRATION_ACCEPT_COST = 10
const MIGRATION_SEND_COST = -5
const CONSTRUCTION_RIGHT_RECEIVE_COST = -30
const CONSTRUCTION_RIGHT_GRANT_COST = 15
const ACCESS_RIGHT_COST: Record<AccessKind, { receive: number; grant: number }> = {
  transit: { receive: -10, grant: 5 },
  dock: { receive: -20, grant: 10 },
  basing: { receive: -30, grant: 25 },
}
const RECOGNITION_RECEIVE_COST = -30
// Recognizing a rival's claim is a real concession: about what ceding a port is.
const RECOGNITION_GRANT_COST = 25
const TERRITORY_TRANSFER_RECEIVE_COST = -60
// Handing over sovereignty is the biggest ask of all.
const TERRITORY_TRANSFER_GIVE_COST = 60
const DEMILITARIZED_ZONE_COST = 10

// Opinion hit to the OTHER side when you cancel a still-binding treaty you
// hold with them (see data/treatyData.isBinding) — free once it's expired.
export const OPINION_ON_TREATY_BROKEN = -25
// Opinion gained on signing an embassy — a small, immediate goodwill gesture.
export const OPINION_ON_EMBASSY = 10

export const ARTICLE_LABELS: Record<ArticleKind, string> = {
  embassy: 'Embassy',
  'non-aggression-pact': 'Non-Aggression Pact',
  'trade-agreement': 'Trade Agreement',
  alliance: 'Alliance',
  'defensive-pact': 'Defensive Pact',
  'guarantee-independence': 'Guarantee Independence',
  'treaty-port': 'Treaty Port',
  'investment-rights': 'Investment Rights',
  'military-access': 'Military Access',
  'transfer-subject': 'Transfer Subject',
  'ship-transfer': 'Ship Transfer',
  'join-power-bloc': 'Join International Organization',
  'migration': 'Migration',
  'construction-right': 'Construction Right',
  'access-right': 'Access Right',
  'territorial-recognition': 'Territorial Recognition',
  'territorial-transfer': 'Territorial Transfer',
  'demilitarized-zone': 'Demilitarized Zone',
}

// A short human-readable line for one article, from `viewerId`'s point of
// view — used everywhere a treaty's contents are listed.
export function describeArticle(article: TreatyArticle, viewerId: string, nameOf: (id: string) => string): string {
  switch (article.kind) {
    case 'guarantee-independence':
      return article.guarantorId === viewerId ? `Guaranteeing ${nameOf(article.guaranteedId)}'s independence` : `Guaranteed by ${nameOf(article.guarantorId)}`
    case 'treaty-port':
      return article.sourceId === viewerId
        ? `Ceded a treaty port on ${article.bodyName} to ${nameOf(article.targetId)}`
        : `Treaty port on ${article.bodyName} received from ${nameOf(article.sourceId)}`
    case 'investment-rights':
      return article.sourceId === viewerId ? `Opened investment to ${nameOf(article.targetId)}` : `Investment rights in ${nameOf(article.sourceId)}`
    case 'military-access':
      return article.sourceId === viewerId ? `Granted military access to ${nameOf(article.targetId)}` : `Military access through ${nameOf(article.sourceId)}`
    case 'transfer-subject':
      return article.fromSuzerainId === viewerId
        ? `Transferred ${nameOf(article.subjectId)} to ${nameOf(article.toSuzerainId)}`
        : `Received ${nameOf(article.subjectId)} from ${nameOf(article.fromSuzerainId)}`
    case 'ship-transfer':
      return article.fromId === viewerId ? `Transferred a ship to ${nameOf(article.toId)}` : `Received a ship from ${nameOf(article.fromId)}`
    case 'join-power-bloc':
      return article.joiningId === viewerId ? `Joined ${nameOf(article.leaderId)}'s organization` : `${nameOf(article.joiningId)} joined your organization`
    case 'migration':
      return article.mutual ? `People may move freely between us and ${nameOf(article.sourceId === viewerId ? article.targetId : article.sourceId)}${article.quota ? ` (up to ${article.quota}M a month)` : ''}` : article.sourceId === viewerId ? `Our people may migrate to ${nameOf(article.targetId)}${article.quota ? ` (up to ${article.quota}M a month)` : ''}` : `${nameOf(article.sourceId)}'s people may migrate to us${article.quota ? ` (up to ${article.quota}M a month)` : ''}`
    case 'construction-right':
      return article.sourceId === viewerId ? `Allowed ${nameOf(article.targetId)} to build in ${article.scope.id}` : `Right to build in ${article.scope.id}, from ${nameOf(article.sourceId)}`
    case 'access-right':
      return article.sourceId === viewerId ? `Granted ${nameOf(article.targetId)} ${article.access} rights at ${article.scope.id}` : `${article.access[0].toUpperCase()}${article.access.slice(1)} rights at ${article.scope.id}, from ${nameOf(article.sourceId)}`
    case 'territorial-recognition':
      return article.sourceId === viewerId ? `Recognized ${nameOf(article.targetId)}'s claim on ${article.scope.id}` : `${nameOf(article.sourceId)} recognized our claim on ${article.scope.id}`
    case 'territorial-transfer':
      return article.fromId === viewerId ? `Transferred ${article.scope.id} to ${nameOf(article.toId)}` : `Received ${article.scope.id} from ${nameOf(article.fromId)}`
    case 'demilitarized-zone':
      return `${article.scope.id} demilitarized`
    default:
      return ARTICLE_LABELS[article.kind]
  }
}

// A sensible default name for a new treaty, before the proposer renames it —
// just the article list, since Victoria 3 itself has no naming convention to
// follow here.
export function defaultTreatyName(articles: TreatyArticle[]): string {
  if (articles.length === 1) return ARTICLE_LABELS[articles[0].kind]
  return `Treaty of ${articles.map((a) => ARTICLE_LABELS[a.kind]).join(', ')}`
}
