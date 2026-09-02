// Population is stored in MILLIONS of people. Show it as a real, legible
// figure with a suffix (never a bare "2.3"): 4000 → "4.00B", 400 → "400M",
// 2.5 → "2.5M".
export function formatPop(millions: number): string {
  if (millions >= 1000) return `${(millions / 1000).toFixed(2)}B`
  if (millions >= 10) return `${Math.round(millions)}M`
  return `${millions.toFixed(1)}M`
}

// All money in the sim is denominated in USD for now (a placeholder currency —
// the setting's real money is undecided). The simulation runs in compact
// internal units; a planet-scale economy should read in the billions and
// trillions, so aggregate money is scaled up for display by this factor. It is
// a *projection* onto real-world magnitudes, not a claim of precision.
export const USD_PER_UNIT = 1_000_000

// Show a money aggregate (GDP, treasury, revenue, profit, wealth, corp value…)
// with a $ and a compact suffix: internal 100000 → "$100B", 4000 → "$4B",
// 32.46 → "$32.5M", −0.25 → "−$250K".
export function formatMoney(nInternal: number): string {
  const n = nInternal * USD_PER_UNIT
  const neg = n < 0
  const a = Math.abs(n)
  let body: string
  if (a >= 1e12) body = `${(a / 1e12).toFixed(2)}T`
  else if (a >= 1e9) body = `${(a / 1e9).toFixed(2)}B`
  else if (a >= 1e6) body = `${(a / 1e6).toFixed(1)}M`
  else if (a >= 1e3) body = `${(a / 1e3).toFixed(0)}K`
  else body = Math.round(a).toLocaleString()
  return `${neg ? '−' : ''}$${body}`
}

// A market price is a *per-unit* value (one commodity lot), so it stays in the
// small internal scale — always $ with two decimals, e.g. 2 → "$2.00".
export function formatPrice(n: number): string {
  return `$${n.toFixed(2)}`
}
