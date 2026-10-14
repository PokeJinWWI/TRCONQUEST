// Resizable side panels: saved widths load clamped, junk gives the defaults, and the stylesheet
// sizes the nav sidebar and the Outliner (and everything placed beside them) from the width
// variables, never a fixed 220px. See state/sidePanelStore.ts, components/SidePanelResizer.tsx.
//
// Run:  npx tsx tests/sidePanels.test.ts

import { readFileSync } from 'node:fs'
import { SIDE_PANEL_DEFAULT, SIDE_PANEL_MAX, SIDE_PANEL_MIN, clampSidePanel, parseSidePanels, useSidePanelStore } from '../src/state/sidePanelStore'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

console.log('\n=== 1. Widths ===')
check('defaults with nothing saved', parseSidePanels(null).nav === SIDE_PANEL_DEFAULT && parseSidePanels(null).outliner === SIDE_PANEL_DEFAULT)
check('a saved width loads', parseSidePanels('{"nav":300,"outliner":180}').nav === 300 && parseSidePanels('{"nav":300,"outliner":180}').outliner === 180)
check('out-of-range widths are clamped', parseSidePanels('{"nav":5,"outliner":9999}').nav === SIDE_PANEL_MIN && parseSidePanels('{"nav":5,"outliner":9999}').outliner === SIDE_PANEL_MAX)
check('bad JSON or wrong types give the defaults', parseSidePanels('{{').nav === SIDE_PANEL_DEFAULT && parseSidePanels('{"nav":"wide"}').nav === SIDE_PANEL_DEFAULT)
check('NaN is never stored', clampSidePanel(Number.NaN) === SIDE_PANEL_DEFAULT)
useSidePanelStore.getState().setWidth('outliner', 1000)
check('setWidth clamps', useSidePanelStore.getState().widths.outliner === SIDE_PANEL_MAX)

console.log('\n=== 2. The stylesheet follows the variables ===')
{
  const css = readFileSync('src/App.css', 'utf8')
  const rule = (sel: string) => css.match(new RegExp(`${sel.replace('.', '\\.')}\\s*{[^}]*}`))?.[0] ?? ''
  check('the nav sidebar is --nav-width wide', /width:\s*var\(--nav-width/.test(rule('.nav-sidebar')))
  check('the Outliner is --outliner-width wide', /width:\s*var\(--outliner-width/.test(rule('.outliner')))
  check('their content follows too', /var\(--nav-width/.test(rule('.nav-sidebar-content')) && /var\(--outliner-width/.test(rule('.outliner-content')))
  check('the docked action panel sits between them', /left:\s*var\(--nav-width[^;]*;\s*right:\s*var\(--outliner-width/.test(rule('.action-dock-panel')))
  check('no side-panel rule keeps a fixed 220px', !/\.(nav-sidebar|outliner|action-dock-panel|dip-toasts)\s*{[^}]*\b220px/.test(css.replace(/var\([^)]*\)/g, '')))
  check('long nav labels end in "…"', /\.nav-btn-label\s*{[^}]*text-overflow:\s*ellipsis/.test(css))
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`)
process.exit(failures === 0 ? 0 : 1)
