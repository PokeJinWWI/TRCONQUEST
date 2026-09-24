// The one rule for additive selection clicks, shared by every marker, list
// and panel: Shift, Ctrl or Cmd held means "add to / remove from the
// selection" instead of "select just this".
export function isAdditiveClick(e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }): boolean {
  return e.shiftKey || e.ctrlKey || e.metaKey
}
