import { create } from 'zustand'

export const START_YEAR = 2600
export const DAYS_PER_YEAR = 365.25

// Simulated days advanced per real second at 1x speed.
const BASE_DAYS_PER_SECOND = 6

// Stellaris-style discrete speed tiers. Index 0 is the slowest non-paused speed.
export const SPEED_MULTIPLIERS = [1, 2, 3, 4, 5]

interface GameTimeState {
  simDays: number
  paused: boolean
  speedIndex: number
  tick: (deltaSeconds: number) => void
  togglePause: () => void
  speedUp: () => void
  slowDown: () => void
}

export const useGameTimeStore = create<GameTimeState>((set, get) => ({
  simDays: 0,
  paused: false,
  speedIndex: 0,
  tick: (deltaSeconds) => {
    const { paused, speedIndex } = get()
    if (paused) return
    const multiplier = SPEED_MULTIPLIERS[speedIndex]
    set((s) => ({ simDays: s.simDays + deltaSeconds * BASE_DAYS_PER_SECOND * multiplier }))
  },
  togglePause: () => set((s) => ({ paused: !s.paused })),
  speedUp: () =>
    set((s) => ({
      paused: false,
      speedIndex: Math.min(s.speedIndex + 1, SPEED_MULTIPLIERS.length - 1),
    })),
  slowDown: () => set((s) => ({ speedIndex: Math.max(s.speedIndex - 1, 0) })),
}))

export function simDaysToDate(simDays: number): Date {
  const date = new Date(Date.UTC(START_YEAR, 0, 1))
  date.setUTCDate(date.getUTCDate() + Math.floor(simDays))
  return date
}

export function simDaysToYears(simDays: number): number {
  return simDays / DAYS_PER_YEAR
}

const MONTHS = [
  'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
  'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC',
]

// Shared date format ("18 AUG 2604") — the same string TimeControls shows
// for the current date, reused for a ship's estimated arrival so both read
// as the same kind of in-universe date.
export function formatDate(date: Date): string {
  const day = date.getUTCDate()
  const month = MONTHS[date.getUTCMonth()]
  const year = date.getUTCFullYear()
  return `${day} ${month} ${year}`
}
