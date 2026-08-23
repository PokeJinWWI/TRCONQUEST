import { create } from 'zustand'

export const START_YEAR = 2600
export const DAYS_PER_YEAR = 365.25
export const SECONDS_PER_DAY = 86_400

// Two rates on ONE clock, not two clocks. Everything positional in this
// project (planet orbits, moon orbits, ship travel, cooldowns) is already a
// pure function of `simDays`, so "tactical time" costs nothing structurally —
// it's just a wildly different number of sim-days added per real second. No
// existing physics needed changing to support it, and there's no second
// timeline that could desync from the first.
export type TimeMode = 'normal' | 'tactical'

// Strategic pace: a real second buys six simulated days.
export const NORMAL_DAYS_PER_SECOND = 6
// Tactical pace: a real second buys one simulated *second* — the pace combat
// is authored in (weapon cooldowns, FTL charge times, lattice traversal are
// all specified in sim-seconds). ~518,400x slower than normal 1x, which is
// exactly why combat is unobservable unless the game is in this mode (see
// combatStore's auto-switch on engagement start).
export const TACTICAL_DAYS_PER_SECOND = 1 / SECONDS_PER_DAY

// Stellaris-style discrete speed tiers. Index 0 is the slowest non-paused
// speed. Tactical tops out at 3x rather than 5x — past that, per-shot combat
// events start landing faster than they can be read.
export const NORMAL_SPEED_MULTIPLIERS = [1, 2, 3, 4, 5]
export const TACTICAL_SPEED_MULTIPLIERS = [1, 2, 3]

export function speedMultipliersFor(mode: TimeMode): number[] {
  return mode === 'tactical' ? TACTICAL_SPEED_MULTIPLIERS : NORMAL_SPEED_MULTIPLIERS
}

export function daysPerSecondFor(mode: TimeMode): number {
  return mode === 'tactical' ? TACTICAL_DAYS_PER_SECOND : NORMAL_DAYS_PER_SECOND
}

// Combat is authored in seconds (a 5-second hyperdrive charge, a 2-second
// weapon cooldown) but every deadline in this project is stored as an
// absolute `simDays` value, so all of it goes through here rather than
// anything hand-dividing by 86400.
export function simSecondsToDays(seconds: number): number {
  return seconds / SECONDS_PER_DAY
}

export function simDaysToSeconds(days: number): number {
  return days * SECONDS_PER_DAY
}

interface GameTimeState {
  simDays: number
  paused: boolean
  speedIndex: number
  mode: TimeMode
  tick: (deltaSeconds: number) => void
  togglePause: () => void
  speedUp: () => void
  slowDown: () => void
  // Switching modes clamps speedIndex into the new mode's tier count
  // (tactical has 3 tiers, normal 5) so a player at normal 5x doesn't land on
  // a nonexistent tactical tier. Deliberately does NOT touch `paused` — if
  // you were paused when combat broke out, you stay paused and get to look
  // around before anything happens.
  setMode: (mode: TimeMode) => void
}

export const useGameTimeStore = create<GameTimeState>((set, get) => ({
  simDays: 0,
  paused: false,
  speedIndex: 0,
  mode: 'normal',
  tick: (deltaSeconds) => {
    const { paused, speedIndex, mode } = get()
    if (paused) return
    const multiplier = speedMultipliersFor(mode)[speedIndex] ?? 1
    set((s) => ({ simDays: s.simDays + deltaSeconds * daysPerSecondFor(mode) * multiplier }))
  },
  togglePause: () => set((s) => ({ paused: !s.paused })),
  speedUp: () =>
    set((s) => ({
      paused: false,
      speedIndex: Math.min(s.speedIndex + 1, speedMultipliersFor(s.mode).length - 1),
    })),
  slowDown: () => set((s) => ({ speedIndex: Math.max(s.speedIndex - 1, 0) })),
  setMode: (mode) =>
    set((s) => ({
      mode,
      speedIndex: Math.min(s.speedIndex, speedMultipliersFor(mode).length - 1),
    })),
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

// Tactical mode advances the date so slowly it looks frozen (a full in-game
// day takes 24 real minutes at 1x), so the HUD shows a wall-clock time
// alongside it to make the passage of time legible at all. Derived from the
// same simDays value, not a separate counter.
export function formatClockTime(simDays: number): string {
  const secondsIntoDay = Math.floor((simDays % 1) * SECONDS_PER_DAY)
  const h = Math.floor(secondsIntoDay / 3600)
  const m = Math.floor((secondsIntoDay % 3600) / 60)
  const s = secondsIntoDay % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
