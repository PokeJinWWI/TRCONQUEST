// What part of an on-screen label to look up (pure): "Clinic ×2" -> "Clinic", "+ Build here" ->
// "Build here", "Colonies:" -> "Colonies", "Armies (3)" -> "Armies". Null for text that is not a
// label: too long, a sentence, a number, no letters. ("Govt. pressure" is a label; "It is. More" is not.)
export function labelKey(text: string): string | null {
  let t = text.replace(/\s+/g, ' ').trim()
  if (t.length < 2 || t.length > 48) return null
  t = t.replace(/^[+▸▾›‹·•]\s*/, '').replace(/\s*[×x]\s?\d+$/, '').replace(/\s*\(\d+\)$/, '').replace(/:$/, '').trim()
  t = t.replace(/[\u{1F300}-\u{1FAFF}\u2600-\u27BF★☆✓✎]/gu, '').trim()
  if (!/[A-Za-z]/.test(t)) return null
  // Already carries its own script (a player-typed "Name 名前").
  if (/[\u3040-\u30ff\u4e00-\u9fff]/.test(t)) return null
  // A sentence (ends with a full stop, or has one inside) is prose, not a label.
  if (/[.!?]$|[.!?]\s+[A-Z]/.test(t)) return null
  return t
}
