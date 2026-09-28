import { useHoverTipStore } from '../state/hoverTipStore'

// Draws the tooltip a 3D scene object asked for (state/hoverTipStore.ts), in the
// same style as every other tooltip in the game.
export function HoverTip() {
  const tip = useHoverTipStore((s) => s.tip)
  if (!tip) return null
  return (
    <div className="game-tooltip" role="tooltip" style={{ left: tip.x + 14, top: tip.y + 18 }}>
      <div className="game-tooltip-text">{tip.text}</div>
    </div>
  )
}
