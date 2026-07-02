/**
 * asciiHand.worker.ts
 *
 * Raymarches a simple signed-distance-field "hand" (a palm sphere + 5
 * capsule fingers, smooth-blended) and rasterizes it directly into a grid
 * of ASCII characters based on surface lighting. Runs in a dedicated Worker
 * because a single frame at a readable resolution takes 40-90ms of compute
 * — too slow to do on the main thread without janking scroll/input.
 *
 * Protocol (postMessage):
 *   -> { type: 'config', cols, rows, mirror?, phase?, charAspect? }
 *      Reconfigures grid size / hand orientation. Can be sent anytime
 *      (e.g. on resize) and will apply on the next tick.
 *   -> { type: 'stop' }
 *      Stops the render loop.
 *   <- { type: 'frame', text: string }
 *      One rendered frame, ready to assign to a <pre>.textContent.
 */

type ConfigMsg = {
  type: "config";
  cols: number;
  rows: number;
  /** Mirror the hand across X (used for the "right" panel). */
  mirror?: boolean;
  /** Phase offset (radians) so left/right hands don't move in lockstep. */
  phase?: number;
  /** Measured (charWidth / charHeight) of the monospace font, for correct proportions. */
  charAspect?: number;
};
type StopMsg = { type: "stop" };
type InMsg = ConfigMsg | StopMsg;

// --- tunables -------------------------------------------------------------

const MAX_STEPS = 36;
const MAX_DIST = 6;
const HIT_EPS = 0.012;
const TARGET_FRAME_MS = 70; // ~14fps; deliberately chunky/organic, not smooth 60fps
const NORMAL_EPS = 0.0015;

// Darkest -> lightest. Picked to echo the density characters seen in the
// reference capture (., ~, :, ;, =, +, ?, <, >, brackets, slashes, etc).
const RAMP =
  " .`,:;~-_+<>i!lI?/\\|()1{}[]rcvunxzjftLCJUYXZO0Qoahkbdpqwm*#MW&8%B@$";

// --- vector helpers (scalar, no allocation, hot loop) ----------------------

function vlen(x: number, y: number, z: number) {
  return Math.sqrt(x * x + y * y + z * z);
}
function vdot(ax: number, ay: number, az: number, bx: number, by: number, bz: number) {
  return ax * bx + ay * by + az * bz;
}
function smin(a: number, b: number, k: number) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

// --- SDF primitives ---------------------------------------------------------

function sdSphere(px: number, py: number, pz: number, cx: number, cy: number, cz: number, r: number) {
  return vlen(px - cx, py - cy, pz - cz) - r;
}

function sdCapsule(
  px: number, py: number, pz: number,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  r: number,
) {
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  let t = vdot(apx, apy, apz, abx, aby, abz) / vdot(abx, aby, abz, abx, aby, abz);
  t = Math.max(0, Math.min(1, t));
  const cx = ax + abx * t, cy = ay + aby * t, cz = az + abz * t;
  return vlen(px - cx, py - cy, pz - cz) - r;
}

// --- hand shape --------------------------------------------------------------
// Palm sphere at origin + 5 fanned, slightly-curled finger capsules.

const PALM_R = 0.44;

interface Finger {
  dx: number; dy: number; dz: number;
  len: number; r: number; curl: number;
}

function buildFingers(): Finger[] {
  const spread = [-0.62, -0.3, 0.0, 0.3, 0.58]; // thumb..pinky fan angle
  const lens = [0.55, 0.8, 0.9, 0.82, 0.6];
  const rad = [0.085, 0.075, 0.075, 0.072, 0.065];
  const curl = [0.35, 0.15, 0.05, 0.1, 0.25];
  const fingers: Finger[] = [];
  for (let i = 0; i < 5; i++) {
    const a = spread[i];
    const dirx = Math.sin(a);
    const diry = Math.cos(a) * 0.85 + 0.15;
    const dirz = 0.25 - Math.abs(a) * 0.15;
    const dl = Math.hypot(dirx, diry, dirz);
    fingers.push({ dx: dirx / dl, dy: diry / dl, dz: dirz / dl, len: lens[i], r: rad[i], curl: curl[i] });
  }
  return fingers;
}
const FINGERS = buildFingers();

function sdHand(px: number, py: number, pz: number): number {
  let d = sdSphere(px, py, pz, 0, 0, 0, PALM_R);
  for (let i = 0; i < FINGERS.length; i++) {
    const f = FINGERS[i];
    const bx = f.dx * PALM_R * 0.7, by = f.dy * PALM_R * 0.7, bz = f.dz * PALM_R * 0.7;
    const tx = bx + f.dx * f.len;
    const ty = by + f.dy * f.len;
    const tz = bz + f.dz * f.len - f.curl * f.len;
    const fd = sdCapsule(px, py, pz, bx, by, bz, tx, ty, tz, f.r);
    d = smin(d, fd, 0.18);
  }
  return d;
}

