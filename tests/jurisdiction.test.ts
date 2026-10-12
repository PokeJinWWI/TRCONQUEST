// Territorial claims and jurisdiction (scene/claims.ts, scene/jurisdiction.ts,
// scene/sovereignty.ts, state/jurisdictionStore.ts): the claim lifecycle, who governs a
// place, and who may build there (acceptance scenarios A, B, C, F, H and I of the spec).
//
// Run:  npx tsx tests/jurisdiction.test.ts
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileClaim, recognize, scopeCovers, strengthenBySettlement, transfer, withdraw, type Claim, type Geo, type Scope } from '../src/scene/claims'
import { decideConstruction, jurisdictionOf, type JurisdictionState, type Permission } from '../src/scene/jurisdiction'
import { decideConstructionNow, fileClaimNow, grantPermission, jurisdictionNow, recognizeClaim, strengthenBySettlementNow, transferSovereignty } from '../src/scene/sovereignty'
import { locationsOf } from '../src/scene/locations'
import { SETTLEMENT_CLAIM_RADIUS_CELLS } from '../src/data/territoryData'
import { resetGame } from '../src/scene/gameReset'
import { useJurisdictionStore } from '../src/state/jurisdictionStore'
import { useLocationStore, siteOwner } from '../src/state/locationStore'
import { useTerritoryStore } from '../src/state/territoryStore'
import { applySave, createSave } from '../src/state/saveGame'
import { sameData } from '../src/state/saveCodec'
import { systemClaim } from '../src/scene/territory'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const A = 'imperial-state-of-mars'
const B = 'republic-of-venus'
const C = 'orion-republic'

// A tiny world: system "sx" with bodies P1 and P2; P1 has sites at nodes 0, 5, 40; P2 has one at 0.
const SITES: Record<string, { bodyName: string; node: number }> = {
  'P1#settlement-0': { bodyName: 'P1', node: 0 },
  'P1#industrial-0': { bodyName: 'P1', node: 5 },
  'P1#industrial-1': { bodyName: 'P1', node: 40 },
  'P2#settlement-0': { bodyName: 'P2', node: 0 },
}
const geo: Geo = {
  siteOf: (id) => SITES[id],
  starOfBody: (b) => (b === 'P1' || b === 'P2' ? 'sx' : undefined),
  cellsBetween: (a, b) => Math.abs(a - b),
}
const state = (over: Partial<JurisdictionState> = {}): JurisdictionState => ({
  claims: [],
  permissions: [],
  bodyOwner: {},
  bodyController: {},
  atWar: () => false,
  geo,
  nameOf: (id) => id,
  ...over,
})
const sys: Scope = { kind: 'system', id: 'sx' }
const loc = (id: string): Scope => ({ kind: 'location', id })
const ok = (r: ReturnType<typeof fileClaim>): Claim[] => {
  if (!r.ok) throw new Error(r.reason)
  return r.claims
}

