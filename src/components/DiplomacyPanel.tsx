import { useEffect, useMemo, useRef, useState } from 'react'
import { COUNTRIES } from '../data/countryData'
import { STRATEGIC_AI_COUNTRY_IDS, ownerDisplay } from '../data/countryRoster'
import { TRUCE_DAYS, type PeaceTerms, type War } from '../data/diplomacyData'
import { useDiplomacyStore, relationIn } from '../state/diplomacyStore'
import { usePlayerStore } from '../state/playerStore'
import { useShipStore } from '../state/shipStore'
import { useTerritoryStore } from '../state/territoryStore'
import { useGameTimeStore, simDaysToDate } from '../state/gameTimeStore'
import { useConfirmStore } from '../state/confirmStore'
import { shipPower } from '../ai/blackboard'
import { declareWarOn, liveBodyValue, proposePeace } from '../scene/peace'
import { bodiesHeldFrom, cessionCost, scoreFor, warExhaustion } from '../scene/warScore'

// Diplomacy: relations with every other nation (and declaring war), the wars
// under way (war score, occupations, exhaustion, peace offers), and the event
// log. All the rules live in scene/peace.ts and scene/warScore.ts — the same
// ones the AI empires play by.

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

function RelationsTab() {
  const playerId = usePlayerStore((s) => s.selectedCountryId)
  const relations = useDiplomacyStore((s) => s.relations)
  const ships = useShipStore((s) => s.ships)
  const day = useDay()
  const [message, setMessage] = useState<string | null>(null)
  const power = useMemo(() => {
    const m = new Map<string, number>()
    for (const s of ships) m.set(s.ownerId, (m.get(s.ownerId) ?? 0) + shipPower(s))
    return m
  }, [ships])
  if (!playerId) return null

  const declare = (targetId: string) => {
    useConfirmStore.getState().requestConfirm({
      title: `Declare war on ${nameOf(targetId)}?`,
      effects: [
        'Your ships and theirs fight wherever they meet.',
        'You may invade their worlds once you hold the orbit.',
        `Peace later brings a ${Math.round(TRUCE_DAYS / 365)}-year truce.`,
        'Their opinion of you drops sharply.',
      ],
      confirmLabel: 'Declare war',
      onConfirm: () => {
        const r = declareWarOn(playerId, targetId, useGameTimeStore.getState().simDays)
        setMessage(r.ok ? `War declared on ${nameOf(targetId)}` : r.reason)
      },
    })
  }

  return (
    <div className="dip-list">
      {COUNTRIES.filter((c) => c.id !== playerId).map((c) => {
        const rel = relationIn(relations, playerId, c.id)
        const truceLeft = Math.max(0, Math.ceil(rel.truceUntilSimDays - day))
        const status = rel.status === 'war' ? 'At war' : truceLeft > 0 ? `Truce · ${truceLeft}d` : 'Peace'
        const ai = STRATEGIC_AI_COUNTRY_IDS.includes(c.id)
        return (
          <div key={c.id} className="dip-card">
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
            {rel.status !== 'war' && (
              <button
                type="button"
                className="detail-view-btn danger"
                disabled={truceLeft > 0}
                title={truceLeft > 0 ? 'A truce is still in effect' : undefined}
                onClick={() => declare(c.id)}
              >
                Declare War
              </button>
            )}
          </div>
        )
      })}
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
  if (subcategory === 'Events') return <EventsTab />
  return <RelationsTab />
}

// New diplomacy events pop up briefly at the top of the screen, whichever
// view is open — war declarations, occupations, peace.
const TOAST_MS = 7000
const MAX_TOASTS = 3

export function DiplomacyToast() {
  const events = useDiplomacyStore((s) => s.events)
  // The last event already on record when this mounted; anything after it is
  // new. '' when there were none, so the very first event still shows.
  const seen = useRef<string>(useDiplomacyStore.getState().events.at(-1)?.id ?? '')
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())
  const [toasts, setToasts] = useState<{ id: string; text: string; color: string }[]>([])

  useEffect(() => {
    const pending = timers.current
    return () => pending.forEach(clearTimeout)
  }, [])

  useEffect(() => {
    const last = events[events.length - 1]
    if (!last || last.id === seen.current) return
    const idx = events.findIndex((e) => e.id === seen.current)
    const fresh = events.slice(idx + 1)
    seen.current = last.id
    if (fresh.length === 0) return
    setToasts((t) => [...t, ...fresh.map((e) => ({ id: e.id, text: e.text, color: colorOf(e.countryIds[0] ?? '') }))].slice(-MAX_TOASTS))
    // Each batch expires on its own clock — a later event mustn't cancel an
    // earlier one's timeout.
    const ids = new Set(fresh.map((e) => e.id))
    const timer = setTimeout(() => {
      timers.current.delete(timer)
      setToasts((t) => t.filter((x) => !ids.has(x.id)))
    }, TOAST_MS)
    timers.current.add(timer)
  }, [events])

  if (toasts.length === 0) return null
  return (
    <div className="dip-toasts">
      {toasts.map((t) => (
        <div key={t.id} className="dip-toast" style={{ borderLeftColor: t.color }}>
          {t.text}
        </div>
      ))}
    </div>
  )
}
