import { getStarsForNeighborhood } from '../data/starData'
import {
  BATTLE_KIND_LABELS,
  battlesAtBody,
  battlesInStars,
  battlesInSystem,
  type BattleKind,
  type PlayerBattle,
} from '../scene/battleList'
import { openBattle } from '../scene/battleNav'
import { useBattleStore } from '../state/battleStore'

// The indicator that the player is fighting somewhere: a small pulsing tag on a
// map marker, one per kind of battle (space / ground / contest) at or below it. Every map
// level shows them — a body's marker in the system and satellite views, a
// star's in the interstellar view, a neighbourhood's in the galactic view — so
// a fight in orbit of one planet reads from as far out as the galaxy. Clicking
// opens the battle.
export type BattleScope = { body: string } | { star: string } | { neighborhood: string }

function inScope(battles: PlayerBattle[], scope: BattleScope): PlayerBattle[] {
  if ('body' in scope) return battlesAtBody(battles, scope.body)
  if ('star' in scope) return battlesInSystem(battles, scope.star)
  return battlesInStars(
    battles,
    getStarsForNeighborhood(scope.neighborhood).map((s) => s.id),
  )
}

const KIND_GLYPH: Record<BattleKind, string> = { space: '✦', ground: '▲', terrain: '◈', contest: '◆' }

export function BattleBadge({ scope }: { scope: BattleScope }) {
  // A string, so the marker re-renders only when the kinds or count change.
  const key = useBattleStore((s) => {
    const here = inScope(s.battles, scope)
    return (['space', 'ground', 'terrain', 'contest'] as const).map((k) => `${k}:${here.filter((b) => b.kind === k).length}`).join(',')
  })
  const counts = key.split(',').map((c) => c.split(':')) as [BattleKind, string][]
  const present = counts.filter(([, n]) => Number(n) > 0)
  if (present.length === 0) return null
  return (
    <>
      {present.map(([kind, n]) => (
        <span
          key={kind}
          className={`battle-badge ${kind}`}
          title={
            kind === 'terrain'
              ? `${Number(n) > 1 ? `${n} ` : ''}Terrain battle${Number(n) > 1 ? 's' : ''} — units at close quarters — click to open`
              : kind === 'contest'
              ? `${Number(n) > 1 ? `${n} ` : ''}Contested world${Number(n) > 1 ? 's' : ''} — hostile armies, no fighting yet — click to open`
              : `${Number(n) > 1 ? `${n} ` : ''}${BATTLE_KIND_LABELS[kind]} battle${Number(n) > 1 ? 's' : ''} in progress — click to open`
          }
          onClick={(e) => {
            // The marker underneath selects its body/star on click; this
            // opens the fight instead.
            e.stopPropagation()
            const first = inScope(useBattleStore.getState().battles, scope).find((b) => b.kind === kind)
            if (first) openBattle(first)
          }}
        >
          {KIND_GLYPH[kind]}
          {Number(n) > 1 ? n : ''}
        </span>
      ))}
    </>
  )
}