console.log('\n=== 1. The claim lifecycle ===')
{
  let claims = ok(fileClaim([], { scope: sys, claimantId: A, basis: 'founding', simDays: 1 }))
  check('a filed claim is provisional, not sovereignty', claims[0].status === 'provisional' && jurisdictionOf(sys, state({ claims })).sovereign === undefined && jurisdictionOf(sys, state({ claims })).frontier)
  check('the same country cannot file twice on one scope', !fileClaim(claims, { scope: sys, claimantId: A, basis: 'founding', simDays: 2 }).ok)
  check('survey alone makes no claim: nobody holds the frontier', jurisdictionOf(sys, state()).frontier && jurisdictionOf(sys, state()).disputants.length === 0)

  const rec = recognize(claims, { claimId: claims[0].id, basis: 'treaty', byId: B, simDays: 5 })
  check('an explicit act recognizes it', rec.ok && rec.claim.status === 'recognized' && rec.claim.basis === 'treaty' && rec.claim.evidence.length === 1)
  if (rec.ok) claims = rec.claims
  check('...and now the system has a sovereign, distinct from the provisional stage', jurisdictionOf(sys, state({ claims })).sovereign === A && jurisdictionOf(sys, state({ claims })).sovereignFrom === 'system')
  check('a recognized claim cannot be recognized again', !recognize(claims, { claimId: claims[0].id, basis: 'treaty', simDays: 6 }).ok)

  // Conflicting claims stay represented.
  claims = ok(fileClaim([], { scope: loc('P1#industrial-0'), claimantId: A, basis: 'founding', simDays: 1 }))
  claims = ok(fileClaim(claims, { scope: loc('P1#industrial-0'), claimantId: B, basis: 'founding', simDays: 2 }))
  const j = jurisdictionOf(loc('P1#industrial-0'), state({ claims }))
  check('two claimants: contested, both kept, no owner picked', j.contested && j.disputants.join() === [A, B].sort().join() && !j.sovereign && claims.every((c) => c.status === 'provisional'))
  check('recognition is refused while a rival stands', !recognize(claims, { claimId: claims[0].id, basis: 'treaty', simDays: 3 }).ok)
  const settled = recognize(claims, { claimId: claims[0].id, basis: 'treaty', simDays: 3, resolveRivals: true })
  check('...unless the treaty settles it: the rival is superseded', settled.ok && settled.claims.find((c) => c.claimantId === B)!.status === 'superseded' && settled.claims.find((c) => c.claimantId === B)!.supersededBy === claims[0].id)
  const cleared = withdraw(claims, claims[1].id)
  check('contested is derived: it clears when one withdraws', !jurisdictionOf(loc('P1#industrial-0'), state({ claims: cleared })).contested)

  // Transfer.
  const held = settled.ok ? settled.claims : []
  const moved = transfer(held, { scope: loc('P1#industrial-0'), toId: C, simDays: 9 })
  check('a transfer supersedes the old recognized claim and recognizes the new', moved.ok && moved.claims.find((c) => c.claimantId === A)!.status === 'superseded' && moved.claim.claimantId === C && moved.claim.basis === 'transfer')
  check('...and never to the one already recognized', !transfer(held, { scope: loc('P1#industrial-0'), toId: A, simDays: 9 }).ok)
}

console.log('\n=== 2. Settlement claims have a scope, never a system ===')
{
  check('a region covers its anchor and nearby sites', scopeCovers({ kind: 'region', id: 'P1#settlement-0' }, 'P1#industrial-0', geo))
  check('...not the far side of the body', !scopeCovers({ kind: 'region', id: 'P1#settlement-0' }, 'P1#industrial-1', geo, SETTLEMENT_CLAIM_RADIUS_CELLS))
  check('...nor another body', !scopeCovers({ kind: 'region', id: 'P1#settlement-0' }, 'P2#settlement-0', geo))
  const r = strengthenBySettlement([], { claimantId: A, anchorSiteId: 'P1#settlement-0', geo, simDays: 3 })
  check('a settlement with no claim files a provisional REGION claim', r.ok && r.claim.scope.kind === 'region' && r.claim.status === 'provisional' && r.claim.basis === 'settlement')
  check('...which is not a system claim and gives no sovereignty', r.ok && jurisdictionOf(sys, state({ claims: r.claims })).disputants.length === 0 && jurisdictionOf(loc('P1#industrial-1'), state({ claims: r.claims })).disputants.length === 0)
  if (r.ok) {
    const again = strengthenBySettlement(r.claims, { claimantId: A, anchorSiteId: 'P1#industrial-0', geo, simDays: 8 })
    check('a second settlement inside it adds evidence instead of a new claim', again.ok && again.claims.length === 1 && again.claim.evidence.length === 2)
  }
}

