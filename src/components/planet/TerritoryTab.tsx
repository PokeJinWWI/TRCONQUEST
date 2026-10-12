import { useMemo, useState } from 'react'
import { FACILITY_SPECS, type FacilityKind } from '../../data/orbitalData'
import { buildFacility, planFacility } from '../../scene/orbitalOrders'
import { territoryView } from '../../scene/territoryView'
import { useDiplomacyStore } from '../../state/diplomacyStore'
import { useJurisdictionStore } from '../../state/jurisdictionStore'
import { useLocationStore } from '../../state/locationStore'
import { useOrbitalStore } from '../../state/orbitalStore'
import { usePlayerStore } from '../../state/playerStore'
import { useTerritoryStore } from '../../state/territoryStore'
import { useTreatyStore } from '../../state/treatyStore'

// The planet screen's Territory tab (both economy modes): every layer of control on its own row, so nothing
// hides behind one "owner" label (docs/territorial-design.md section 19). Who GOVERNS, who holds the ground
// and the orbit BY FORCE, who OWNS what stands there, and which claims and agreements stand behind it.

const STATUS_TIP: Record<string, string> = {
  provisional: 'Asserted, not accepted: gives priority on the frontier, never sovereignty',
  recognized: 'Accepted by an explicit act: a treaty, a transfer or a recognition',
  superseded: 'Replaced by an agreement or another recognized claim',
  withdrawn: 'Given up by its claimant',
}

function Row({ label, value, tip, tone }: { label: string; value: string; tip?: string; tone?: 'pos' | 'neg' }) {
  return (
    <div className="inspect-row" title={tip}>
      <span className="inspect-label">{label}</span>
      <span className={`inspect-value${tone === 'pos' ? ' econ-pos' : tone === 'neg' ? ' econ-neg' : ''}`}>{value}</span>
    </div>
  )
}

export function TerritoryTab({ bodyName }: { bodyName: string }) {
  const playerId = usePlayerStore((s) => s.selectedCountryId)
  // Re-read the view when anything it is made from changes (none of these is the clock).
  const claims = useJurisdictionStore((s) => s.claims)
  const permissions = useJurisdictionStore((s) => s.permissions)
  const owners = useTerritoryStore((s) => s.bodyOwner)
  const controllers = useTerritoryStore((s) => s.bodyController)
  const facilities = useOrbitalStore((s) => s.facilities)
  const treaties = useTreatyStore((s) => s.treaties)
  const established = useLocationStore((s) => s.established)
  const eventCount = useDiplomacyStore((s) => s.events.length)
  const [message, setMessage] = useState<string | null>(null)
  const view = useMemo(() => territoryView(bodyName), [bodyName, claims, permissions, owners, controllers, facilities, treaties, established, eventCount])

  const build = (zone: string, kind: FacilityKind) => {
    if (!playerId) return
    const r = buildFacility(playerId, zone, kind)
    setMessage(r.ok ? `${FACILITY_SPECS[kind].name} started in ${zone}.` : r.reason)
  }

  return (
    <div className="territory-tab">
      <div className="inspect-divider" />
      <Row label="Governed by" value={view.sovereign ? `${view.sovereign.name} (${view.sovereign.from}-wide)` : 'Nobody: open frontier'} tip="The recognized sovereign: who may make the rules here. Owning a building, a station or a Starbase never confers it." tone={view.sovereign ? undefined : 'neg'} />
      <Row label="Ground held by" value={view.groundControl.occupied ? `${view.groundControl.name} (occupation)` : view.groundControl.name} tip="Who holds the ground by force right now. Occupation is not sovereignty." tone={view.groundControl.occupied ? 'neg' : undefined} />
      {view.contested && <Row label="Disputed by" value={view.disputants.join(', ')} tip="Rival claims stand here; building in a dispute is a diplomatic incident" tone="neg" />}
      {view.frontier && !view.contested && <Row label="Frontier" value="Anyone may settle; a provisional claim gives priority" tip="No one governs here yet: the frontier rules apply." />}

      {view.claims.length > 0 && (
        <>
          <div className="inspect-divider" />
          <div className="inspect-label">Claims</div>
          {view.claims.map((c) => (
            <div key={c.id} className="inspect-row" title={`${STATUS_TIP[c.status]}\nBasis: ${c.basis} · ${c.evidence} item${c.evidence === 1 ? '' : 's'} of evidence`}>
              <span className="inspect-label">{c.claimant}</span>
              <span className="inspect-value">{c.status} · {c.scope}</span>
            </div>
          ))}
        </>
      )}

      {view.enclaves.length > 0 && (
        <>
          <div className="inspect-divider" />
          <div className="inspect-label" title="Property of one country on ground another governs: it stays its owner's whatever happens to the sovereignty">Foreign-owned sites</div>
          {view.enclaves.map((e) => (
            <Row key={e.siteId} label={e.siteId} value={`owned by ${e.owner}`} />
          ))}
        </>
      )}

      {view.agreements.length > 0 && (
        <>
          <div className="inspect-divider" />
          <div className="inspect-label">Agreements and bans in force</div>
          {view.agreements.map((a) => (
            <div key={a} className="inspect-row">
              <span className="inspect-value" style={{ textAlign: 'left' }}>{a}</span>
            </div>
          ))}
        </>
      )}

      <div className="inspect-divider" />
      <div className="inspect-label" title="Three different answers for each orbit: who has the right to govern it, who holds it by force, and who owns what is in it">Orbit</div>
      {view.orbit.map((z) => (
        <div key={z.zone} className="pl-orbit-zone">
          <Row label={`${z.kind} orbit: governed by`} value={z.governs} tip="The legal authority over this orbital zone (by default the planet's sovereign)" />
          <Row label="...held by force by" value={z.holds} tip="Derived from armed ships and working defense platforms present: it changes as they do" tone={z.holds === 'contested' ? 'neg' : undefined} />
          {z.facilities.map((f, i) => (
            <Row key={i} label={`  ${f.kind}`} value={`${f.owner}${f.working ? '' : ' (building)'}`} tip="Property of its owner; it confers no sovereignty" />
          ))}
          {playerId && (['station', 'defense'] as FacilityKind[]).map((kind) => {
            const plan = planFacility(playerId, z.zone, kind)
            return (
              <button key={kind} type="button" className="detail-view-btn" disabled={!plan.ok} title={plan.ok ? `${FACILITY_SPECS[kind].name}: build in ${z.zone}${plan.decision.incident ? ' (a dispute: a diplomatic incident)' : ''}` : plan.reason} onClick={() => build(z.zone, kind)}>
                {FACILITY_SPECS[kind].name}
              </button>
            )
          })}
        </div>
      ))}
      {message && <div className="inspect-status">{message}</div>}

      {view.recent.length > 0 && (
        <>
          <div className="inspect-divider" />
          <div className="inspect-label">Recent</div>
          {view.recent.map((r, i) => (
            <div key={i} className="inspect-status">{r}</div>
          ))}
        </>
      )}
    </div>
  )
}
