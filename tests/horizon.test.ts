// The horizon test the ground map's markers use (scene/horizon.ts).
//
// Run:  npx tsx tests/horizon.test.ts
import { facesCamera } from '../src/scene/horizon'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}
const R = 5.05
const cam = (d: number) => ({ x: 0, y: 0, z: d })
const at = (deg: number) => ({ x: Math.sin((deg * Math.PI) / 180), y: 0, z: Math.cos((deg * Math.PI) / 180) })
for (const d of [7, 14, 30, 44]) {
  const horizonDeg = (Math.acos(5 / d) * 180) / Math.PI
  check(`camera at ${d}: the point facing the camera is seen`, facesCamera(at(0), cam(d), R))
  check(`...a point just inside the horizon (${(horizonDeg - 3).toFixed(0)} degrees) is seen`, facesCamera(at(horizonDeg - 3), cam(d), R))
  check(`...a point just beyond it (${(horizonDeg + 8).toFixed(0)} degrees) is hidden`, !facesCamera(at(horizonDeg + 8), cam(d), R))
  check(`...the far side is hidden`, !facesCamera(at(180), cam(d), R))
}
console.log(failures ? `\n${failures} FAILED` : '\nAll horizon checks passed')
process.exit(failures ? 1 : 0)