console.log('\n=== 3. Construction rights (acceptance A, B, C, F) ===')
{
  // A. Frontier expansion.
  const aClaim = ok(fileClaim([], { scope: sys, claimantId: A, basis: 'founding', simDays: 1 }))
  const s = state({ claims: aClaim })
  const dB = decideConstruction({ builderId: B, scope: { kind: 'body', id: 'P1' }, asset: 'colony' }, s)
  check('A: B settling inside A\'s provisional claim is a contested, incident-making act', dB.legal === 'contested' && dB.incident && dB.allowed, dB.reason)
  check('A: A itself has priority (a limited right), not sovereignty', decideConstruction({ builderId: A, scope: { kind: 'body', id: 'P1' }, asset: 'colony' }, s).legal === 'limited-right')
  check('A: with no claim at all it is open frontier', decideConstruction({ builderId: B, scope: { kind: 'body', id: 'P1' }, asset: 'colony' }, state()).legal === 'authorized')

  // B. Established planet.
  const owned = state({ bodyOwner: { P1: A } })
  const dOwn = decideConstruction({ builderId: B, scope: loc('P1#industrial-0'), asset: 'industrial' }, owned)
  check('B: a foreign builder needs the sovereign\'s permission', dOwn.legal === 'needs-permission' && !dOwn.allowed, dOwn.reason)
  check('B: the sovereign builds freely', decideConstruction({ builderId: A, scope: loc('P1#industrial-0'), asset: 'industrial' }, owned).legal === 'authorized')
  const grant: Permission = { id: 'g1', grantorId: A, holderId: B, scope: { kind: 'body', id: 'P1' }, effect: 'allow', basis: 'concession', since: 1 }
  check('B: a concession lets it, as authorized under an agreement', decideConstruction({ builderId: B, scope: loc('P1#industrial-0'), asset: 'industrial' }, state({ bodyOwner: { P1: A }, permissions: [grant] })).legal === 'treaty')
  check('B: a ban from the sovereign prohibits', decideConstruction({ builderId: B, scope: loc('P1#industrial-0'), asset: 'industrial' }, state({ bodyOwner: { P1: A }, permissions: [{ ...grant, effect: 'deny' }] })).legal === 'prohibited')
  check('B: at war with the sovereign is prohibited', decideConstruction({ builderId: B, scope: loc('P1#industrial-0'), asset: 'industrial' }, state({ bodyOwner: { P1: A }, atWar: () => true })).legal !== 'authorized')
  check('B: someone else\'s grant does not apply to a third country', decideConstruction({ builderId: C, scope: loc('P1#industrial-0'), asset: 'industrial' }, state({ bodyOwner: { P1: A }, permissions: [grant] })).legal === 'needs-permission')

  // C. Shared planet: A governs a region at site 0, B governs a region at site 40, the rest is open.
  let claims = ok(fileClaim([], { scope: { kind: 'region', id: 'P1#settlement-0' }, claimantId: A, basis: 'settlement', simDays: 1 }))
  claims = ok(fileClaim(claims, { scope: { kind: 'region', id: 'P1#industrial-1' }, claimantId: B, basis: 'settlement', simDays: 2 }))
  for (const c of claims) claims = ok(recognize(claims, { claimId: c.id, basis: 'treaty', simDays: 3 }) as ReturnType<typeof fileClaim>)
  const shared = state({ claims })
  const at = (site: string) => decideConstruction({ builderId: C, scope: loc(site), asset: 'industrial' }, shared)
  check('C: inside A\'s region the rules are A\'s', at('P1#industrial-0').legal === 'needs-permission' && at('P1#industrial-0').jurisdiction.sovereign === A)
  check('C: inside B\'s region the rules are B\'s', at('P1#industrial-1').jurisdiction.sovereign === B && at('P1#industrial-1').legal === 'needs-permission')
  check('C: the other planet is not closed because P1 is settled', decideConstruction({ builderId: C, scope: loc('P2#settlement-0'), asset: 'settlement' }, shared).legal === 'authorized')

  // F. Split system: A holds P1, B holds P2, C has the Starbase (it has no standing in jurisdiction).
  const split = state({ bodyOwner: { P1: A, P2: B } })
  check('F: each planet has its own sovereign', jurisdictionOf({ kind: 'body', id: 'P1' }, split).sovereign === A && jurisdictionOf({ kind: 'body', id: 'P2' }, split).sovereign === B)
  check('F: the system itself has none: a Starbase confers nothing', jurisdictionOf(sys, split).sovereign === undefined && jurisdictionOf(sys, split).frontier)

  // Legal and physical are different answers.
  const wrongKind = decideConstruction({ builderId: A, scope: loc('P1#industrial-0'), asset: 'settlement', physical: { ok: false, reason: 'this is a industrial site, not a settlement site' } }, owned)
  check('legal yes, physical no: reported apart and not allowed', wrongKind.legal === 'authorized' && !wrongKind.physical.ok && !wrongKind.allowed)
  const forbiddenButFits = decideConstruction({ builderId: B, scope: loc('P1#industrial-0'), asset: 'industrial' }, owned)
  check('legal no, physical yes: reported apart too', forbiddenButFits.physical.ok && !forbiddenButFits.allowed && forbiddenButFits.legal === 'needs-permission')
  const occupied = decideConstruction({ builderId: B, scope: { kind: 'body', id: 'P1' }, asset: 'colony' }, state({ bodyOwner: { P1: A }, bodyController: { P1: C }, atWar: (x, y) => (x === C && y === B) || (x === B && y === C) }))
  check('hostile armed control stops building for now', occupied.legal === 'military-restricted' && !occupied.allowed, occupied.reason)
}

