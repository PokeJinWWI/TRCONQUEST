import { useEffect, useMemo, useRef, useState } from 'react'
import { COUNTRIES, getCountry } from '../data/countryData'
import { STRATEGIC_AI_COUNTRY_IDS, ownerDisplay } from '../data/countryRoster'
import { TRUCE_DAYS, VASSALIZE_SCORE, type DiplomacyEvent, type PeaceTerms, type War } from '../data/diplomacyData'
import { TOAST_MS, goToEvent, tickToasts, type Toast } from '../scene/eventNavigation'
import { bindsForeignPolicy, paysTribute, SUBJECT_OFFER_MIN_POWER_RATIO, type SubjectType } from '../data/subjectData'
import { useDiplomacyStore, relationIn, warBetweenIn } from '../state/diplomacyStore'
import { usePlayerStore } from '../state/playerStore'
import { useShipStore } from '../state/shipStore'
import { useTerritoryStore } from '../state/territoryStore'
import { useSubjectStore, subjectsOf, subjectionOf, isSubjectOf } from '../state/subjectStore'
import { useTreatyStore, treatiesBetween, treatiesOf } from '../state/treatyStore'
import { useInternationalOrgStore } from '../state/internationalOrgStore'
import { ARTICLE_LABELS, describeArticle, expiresSimDays, isBinding, TREATY_DURATIONS_YEARS, type ArticleKind, type TreatyArticle, type TreatyDurationYears } from '../data/treatyData'
import { useGameTimeStore, simDaysToDate } from '../state/gameTimeStore'
import { useConfirmStore } from '../state/confirmStore'
import { shipPower } from '../ai/blackboard'
import { declareWarOn, liveBodyValue, proposePeace } from '../scene/peace'
import { canOfferSubjection, grantIndependence, releaseAsSubject } from '../scene/subjects'
import { cancelTreaty, proposeTreaty } from '../scene/treaties'
import { bodiesOwnedBy } from '../scene/territory'
import { spaceportSitesOf } from '../state/nationEconomy'
import { affordableReparations, bodiesHeldFrom, cessionCost, scoreFor, warExhaustion } from '../scene/warScore'

// Diplomacy: a directory of every nation (Relations) that drills into a full
// per-nation profile — Paradox-style, everything about (and doable to) that
// one nation in one screen: relation, any war between you, treaties, subject
// status, and every action — plus global overviews (Wars, Treaties, Subjects,
// Events) for the whole galaxy at a glance. All the rules live in
// scene/peace.ts, scene/warScore.ts, scene/treaties.ts and scene/subjects.ts —
// the same ones the AI empires play by.

function nameOf(id: string): string {
  return ownerDisplay(id).name
}
function colorOf(id: string): string {
  return ownerDisplay(id).color
}

function useDay(): number {
  return useGameTimeStore((s) => Math.floor(s.simDays))
}

