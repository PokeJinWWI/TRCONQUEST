// Population is stored in MILLIONS of people. Show it as a real, legible
// figure with a suffix (never a bare "2.3"): 4000 → "4.00B", 400 → "400M",
// 2.5 → "2.5M".
export function formatPop(millions: number): string {
  if (millions >= 1000) return `${(millions / 1000).toFixed(2)}B`
  if (millions >= 10) return `${Math.round(millions)}M`
  return `${millions.toFixed(1)}M`
}
