import { useState } from 'react'
import { BOMBARD_STANCES, BOMBARD_STANCE_DESCRIPTIONS, BOMBARD_STANCE_LABELS, DEFENSE_DEFS, DEFENSE_KINDS, type DefenseKind } from '../../data/defenseData'
import { RESOURCE_TYPES, type ResourceId } from '../../data/resourceData'
import { ownerDisplay } from '../../data/countryRoster'
import { useDefenseStore, canBuildDefense } from '../../state/defenseStore'
import { useTerritoryStore } from '../../state/territoryStore'
import { useGameTimeStore } from '../../state/gameTimeStore'
import { useArmyStore } from '../../state/armyStore'
import { useShipStore } from '../../state/shipStore'
import { useResourceStore } from '../../state/resourceStore'
import { atWar } from '../../state/diplomacyStore'
import { holderOfInstallation, isActive } from '../../scene/defenseLogic'
import { hostileWarshipsAt, armyStrength, isArmed, orbitedBody } from '../../scene/armyLogic'
import { useBombardmentStore } from '../../state/bombardmentStore'
import { canBombard } from '../../scene/bombardment'
import { queueBombard } from '../../scene/commsVisual'
import { controllerOf } from '../../scene/territory'
import { PlanetIcon } from './PlanetIcons'

// The planet screen's Defense tab (both economy modes): the world's defense
// installations (status, integrity, who holds them — they can be captured),
// building new ones, and the garrison and orbit at a glance.

const RESOURCE_NAME = Object.fromEntries(RESOURCE_TYPES.map((r) => [r.id, r.name])) as Record<ResourceId, string>

