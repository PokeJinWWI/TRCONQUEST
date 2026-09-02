// Population is stored in MILLIONS of people. Show it as a real, legible
// figure with a suffix (never a bare "2.3"): 4000 → "4.00B", 400 → "400M",
// 2.5 → "2.5M".
export function formatPop(millions: number): string {
  if (millions >= 1000) return `${(millions / 1000).toFixed(2)}B`
  if (millions >= 10) return `${Math.round(millions)}M`
  return `${millions.toFixed(1)}M`
}

// All money in the sim is denominated in USD for now (a placeholder currency —
// the setting's real money is undecided). Show it with a $ and a compact
// suffix for large sums, comma-grouped below that: 32460 → "$32.5K",
// 100000 → "$100.0K", 3043 → "$3,043", -250 → "−$250".
export function formatMoney(n: number): string {
  const neg = n < 0
  const a = Math.abs(n)
  let body: string
  if (a >= 1e12) body = `${(a / 1e12).toFixed(2)}T`
  else if (a >= 1e9) body = `${(a / 1e9).toFixed(2)}B`
  else if (a >= 1e6) body = `${(a / 1e6).toFixed(2)}M`
  else if (a >= 1e4) body = `${(a / 1e3).toFixed(1)}K`
  else body = Math.round(a).toLocaleString()
  return `${neg ? '−' : ''}$${body}`
}

// A market price (small per-unit money value) — always $ with two decimals,
// e.g. 2 → "$2.00", 10.5 → "$10.50".
export function formatPrice(n: number): string {
  return `$${n.toFixed(2)}`
}
