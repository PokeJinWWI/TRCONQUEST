import type { ReactElement } from 'react'

// Simple glyphs for the planet screen: districts, buildings (Simple mode's six
// and Complex mode's building groups), defense installations and foreign
// buildings. Hand-drawn 16×16 SVG in currentColor, the same approach as
// ResourceIcons.tsx — no icon library. One shape per idea, readable at 14–28px.

const GLYPHS: Record<string, ReactElement> = {
  // --- Buildings (Simple mode) -------------------------------------------------
  factory: <path d="M2 14V7l4 2.5V7l4 2.5V4h4v10z M10 11h2 M6 11h2" fill="none" />,
  exoticRefinery: (
    <>
      <path d="M5 14V9a3 3 0 0 1 6 0v5z" fill="none" />
      <path d="M8 2v4 M6 4h4" fill="none" />
      <circle cx="8" cy="11" r="1" />
    </>
  ),
  researchLab: <path d="M6 2h4 M7 2v4L3 13a1 1 0 0 0 1 1.5h8A1 1 0 0 0 13 13L9 6V2 M5 10h6" fill="none" />,
  farm: <path d="M2 13h12 M4 13c0-3 1-5 4-6 M8 13V4 M8 7c2-3 4-3 5-3-1 2-2 3-5 3z M8 9C6 6 4 6 3 6c1 2 2 3 5 3z" fill="none" />,
  mine: <path d="M3 14l6-6 M8 3c2 0 4 1 5 3-2-1-4-1-6 0z M11 5l-2 2 M2 14h12" fill="none" />,
  powerPlant: <path d="M9 1 4 9h4l-1 6 5-8H8l1-6z" fill="none" />,

  // --- Districts ---------------------------------------------------------------
  industrial: <path d="M1 14V8l3 2V8l3 2V8l3 2V3h2v2h2v9z" fill="none" />,
  academic: <path d="M1 6l7-4 7 4-7 4z M4 8v4c2 1.5 6 1.5 8 0V8 M14 6v5" fill="none" />,
  agricultural: <path d="M1 12c2-2 5-2 7 0s5 2 7 0 M1 8c2-2 5-2 7 0s5 2 7 0 M8 3v2" fill="none" />,
  mining: <path d="M2 14 8 4l6 10z M5.5 9.5h5 M8 4v10" fill="none" />,
  generator: (
    <>
      <circle cx="8" cy="8" r="6" fill="none" />
      <path d="M9 3 6 9h3l-1 4 3-6H8l1-4z" />
    </>
  ),
  urban: <path d="M1 14h14 M2 14V8h3v6 M6 14V3h4v11 M11 14V6h3v8 M7.5 5h1 M7.5 8h1 M7.5 11h1" fill="none" />,
  core: <path d="M8 1l2 4h4l-3 3 1 5-4-2.5L4 13l1-5-3-3h4z" fill="none" />,
  resource: <path d="M8 1l6 5-2 9H4L2 6z M2 6h12 M8 1v14" fill="none" />,

  // --- Building groups (Complex mode) --------------------------------------------
  power: <path d="M9 1 4 9h4l-1 6 5-8H8l1-6z" fill="none" />,
  extraction: <path d="M3 14l6-6 M8 3c2 0 4 1 5 3-2-1-4-1-6 0z M11 5l-2 2 M2 14h12" fill="none" />,
  agriculture: <path d="M2 13h12 M4 13c0-3 1-5 4-6 M8 13V4 M8 7c2-3 4-3 5-3-1 2-2 3-5 3z M8 9C6 6 4 6 3 6c1 2 2 3 5 3z" fill="none" />,
  heavyIndustry: <path d="M2 14V7l4 2.5V7l4 2.5V4h4v10z M10 11h2 M6 11h2" fill="none" />,
  chemicals: <path d="M6 2h4 M7 2v4L3 13a1 1 0 0 0 1 1.5h8A1 1 0 0 0 13 13L9 6V2 M5 10c2 1 4-1 6 0" fill="none" />,
  consumerGoods: <path d="M2 5l6-3 6 3-6 3-6-3zM2 5v6l6 3 6-3V5M8 8v6" fill="none" />,
  vehicles: (
    <>
      <path d="M2 10l1-4h8l2 4h1v2H2z" fill="none" />
      <circle cx="5" cy="12.5" r="1.3" />
      <circle cx="11" cy="12.5" r="1.3" />
    </>
  ),
  infrastructure: <path d="M1 12h14 M3 12V7 M13 12V7 M1 7c2-3 5-4 7-4s5 1 7 4 M8 3v9" fill="none" />,
  services: <path d="M8 2v12 M2 8h12 M4 4h8v8H4z" fill="none" />,
  civic: <path d="M1 14h14 M2 6h12L8 2z M3 6v7 M6 6v7 M10 6v7 M13 6v7" fill="none" />,

  // --- Defense installations -------------------------------------------------------
  fortress: <path d="M2 14V5h2v2h2V5h4v2h2V5h2v9z M7 14v-3h2v3" fill="none" />,
  shieldGenerator: <path d="M8 1l6 2.5v4c0 3.5-2.5 6-6 7.5-3.5-1.5-6-4-6-7.5v-4z M8 5v6 M5 8h6" fill="none" />,
  defenseBattery: <path d="M3 14h10l-1-4H4z M6 10l3-6 M8.5 4.5l3-1.5 M8 10a2 2 0 0 0-4 0" fill="none" />,

  // --- Foreign buildings -----------------------------------------------------------------
  embassy: <path d="M3 15V1 M3 2h9l-2 3 2 3H3" fill="none" />,
  branchOffice: <path d="M2 5h12v9H2z M6 5V3h4v2 M2 9h12 M7 9v2h2V9" fill="none" />,
}

export function PlanetIcon({ id, size = 16, className, title }: { id: string; size?: number; className?: string; title?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinejoin="round"
      strokeLinecap="round"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
    >
      {title && <title>{title}</title>}
      {GLYPHS[id] ?? <rect x="3" y="3" width="10" height="10" rx="2" fill="none" />}
    </svg>
  )
}

export function hasPlanetIcon(id: string): boolean {
  return id in GLYPHS
}