export function DefenseTab({ bodyName, playerId }: { bodyName: string; playerId: string | null }) {
  const installations = useDefenseStore((s) => s.installations)
  const build = useDefenseStore((s) => s.build)
  const owners = useTerritoryStore((s) => s.bodyOwner)
  const controllers = useTerritoryStore((s) => s.bodyController)
  const holders = useTerritoryStore((s) => s.nodeHolders)
  const simDays = useGameTimeStore((s) => s.simDays)
  const armies = useArmyStore((s) => s.armies)
  const ships = useShipStore((s) => s.ships)
  const amounts = useResourceStore((s) => (playerId ? s.byCountry[playerId]?.amounts : undefined))
  const [message, setMessage] = useState<string | null>(null)
  const devastation = useBombardmentStore((s) => s.devastation[bodyName] ?? 0)
  const strikes = useBombardmentStore((s) => s.strikes)

  const here = installations.filter((i) => i.bodyName === bodyName)
  const controller = controllerOf(bodyName, owners, controllers)
  const mine = !!playerId && owners[bodyName] === playerId && controller === playerId
  const garrison = armies.filter((a) => a.location.kind === 'body' && a.location.bodyName === bodyName)
  const byOwner = new Map<string, number>()
  for (const a of garrison) byOwner.set(a.ownerId, (byOwner.get(a.ownerId) ?? 0) + armyStrength(a).strength)
  const hostileShips = controller ? hostileWarshipsAt(controller, bodyName, ships, atWar) : []

  const myShipsHere = playerId ? ships.filter((s) => s.ownerId === playerId && orbitedBody(s) === bodyName && isArmed(s)) : []
  const strikesHere = strikes.filter((st) => st.bodyName === bodyName)
  const mayBombard = !!playerId && canBombard(playerId, bodyName, ships.map((s) => ({ id: s.id, ownerId: s.ownerId, bodyName: orbitedBody(s), armed: isArmed(s), weapons: 0, stance: 'off' as const })), owners, controllers, atWar)
  const doBuild = (kind: DefenseKind) => {
    if (!playerId) return
    const res = build(playerId, bodyName, kind, simDays)
    setMessage(res.ok ? null : res.reason)
  }

  return (
    <div className="pl-defense">
      <div className="pl-stat-grid">
        <div className="pl-stat" title="Defense installations on this world"><span>Installations</span><b>{here.length}</b></div>
        <div className={`pl-stat${hostileShips.length > 0 ? ' warn' : ''}`} title="Armed enemy warships orbiting this world"><span>Hostile ships</span><b>{hostileShips.length}</b></div>
        <div className="pl-stat" title="Ground forces on the surface"><span>Armies</span><b>{garrison.length}</b></div>
      </div>
      {byOwner.size > 0 && (
        <div className="pl-output">
          {[...byOwner.entries()].map(([id, str]) => (
            <span key={id} className="pl-output-chip" style={{ borderColor: ownerDisplay(id).color }}>{ownerDisplay(id).name} <b style={{ color: ownerDisplay(id).color }}>{Math.round(str)}</b></span>
          ))}
        </div>
      )}

      {(devastation > 0 || strikesHere.length > 0) && (
        <div className="pl-bombard">
          <div className="cb-meter" title="Damage from orbital bombardment — it cuts this world's output by up to half, and heals slowly once the bombing stops.">
            <div className="cb-meter-head"><span>Devastation</span><span className="cb-meter-val">{Math.round(devastation * 100)}%</span></div>
            <div className="cb-meter-track"><div className="cb-meter-fill" style={{ width: `${devastation * 100}%`, background: '#ff6b4a' }} /></div>
          </div>
          {strikesHere.map((st) => (
            <div key={st.attackerId} className="econ-neg" style={{ fontSize: 10 }}>
              Under {st.full ? 'FULL' : 'orbital'} bombardment by {ownerDisplay(st.attackerId).name}{st.shielded ? ' (the shield is absorbing most of it)' : ''}
            </div>
          ))}
        </div>
      )}

      {myShipsHere.length > 0 && owners[bodyName] !== playerId && (
        <div className="pl-bombard-order">
          <span className="abs-dim">Your {myShipsHere.length} armed ship{myShipsHere.length === 1 ? '' : 's'} in orbit:</span>
          {BOMBARD_STANCES.map((b) => (
            <button key={b} type="button" className="laws-enact-btn" disabled={b !== 'off' && !mayBombard} title={mayBombard || b === 'off' ? BOMBARD_STANCE_DESCRIPTIONS[b] : 'Needs war with this world’s holder and no enemy warships in orbit'}
              onClick={() => myShipsHere.forEach((s) => queueBombard(s, b))}>
              {BOMBARD_STANCE_LABELS[b]}
            </button>
          ))}
        </div>
      )}

      <div className="econ-subtitle">Installations</div>
      {here.length === 0 && <div className="abs-dim">None — this world has no fixed defenses.</div>}
      <div className="pl-def-list">
        {here.map((i) => {
          const def = DEFENSE_DEFS[i.kind]
          const holder = holderOfInstallation(i, owners, holders)
          const building = !isActive(i, simDays)
          const captured = holder && holder !== i.builtBy
          const frac = Math.max(0, Math.min(1, i.integrity / def.integrity))
          return (
            <div key={i.id} className={`pl-def${building ? ' building' : ''}`} title={def.description}>
              <PlanetIcon id={i.kind} size={26} />
              <div className="pl-def-body">
                <div className="pl-def-name">
                  {def.name}
                  {building && <span className="abs-dim"> · ready in {Math.ceil(i.readySimDays - simDays)} days</span>}
                  {captured && <span className="econ-neg"> · captured</span>}
                </div>
                <div className="abs-dim">
                  Held by <span style={{ color: holder ? ownerDisplay(holder).color : undefined }}>{holder ? ownerDisplay(holder).name : 'nobody'}</span>
                </div>
                <span className="pl-def-bar" title={`Integrity ${Math.round(i.integrity)} / ${def.integrity}`}><span style={{ width: `${frac * 100}%` }} /></span>
              </div>
            </div>
          )
        })}
      </div>

      {mine && (
        <>
          <div className="econ-subtitle" style={{ marginTop: 10 }}>Build</div>
          {message && <div className="econ-neg pl-message">{message}</div>}
          <div className="pl-def-build">
            {DEFENSE_KINDS.map((kind) => {
              const def = DEFENSE_DEFS[kind]
              const check = canBuildDefense(playerId!, bodyName, kind, installations)
              const cost = Object.entries(def.cost) as [ResourceId, number][]
              return (
                <button key={kind} type="button" className="pl-pick" disabled={!check.ok} title={check.ok ? def.description : `${def.description}\n\n${(check as { reason: string }).reason}`} onClick={() => doBuild(kind)}>
                  <PlanetIcon id={kind} size={18} />
                  <span>{def.name}</span>
                  <span className="abs-dim">
                    {cost.map(([r, n]) => (
                      <span key={r} className={(amounts?.[r] ?? 0) < n ? 'econ-neg' : ''}>{n} {RESOURCE_NAME[r]} </span>
                    ))}
                    · {def.buildDays}d
                  </span>
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
