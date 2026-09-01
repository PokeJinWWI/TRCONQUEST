interface Series {
  values: number[]
  color: string
  label: string
}

interface LineGraphProps {
  title: string
  series: Series[]
  // Optional formatter for the latest-value readout in the legend.
  format?: (v: number) => string
  // Force the y-axis to include 0 (for revenue/expenditure/balance-style
  // charts where the zero line is meaningful).
  includeZero?: boolean
  height?: number
}

const WIDTH = 260

// A tiny inline-SVG time-series chart — no external charting library (the
// project has none, and the artifact/CSP constraints elsewhere favor
// self-contained SVG anyway). Plots one or more series sharing a y-scale,
// oldest sample at the left. Theme colors are passed in so it matches whatever
// the caller wants.
export function LineGraph({ title, series, format = (v) => v.toFixed(1), includeZero, height = 70 }: LineGraphProps) {
  const all = series.flatMap((s) => s.values)
  const n = Math.max(...series.map((s) => s.values.length), 0)
  if (n < 2 || all.length === 0) {
    return (
      <div className="econ-graph">
        <div className="econ-graph-title">{title}</div>
        <div className="econ-graph-empty">Gathering data…</div>
      </div>
    )
  }

  let min = Math.min(...all)
  let max = Math.max(...all)
  if (includeZero) {
    min = Math.min(min, 0)
    max = Math.max(max, 0)
  }
  if (max - min < 1e-9) {
    // Flat line — give it a little vertical room so it renders mid-box.
    max += 1
    min -= 1
  }

  const padX = 3
  const padY = 4
  const plotW = WIDTH - padX * 2
  const plotH = height - padY * 2
  const x = (i: number, len: number) => padX + (len <= 1 ? 0 : (i / (len - 1)) * plotW)
  const y = (v: number) => padY + (1 - (v - min) / (max - min)) * plotH

  return (
    <div className="econ-graph">
      <div className="econ-graph-title">{title}</div>
      <svg viewBox={`0 0 ${WIDTH} ${height}`} className="econ-graph-svg" preserveAspectRatio="none">
        {/* zero baseline where it's in range */}
        {min < 0 && max > 0 && (
          <line x1={padX} x2={WIDTH - padX} y1={y(0)} y2={y(0)} stroke="rgba(255,255,255,0.2)" strokeWidth={0.5} strokeDasharray="2 2" />
        )}
        {series.map((s) => {
          const pts = s.values.map((v, i) => `${x(i, s.values.length).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
          return <polyline key={s.label} points={pts} fill="none" stroke={s.color} strokeWidth={1.3} />
        })}
      </svg>
      <div className="econ-graph-legend">
        {series.map((s) => (
          <span key={s.label} className="econ-graph-legend-item">
            <span className="econ-graph-swatch" style={{ background: s.color }} />
            {s.label} {format(s.values[s.values.length - 1])}
          </span>
        ))}
      </div>
    </div>
  )
}
