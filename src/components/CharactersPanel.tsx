import { useState } from 'react'
import { useEconomyStore } from '../state/economyStore'
import { formatMoney } from '../economy/format'
import { CULTURES, RELIGIONS } from '../economy/demographics'
import type { Character } from '../economy/economyTypes'

// The interactions available on a character. A representative set in the spirit
// of CK3 / Imperator / EU5 — some carry real mechanical effects (see the store's
// characterAction), the rest are flavor for now.
const INTERACTIONS: { id: string; label: string; needsCorp?: boolean; hint: string }[] = [
  { id: 'grant-funds', label: 'Grant Funds', hint: 'Gift $100M from the state to this character.' },
  { id: 'demand-dividend', label: 'Demand Dividend', needsCorp: true, hint: 'Extract a special dividend from their company into the state.' },
  { id: 'mentor', label: 'Mentor', hint: 'Invest in their education — improves administration.' },
  { id: 'honor', label: 'Honor', hint: 'Bestow a state honor, raising their prestige.' },
]

function CharacterDetail({ character }: { character: Character }) {
  const corporations = useEconomyStore((s) => s.corporations)
  const families = useEconomyStore((s) => s.families)
  const characterAction = useEconomyStore((s) => s.characterAction)
  const corp = corporations.find((c) => c.id === character.corporationId)
  const family = families.find((f) => f.id === character.familyId)
  const culture = CULTURES[character.cultureId]?.name ?? character.cultureId
  const religion = RELIGIONS[character.religionId]?.name ?? character.religionId

  return (
    <div className="char-detail">
      <div className="char-detail-head">
        <span className="char-detail-name">{character.name}</span>
        <span className="char-detail-role">{character.role === 'corp-leader' ? `Leader — ${corp?.name ?? 'Corporation'}` : 'Unaffiliated'}</span>
      </div>
      <div className="char-detail-rows">
        <div className="inspect-row">
          <span className="inspect-label">Age</span>
          <span className="inspect-value">{character.age}</span>
        </div>
        <div className="inspect-row">
          <span className="inspect-label">House</span>
          <span className="inspect-value">{family?.name ?? '—'}</span>
        </div>
        <div className="inspect-row">
          <span className="inspect-label">Culture</span>
          <span className="inspect-value">{culture}</span>
        </div>
        <div className="inspect-row">
          <span className="inspect-label">Faith</span>
          <span className="inspect-value">{religion}</span>
        </div>
        <div className="inspect-row">
          <span className="inspect-label">Wealth</span>
          <span className="inspect-value">{formatMoney(character.wealth)}</span>
        </div>
      </div>
      <div className="char-traits">
        {character.traits.map((t) => (
          <span key={t} className="char-trait">
            {t}
          </span>
        ))}
      </div>
      <div className="char-skills">
        <span>Admin <b>{character.skills.administration}</b></span>
        <span>Finance <b>{character.skills.finance}</b></span>
        <span>Diplomacy <b>{character.skills.diplomacy}</b></span>
      </div>

      <div className="econ-subtitle" style={{ marginTop: 8 }}>
        Interactions
      </div>
      <div className="char-actions">
        {INTERACTIONS.filter((a) => !a.needsCorp || character.corporationId).map((a) => (
          <button key={a.id} type="button" className="corp-btn" title={a.hint} onClick={() => characterAction(character.id, a.id)}>
            {a.label}
          </button>
        ))}
      </div>

      {character.log.length > 0 && (
        <>
          <div className="econ-subtitle" style={{ marginTop: 8 }}>
            History
          </div>
          <div className="char-log">
            {character.log
              .slice()
              .reverse()
              .map((l, i) => (
                <div key={i} className="char-log-line">
                  {l}
                </div>
              ))}
          </div>
        </>
      )}
    </div>
  )
}

export function CharactersPanel({ subcategory }: { subcategory: string | null }) {
  const characters = useEconomyStore((s) => s.characters)
  const families = useEconomyStore((s) => s.families)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  if (subcategory === 'Families') {
    return (
      <div className="econ-panel">
        <div className="econ-subtitle">Families</div>
        {families.length === 0 ? (
          <div className="nav-placeholder">No families of note.</div>
        ) : (
          families.map((f) => {
            const members = f.memberIds.map((id) => characters.find((c) => c.id === id)).filter(Boolean) as Character[]
            return (
              <div key={f.id} className="corp-card">
                <div className="corp-card-head">
                  <span className="corp-card-name">House {f.name}</span>
                  <span className="corp-card-sector">Prestige {f.prestige}</span>
                </div>
                <div className="char-family-members">
                  {members.map((m) => (
                    <button key={m.id} type="button" className="char-member-chip" onClick={() => setSelectedId(m.id)} title={m.traits.join(', ')}>
                      {m.name}
                      {m.role === 'corp-leader' && ' ★'}
                    </button>
                  ))}
                </div>
              </div>
            )
          })
        )}
        {selectedId && characters.find((c) => c.id === selectedId) && <CharacterDetail character={characters.find((c) => c.id === selectedId)!} />}
      </div>
    )
  }

  const selected = characters.find((c) => c.id === selectedId) ?? characters[0]
  return (
    <div className="econ-panel">
      <div className="econ-subtitle">Characters</div>
      <div className="char-list">
        {characters.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`char-list-item${selected?.id === c.id ? ' active' : ''}`}
            onClick={() => setSelectedId(c.id)}
          >
            <span className="char-list-name">{c.name}</span>
            <span className="char-list-role">{c.role === 'corp-leader' ? 'Leader' : 'Notable'}</span>
          </button>
        ))}
      </div>
      {selected && <CharacterDetail character={selected} />}
    </div>
  )
}
