import { resetGame } from '../scene/gameReset'
import { useMenuStore } from '../state/menuStore'
import { SettingsPanel } from './SettingsPanel'

// The Escape menu: resume, settings, and quit to the empire-select screen.
// Opening it pauses the game and closing it resumes (see state/menuStore.ts).
// Also the one place the keyboard controls are written down.
export function EscapeMenu() {
  const open = useMenuStore((s) => s.open)
  const closeMenu = useMenuStore((s) => s.closeMenu)
  const view = useMenuStore((s) => s.view)
  const setView = useMenuStore((s) => s.setView)
  if (!open) return null

  const close = closeMenu
  const quit = () => {
    // The game is being thrown away, so there is nothing to resume: clear the
    // menu without touching the (about to be reset) clock.
    useMenuStore.setState({ open: false, view: 'main', pausedByMenu: false })
    resetGame()
  }

  return (
    <div className="confirm-overlay escape-menu-overlay" onClick={close}>
      <div className="confirm-box escape-menu" onClick={(e) => e.stopPropagation()}>
        <div className="confirm-title">{view === 'settings' ? 'Settings' : view === 'quit' ? 'Quit to empire select?' : 'Paused'}</div>

        {view === 'main' && (
          <>
            <div className="escape-menu-buttons">
              <button type="button" className="confirm-btn confirm-btn-go" onClick={close}>
                Resume
              </button>
              <button type="button" className="confirm-btn" onClick={() => setView('settings')}>
                Settings
              </button>
              <button type="button" className="confirm-btn confirm-btn-cancel" onClick={() => setView('quit')}>
                Quit to empire select
              </button>
            </div>
            <ul className="confirm-effects escape-menu-keys">
              <li className="confirm-effect">Esc — this menu · Space — pause / resume</li>
              <li className="confirm-effect">W A S D — pan the camera</li>
              <li className="confirm-effect">Shift + right-click — queue an order after the current one</li>
            </ul>
          </>
        )}

        {view === 'settings' && (
          <>
            <SettingsPanel />
            <div className="confirm-actions">
              <button type="button" className="confirm-btn confirm-btn-go" onClick={() => setView('main')}>
                Back
              </button>
            </div>
          </>
        )}

        {view === 'quit' && (
          <>
            <div className="confirm-body">The game is not saved. You will return to the empire select screen and start over.</div>
            <div className="confirm-actions">
              <button type="button" className="confirm-btn confirm-btn-cancel" onClick={() => setView('main')}>
                Cancel
              </button>
              <button type="button" className="confirm-btn confirm-btn-go" onClick={quit}>
                Quit
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
