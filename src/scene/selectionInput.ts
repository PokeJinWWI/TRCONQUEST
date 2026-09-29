// The one rule for additive selection clicks, shared by every marker, list
// and panel: Shift held means "add to / remove from the selection" instead of
// "select just this". Ctrl/Cmd is "open in a new tab" (isNewTabClick), like a
// browser link.
export function isAdditiveClick(e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }): boolean {
  return e.shiftKey
}

export function isNewTabClick(e: { ctrlKey: boolean; metaKey: boolean }): boolean {
  return e.ctrlKey || e.metaKey
}

// On a Mac, Ctrl-click arrives as a right-click (contextmenu) with Ctrl held:
// anything that opens in a new tab on Ctrl/Cmd-click also listens for this.
export function isNewTabContextMenu(e: { ctrlKey: boolean }): boolean {
  return e.ctrlKey
}
