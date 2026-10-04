// The simulation's flows (GDP, revenue, spending…) are per tick = per month;
// the economy screens show them per year, the way nations report them.
export const MONTHS_PER_YEAR = 12

// Population is stored in MILLIONS of people. Show it as a real, legible
// figure with a suffix (never a bare "2.3"): 4000 → "4.00B", 400 → "400M",
// 2.5 → "2.5M".
export function formatPop(millions: number): string {
  if (millions >= 1000) return `${(millions / 1000).toFixed(2)}B`
  if (millions >= 10) return `${Math.round(millions)}M`
  return `${millions.toFixed(1)}M`
}

// The simulation runs in compact internal units; a planet-scale economy should
// read in the billions and trillions, so aggregate money is scaled up for
// display by this factor. It is a *projection* onto real-world magnitudes, not a
// claim of precision. Simple mode keeps this scale; Complex mode uses its own
// (IED_PER_UNIT below) because the two sims' internal scales differ ~270×.
export const USD_PER_UNIT = 1_000_000

// Show a money aggregate (GDP, treasury, revenue, profit, wealth, corp value…)
// with a $ and a compact suffix: internal 100000 → "$100B", 4000 → "$4B",
// 32.46 → "$32.5M", −0.25 → "−$250K". Used by Simple mode.
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
// small internal scale — always $ with two decimals, e.g. 2 → "$2.00". Simple mode.
export function formatPrice(n: number): string {
  return `$${n.toFixed(2)}`
}

// --- Complex mode: the International Earth Dollar (IED) ----------------------
// Complex mode denominates every DISPLAYED metric in the International Earth
// Dollar — the interstellar reserve currency, the setting's common reference
// (like the real USD). Each nation's internal books are kept in its OWN currency
// (ISC/VNC/ORD/LRD; Earth's own currency *is* the IED at rate 1.0); the sim only
// ever converts at a border. For a COMPARABLE metric we convert local → IED by
// the nation's live exchange rate (`Currency.rate` = IED value of one local
// unit), so a depreciating currency reads as poorer in IED. Forex and trade
// screens keep showing the local currency — that is where the rate itself lives.
//
// The scale factor is Complex-specific (its internal GDP is ~270× Simple's) and
// is tuned so a major homeworld reads at a believable spacefaring-era income.
export const IED_PER_UNIT = 75_000_000
export const IED_CODE = 'IED'

// Format an internal (local-currency) money aggregate in IED. `rate` is the
// nation's `Currency.rate`; omit (defaults 1) only for amounts already in IED.
export function formatIED(nLocal: number, rate = 1): string {
  const n = nLocal * rate * IED_PER_UNIT
  const neg = n < 0
  const a = Math.abs(n)
  let body: string
  if (a >= 1e12) body = `${(a / 1e12).toFixed(2)}T`
  else if (a >= 1e9) body = `${(a / 1e9).toFixed(2)}B`
  else if (a >= 1e6) body = `${(a / 1e6).toFixed(1)}M`
  else if (a >= 1e3) body = `${(a / 1e3).toFixed(0)}K`
  else body = Math.round(a).toLocaleString()
  return `${neg ? '−' : ''}IED ${body}`
}

// A per-unit market price in IED (converted from local by `rate`): "IED 2.00".
export function formatIEDPrice(nLocal: number, rate = 1): string {
  return `IED ${(nLocal * rate).toFixed(2)}`
}
