import type { FiscalSample } from '../state/economyStore'
import { MONTHS_PER_YEAR, formatMoney } from '../economy/format'
import { TimeChart } from './TimeChart'

// Every Complex-mode economy chart, defined ONCE — the Economy Overview, the
// Finance tab and the Central Bank tabs all render these same components, so
// the same number is drawn the same way (title, units, colours) wherever it
// appears. Conventions:
//   • GDP and budget flows are PER YEAR (the simulation's per-tick/monthly
//     flows × 12), the way nations report them;
//   • stocks (treasury, debt, money supply, reserves) are as they stand;
//   • rates and ratios are percentages.
// A series added to the history later is charted from the first sample that
// has it (trailingSeries).

export const CHART_COLORS = {
  nominal: '#4ade80',
  real: '#8ab4ff',
  growth: '#9be37b',
  inflation: '#ff6b6b',
  expected: '#ffb36b',
  policyRate: '#6fe3ff',
  realRate: '#c49bff',
  price: '#ffd23f',
  unemployment: '#ffd23f',
  debtRatio: '#ff9a6b',
  revenue: '#4ade80',
  spending: '#ff6b6b',
  treasury: '#4ade80',
  debt: '#ff9a6b',
  outputGap: '#9be37b',
  credibility: '#6fe3ff',
  m2: '#6fe3ff',
  deposits: '#8ab4ff',
  loans: '#ffb36b',
  m0: '#4ade80',
  rate: '#6fe3ff',
  peg: '#ffd23f',
  fx: '#4ade80',
}

const pct = (d: number) => (v: number) => `${(v * 100).toFixed(d)}%`

// The trailing run of samples where `pick` is defined — fields added to the
// history later are missing from older samples; the chart aligns series on
// the newest point.
export function trailingSeries(h: FiscalSample[], pick: (p: FiscalSample) => number | undefined): number[] {
  const out: number[] = []
  for (let i = h.length - 1; i >= 0; i--) {
    const v = pick(h[i])
    if (v === undefined || !Number.isFinite(v)) break
    out.unshift(v)
  }
  return out
}

export const gdpPerYear = (p: Pick<FiscalSample, 'gdp'>) => p.gdp * MONTHS_PER_YEAR
export const realGdpPerYear = (p: Pick<FiscalSample, 'gdp' | 'priceLevel'>) => (p.priceLevel > 0 ? gdpPerYear(p) / p.priceLevel : gdpPerYear(p))
// GDP per person per year (population is in millions; money in internal units).
export function gdpPerCapita(gdpYear: number, populationMillions: number | undefined): number | undefined {
  return populationMillions && populationMillions > 0 ? gdpYear / (populationMillions * 1_000_000) : undefined
}

// Year-on-year real growth at each sample that has one 12 months earlier.
export function yoyGrowth(h: FiscalSample[]): number[] {
  const real = h.map(realGdpPerYear)
  const out: number[] = []
  for (let j = MONTHS_PER_YEAR; j < real.length; j++) out.push(real[j - MONTHS_PER_YEAR] > 0 ? real[j] / real[j - MONTHS_PER_YEAR] - 1 : 0)
  return out
}

interface ChartProps {
  h: FiscalSample[]
  tick: number
}

export function GdpChart({ h, tick }: ChartProps) {
  return (
    <TimeChart
      title="GDP (per year)"
      endTick={tick}
      format={formatMoney}
      series={[
        { label: 'Nominal', color: CHART_COLORS.nominal, values: h.map(gdpPerYear) },
        { label: 'Real', color: CHART_COLORS.real, values: h.map(realGdpPerYear) },
      ]}
      tip="Everything the nation produces in a year. Nominal is in today's prices; real strips out inflation (start-of-game prices), so it only grows when the nation produces more."
    />
  )
}

export function GdpPerCapitaChart({ h, tick }: ChartProps) {
  return (
    <TimeChart
      title="GDP per capita (per year)"
      endTick={tick}
      format={formatMoney}
      series={[
        { label: 'Nominal', color: CHART_COLORS.nominal, values: trailingSeries(h, (p) => gdpPerCapita(gdpPerYear(p), p.population)) },
        { label: 'Real', color: CHART_COLORS.real, values: trailingSeries(h, (p) => gdpPerCapita(realGdpPerYear(p), p.population)) },
      ]}
      tip="GDP divided by population — how much the economy produces per person. A better measure of how well off people are than total GDP, which also grows just because the population does."
    />
  )
}

export function GrowthChart({ h, tick }: ChartProps) {
  return (
    <TimeChart
      title="Real growth (year on year)"
      endTick={tick}
      format={pct(1)}
      includeZero
      series={[{ label: 'Growth', color: CHART_COLORS.growth, values: yoyGrowth(h) }]}
      tip="Real GDP compared with 12 months earlier. Needs a year of history."
    />
  )
}

export function PriceLevelChart({ h, tick }: ChartProps) {
  return (
    <TimeChart
      title="Price level (CPI, 1.00 = start)"
      endTick={tick}
      format={(v) => v.toFixed(2)}
      series={[{ label: 'CPI', color: CHART_COLORS.price, values: h.map((p) => p.priceLevel) }]}
      tip="How expensive a typical basket of goods is compared with the start of the game. Rising = inflation, falling = deflation."
    />
  )
}

export function InflationChart({ h, tick }: ChartProps) {
  return (
    <TimeChart
      title="Inflation (per year)"
      endTick={tick}
      format={pct(1)}
      includeZero
      series={[
        { label: 'Inflation', color: CHART_COLORS.inflation, values: h.map((p) => p.inflation) },
        { label: 'Expected', color: CHART_COLORS.expected, values: trailingSeries(h, (p) => p.inflationExpectation) },
      ]}
      tip="How fast prices are rising, and how fast people expect them to rise — expectations feed into wages and prices, so they matter."
    />
  )
}

