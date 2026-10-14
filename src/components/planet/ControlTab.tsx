import { useMemo, useState } from 'react'
import { STARBASE_COST, STARBASE_TIERS } from '../../data/starbaseData'
import { ownerDisplay } from '../../data/countryRoster'
import { stationBuildBlock } from '../../scene/stationRules'
import { useStarbaseStore } from '../../state/starbaseStore'
import { useStarbasePanelStore } from '../../state/starbasePanelStore'
import { useGameTimeStore } from '../../state/gameTimeStore'
import { territoryView } from '../../scene/territoryView'
import { controlView } from '../../scene/controlView'
import { claimPlanetNow } from '../../scene/planetClaim'
import { useViewStore } from '../../state/viewStore'
import { useColonyStore } from '../../state/colonyStore'
import { useShipStore } from '../../state/shipStore'
import { useArmyStore } from '../../state/armyStore'
import { useStarbaseStore as useStationStore } from '../../state/starbaseStore'
import { useDiplomacyStore } from '../../state/diplomacyStore'
import { useJurisdictionStore } from '../../state/jurisdictionStore'
import { siteName, useLocationStore } from '../../state/locationStore'
import { useOrbitalStore } from '../../state/orbitalStore'
import { usePlayerStore } from '../../state/playerStore'
import { useTerritoryStore } from '../../state/territoryStore'
import { useTreatyStore } from '../../state/treatyStore'

// The planet screen's Control tab (both economy modes): who is present and how much each controls, the player's colony
// progress, the decisions open to the player, then every layer of control on its own row, so nothing
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

