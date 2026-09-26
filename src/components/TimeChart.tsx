import { useState, type MouseEvent } from 'react'
import { simDaysToDate } from '../state/gameTimeStore'

// A time-series chart with real axes, shared by both economy modes. Samples are
// one per economy tick (one per in-game month); `endTick` is the tick number of
// the newest sample, so sample `j` of `n` is tick endTick − (n − 1 − j), dated
// tick × SIM_DAYS_PER_TICK days into the game. The x axis ticks every month (or
// every few months on the longer ranges) with the month's name; the y axis has
// a handful of round-number gridlines. The visible range is the last 6 months
// by default, switchable to 1 or 3 years. Hovering reads out the value.

const SIM_DAYS_PER_TICK = 30 // useEconomyTick's cadence
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export interface ChartSeries {
  values: number[]
  color: string
  label: string
}

interface TimeChartProps {
  title: string
  series: ChartSeries[]
  endTick: number
  format?: (v: number) => string
  includeZero?: boolean
  height?: number
  // What the chart is — shown as a hover tooltip on its title.
  tip?: string
}

const RANGES = [
  { label: '6M', months: 6, every: 1 },
  { label: '1Y', months: 12, every: 2 },
  { label: '3Y', months: 36, every: 6 },
] as const

const W = 300
const PAD_L = 46
const PAD_R = 6
const PAD_T = 6
const PAD_B = 16

// Round-number y ticks spanning [min, max].
export function niceTicks(min: number, max: number, count = 4): number[] {
  const span = max - min
  if (!(span > 0)) return [min]
  const raw = span / count
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) ?? 10 * mag
  const ticks: number[] = []
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-6; v += step) ticks.push(Math.abs(v) < step * 1e-9 ? 0 : v)
  return ticks
}

// X-axis ticks for `shown` monthly samples starting at `firstTick`: one at
// each sample that starts a new calendar month (every `every`-th of them),
// labelled with the month — and the year on January and the first tick.
export function monthTicks(firstTick: number, shown: number, every: number): { j: number; label: string }[] {
  const ticks: { j: number; label: string }[] = []
  let count = 0
  for (let j = 0; j < shown; j++) {
    const cur = monthOf(firstTick + j)
    const prev = j > 0 ? monthOf(firstTick + j - 1) : null
    if (prev && prev.m === cur.m && prev.y === cur.y) continue
    if (count++ % every !== 0) continue
    ticks.push({ j, label: cur.m === 0 || j === 0 ? `${MONTHS[cur.m]} ${String(cur.y).slice(-2)}` : MONTHS[cur.m] })
  }
  return ticks
}

// The calendar month a sample belongs to, dated by the MIDDLE of the 30 days it
// covers — dating by the tick's end day skips February (Jan 31 → Mar 2).
function monthOf(tick: number): { m: number; y: number } {
  const d = simDaysToDate(tick * SIM_DAYS_PER_TICK - SIM_DAYS_PER_TICK / 2)
  return { m: d.getUTCMonth(), y: d.getUTCFullYear() }
}

