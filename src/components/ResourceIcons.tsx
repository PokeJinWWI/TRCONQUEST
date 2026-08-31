import type { ReactElement } from 'react'
import type { ResourceId } from '../data/resourceData'

// Minimal stroke-based glyphs, 16x16, currentColor — this is the first icon
// usage in the project (no icon library is installed), so these are drawn by
// hand rather than pulling in a dependency for eight symbols. Kept to a
// single simple shape each to match the HUD's terse readout style.
const ICON_PATHS: Record<ResourceId, ReactElement> = {
  energy: <path d="M9 1 3 9h4l-1 6 6-8H8l1-6z" />,
  minerals: <path d="M8 1l5 4-2 9H5L3 5z" />,
  food: <path d="M8 15V6M8 6C8 3 6 1 4 1c0 3 1 5 4 5zM8 6c0-3 2-5 4-5 0 3-1 5-4 5z" fill="none" />,
  consumerGoods: <path d="M2 5l6-3 6 3-6 3-6-3zM2 5v6l6 3 6-3V5M8 8v6" fill="none" />,
  alloys: <path d="M2 11h5v3H2zM9 11h5v3H9zM4 6h5v3H4z" />,
  exoticMatter: (
    <>
      <circle cx="8" cy="8" r="1.6" />
      <ellipse cx="8" cy="8" rx="6.5" ry="2.6" fill="none" />
      <ellipse cx="8" cy="8" rx="6.5" ry="2.6" fill="none" transform="rotate(60 8 8)" />
      <ellipse cx="8" cy="8" rx="6.5" ry="2.6" fill="none" transform="rotate(120 8 8)" />
    </>
  ),
  hyperium: <path d="M8 1l6 3.5v7L8 15l-6-3.5v-7L8 1zM8 5l2.5 1.5v3L8 11l-2.5-1.5v-3L8 5z" fill="none" />,
  other: <path d="M8 2v3M8 11v3M2 8h3M11 8h3M4 4l2 2M10 10l2 2M12 4l-2 2M6 10l-2 2" fill="none" />,
}

export function ResourceIcon({ id, className }: { id: ResourceId; className?: string }) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth="1.1"
      strokeLinejoin="round"
      strokeLinecap="round"
      aria-hidden="true"
    >
      {ICON_PATHS[id]}
    </svg>
  )
}
