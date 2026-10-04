import { usePlayerTech } from '../hooks/usePlayerTech'
import { resolveShipClass } from '../state/shipClassResolver'
import { useShipStore, type ShipInstance } from '../state/shipStore'
import { DRIVE_LABELS, DRIVE_ORDER, defaultDriveChoice, driveOptions, effectiveDrive, type DriveChoice, type ShipDrive } from './driveChoice'
import { replanForWarpWhenReady } from './warpReplan'

// How fast each drive is for ranking the slowest ship of a selection: reaction crawls, warp
// flies, a hyperdrive jump is instant. The fleet order itself is synchronised to the slowest
// ship by fleetMove.planFleetMove.
const SPEED_RANK: Record<ShipDrive, number> = { reaction: 0, warp: 1, hyperdrive: 2 }

const TIPS: Record<DriveChoice, string> = {
  auto: 'Auto: warp when the drive is usable and enabled, else a hyperdrive jump outside its own system, else reaction drive',
  reaction: 'Reaction drive: fly there. Slow between stars (years), and never risky',
  hyperdrive: 'Hyperdrive: jump (instant, can lose the ship, then a cooldown)',
  warp: 'Warp drive: fly faster than light, no loss roll',
}

// The drive of one ship, or of a whole selection: the buttons offer only drives EVERY
// selected ship has and its owner can use (the rest are greyed, with the reason), and the
// drive shown is the slowest ship's. The pick persists on each ship until changed.
// Its own component so its hooks stay clear of ShipPanel's early return.
export function ShipDriveSelector({ ships }: { ships: ShipInstance[] }) {
  const researched = usePlayerTech().researched
  const classes = ships.map((s) => resolveShipClass(s.classId))
  // Nothing to choose between for a hull with no FTL drive at all.
  if (ships.length === 0 || classes.some((c) => !c) || classes.every((c) => c!.ftlDrives.length === 0)) return null
  const perShip = ships.map((s, i) => ({ ship: s, options: driveOptions(classes[i]!.ftlDrives, researched), choice: (s.driveChoice ?? defaultDriveChoice(classes[i]!.defaultDrive)) as DriveChoice }))
  const optionFor = (drive: ShipDrive) => {
    const all = perShip.map((p) => p.options.find((o) => o.drive === drive)!)
    const blocker = all.find((o) => !o.available)
    return { available: !blocker, reason: blocker?.reason ?? null }
  }
  const effective = perShip.map((p, i) => effectiveDrive(p.choice, classes[i]!.ftlDrives, researched, p.ship.warpEnabled))
  const slowest = effective.reduce((a, b) => (SPEED_RANK[b] < SPEED_RANK[a] ? b : a))
  const choices = new Set(perShip.map((p) => p.choice))
  const picked: DriveChoice | null = choices.size === 1 ? [...choices][0] : null
  const set = (choice: DriveChoice) => {
    for (const p of perShip) {
      useShipStore.getState().setDriveChoice(p.ship.id, choice)
      if (choice === 'warp' || choice === 'auto') replanForWarpWhenReady(p.ship.id)
    }
  }
  const buttons: { choice: DriveChoice; available: boolean; reason: string | null }[] = [
    { choice: 'auto', available: true, reason: null },
    ...DRIVE_ORDER.map((d) => ({ choice: d as DriveChoice, ...optionFor(d) })),
  ]
  // Greyed buttons may not show their tooltip (a disabled control gets no hover), so the reasons are written out.
  const greyed = buttons.filter((b) => !b.available && b.reason)
  return (
    <>
    <div className="inspect-row">
      <span className="inspect-label" title="Which drive the ship uses for its next orders (interstellar and between clusters). It stays until you change it.">
        Drive
      </span>
      <span className="inspect-value ship-automation">
        {buttons.map((b) => (
          <button
            key={b.choice}
            type="button"
            className={`nav-subtab${picked === b.choice ? ' active' : ''}`}
            disabled={!b.available}
            onClick={() => set(b.choice)}
            title={b.reason ?? TIPS[b.choice]}
          >
            {DRIVE_LABELS[b.choice]}
          </button>
        ))}
        <span className="abs-dim">
          {' '}
          {ships.length > 1 ? 'slowest: ' : 'uses '}
          {DRIVE_LABELS[slowest]}
          {picked === null ? ' (mixed picks)' : ''}
        </span>
      </span>
    </div>
    {greyed.length > 0 && <div className="ship-panel-hint">{greyed.map((b) => `${DRIVE_LABELS[b.choice]}: ${b.reason}`).join(' · ')}</div>}
    </>
  )
}