export function InterestRatesChart({ h, tick }: ChartProps) {
  return (
    <TimeChart
      title="Interest rates vs inflation"
      endTick={tick}
      format={pct(1)}
      includeZero
      series={[
        { label: 'Policy rate', color: CHART_COLORS.policyRate, values: trailingSeries(h, (p) => p.policyRate) },
        { label: 'Real rate', color: CHART_COLORS.realRate, values: trailingSeries(h, (p) => p.realRate) },
        { label: 'Inflation', color: CHART_COLORS.inflation, values: h.map((p) => p.inflation) },
      ]}
      tip="The central bank's policy rate, and the real rate (policy rate minus expected inflation). A positive real rate cools the economy and brings inflation down, with a lag."
    />
  )
}

export function OutputGapChart({ h, tick }: ChartProps) {
  return (
    <TimeChart
      title="Output gap"
      endTick={tick}
      format={pct(1)}
      includeZero
      series={[{ label: 'Output gap', color: CHART_COLORS.outputGap, values: trailingSeries(h, (p) => p.outputGap) }]}
      tip="How far the economy runs above (+) or below (−) its normal capacity. Above tends to push inflation up."
    />
  )
}

export function UnemploymentChart({ h, tick }: ChartProps) {
  return (
    <TimeChart
      title="Unemployment"
      endTick={tick}
      format={pct(1)}
      includeZero
      series={[{ label: 'Unemployment', color: CHART_COLORS.unemployment, values: trailingSeries(h, (p) => p.unemployment) }]}
      tip="Share of the labour force without a job."
    />
  )
}

export function DebtToGdpChart({ h, tick }: ChartProps) {
  return (
    <TimeChart
      title="Debt / GDP"
      endTick={tick}
      format={pct(0)}
      includeZero
      series={[{ label: 'Debt/GDP', color: CHART_COLORS.debtRatio, values: h.map((p) => p.debtToGdp) }]}
      tip="National debt as a share of a year's GDP — the usual yardstick for how heavy a debt is. It sets the credit rating."
    />
  )
}

export function BudgetFlowChart({ h, tick }: ChartProps) {
  return (
    <TimeChart
      title="Revenue vs spending (per year)"
      endTick={tick}
      format={formatMoney}
      includeZero
      series={[
        { label: 'Revenue', color: CHART_COLORS.revenue, values: h.map((p) => p.revenue * MONTHS_PER_YEAR) },
        { label: 'Spending', color: CHART_COLORS.spending, values: h.map((p) => p.expenditure * MONTHS_PER_YEAR) },
      ]}
      tip="What the state takes in vs what it spends, at a yearly rate. When spending is above revenue the state runs a deficit."
    />
  )
}

export function TreasuryDebtChart({ h, tick }: ChartProps) {
  return (
    <TimeChart
      title="Treasury & debt"
      endTick={tick}
      format={formatMoney}
      includeZero
      series={[
        { label: 'Treasury', color: CHART_COLORS.treasury, values: h.map((p) => p.treasury) },
        { label: 'Debt', color: CHART_COLORS.debt, values: trailingSeries(h, (p) => p.debt) },
      ]}
      tip="Cash on hand and what the state owes."
    />
  )
}

export function CredibilityChart({ h, tick }: ChartProps) {
  return (
    <TimeChart
      title="Credibility"
      endTick={tick}
      format={pct(0)}
      includeZero
      series={[{ label: 'Credibility', color: CHART_COLORS.credibility, values: trailingSeries(h, (p) => p.credibility) }]}
      tip="Trust in the bank to hold its mandate — earned slowly, lost fast."
    />
  )
}

export function MoneySupplyChart({ h, tick }: ChartProps) {
  return (
    <TimeChart
      title="Money supply & credit"
      endTick={tick}
      format={formatMoney}
      series={[
        { label: 'M2', color: CHART_COLORS.m2, values: trailingSeries(h, (p) => p.broadMoney) },
        { label: 'Deposits', color: CHART_COLORS.deposits, values: trailingSeries(h, (p) => p.deposits) },
        { label: 'Loans', color: CHART_COLORS.loans, values: trailingSeries(h, (p) => p.loans) },
        { label: 'M0', color: CHART_COLORS.m0, values: trailingSeries(h, (p) => p.baseMoney) },
      ]}
      tip="Base money (M0) is what the central bank creates; banks lend deposits out again, so broad money (M2) is much larger. Fast M2 growth tends to mean inflation later."
    />
  )
}

export function ExchangeRateChart({ h, tick, code, showPeg }: ChartProps & { code: string; showPeg: boolean }) {
  return (
    <TimeChart
      title="Exchange rate (TSC per unit)"
      endTick={tick}
      format={(v) => v.toFixed(3)}
      series={[
        { label: code, color: CHART_COLORS.rate, values: trailingSeries(h, (p) => p.exchangeRate) },
        ...(showPeg ? [{ label: 'Target', color: CHART_COLORS.peg, values: trailingSeries(h, (p) => p.pegTarget) }] : []),
      ]}
      tip="What one unit of your currency is worth in Terra Standard Credits. Under a peg or managed float the bank spends FX reserves to steer it toward the target."
    />
  )
}

export function FxReservesChart({ h, tick }: ChartProps) {
  return (
    <TimeChart
      title="FX reserves"
      endTick={tick}
      format={formatMoney}
      includeZero
      series={[{ label: 'FX reserves', color: CHART_COLORS.fx, values: trailingSeries(h, (p) => p.fxReserves) }]}
      tip="Foreign currency the bank holds to defend the exchange rate. A peg breaks when these run out."
    />
  )
}