export function ControlTab({ bodyName }: { bodyName: string }) {
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
  const colonies = useColonyStore((s) => s.colonies)
  const armies = useArmyStore((s) => s.armies)
  const shipsKey = useShipStore((s) => s.ships.filter((x) => x.location.kind === 'orbiting' && x.location.bodyName === bodyName).map((x) => x.id).join(','))
  const stationsKey = useStationStore((s) => s.starbases.filter((x) => x.zone?.startsWith(`${bodyName}~`)).length)
  const view = useMemo(() => territoryView(bodyName), [bodyName, claims, permissions, owners, controllers, facilities, treaties, established, eventCount])
  const control = useMemo(() => controlView(bodyName, playerId), [bodyName, playerId, claims, owners, controllers, established, colonies, armies, shipsKey, stationsKey])
  const decide = (d: (typeof control.decisions)[number]) => {
    if (!playerId) return
    if (d.id === 'diplomacy') return useViewStore.getState().setNavCategory('Diplomacy', null)
    const r = claimPlanetNow(playerId, bodyName, useGameTimeStore.getState().simDays)
    setMessage(r.ok ? (r.sovereign ? `${bodyName} is yours: claimed for ${r.cost} influence.` : `Claimed for ${r.cost} influence: no one else may settle it. Grow your people there to make it yours outright.`) : r.reason)
  }

  const stations = useStarbaseStore((s) => s.starbases)
  const now = useGameTimeStore.getState().simDays
  const buildStation = (zone: string) => {
    if (!playerId) return
    const r = useStarbaseStore.getState().buildOrbitStation(playerId, zone, useGameTimeStore.getState().simDays)
    setMessage(r.ok ? `Station started in ${zone}.` : r.reason)
  }

  return (
    <div className="pl-districts territory-tab">
      <div className="pl-stat-grid">
        <div className="pl-stat" title="The recognized sovereign: who may make the rules here. Owning a building, a station or a Starbase never confers it."><span>Governed by</span><b>{view.sovereign ? view.sovereign.name : 'Nobody'}</b></div>
        <div className={`pl-stat${view.groundControl.occupied ? ' warn' : ''}`} title="Who holds the ground by force right now. Occupation is not sovereignty."><span>Ground held by</span><b>{view.groundControl.name}{view.groundControl.occupied ? ' (occ.)' : ''}</b></div>
        <div className={`pl-stat${view.contested ? ' warn' : ''}`} title={view.contested ? 'Rival claims stand here; building in a dispute is a diplomatic incident' : view.frontier ? 'No one governs here yet: anyone may settle; a provisional claim gives priority' : 'Recognized and undisputed'}><span>Status</span><b>{view.contested ? 'Disputed' : view.frontier ? 'Frontier' : 'Settled'}</b></div>
      </div>
      <div className="econ-subtitle" title="Everyone with a presence here. Control share blends people, established sites, ground forces and armed ships and stations in orbit; each number is shown so you can see why.">Presence</div>
      {control.rows.length === 0 && <div className="inspect-status">Nobody has a presence here.</div>}
      {control.rows.map((r) => (
        <div key={r.id} className="pl-district">
          <div className="pl-district-head">
            <span className="pl-district-name" style={{ color: r.color }}>{r.name}{r.isPlayer ? ' (you)' : ''}</span>
            <span className="inspect-value">{Math.round(r.share * 100)}%</span>
          </div>
          <div className="fleet-row-bar">
            <span className="health-bar-track tone-overall combat-roster-bar"><span className="health-bar-fill" style={{ width: `${r.share * 100}%` }} /></span>
          </div>
          <Row label="Status" value={[r.sovereign ? 'Sovereign' : null, r.holdsGround ? 'Holds the ground' : null].filter(Boolean).join(' · ') || 'Present'} tip="Sovereign = the recognized governor of the whole body; holding the ground is by force" />
          {r.population > 0 && <Row label="People" value={`${r.population >= 10 ? Math.round(r.population).toLocaleString() : r.population.toFixed(1)} million`} />}
          {r.sites > 0 && <Row label="Sites" value={`${r.sites} established`} tip="Settlements, industry, mines and farms this nation has established here" />}
          {r.armies > 0 && <Row label="Ground forces" value={`${r.armies} armies · strength ${r.groundStrength}`} />}
          {(r.armedShips > 0 || r.stations > 0) && <Row label="In orbit" value={[r.armedShips > 0 ? `${r.armedShips} armed ships` : null, r.stations > 0 ? `${r.stations} stations` : null].filter(Boolean).join(', ')} />}
        </div>
      ))}

      {control.colony && (
        <div>
          <div className="econ-subtitle" title="A micro-colony becomes a planetary colony once its orbit has been held for a while; its landing grows from an outpost into a municipal government">Your colony</div>
          <div className="pl-district">
            <Row label="Stage" value={control.colony.stage === 'micro' ? 'Micro-colony' : 'Planetary colony'} />
            {control.colony.stage === 'micro' && <Row label="Orbit held" value={`${Math.floor(control.colony.patrolDays)} / ${control.colony.patrolTarget} days`} tip="An armed ship on patrol in orbit, no hostile warship, nobody contesting the ground: 90 days promotes the colony and lifts its land cap" />}
            <Row label="Settlement" value={control.colony.settlement.kind === 'hall' ? 'Municipal government' : `Outpost · ${control.colony.settlement.population.toFixed(1)} / ${control.colony.settlement.hallAt} million for a municipal hall`} tip="The landing site starts as an outpost and becomes a municipal government building when the colony is big enough" />
            {control.colony.blockers.map((b) => <div key={b} className="inspect-status">Waiting: {b}</div>)}
          </div>
        </div>
      )}

      {control.decisions.length > 0 && (
        <div>
          <div className="econ-subtitle">Decisions</div>
          {control.decisions.map((d) => (
            <div key={`${d.id}-${d.withId ?? ''}`} className="ship-panel-btn-row">
              <button type="button" className="detail-view-btn" disabled={!!d.block} title={d.block ?? d.detail} onClick={() => decide(d)}>{d.label}</button>
              {d.block && <div className="inspect-status">{d.block}</div>}
            </div>
          ))}
          {message && <div className="econ-neg pl-message">{message}</div>}
        </div>
      )}

      {view.sovereign && <div className="abs-dim pl-land">Sovereignty is {view.sovereign.from}-wide.</div>}
      {view.contested && <div className="econ-neg pl-message">Disputed by {view.disputants.join(', ')}</div>}

      {view.claims.length > 0 && (
        <div>
          <div className="econ-subtitle">Claims</div>
          <div className="pl-district">
            {view.claims.map((c) => (
              <div key={c.id} className="inspect-row" title={`${STATUS_TIP[c.status]}\nBasis: ${c.basis} · ${c.evidence} item${c.evidence === 1 ? '' : 's'} of evidence`}>
                <span className="inspect-label">{c.claimant}</span>
                <span className="inspect-value">{c.status} · {c.scope}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {view.enclaves.length > 0 && (
        <div>
          <div className="econ-subtitle" title="Property of one country on ground another governs: it stays its owner's whatever happens to the sovereignty">Foreign-owned areas</div>
          <div className="pl-district">
            {view.enclaves.map((e) => (
              <Row key={e.siteId} label={siteName(e.siteId)} value={`owned by ${e.owner}`} />
            ))}
          </div>
        </div>
      )}

      {view.agreements.length > 0 && (
        <div>
          <div className="econ-subtitle">Agreements and bans in force</div>
          <div className="pl-district">
            {view.agreements.map((a) => (
              <div key={a} className="inspect-row">
                <span className="inspect-value" style={{ textAlign: 'left' }}>{a}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="econ-subtitle" title="Three different answers for each orbit: who has the right to govern it, who holds it by force, and who owns what is in it">Orbit</div>
      {view.orbit.map((z) => (
        <div key={z.zone} className="pl-district pl-orbit-zone">
          <div className="pl-district-head"><span className="pl-district-name">{z.kind[0].toUpperCase() + z.kind.slice(1)} orbit</span></div>
          <Row label="Governed by" value={z.governs} tip="The legal authority over this orbital zone (by default the planet's sovereign)" />
          <Row label="Held by force by" value={z.holds} tip="Derived from armed ships and working defense platforms present: it changes as they do" tone={z.holds === 'contested' ? 'neg' : undefined} />
          {z.facilities.map((f, i) => (
            <Row key={i} label={`  ${f.kind}`} value={`${f.owner}${f.working ? '' : ' (building)'}`} tip="Property of its owner; it confers no sovereignty" />
          ))}
          {stations.filter((sb) => sb.zone === z.zone).map((sb) => (
            <div key={sb.id} className="inspect-row">
              <button type="button" className="good-flow-link" style={{ width: 'auto', textAlign: 'left' }} title="Open the station: modules, power, tier" onClick={() => useStarbasePanelStore.getState().open(sb.id)}>
                {sb.name ?? 'Orbital station'} · {STARBASE_TIERS[sb.tier ?? 'starbase'].label}
              </button>
              <span className="inspect-value">{ownerDisplay(sb.ownerId).name}{sb.readySimDays > now ? ' (building)' : ''}</span>
            </div>
          ))}
          {playerId && !stations.some((sb) => sb.zone === z.zone) && (() => {
            const block = stationBuildBlock(playerId, z.zone, stations)
            return (
              <button type="button" className="detail-view-btn" disabled={!!block} title={block ?? `Found an orbital station here (${Object.entries(STARBASE_COST).map(([id, n]) => `${n} ${id}`).join(', ')}). Modules and tiers come after.`} onClick={() => buildStation(z.zone)}>
                Build station
              </button>
            )
          })()}
        </div>
      ))}
      {message && <div className="econ-neg pl-message">{message}</div>}

      {view.recent.length > 0 && (
        <div>
          <div className="econ-subtitle">Recent</div>
          <div className="pl-district">
            {view.recent.map((r, i) => (
              <div key={i} className="inspect-status">{r}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