export function TimeChart({ title, series, endTick, format = (v) => v.toFixed(1), includeZero, height = 110, tip }: TimeChartProps) {
  const [rangeIdx, setRangeIdx] = useState(0)
  const [hover, setHover] = useState<number | null>(null)
  const range = RANGES[rangeIdx]
  const n = Math.max(0, ...series.map((s) => s.values.length))
  // Show the last `months` months (+1 sample so the first month has a left edge).
  const shown = Math.min(n, range.months + 1)
  const sliced = series.map((s) => ({ ...s, values: s.values.slice(Math.max(0, s.values.length - shown)) }))
  const firstTick = endTick - (shown - 1)

  const header = (
    <div className="tchart-head">
      <span className="econ-graph-title" title={tip}>{title}</span>
      <span className="tchart-ranges">
        {RANGES.map((r, i) => (
          <button key={r.label} type="button" className={`tchart-range${i === rangeIdx ? ' active' : ''}`} title={`Show the last ${r.months === 36 ? '3 years' : r.months === 12 ? 'year' : '6 months'}`} onClick={() => setRangeIdx(i)}>
            {r.label}
          </button>
        ))}
      </span>
    </div>
  )

  if (shown < 2) {
    return (
      <div className="econ-graph">
        {header}
        <div className="econ-graph-empty">Gathering data — a point is added every month.</div>
      </div>
    )
  }

  const all = sliced.flatMap((s) => s.values)
  let min = Math.min(...all)
  let max = Math.max(...all)
  if (includeZero) {
    min = Math.min(min, 0)
    max = Math.max(max, 0)
  }
  if (max - min < 1e-9) {
    const pad = Math.abs(max) > 1e-9 ? Math.abs(max) * 0.05 : 1
    max += pad
    min -= pad
  } else {
    const pad = (max - min) * 0.08
    max += pad
    if (!(includeZero && min === 0)) min -= pad
  }
  const yTicks = niceTicks(min, max)

  const plotW = W - PAD_L - PAD_R
  const plotH = height - PAD_T - PAD_B
  const x = (j: number) => PAD_L + (j / (shown - 1)) * plotW
  const y = (v: number) => PAD_T + (1 - (v - min) / (max - min)) * plotH

  const xTicks = monthTicks(firstTick, shown, range.every)

  const onMove = (e: MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const px = ((e.clientX - rect.left) / rect.width) * W
    const j = Math.round(((px - PAD_L) / plotW) * (shown - 1))
    setHover(j >= 0 && j < shown ? j : null)
  }
  const hoverDate = hover !== null ? monthOf(firstTick + hover) : null

  return (
    <div className="econ-graph">
      {header}
      <svg viewBox={`0 0 ${W} ${height}`} className="tchart-svg" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        {/* y gridlines + labels */}
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={PAD_L} x2={W - PAD_R} y1={y(v)} y2={y(v)} stroke={v === 0 ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.08)'} strokeWidth={0.6} strokeDasharray={v === 0 ? '3 2' : undefined} />
            <text x={PAD_L - 4} y={y(v) + 3} textAnchor="end" className="tchart-label">{format(v)}</text>
          </g>
        ))}
        {/* axes */}
        <line x1={PAD_L} x2={PAD_L} y1={PAD_T} y2={PAD_T + plotH} stroke="rgba(255,255,255,0.3)" strokeWidth={0.7} />
        <line x1={PAD_L} x2={W - PAD_R} y1={PAD_T + plotH} y2={PAD_T + plotH} stroke="rgba(255,255,255,0.3)" strokeWidth={0.7} />
        {/* month ticks */}
        {xTicks.map((t) => (
          <g key={t.j}>
            <line x1={x(t.j)} x2={x(t.j)} y1={PAD_T + plotH} y2={PAD_T + plotH + 3} stroke="rgba(255,255,255,0.4)" strokeWidth={0.7} />
            <text x={x(t.j)} y={height - 3} textAnchor={t.j === 0 ? 'start' : t.j === shown - 1 ? 'end' : 'middle'} className="tchart-label">{t.label}</text>
          </g>
        ))}
        {sliced.map((s) => {
          const off = shown - s.values.length
          const pts = s.values.map((v, i) => `${x(i + off).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
          return <polyline key={s.label} points={pts} fill="none" stroke={s.color} strokeWidth={1.4} />
        })}
        {hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={PAD_T} y2={PAD_T + plotH} stroke="rgba(255,255,255,0.35)" strokeWidth={0.6} />
            {sliced.map((s) => {
              const v = s.values[hover - (shown - s.values.length)]
              return v === undefined ? null : <circle key={s.label} cx={x(hover)} cy={y(v)} r={2} fill={s.color} />
            })}
          </g>
        )}
      </svg>
      <div className="econ-graph-legend">
        {hoverDate && <span className="econ-graph-legend-item tchart-when">{MONTHS[hoverDate.m]} {hoverDate.y}:</span>}
        {sliced.map((s) => {
          const v = hover !== null ? s.values[hover - (shown - s.values.length)] : s.values[s.values.length - 1]
          return (
            <span key={s.label} className="econ-graph-legend-item">
              <span className="econ-graph-swatch" style={{ background: s.color }} />
              {s.label} {v === undefined ? '—' : format(v)}
            </span>
          )
        })}
      </div>
    </div>
  )
}
