import { Bi } from './Bi'
import { resetGame } from '../scene/gameReset'
import { useMenuStore } from '../state/menuStore'
import { SaveSlots } from './SaveSlots'
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
        <div className="confirm-title">{view === 'settings' ? 'Settings' : view === 'saves' ? 'Save / Load' : view === 'quit' ? 'Quit to empire select?' : 'Paused'}</div>

        {view === 'main' && (
          <>
            <div className="escape-menu-buttons">
              <button type="button" className="confirm-btn confirm-btn-go" onClick={close}>
                <Bi en="Resume" />
              </button>
              <button type="button" className="confirm-btn" onClick={() => setView('saves')}>
                <Bi en="Save / Load" />
              </button>
              <button type="button" className="confirm-btn" onClick={() => setView('settings')}>
                <Bi en="Settings" />
              </button>
              <button type="button" className="confirm-btn confirm-btn-cancel" onClick={() => setView('quit')}>
                <Bi en="Quit to empire select" />
              </button>
            </div>
            <ul className="confirm-effects escape-menu-keys">
              <li className="confirm-effect">Esc — this menu · Space — pause / resume</li>
              <li className="confirm-effect">W A S D — pan the camera</li>
              <li className="confirm-effect">Shift + right-click — queue an order after the current one</li>
            </ul>
          </>
        )}

        {view === 'saves' && (
          <>
            {/* A loaded game is paused; the menu closing must not unpause it. */}
            <SaveSlots canSave onLoaded={() => useMenuStore.setState({ open: false, view: 'main', pausedByMenu: false })} />
            <div className="confirm-actions">
              <button type="button" className="confirm-btn confirm-btn-go" onClick={() => setView('main')}>
                <Bi en="Back" />
              </button>
            </div>
          </>
        )}

        {view === 'settings' && (
          <>
            <SettingsPanel />
            <div className="confirm-actions">
              <button type="button" className="confirm-btn confirm-btn-go" onClick={() => setView('main')}>
                <Bi en="Back" />
              </button>
            </div>
          </>
        )}

        {view === 'quit' && (
          <>
            <div className="confirm-body">Unsaved progress is lost. You will return to the empire select screen and start over.</div>
            <div className="confirm-actions">
              <button type="button" className="confirm-btn confirm-btn-cancel" onClick={() => setView('main')}>
                <Bi en="Cancel" />
              </button>
              <button type="button" className="confirm-btn confirm-btn-go" onClick={quit}>
                <Bi en="Quit" />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