// rotation, applied to the sample point before evaluating the SDF
function rotY(x: number, y: number, z: number, a: number): [number, number, number] {
  const c = Math.cos(a), s = Math.sin(a);
  return [x * c + z * s, y, -x * s + z * c];
}
function rotX(x: number, y: number, z: number, a: number): [number, number, number] {
  const c = Math.cos(a), s = Math.sin(a);
  return [x, y * c - z * s, y * s + z * c];
}

// --- worker state ------------------------------------------------------------

let cols = 50;
let rows = 24;
let mirror = false;
let phase = 0;
let charAspect = 0.5; // char width / char height, overwritten by 'config'
let running = true;
let t = phase;

function scene(px: number, py: number, pz: number): number {
  if (mirror) px = -px;
  const bobY = Math.sin(t * 0.9 + phase) * 0.06;
  let [rx, ry, rz] = rotY(px, py - bobY, pz, t * 0.55 + phase);
  [rx, ry, rz] = rotX(rx, ry, rz, Math.sin(t * 0.3 + phase) * 0.3 + 0.15);
  return sdHand(rx, ry, rz);
}

function normal(px: number, py: number, pz: number): [number, number, number] {
  const e = NORMAL_EPS;
  const dx = scene(px + e, py, pz) - scene(px - e, py, pz);
  const dy = scene(px, py + e, pz) - scene(px, py - e, pz);
  const dz = scene(px, py, pz + e) - scene(px, py, pz - e);
  const l = vlen(dx, dy, dz) || 1;
  return [dx / l, dy / l, dz / l];
}

function renderFrame(): string {
  const camZ = -2.6;
  const lightX = -0.6, lightY = 0.7, lightZ = -0.8;
  const ll = vlen(lightX, lightY, lightZ);
  const lx = lightX / ll, ly = lightY / ll, lz = lightZ / ll;
  // aspect compensates for monospace glyphs being taller than wide
  const aspect = charAspect > 0 ? 1 / charAspect : 2.0;

  const rampLast = RAMP.length - 1;
  const lines: string[] = new Array(rows);

  for (let row = 0; row < rows; row++) {
    let line = "";
    const v = ((row / (rows - 1)) * 2 - 1) * -1 / aspect;
    for (let col = 0; col < cols; col++) {
      const u = (col / (cols - 1)) * 2 - 1;
      const dl = vlen(u, v, 1);
      const rdx = u / dl, rdy = v / dl, rdz = 1 / dl;

      let px = 0, py = 0, pz = camZ;
      let hit = false, dist = 0;
      for (let s = 0; s < MAX_STEPS; s++) {
        const d = scene(px, py, pz);
        if (d < HIT_EPS) { hit = true; break; }
        dist += d;
        px += rdx * d; py += rdy * d; pz += rdz * d;
        if (dist > MAX_DIST) break;
      }

      if (hit) {
        const [nx, ny, nz] = normal(px, py, pz);
        let diff = Math.max(0.05, vdot(nx, ny, nz, lx, ly, lz));
        const rim = Math.pow(1 - Math.max(0, vdot(nx, ny, nz, -rdx, -rdy, -rdz)), 2) * 0.3;
        const b = Math.min(1, diff + rim);
        const idx = Math.floor(b * rampLast);
        line += RAMP[rampLast - idx];
      } else {
        line += " ";
      }
    }
    lines[row] = line;
  }
  return lines.join("\n");
}

async function loop() {
  while (running) {
    const start = performance.now();
    const text = renderFrame();
    (postMessage as (msg: unknown) => void)({ type: "frame", text });
    t += TARGET_FRAME_MS / 1000;
    const elapsed = performance.now() - start;
    const wait = Math.max(0, TARGET_FRAME_MS - elapsed);
    await new Promise((r) => setTimeout(r, wait));
  }
}

self.onmessage = (ev: MessageEvent<InMsg>) => {
  const msg = ev.data;
  if (msg.type === "config") {
    cols = Math.max(10, Math.min(140, msg.cols));
    rows = Math.max(6, Math.min(80, msg.rows));
    mirror = !!msg.mirror;
    phase = msg.phase ?? phase;
    if (msg.charAspect) charAspect = msg.charAspect;
  } else if (msg.type === "stop") {
    running = false;
    self.close();
  }
};

loop();