console.log('\n=== 4. Through the stores: transfer keeps assets (acceptance H) ===')
{
  resetGame()
  const mars = locationsOf('Mars')
  const anchor = mars.find((x) => x.kind === 'settlement' && x.fixed)!
  const factory = mars.find((x) => x.kind === 'industrial')!
  check('Mars\'s starting facts: Mars owns it, Venus may not just build', decideConstructionNow(B, { kind: 'location', id: factory.id }, 'industrial').legal === 'needs-permission')

  // A region around the capital, recognized for Mars; Venus's factory is established with a concession.
  const filed = strengthenBySettlementNow(A, anchor.id, 10)
  check('Mars\'s capital settlement files a region claim', filed.ok && useJurisdictionStore.getState().claims.length === 1)
  grantPermission({ id: 'conc', grantorId: A, holderId: B, scope: { kind: 'location', id: factory.id }, effect: 'allow', basis: 'concession', since: 11 })
  check('Venus can establish the factory under the concession', decideConstructionNow(B, { kind: 'location', id: factory.id }, 'industrial').legal === 'treaty' && useLocationStore.getState().establish(factory.id, B, 12))
  check('property and sovereignty are separate: Venus owns the factory, Mars governs the ground', siteOwner(factory.id) === B && jurisdictionNow({ kind: 'location', id: factory.id }).sovereign === A)

  // A war settlement transfers sovereignty of the whole body to Venus.
  const t = transferSovereignty({ kind: 'body', id: 'Mars' }, B, 20)
  check('the body-wide transfer is recorded and Venus is now its sovereign', t.ok && useTerritoryStore.getState().bodyOwner['Mars'] === B && jurisdictionNow({ kind: 'body', id: 'Mars' }).sovereign === B)
  check('...the factory is not erased: still Venus\'s, still there', siteOwner(factory.id) === B && !!useLocationStore.getState().established[factory.id])
  check('...and the old claims are kept as history', useJurisdictionStore.getState().claims.some((c) => c.scope.kind === 'body' && c.status === 'recognized' && c.claimantId === B))
  useTerritoryStore.getState().cedeBody('Mars', A)
}

