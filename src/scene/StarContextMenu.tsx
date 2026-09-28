import { useEffect } from 'react'

export interface ContextMenuItem {
  label: string
  onClick: () => void
  disabled?: boolean
  title?: string
}

// A small right-click menu at the cursor. Closes on any click elsewhere, Escape,
// or scrolling.
export function ContextMenu({ x, y, title, items, onClose }: { x: number; y: number; title: string; items: ContextMenuItem[]; onClose: () => void }) {
  useEffect(() => {
    const close = (e: Event) => {
      if (e instanceof PointerEvent && e.target instanceof Element && e.target.closest('.context-menu')) return
      onClose()
    }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('pointerdown', close, true)
    document.addEventListener('wheel', close, true)
    document.addEventListener('keydown', key, true)
    return () => {
      document.removeEventListener('pointerdown', close, true)
      document.removeEventListener('wheel', close, true)
      document.removeEventListener('keydown', key, true)
    }
  }, [onClose])

  return (
    <div className="context-menu" style={{ left: Math.min(x, window.innerWidth - 200), top: Math.min(y, window.innerHeight - 40 - items.length * 30) }} onContextMenu={(e) => e.preventDefault()}>
      <div className="context-menu-title">{title}</div>
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          className="context-menu-item"
          disabled={item.disabled}
          title={item.title}
          onClick={() => {
            item.onClick()
            onClose()
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