function formatDate(simDays: number): string {
  const d = simDaysToDate(simDays)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

function Swatch({ id }: { id: string }) {
  return <span className="dip-swatch" style={{ background: colorOf(id) }} />
}

function useFleetPower(): Map<string, number> {
  const ships = useShipStore((s) => s.ships)
  return useMemo(() => {
    const m = new Map<string, number>()
    for (const s of ships) m.set(s.ownerId, (m.get(s.ownerId) ?? 0) + shipPower(s))
    return m
  }, [ships])
}

// A directory of every other nation — click one to open its full profile.
function RelationsTab() {
  const playerId = usePlayerStore((s) => s.selectedCountryId)
  const relations = useDiplomacyStore((s) => s.relations)
  const power = useFleetPower()
  const day = useDay()
  const [openId, setOpenId] = useState<string | null>(null)
  if (!playerId) return null

  if (openId === '__self__') return <MyProfile playerId={playerId} onBack={() => setOpenId(null)} />
  if (openId) return <CountryProfile id={openId} playerId={playerId} onBack={() => setOpenId(null)} />

  const mine = getCountry(playerId)

  return (
    <div className="dip-list">
      {mine && (
        <div className="dip-card dip-card-clickable dip-card-self" onClick={() => setOpenId('__self__')}>
          <div className="dip-card-head">
            <Swatch id={playerId} />
            <span className="dip-card-name">{mine.name} (You)</span>
          </div>
          <div className="inspect-row">
            <span className="inspect-label">Capital</span>
            <span className="inspect-value">{mine.capitalBodyName}</span>
          </div>
        </div>
      )}
      {COUNTRIES.filter((c) => c.id !== playerId).map((c) => {
        const rel = relationIn(relations, playerId, c.id)
        const truceLeft = Math.max(0, Math.ceil(rel.truceUntilSimDays - day))
        const status = rel.status === 'war' ? 'At war' : truceLeft > 0 ? `Truce · ${truceLeft}d` : 'Peace'
        const ai = STRATEGIC_AI_COUNTRY_IDS.includes(c.id)
        return (
          <div key={c.id} className="dip-card dip-card-clickable" onClick={() => setOpenId(c.id)}>
            <div className="dip-card-head">
              <Swatch id={c.id} />
              <span className="dip-card-name">{c.name}</span>
              <span className={`dip-status ${rel.status === 'war' ? 'war' : ''}`}>{status}</span>
            </div>
            <div className="inspect-row">
              <span className="inspect-label">Opinion of you</span>
              <span className={`inspect-value ${rel.opinion < 0 ? 'econ-neg' : rel.opinion > 0 ? 'econ-pos' : ''}`}>{Math.round(rel.opinion)}</span>
            </div>
            <div className="inspect-row">
              <span className="inspect-label">Fleet strength</span>
              <span className="inspect-value">
                {Math.round(power.get(c.id) ?? 0).toLocaleString()} <span className="dip-muted">(yours {Math.round(power.get(playerId) ?? 0).toLocaleString()})</span>
              </span>
            </div>
            <div className="inspect-row">
              <span className="inspect-label">Government</span>
              <span className="inspect-value">{ai ? 'AI empire' : 'Dormant'}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// Everything about, and everything doable to, one other nation — Paradox
// style: relation, any war between you two, treaties between you two,
// subject status between you two, and every action, all in one screen.
function CountryProfile({ id, playerId, onBack }: { id: string; playerId: string; onBack: () => void }) {
  const relations = useDiplomacyStore((s) => s.relations)
  const wars = useDiplomacyStore((s) => s.wars)
  const treaties = useTreatyStore((s) => s.treaties)
  const subjections = useSubjectStore((s) => s.subjections)
  const power = useFleetPower()
  const day = useDay()
  const bodyOwner = useTerritoryStore((s) => s.bodyOwner)
  const ships = useShipStore((s) => s.ships)
  const orgs = useInternationalOrgStore((s) => s.orgs)
  const [message, setMessage] = useState<string | null>(null)
  const [subjectType, setSubjectType] = useState<SubjectType>('vassal')
  const [pending, setPending] = useState<TreatyArticle[]>([])
  const [treatyName, setTreatyName] = useState('')
  const [durationYears, setDurationYears] = useState<TreatyDurationYears>(10)
  const [newKind, setNewKind] = useState<ArticleKind>('embassy')
  const [direction, setDirection] = useState<'mine' | 'theirs'>('mine')
  const [portBody, setPortBody] = useState('')
  const [subjectToTransfer, setSubjectToTransfer] = useState('')
  const [shipToTransfer, setShipToTransfer] = useState('')
  const [orgToJoin, setOrgToJoin] = useState('')

  const rel = relationIn(relations, playerId, id)
  const truceLeft = Math.max(0, Math.ceil(rel.truceUntilSimDays - day))
  const war = warBetweenIn(wars, playerId, id)
  const ai = STRATEGIC_AI_COUNTRY_IDS.includes(id)
  const ours = treatiesBetween(treaties, playerId, id)
  const theyAreMySubject = subjectionOf(subjections, id)?.suzerainId === playerId ? subjectionOf(subjections, id) : undefined
  const iAmTheirSubject = subjectionOf(subjections, playerId)?.suzerainId === id
  const inAnyHierarchy = isSubjectOf(playerId, id)

  const declare = (tier: 'skirmish' | 'limited') => {
    useConfirmStore.getState().requestConfirm({
      title: tier === 'skirmish' ? `Start a skirmish with ${nameOf(id)}?` : `Declare war on ${nameOf(id)}?`,
      effects:
        tier === 'skirmish'
          ? ['A limited, low-stakes conflict — no territory changes hands.', 'It lapses on its own if nobody presses it, or either side can escalate it.']
          : [
              'Your ships and theirs fight wherever they meet.',
              'You may invade their worlds once you hold the orbit.',
              `Peace later brings a ${Math.round(TRUCE_DAYS / 365)}-year truce.`,
              'Their opinion of you drops sharply.',
            ],
      confirmLabel: tier === 'skirmish' ? 'Start skirmish' : 'Declare war',
      onConfirm: () => {
        const r = declareWarOn(playerId, id, useGameTimeStore.getState().simDays, tier)
        setMessage(r.ok ? (tier === 'skirmish' ? `Skirmish started with ${nameOf(id)}` : `War declared on ${nameOf(id)}`) : r.reason)
      },
    })
  }

  const myPorts = bodiesOwnedBy(playerId, bodyOwner).filter((b) => spaceportSitesOf(b).length > 0)
  const theirPorts = bodiesOwnedBy(id, bodyOwner).filter((b) => spaceportSitesOf(b).length > 0)
  const isMutualKind = (k: ArticleKind) => k === 'embassy' || k === 'non-aggression-pact' || k === 'trade-agreement' || k === 'alliance' || k === 'defensive-pact'
  const isDirectionalNoParam = (k: ArticleKind) => k === 'investment-rights' || k === 'military-access'
  const mySubjects = subjectsOf(subjections, playerId)
  const theirSubjects = subjectsOf(subjections, id)
  const myShips = ships.filter((s) => s.ownerId === playerId)
  const theirShips = ships.filter((s) => s.ownerId === id)
  const myOrgs = orgs.filter((o) => o.leaderId === playerId)
  const theirOrgs = orgs.filter((o) => o.leaderId === id)

  const addArticle = () => {
    if (isMutualKind(newKind)) {
      if (pending.some((a) => a.kind === newKind)) return
      setPending([...pending, { kind: newKind } as TreatyArticle])
      return
    }
    if (newKind === 'guarantee-independence') {
      setPending([
        ...pending,
        direction === 'mine' ? { kind: 'guarantee-independence', guarantorId: playerId, guaranteedId: id } : { kind: 'guarantee-independence', guarantorId: id, guaranteedId: playerId },
      ])
      return
    }
    if (newKind === 'treaty-port') {
      if (!portBody) return
      setPending([
        ...pending,
        direction === 'mine' ? { kind: 'treaty-port', sourceId: playerId, targetId: id, bodyName: portBody } : { kind: 'treaty-port', sourceId: id, targetId: playerId, bodyName: portBody },
      ])
      setPortBody('')
      return
    }
    if (isDirectionalNoParam(newKind)) {
      setPending([
        ...pending,
        direction === 'mine' ? ({ kind: newKind, sourceId: playerId, targetId: id } as TreatyArticle) : ({ kind: newKind, sourceId: id, targetId: playerId } as TreatyArticle),
      ])
      return
    }
    if (newKind === 'transfer-subject') {
      if (!subjectToTransfer) return
      setPending([
        ...pending,
        direction === 'mine'
          ? { kind: 'transfer-subject', subjectId: subjectToTransfer, fromSuzerainId: playerId, toSuzerainId: id }
          : { kind: 'transfer-subject', subjectId: subjectToTransfer, fromSuzerainId: id, toSuzerainId: playerId },
      ])
      setSubjectToTransfer('')
      return
    }
    if (newKind === 'ship-transfer') {
      if (!shipToTransfer) return
      setPending([
        ...pending,
        direction === 'mine' ? { kind: 'ship-transfer', shipId: shipToTransfer, fromId: playerId, toId: id } : { kind: 'ship-transfer', shipId: shipToTransfer, fromId: id, toId: playerId },
      ])
      setShipToTransfer('')
      return
    }
    if (newKind === 'join-power-bloc') {
      if (!orgToJoin) return
      setPending([
        ...pending,
        direction === 'mine' ? { kind: 'join-power-bloc', orgId: orgToJoin, leaderId: id, joiningId: playerId } : { kind: 'join-power-bloc', orgId: orgToJoin, leaderId: playerId, joiningId: id },
      ])
      setOrgToJoin('')
    }
  }

  const proposeBundle = () => {
    if (pending.length === 0) return
    const r = proposeTreaty(playerId, id, pending, durationYears, useGameTimeStore.getState().simDays, treatyName)
    setMessage(r.ok ? `Treaty signed with ${nameOf(id)}` : r.reason)
    if (r.ok) {
      setPending([])
      setTreatyName('')
    }
  }

  const canSubjugate = !inAnyHierarchy && canOfferSubjection(playerId, id, power)

  return (
    <div className="dip-list">
      <div className="dip-card">
        <div className="dip-card-head">
          <button type="button" className="detail-view-btn" onClick={onBack}>
            ← Back
          </button>
          <Swatch id={id} />
          <span className="dip-card-name">{nameOf(id)}</span>
          <span className={`dip-status ${rel.status === 'war' ? 'war' : ''}`}>{rel.status === 'war' ? 'At war' : truceLeft > 0 ? `Truce · ${truceLeft}d` : 'Peace'}</span>
        </div>
        <div className="inspect-row">
          <span className="inspect-label">Opinion of you</span>
          <span className={`inspect-value ${rel.opinion < 0 ? 'econ-neg' : rel.opinion > 0 ? 'econ-pos' : ''}`}>{Math.round(rel.opinion)}</span>
        </div>
        <div className="inspect-row">
          <span className="inspect-label">Fleet strength</span>
          <span className="inspect-value">
            {Math.round(power.get(id) ?? 0).toLocaleString()} <span className="dip-muted">(yours {Math.round(power.get(playerId) ?? 0).toLocaleString()})</span>
          </span>
        </div>
        <div className="inspect-row">
          <span className="inspect-label">Government</span>
          <span className="inspect-value">{ai ? 'AI empire' : 'Dormant'}</span>
        </div>
        {theyAreMySubject && (
          <div className="inspect-row">
            <span className="inspect-label">Status</span>
            <span className="inspect-value">Your {theyAreMySubject.type}</span>
          </div>
        )}
        {iAmTheirSubject && (
          <div className="inspect-row">
            <span className="inspect-label">Status</span>
            <span className="inspect-value">You are their subject</span>
          </div>
        )}
        {!war && rel.status !== 'war' && !inAnyHierarchy && (
          <div className="dip-actions">
            <button type="button" className="detail-view-btn danger" disabled={truceLeft > 0} title={truceLeft > 0 ? 'A truce is still in effect' : undefined} onClick={() => declare('limited')}>
              Declare War
            </button>
            <button
              type="button"
              className="detail-view-btn"
              disabled={truceLeft > 0}
              title={truceLeft > 0 ? 'A truce is still in effect' : undefined}
              onClick={() => declare('skirmish')}
            >
              Start Skirmish
            </button>
          </div>
        )}
      </div>

      {war && <WarCard war={war} viewerId={playerId} />}

      <div className="dip-card">
        <div className="dip-card-head">
          <span className="dip-card-name">Treaties</span>
        </div>
        {ours.length === 0 && <div className="inspect-status">None in effect.</div>}
        {ours.map((t) => (
          <div key={t.id} className="dip-treaty-card">
            <div className="inspect-row">
              <span className="inspect-label">{t.name}</span>
              <button type="button" className="detail-view-btn danger" onClick={() => cancelTreaty(t.id, playerId, day)}>
                {isBinding(t, day) ? 'Cancel treaty' : 'Withdraw'}
              </button>
            </div>
            <div className="inspect-row">
              <span className="inspect-label">
                Signed {formatDate(t.signedSimDays)} · {t.durationYears}-year term
              </span>
              <span className="inspect-value">{isBinding(t, day) ? `Binding until ${formatDate(expiresSimDays(t))}` : 'Free to withdraw'}</span>
            </div>
            {t.articles.map((a, i) => (
              <div key={i} className="inspect-row">
                <span className="inspect-value">{describeArticle(a, playerId, nameOf)}</span>
              </div>
            ))}
          </div>
        ))}
        {rel.status !== 'war' && (
          <>
            {pending.length > 0 && (
              <div className="dip-treaty-pending">
                <div className="army-group-label">Pending — proposed as one treaty</div>
                {pending.map((a, i) => (
                  <div key={i} className="inspect-row">
                    <span className="inspect-value">{describeArticle(a, playerId, nameOf)}</span>
                    <button type="button" className="detail-view-btn danger" onClick={() => setPending(pending.filter((_, j) => j !== i))}>
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="dip-actions">
              <select className="econ-method-select" value={newKind} onChange={(e) => setNewKind(e.target.value as ArticleKind)}>
                {(
                  [
                    'embassy',
                    'non-aggression-pact',
                    'trade-agreement',
                    'alliance',
                    'defensive-pact',
                    'guarantee-independence',
                    'treaty-port',
                    'investment-rights',
                    'military-access',
                    'transfer-subject',
                    'ship-transfer',
                    'join-power-bloc',
                  ] as ArticleKind[]
                ).map((k) => (
                  <option key={k} value={k}>
                    {ARTICLE_LABELS[k]}
                  </option>
                ))}
              </select>
              {newKind === 'guarantee-independence' && (
                <select className="econ-method-select" value={direction} onChange={(e) => setDirection(e.target.value as 'mine' | 'theirs')}>
                  <option value="mine">You guarantee them</option>
                  <option value="theirs">They guarantee you</option>
                </select>
              )}
              {newKind === 'treaty-port' && (
                <>
                  <select className="econ-method-select" value={direction} onChange={(e) => setDirection(e.target.value as 'mine' | 'theirs')}>
                    <option value="mine">You cede a port to them</option>
                    <option value="theirs">They cede a port to you</option>
                  </select>
                  <select className="econ-method-select" value={portBody} onChange={(e) => setPortBody(e.target.value)}>
                    <option value="">Choose a world…</option>
                    {(direction === 'mine' ? myPorts : theirPorts).map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>
                </>
              )}
              {newKind === 'investment-rights' && (
                <select className="econ-method-select" value={direction} onChange={(e) => setDirection(e.target.value as 'mine' | 'theirs')}>
                  <option value="mine">You open your territory to them</option>
                  <option value="theirs">They open their territory to you</option>
                </select>
              )}
              {newKind === 'military-access' && (
                <select className="econ-method-select" value={direction} onChange={(e) => setDirection(e.target.value as 'mine' | 'theirs')}>
                  <option value="mine">You grant them access</option>
                  <option value="theirs">They grant you access</option>
                </select>
              )}
              {newKind === 'transfer-subject' && (
                <>
                  <select className="econ-method-select" value={direction} onChange={(e) => setDirection(e.target.value as 'mine' | 'theirs')}>
                    <option value="mine">You transfer a subject to them</option>
                    <option value="theirs">They transfer a subject to you</option>
                  </select>
                  <select className="econ-method-select" value={subjectToTransfer} onChange={(e) => setSubjectToTransfer(e.target.value)}>
                    <option value="">Choose a subject…</option>
                    {(direction === 'mine' ? mySubjects : theirSubjects).map((s) => (
                      <option key={s.subjectId} value={s.subjectId}>
                        {nameOf(s.subjectId)}
                      </option>
                    ))}
                  </select>
                </>
              )}
              {newKind === 'ship-transfer' && (
                <>
                  <select className="econ-method-select" value={direction} onChange={(e) => setDirection(e.target.value as 'mine' | 'theirs')}>
                    <option value="mine">You give them a ship</option>
                    <option value="theirs">They give you a ship</option>
                  </select>
                  <select className="econ-method-select" value={shipToTransfer} onChange={(e) => setShipToTransfer(e.target.value)}>
                    <option value="">Choose a ship…</option>
                    {(direction === 'mine' ? myShips : theirShips).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.id}
                      </option>
                    ))}
                  </select>
                </>
              )}
              {newKind === 'join-power-bloc' && (
                <>
                  <select className="econ-method-select" value={direction} onChange={(e) => setDirection(e.target.value as 'mine' | 'theirs')}>
                    <option value="mine">You join their organization</option>
                    <option value="theirs">They join your organization</option>
                  </select>
                  <select className="econ-method-select" value={orgToJoin} onChange={(e) => setOrgToJoin(e.target.value)}>
                    <option value="">Choose an organization…</option>
                    {(direction === 'mine' ? theirOrgs : myOrgs).map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                </>
              )}
              <button
                type="button"
                className="detail-view-btn"
                disabled={
                  (newKind === 'treaty-port' && !portBody) ||
                  (newKind === 'transfer-subject' && !subjectToTransfer) ||
                  (newKind === 'ship-transfer' && !shipToTransfer) ||
                  (newKind === 'join-power-bloc' && !orgToJoin)
                }
                onClick={addArticle}
              >
                Add Article
              </button>
            </div>
            {pending.length > 0 && (
              <div className="dip-actions">
                <input
                  type="text"
                  className="econ-method-select"
                  placeholder="Treaty name (optional)"
                  value={treatyName}
                  onChange={(e) => setTreatyName(e.target.value)}
                />
                <select className="econ-method-select" value={durationYears} onChange={(e) => setDurationYears(Number(e.target.value) as TreatyDurationYears)}>
                  {TREATY_DURATIONS_YEARS.map((y) => (
                    <option key={y} value={y}>
                      {y} years
                    </option>
                  ))}
                </select>
                <button type="button" className="detail-view-btn" onClick={proposeBundle}>
                  Propose Treaty ({pending.length} article{pending.length > 1 ? 's' : ''})
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {canSubjugate && (
        <div className="dip-card">
          <div className="dip-card-head">
            <span className="dip-card-name">Offer Subjection</span>
          </div>
          <div className="inspect-status">
            You are at least {SUBJECT_OFFER_MIN_POWER_RATIO}× their fleet strength — they may accept becoming your subject.
          </div>
          <div className="dip-actions">
            <select className="econ-method-select" value={subjectType} onChange={(e) => setSubjectType(e.target.value as SubjectType)}>
              {SUBJECT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="detail-view-btn"
              onClick={() => {
                useSubjectStore.getState().establishSubject(playerId, id, subjectType, day)
                setMessage(`${nameOf(id)} is now your ${subjectType}`)
              }}
            >
              Offer
            </button>
          </div>
        </div>
      )}
      {message && <div className="inspect-status ok">{message}</div>}
    </div>
  )
}

function ScoreBar({ score }: { score: number }) {
  const pct = (Math.max(-100, Math.min(100, score)) + 100) / 2
  return (
    <div className="dip-score">
      <span className="dip-score-track">
        <span className="dip-score-mid" />
        <span className={`dip-score-fill ${score >= 0 ? 'pos' : 'neg'}`} style={score >= 0 ? { left: '50%', width: `${pct - 50}%` } : { left: `${pct}%`, width: `${50 - pct}%` }} />
      </span>
      <span className={`dip-score-value ${score >= 0 ? 'econ-pos' : 'econ-neg'}`}>{score > 0 ? '+' : ''}{Math.round(score)}</span>
    </div>
  )
}

function WarCard({ war, viewerId }: { war: War; viewerId: string }) {
  const owners = useTerritoryStore((s) => s.bodyOwner)
  const controllers = useTerritoryStore((s) => s.bodyController)
  const day = useDay()
  const [message, setMessage] = useState<string | null>(null)
  const involved = war.attackerId === viewerId || war.defenderId === viewerId
  const me = involved ? viewerId : war.attackerId
  const them = war.attackerId === me ? war.defenderId : war.attackerId
  const score = scoreFor(war, me, owners, controllers, liveBodyValue)
  const iHold = bodiesHeldFrom(them, me, owners, controllers)
  const theyHold = bodiesHeldFrom(me, them, owners, controllers)
  const demandCost = cessionCost(iHold, them, owners, liveBodyValue)
  const reparations = affordableReparations(war, me, owners, controllers, liveBodyValue, day)

  const offer = (terms: PeaceTerms) => {
    const verdict = proposePeace(war.id, me, terms, useGameTimeStore.getState().simDays)
    setMessage(verdict.accept ? `${nameOf(them)} accepted.` : `${nameOf(them)} refused: ${verdict.reason}`)
  }

  return (
    <div className="dip-card">
      <div className="dip-card-head">
        <Swatch id={me} />
        <span className="dip-card-name">
          {nameOf(me)} vs {nameOf(them)}
        </span>
        <Swatch id={them} />
      </div>
      <div className="inspect-row">
        <span className="inspect-label">Since</span>
        <span className="inspect-value">
          {formatDate(war.startedSimDays)} · {nameOf(war.attackerId)} attacked
        </span>
      </div>
      <div className="inspect-row">
        <span className="inspect-label">War score ({nameOf(me)})</span>
      </div>
      <ScoreBar score={score} />
      <div className="inspect-row">
        <span className="inspect-label">{involved ? 'You occupy' : `${nameOf(me)} occupies`}</span>
        <span className="inspect-value">{iHold.length ? iHold.join(', ') : '—'}</span>
      </div>
      <div className="inspect-row">
        <span className="inspect-label">{involved ? 'They occupy' : `${nameOf(them)} occupies`}</span>
        <span className="inspect-value">{theyHold.length ? theyHold.join(', ') : '—'}</span>
      </div>
      <div className="inspect-row">
        <span className="inspect-label">Exhaustion</span>
        <span className="inspect-value">
          {Math.round(warExhaustion(war, me, day))}% · them {Math.round(warExhaustion(war, them, day))}%
        </span>
      </div>
      {involved && (
        <div className="dip-actions">
          <button type="button" className="detail-view-btn" onClick={() => offer({ kind: 'white' })}>
            Offer White Peace
          </button>
          {iHold.length > 0 && (
            <button
              type="button"
              className="detail-view-btn"
              title={`Costs ${Math.ceil(demandCost)} war score`}
              onClick={() => offer({ kind: 'cede', bodies: iHold })}
            >
              Demand {iHold.join(', ')} ({Math.ceil(demandCost)})
            </button>
          )}
          <button
            type="button"
            className="detail-view-btn"
            title={`They become your vassal and the war ends. Costs ${VASSALIZE_SCORE} war score (half if they are exhausted). Not possible against a subject.`}
            onClick={() => offer({ kind: 'vassalize', subjectType: 'vassal' })}
          >
            Demand vassalization ({VASSALIZE_SCORE})
          </button>
          {reparations > 0 && (
            <button
              type="button"
              className="detail-view-btn"
              title="They hand you this share of every good in their stockpile. Each percent costs a point of war score (half a point if they are exhausted)."
              onClick={() => offer({ kind: 'reparations', share: reparations })}
            >
              Demand reparations ({Math.round(reparations * 100)}% of their stockpile)
            </button>
          )}
        </div>
      )}
      {message && <div className="inspect-status ok">{message}</div>}
    </div>
  )
}

function WarsTab() {
  const playerId = usePlayerStore((s) => s.selectedCountryId)
  const wars = useDiplomacyStore((s) => s.wars)
  if (!playerId) return null
  const mine = wars.filter((w) => w.attackerId === playerId || w.defenderId === playerId)
  const others = wars.filter((w) => !mine.includes(w))
  return (
    <div className="dip-list">
      {mine.length === 0 && <div className="inspect-status">You are at peace.</div>}
      {mine.map((w) => (
        <WarCard key={w.id} war={w} viewerId={playerId} />
      ))}
      {others.length > 0 && (
        <>
          <div className="army-group-label">Other wars</div>
          {others.map((w) => (
            <WarCard key={w.id} war={w} viewerId={playerId} />
          ))}
        </>
      )}
    </div>
  )
}

// The list body shared by the global Treaties tab and MyProfile's own copy —
// one card per treaty, listing every article it bundles.
function TreatyList({ playerId }: { playerId: string }) {
  const treaties = useTreatyStore((s) => s.treaties)
  const day = useDay()
  const mine = treatiesOf(treaties, playerId)

  return (
    <>
      {mine.length === 0 && <div className="inspect-status">No treaties in effect. Open a nation under Relations to propose one.</div>}
      {mine.map((t) => {
        const otherId = t.a === playerId ? t.b : t.a
        return (
          <div key={t.id} className="dip-card">
            <div className="dip-card-head">
              <Swatch id={otherId} />
              <span className="dip-card-name">{t.name}</span>
              <span className="dip-muted">
                {nameOf(otherId)} · {t.durationYears}y
              </span>
            </div>
            <div className="inspect-row">
              <span className="inspect-label">Signed {formatDate(t.signedSimDays)}</span>
              <span className="inspect-value">{isBinding(t, day) ? `Binding until ${formatDate(expiresSimDays(t))}` : 'Free to withdraw'}</span>
            </div>
            {t.articles.map((a, i) => (
              <div key={i} className="inspect-row">
                <span className="inspect-value">{describeArticle(a, playerId, nameOf)}</span>
              </div>
            ))}
            <div className="dip-actions">
              <button type="button" className="detail-view-btn danger" onClick={() => cancelTreaty(t.id, playerId, day)}>
                {isBinding(t, day) ? 'Cancel treaty' : 'Withdraw'}
              </button>
            </div>
          </div>
        )
      })}
    </>
  )
}

// A read-only overview of every treaty the player's nation holds — to
// propose or cancel one, open that nation's profile from the Relations tab.
function TreatiesTab() {
  const playerId = usePlayerStore((s) => s.selectedCountryId)
  if (!playerId) return null
  return (
    <div className="dip-list">
      <TreatyList playerId={playerId} />
    </div>
  )
}

// Your own nation's diplomatic profile — everything Wars/Treaties/Subjects
// show scattered across the galaxy, but scoped to you: every war you're in,
// every treaty you hold, and your subject/suzerain standing, all in one
// screen, same idea as CountryProfile but for yourself.
function MyProfile({ playerId, onBack }: { playerId: string; onBack: () => void }) {
  const wars = useDiplomacyStore((s) => s.wars)
  const mine = getCountry(playerId)
  const myWars = wars.filter((w) => w.attackerId === playerId || w.defenderId === playerId)

  return (
    <div className="dip-list">
      <div className="dip-card">
        <div className="dip-card-head">
          <button type="button" className="detail-view-btn" onClick={onBack}>
            ← Back
          </button>
          <Swatch id={playerId} />
          <span className="dip-card-name">{mine?.name ?? playerId}</span>
        </div>
        <div className="inspect-row">
          <span className="inspect-label">Capital</span>
          <span className="inspect-value">{mine?.capitalBodyName ?? '—'}</span>
        </div>
      </div>

      <div className="army-group-label">Wars</div>
      {myWars.length === 0 && <div className="inspect-status">At peace with everyone.</div>}
      {myWars.map((w) => (
        <WarCard key={w.id} war={w} viewerId={playerId} />
      ))}

      <div className="army-group-label">Treaties</div>
      <TreatyList playerId={playerId} />

      <div className="army-group-label">Subjects</div>
      <SubjectsTab />
    </div>
  )
}

const SUBJECT_TYPES: SubjectType[] = ['vassal', 'protectorate', 'tributary', 'client-state', 'autonomous-region']

function SubjectsTab() {
  const playerId = usePlayerStore((s) => s.selectedCountryId)
  const subjections = useSubjectStore((s) => s.subjections)
  const bodyOwner = useTerritoryStore((s) => s.bodyOwner)
  const day = useDay()
  const [message, setMessage] = useState<string | null>(null)
  const [releaseBody, setReleaseBody] = useState('')
  const [releaseName, setReleaseName] = useState('')
  const [releaseType, setReleaseType] = useState<SubjectType>('vassal')
  if (!playerId) return null

  const mySubjects = subjectsOf(subjections, playerId)
  const myOverlord = subjectionOf(subjections, playerId)
  const player = getCountry(playerId)
  const releasable = bodiesOwnedBy(playerId, bodyOwner).filter((b) => b !== player?.capitalBodyName)

  const doRelease = () => {
    const r = releaseAsSubject(playerId, releaseBody, releaseName, releaseType, useGameTimeStore.getState().simDays)
    if (r.ok) {
      setMessage(`${releaseName} released as a ${releaseType}`)
      setReleaseBody('')
      setReleaseName('')
    } else setMessage(r.reason)
  }

  return (
    <div className="dip-list">
      {myOverlord && (
        <div className="dip-card">
          <div className="dip-card-head">
            <Swatch id={myOverlord.suzerainId} />
            <span className="dip-card-name">Subject of {nameOf(myOverlord.suzerainId)}</span>
          </div>
          <div className="inspect-row">
            <span className="inspect-label">Status</span>
            <span className="inspect-value">
              {myOverlord.type} {bindsForeignPolicy(myOverlord.type) ? '(no independent foreign policy)' : ''}
            </span>
          </div>
        </div>
      )}
      {mySubjects.length === 0 && !myOverlord && <div className="inspect-status">You have no subjects.</div>}
      {mySubjects.map((sub) => (
        <div key={sub.subjectId} className="dip-card">
          <div className="dip-card-head">
            <Swatch id={sub.subjectId} />
            <span className="dip-card-name">{nameOf(sub.subjectId)}</span>
            <span className="dip-status">{sub.type}</span>
          </div>
          <div className="inspect-row">
            <span className="inspect-label">Since</span>
            <span className="inspect-value">{formatDate(sub.sinceSimDays)}</span>
          </div>
          <div className="inspect-row">
            <span className="inspect-label">Market</span>
            <span className="inspect-value">{sub.separateMarket ? 'Separate' : 'Shared with you'}</span>
          </div>
          {paysTribute(sub.type) && (
            <div className="inspect-row">
              <span className="inspect-label">Tribute</span>
              <span className="inspect-value">Paid monthly</span>
            </div>
          )}
          <div className="dip-actions">
            <select className="econ-method-select" value={sub.type} onChange={(e) => useSubjectStore.getState().changeSubjectType(sub.subjectId, e.target.value as SubjectType)}>
              {SUBJECT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="detail-view-btn"
              onClick={() => useSubjectStore.getState().setSeparateMarket(sub.subjectId, !sub.separateMarket)}
            >
              {sub.separateMarket ? 'Share market' : 'Grant separate market'}
            </button>
            <button type="button" className="detail-view-btn danger" onClick={() => grantIndependence(sub.subjectId, day)}>
              Grant Independence
            </button>
          </div>
        </div>
      ))}
      <div className="dip-card">
        <div className="dip-card-head">
          <span className="dip-card-name">Release a world as a new subject</span>
        </div>
        {releasable.length === 0 ? (
          <div className="inspect-status">You have no world you can release (your capital can't be released).</div>
        ) : (
          <>
            <div className="dip-actions">
              <select className="econ-method-select" value={releaseBody} onChange={(e) => setReleaseBody(e.target.value)}>
                <option value="">Choose a world…</option>
                {releasable.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
              <select className="econ-method-select" value={releaseType} onChange={(e) => setReleaseType(e.target.value as SubjectType)}>
                {SUBJECT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div className="dip-actions">
              <input
                type="text"
                className="econ-method-select"
                placeholder="New nation's name (e.g. Kingdom of Luna)"
                value={releaseName}
                onChange={(e) => setReleaseName(e.target.value)}
              />
              <button type="button" className="detail-view-btn" disabled={!releaseBody || !releaseName.trim()} onClick={doRelease}>
                Release
              </button>
            </div>
          </>
        )}
      </div>
      {message && <div className="inspect-status ok">{message}</div>}
    </div>
  )
}

function EventsTab() {
  const events = useDiplomacyStore((s) => s.events)
  return (
    <div className="dip-list">
      {events.length === 0 && <div className="inspect-status">Nothing has happened yet.</div>}
      {[...events].reverse().map((e) => (
        <div key={e.id} className="dip-event">
          <span className="dip-event-date">{formatDate(e.simDays)}</span>
          <span className="dip-event-text">
            {e.countryIds[0] && <Swatch id={e.countryIds[0]} />}
            {e.text}
          </span>
        </div>
      ))}
    </div>
  )
}

export function DiplomacyPanel({ subcategory }: { subcategory: string | null }) {
  if (subcategory === 'Wars') return <WarsTab />
  if (subcategory === 'Treaties') return <TreatiesTab />
  if (subcategory === 'Subjects') return <SubjectsTab />
  if (subcategory === 'Events') return <EventsTab />
  return <RelationsTab />
}

// New diplomacy events pop up at the top of the screen, whichever view is open
// — war declarations, occupations, peace, colonies. Each stays TOAST_MS of
// real time, counted only while the game runs (scene/eventNavigation).
// Left-click goes to where it happened (or its Diplomacy tab); right-click
// dismisses it.
const MAX_TOASTS = 3
const TOAST_TICK_MS = 200

type ToastItem = Toast & { event: DiplomacyEvent; color: string }

export function DiplomacyToast() {
  const events = useDiplomacyStore((s) => s.events)
  // The last event already on record when this mounted; anything after it is
  // new. '' when there were none, so the very first event still shows.
  const seen = useRef<string>(useDiplomacyStore.getState().events.at(-1)?.id ?? '')
  const [toasts, setToasts] = useState<ToastItem[]>([])

  useEffect(() => {
    const last = events[events.length - 1]
    if (!last || last.id === seen.current) return
    const idx = events.findIndex((e) => e.id === seen.current)
    const fresh = events.slice(idx + 1)
    seen.current = last.id
    if (fresh.length === 0) return
    setToasts((t) => [...t, ...fresh.map((e) => ({ id: e.id, remainingMs: TOAST_MS, event: e, color: colorOf(e.countryIds[0] ?? '') }))].slice(-MAX_TOASTS))
  }, [events])

  // A real-time clock (setInterval, not the game's), standing still while paused.
  const any = toasts.length > 0
  useEffect(() => {
    if (!any) return
    const timer = setInterval(() => setToasts((t) => tickToasts(t, TOAST_TICK_MS, useGameTimeStore.getState().paused)), TOAST_TICK_MS)
    return () => clearInterval(timer)
  }, [any])

  const dismiss = (id: string) => setToasts((t) => t.filter((x) => x.id !== id))
  if (toasts.length === 0) return null
  return (
    <div className="dip-toasts">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="dip-toast"
          style={{ borderLeftColor: t.color }}
          title="Click to go there · right-click to dismiss"
          onClick={() => {
            goToEvent(t.event)
            dismiss(t.id)
          }}
          onContextMenu={(e) => {
            e.preventDefault()
            dismiss(t.id)
          }}
        >
          {t.event.text}
        </div>
      ))}
    </div>
  )
}