console.log('\n=== 5. Provisional claim on a frontier body, then recognition ===')
{
  resetGame()
  const ceres = { kind: 'body', id: 'Ceres' } as const
  check('Ceres starts open', decideConstructionNow(A, ceres, 'colony').legal === 'authorized')
  const filed = fileClaimNow(ceres, B, 'founding', 5)
  check('Venus files a provisional claim: nobody is sovereign yet', filed.ok && jurisdictionNow(ceres).sovereign === undefined && !useTerritoryStore.getState().bodyOwner['Ceres'])
  check('Mars settling there is now a contested, allowed act', decideConstructionNow(A, ceres, 'colony').legal === 'contested' && decideConstructionNow(A, ceres, 'colony').allowed)
  const rec = filed.ok ? recognizeClaim(filed.claim.id, { basis: 'treaty', simDays: 6 }) : { ok: false as const, reason: '' }
  check('recognition makes Venus the sovereign (and bodyOwner, which the borders read)', rec.ok && useTerritoryStore.getState().bodyOwner['Ceres'] === B && jurisdictionNow(ceres).sovereign === B)
  check('now Mars needs permission', decideConstructionNow(A, ceres, 'colony').legal === 'needs-permission' && !decideConstructionNow(A, ceres, 'colony').allowed)
  // The map's border rule (systemClaim) is unchanged by claims: it reads body owners.
  check('the map\'s system border rule is unchanged: Sol is still contested...', systemClaim('sol', useTerritoryStore.getState().bodyOwner).kind === 'contested')
  check('...while Sol has no sovereign, and Mars and Venus each govern their own worlds', jurisdictionNow({ kind: 'system', id: 'sol' }).sovereign === undefined && jurisdictionNow({ kind: 'body', id: 'Mars' }).sovereign === A && jurisdictionNow({ kind: 'body', id: 'Venus' }).sovereign === B)
}

console.log('\n=== 6. Save and load (acceptance I) ===')
{
  resetGame()
  const mars = locationsOf('Mars')
  const anchor = mars.find((x) => x.kind === 'settlement' && x.fixed)!
  strengthenBySettlementNow(A, anchor.id, 3)
  fileClaimNow({ kind: 'system', id: 'barnards-star' }, B, 'founding', 4)
  fileClaimNow({ kind: 'system', id: 'barnards-star' }, C, 'founding', 5)
  grantPermission({ id: 'p', grantorId: A, holderId: B, scope: { kind: 'body', id: 'Mars' }, effect: 'allow', basis: 'lease', since: 6 })
  useLocationStore.getState().establish(mars.find((x) => x.kind === 'resource' && !x.material)!.id, B, 7)
  const before = { c: useJurisdictionStore.getState().claims, p: useJurisdictionStore.getState().permissions, l: useLocationStore.getState().established }
  const file = JSON.parse(JSON.stringify(await createSave('territory')))
  resetGame()
  check('a reset clears them', useJurisdictionStore.getState().claims.length === 0)
  await applySave(file)
  check('claims, permissions and established sites survive', sameData(before.c, useJurisdictionStore.getState().claims) && sameData(before.p, useJurisdictionStore.getState().permissions) && sameData(before.l, useLocationStore.getState().established))
  check('...and the contested system is still contested after loading', jurisdictionNow({ kind: 'system', id: 'barnards-star' }).contested)
  resetGame()
}

console.log('\n=== 7. Ownership has a front door ===')
{
  // Only these may write who owns a body: the territory store itself, the sandbox reset, and the
  // sovereignty layer, colonies, peace and subjects (which all call its actions).
  const callers = new Set<string>()
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.(ts|tsx)$/.test(f)) {
        const text = readFileSync(p, 'utf8')
        if (/\.(claimBody|cedeBody)\(/.test(text) || /setState\(\{[^)]*bodyOwner/.test(text)) callers.add(p.replace(/^src\//, ''))
      }
    }
  }
  walk('src')
  const allowed = new Set(['scene/sovereignty.ts', 'scene/colonies.ts', 'scene/peace.ts', 'scene/subjects.ts', 'scene/sandboxSetup.ts'])
  const stray = [...callers].filter((c) => !allowed.has(c))
  check('nothing outside the sanctioned paths changes who owns a body', stray.length === 0, stray.join(', '))
}

console.log(failures ? `\n${failures} FAILED` : '\nAll jurisdiction checks passed')
process.exit(failures ? 1 : 0)
