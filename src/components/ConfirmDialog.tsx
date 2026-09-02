import { useConfirmStore } from '../state/confirmStore'

// The global confirmation dialog. Any impactful action routes through
// confirmStore.requestConfirm and lands here: the player sees exactly what will
// happen (the effects list) and chooses to proceed or cancel.
export function ConfirmDialog() {
  const pending = useConfirmStore((s) => s.pending)
  const resolve = useConfirmStore((s) => s.resolve)
  if (!pending) return null

  return (
    <div className="confirm-overlay" onClick={() => resolve(false)}>
      <div className="confirm-box" onClick={(e) => e.stopPropagation()}>
        <div className="confirm-title">{pending.title}</div>
        {pending.body && <div className="confirm-body">{pending.body}</div>}
        {pending.effects.length > 0 && (
          <ul className="confirm-effects">
            {pending.effects.map((e, i) => (
              <li className="confirm-effect" key={i}>
                {e}
              </li>
            ))}
          </ul>
        )}
        <div className="confirm-actions">
          <button type="button" className="confirm-btn confirm-btn-cancel" onClick={() => resolve(false)}>
            Cancel
          </button>
          <button type="button" className="confirm-btn confirm-btn-go" onClick={() => resolve(true)}>
            {pending.confirmLabel ?? 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  )
}
