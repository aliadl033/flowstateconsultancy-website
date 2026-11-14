/*
  Flow State Consultancy: signal field
  Dependency-free WebGL2 particle engine for the "van ruis naar signaal" motif.

    import { createSignalField } from './signal-field.js';
    const field = createSignalField(containerEl, {
      mode: 'tune',          // 'tune' | 'stream' | 'calm' | 'noise'
      progress: 0,           // 0..1 starting value
      interactive: true,     // pointer parallax / local disturbance
      density: 'auto',       // 'auto' | 'low' | 'high'  ('medium' is accepted too)

      // Optional composition helpers (all optional, all modes unless noted):
      protect: [titleEl, leadEl, buttonsEl], // Element or up to 4 Elements over the field: the
                             // particles behind them are dimmed (rounded rect with a soft 56px edge).
                             // Measured relative to the container on every resize.
      protectStrength: 0.88, // 0..1, default per mode: tune 0.88, stream 0.7, calm 0.6, noise 0.5
      safeTop: titleEl,      // tune: the wave stays below this line. A number (px from the container
                             // top) or an Element (or array): its bottom edge plus 24px.
                             // Default: about half the height (a little lower on wide, short screens).
                             // When the wave would not fit below the line, it is first framed
                             // flatter and further away, and only then allowed above the line.
      tuneFrom: 'right',     // tune: the side that locks in first, 'right' (default: the clean wave
                             // grows out of the SIGNAAL side and eats the noise toward RUIS) or 'left'.
      path: [[x, y, depth], ...7 points], // stream: the channel in screen terms (ndc x, ndc y, depth)
    });
    field.setProgress(p);    // eases toward p with a critically damped spring (~0.35s)
    field.pause(); field.resume(); field.destroy();
    field.refreshColors();   // re-reads the --scope-* colors (after a theme or class change)
    field.supported;         // true = WebGL2, false = 2D canvas fallback (live)
    field.error;             // why WebGL2 was given up ('' while it runs, or when it was never there)
    field.band;              // tune: { top, bottom, left, right } in px from the container top, where
                             // the wave sits (left/right: its middle at the screen edges). Also sent
                             // as a 'signalfield:band' event on the container whenever it moves.
  Events on the container: 'signalfield:band' (see above) and 'signalfield:fallback'
  ({ detail: { reason } }, when the 2D renderer takes over: 'no-webgl2', 'shader' or 'context-lost').

  Create the field after the first paint (requestIdleCallback, or a short timeout), like home.js does:
  context creation costs a few milliseconds of main thread time.

  How it works
  * One gl.POINTS draw call per frame. Every position is computed in the vertex shader from one
    static vec4 of layout per particle (built once per mode, density and size) plus random numbers
    hashed from the vertex id, and a handful of per-frame uniforms.
    The frame loop writes those uniforms in place (no per-frame objects, numbers go to GL through
    typed arrays), rebuilds cameras only when their inputs change, and reads no layout.
  * The backing store is the css size times the device pixel ratio (capped at 2, 1.5 for low
    density), within a pixel budget, so very large screens do not multiply the fill cost.
  * Blending is "soft additive" premultiplied alpha (ONE, ONE_MINUS_SRC_ALPHA with a partial
    alpha): overlaps glow, but converge to a bounded color instead of clipping to white.
  * Colors are read from --scope-bg, --scope-noise, --scope-signal and --scope-text on the
    container (any CSS color). The hex values below are fallbacks only.

  Extras for the lab page (not part of the page contract):
  options.time (shader time in seconds), options.frozen, options.forceFallback,
  field.setMode(), field.setDensity(), field.setTime(), field.setFrozen(),
  field.fps, field.particleCount, field.mode, field.density, field.progress.
*/

const MODES = ['tune', 'stream', 'calm', 'noise'];
const FALLBACK_COLORS = { bg: '#141513', noise: '#8A9088', signal: '#FF5A26', text: '#F3EFE7' };
const COUNTS = {
  // tune low is a little above the brief's 8k: the settled sheet is drawn as threads, which need
  // enough particles along every row to stay continuous on a phone (still trivial for gl.POINTS).
  tune: { high: 26000, medium: 14000, low: 11000 },
  stream: { high: 22000, medium: 13000, low: 7600 },
  calm: { high: 6000, medium: 4800, low: 3600 },
  noise: { high: 26000, medium: 14000, low: 8000 },
};
// High density tune grows with the area beyond 1440 x 900 css px, up to this many particles.
const TUNE_MAX = 42000;
// Front row spacing of the settled sheet in css px (the rows are laid out for it).
const TUNE_ROW_PX = 7.5;
const TUNE_GAMMA = 0.85; // v = s^gamma: rows a little closer toward the front, still compressing behind
// Backing-store pixel budgets: WebGL, and the 2D fallback (which often runs in software).
const PIXEL_BUDGET = 5.2e6;
const PIXEL_BUDGET_2D = 2.4e6;
// Shader time used for the single reduced-motion frame (chosen for a calm composition; for tune a
// trough sits under copy on the left and the crest rises on the right).
const STILL_TIME = { tune: 2.8, stream: 6.0, calm: 3.1, noise: 3.0 };
// Every time rate in the shaders is a multiple of 0.01 rad/s, so wrapping the clock at 200 * PI
// seconds is seamless for all of them, and sine arguments stay small for mobile GPUs.
const TIME_WRAP = 200 * Math.PI;
const SPRING_OMEGA = 12; // critically damped, about 90 to 95 percent settled after 0.35s
const DEG = Math.PI / 180;
const MAX_PROTECT = 4;
const PROTECT_STRENGTH = { tune: 0.88, stream: 0.7, calm: 0.6, noise: 0.5 };
const PROTECT_PAD = 12; // px around each protected element
const PROTECT_FEATHER = 56; // px soft edge outside it
const PROTECT_RADIUS = 24; // px corner radius
const SAFE_GAP = 24; // px between a safeTop element and the crest of the wave
const NOISE_AVOID = 40; // noise: px around protected copy where the clean spot fades out
// The WebGL loop draws every vsync up to about 100 Hz; faster screens (120, 144 Hz) draw every
// other frame. The threshold sits between the 120 Hz and 100 Hz frame times.
const MIN_FRAME_MS = 9.5;
const MIN_FRAME_MS_2D = 1000 / 30 - 2; // the 2D fallback draws at about 30fps
const LOSS_TIMEOUT = 3000; // ms to wait for a lost context to come back before switching to 2D

/* ------------------------------------------------------------------------------------------
   Small helpers
------------------------------------------------------------------------------------------ */

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
function set3(o, a, b, c) { o[0] = a; o[1] = b; o[2] = c; }
function set4(o, a, b, c, d) { o[0] = a; o[1] = b; o[2] = c; o[3] = d; }

const warned = new Set();
function warnOnce(key, msg) {
  if (warned.has(key)) return;
  warned.add(key);
  try { console.warn('signal-field: ' + msg); } catch (e) { /* no console */ }
}

/* ------------------------------------------------------------------------------------------
   Colors: hex and rgb() directly, anything else CSS understands through the browser.
------------------------------------------------------------------------------------------ */

function rgb3(r, g, b) {
  const o = new Float32Array(3);
  o[0] = clamp(r, 0, 1); o[1] = clamp(g, 0, 1); o[2] = clamp(b, 0, 1);
  return o;
}

function parseColorFast(str) {
  const s = String(str || '').trim();
  let m = /^#([0-9a-f]{3,8})$/i.exec(s);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    return rgb3(parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255);
  }
  m = /^rgba?\(\s*([\d.]+)(%?)[\s,]+([\d.]+)(%?)[\s,]+([\d.]+)(%?)/i.exec(s);
  if (m) {
    const ch = (v, pct) => (pct ? Number(v) / 100 : Number(v) / 255);
    return rgb3(ch(m[1], m[2]), ch(m[3], m[4]), ch(m[5], m[6]));
  }
  m = /^color\(\s*srgb\s+([\d.]+)(%?)\s+([\d.]+)(%?)\s+([\d.]+)(%?)/i.exec(s);
  if (m) {
    const ch = (v, pct) => (pct ? Number(v) / 100 : Number(v));
    return rgb3(ch(m[1], m[2]), ch(m[3], m[4]), ch(m[5], m[6]));
  }
  return null;
}

// Any CSS color (named, hsl(), color-mix(), oklch() ...): the browser computes it on a probe
// element; whatever is not sRGB yet goes through a 1x1 canvas.
let probeCtx = null;
function browserColor(el, s) {
  let probe = null;
  try {
    probe = document.createElement('span');
    probe.style.color = s;
    if (!probe.style.color) return null;
    probe.style.cssText += ';position:absolute;width:0;height:0;overflow:hidden;visibility:hidden;pointer-events:none;';
    const host = el && el.isConnected ? el : document.body || document.documentElement;
    host.appendChild(probe);
    const computed = getComputedStyle(probe).color;
    const fast = parseColorFast(computed);
    if (fast) return fast;
    if (!probeCtx) {
      const c = document.createElement('canvas');
      c.width = 1;
      c.height = 1;
      probeCtx = c.getContext('2d', { willReadFrequently: true });
    }
    if (!probeCtx) return null;
    probeCtx.clearRect(0, 0, 1, 1);
    probeCtx.fillStyle = '#000';
    probeCtx.fillStyle = computed;
    probeCtx.fillRect(0, 0, 1, 1);
    const px = probeCtx.getImageData(0, 0, 1, 1).data;
    return rgb3(px[0] / 255, px[1] / 255, px[2] / 255);
  } catch (e) {
    return null;
  } finally {
    if (probe && probe.parentNode) probe.parentNode.removeChild(probe);
  }
}

function resolveColor(el, raw, fallback, name) {
  const s = String(raw || '').trim();
  if (s) {
    const c = parseColorFast(s) || browserColor(el, s);
    if (c) return c;
    warnOnce(name + s, `could not read ${name} ("${s}"), using ${fallback}`);
  }
  return parseColorFast(fallback);
}

function readColors(el) {
  let cs = null;
  try { cs = getComputedStyle(el); } catch (e) { cs = null; }
  const get = (name) => (cs ? cs.getPropertyValue(name) : '');
  return {
    bg: resolveColor(el, get('--scope-bg'), FALLBACK_COLORS.bg, '--scope-bg'),
    noise: resolveColor(el, get('--scope-noise'), FALLBACK_COLORS.noise, '--scope-noise'),
    signal: resolveColor(el, get('--scope-signal'), FALLBACK_COLORS.signal, '--scope-signal'),
    text: resolveColor(el, get('--scope-text'), FALLBACK_COLORS.text, '--scope-text'),
  };
}

function resolveDensity(pref) {
  if (pref === 'low' || pref === 'medium' || pref === 'high') return pref;
  const w = window.innerWidth || document.documentElement.clientWidth || 1280;
  const cores = navigator.hardwareConcurrency || 8;
  if (w <= 480 || cores <= 4) return 'low';
  if (w >= 1280) return 'high';
  return 'medium';
}

// Particles for a mode, density and container size. High density tune grows with the area, so a
// large screen keeps the same fine threads instead of the same particles spread thinner.
function particleCount(mode, density, cssW, cssH) {
  const n = COUNTS[mode][density];
  if (mode !== 'tune' || density !== 'high' || !(cssW > 0 && cssH > 0)) return n;
  return Math.round(clamp((n * cssW * cssH) / (1440 * 900), n, TUNE_MAX) / 1000) * 1000;
}

// Deterministic PRNG (mulberry32), so every load builds the same field.
function rng(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------------------------------
   Camera (column-major matrices). The inputs go through the CAM typed array rather than as
   number arguments: in the frame loop that keeps every number unboxed, so nothing is allocated.
------------------------------------------------------------------------------------------ */

// 0 distance, 1 yaw, 2 pitch, 3 tan of the half vertical field of view, 4 aspect,
// 5 lens shift (moves the image down in NDC units without changing the angle),
// 6 and 7 pointer x and y (NDC), 8 to 10 target xyz.
const CAM = new Float64Array(11);
const EYE = new Float64Array(3);
const EYE0 = new Float64Array(3);
const PRJ = new Float64Array(2);
const HIT = new Float64Array(2);
const TMP_M = new Float64Array(16);

function setCam(dist, yaw, pitch, tanY, aspect, shift) {
  CAM[0] = dist; CAM[1] = yaw; CAM[2] = pitch; CAM[3] = tanY; CAM[4] = aspect; CAM[5] = shift;
  CAM[8] = 0; CAM[9] = 0; CAM[10] = 0;
}

// Eye on an orbit around CAM's target (distance, yaw, pitch).
function orbitEye(eye) {
  const cp = Math.cos(CAM[2]);
  eye[0] = CAM[8] + CAM[0] * Math.sin(CAM[1]) * cp;
  eye[1] = CAM[9] + CAM[0] * Math.sin(CAM[2]);
  eye[2] = CAM[10] + CAM[0] * Math.cos(CAM[1]) * cp;
}

// View projection from eye toward CAM's target (up is +y), perspective with the lens shift.
function viewProj(out, eye) {
  let zx = eye[0] - CAM[8], zy = eye[1] - CAM[9], zz = eye[2] - CAM[10];
  let l = Math.sqrt(zx * zx + zy * zy + zz * zz);
  if (l < 1e-9) l = 1;
  zx /= l; zy /= l; zz /= l;
  // x = up cross z, y = z cross x
  let xx = zz, xz = -zx;
  l = Math.sqrt(xx * xx + xz * xz);
  if (l < 1e-9) l = 1;
  xx /= l; xz /= l;
  const yx = zy * xz, yy = zz * xx - zx * xz, yz = -zy * xx;
  const tx = -(xx * eye[0] + xz * eye[2]);
  const ty = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
  const tz = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
  const f = 1 / CAM[3], fa = f / CAM[4], s = CAM[5];
  const A = (120 + 0.1) / (0.1 - 120), B = (2 * 120 * 0.1) / (0.1 - 120);
  out[0] = fa * xx; out[1] = f * yx + s * zx; out[2] = A * zx; out[3] = -zx;
  out[4] = 0; out[5] = f * yy + s * zy; out[6] = A * zy; out[7] = -zy;
  out[8] = fa * xz; out[9] = f * yz + s * zz; out[10] = A * zz; out[11] = -zz;
  out[12] = fa * tx; out[13] = f * ty + s * tz; out[14] = A * tz + B; out[15] = -tz;
}

// NDC position of a world point (out[0] = x, out[1] = y). Not used in the frame loop.
function project(m, x, y, z, out) {
  const cx = m[0] * x + m[4] * y + m[8] * z + m[12];
  const cy = m[1] * x + m[5] * y + m[9] * z + m[13];
  const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
  const w = Math.abs(cw) > 1e-6 ? cw : 1e-6;
  out[0] = cx / w;
  out[1] = cy / w;
  return cw;
}

// Ray from the eye through the pointer (CAM 6 and 7), intersected with the plane y = 0.
// Writes [x, z] into out and returns true, or returns false when it misses.
function rayToFloor(eye, out) {
  let fx = CAM[8] - eye[0], fy = CAM[9] - eye[1], fz = CAM[10] - eye[2];
  let l = Math.sqrt(fx * fx + fy * fy + fz * fz);
  if (l < 1e-9) l = 1;
  fx /= l; fy /= l; fz /= l;
  // right = forward x up
  let rx = -fz, rz = fx;
  l = Math.sqrt(rx * rx + rz * rz);
  if (l < 1e-9) l = 1;
  rx /= l; rz /= l;
  // up = right x forward
  const ux = -rz * fy, uy = rz * fx - rx * fz, uz = rx * fy;
  const sx = CAM[6] * CAM[3] * CAM[4], sy = (CAM[7] + CAM[5]) * CAM[3];
  const dx = fx + rx * sx + ux * sy, dy = fy + uy * sy, dz = fz + rz * sx + uz * sy;
  if (dy > -1e-3) return false;
  const s = -eye[1] / dy;
  if (s > 80) return false;
  out[0] = eye[0] + dx * s;
  out[1] = eye[2] + dz * s;
  return true;
}

/* ------------------------------------------------------------------------------------------
   Framing of the tune sheet. One function feeds the camera, the particle layout and the band,
   so they always agree. The lens shift is solved so the back crest lands on the target line.
------------------------------------------------------------------------------------------ */

function makeTuneFrame() {
  return { land: 0.5, pitch: 0.5, tanY: 0.5, dist: 10.5, zBack: -8.5, zFront: 3.2, amp: 0.42, cloudH: 0.7, halfWK: 0.5, target: 0.5, shift: 0.5, height: 0.5 };
}
// Scratch frame for the particle layout. Every instance keeps its own frame for drawing (U.tf).
const TF_BUILD = makeTuneFrame();
const BAND2 = new Float64Array(2); // band top and bottom in NDC y, without lens shift
const REFIT_STEPS = 6;

// The band runs from the back crest (plus a little for the static cloud above it) to the trough
// of the front row. Its height does not depend on the lens shift.
function bandNdc(F, a) {
  setCam(F.dist, 0, F.pitch, F.tanY, a, 0);
  orbitEye(EYE0);
  viewProj(TMP_M, EYE0);
  project(TMP_M, 0, -F.amp, F.zFront, PRJ);
  BAND2[1] = PRJ[1];
  project(TMP_M, 0, F.amp * 0.55 + 0.15, F.zBack, PRJ);
  BAND2[0] = PRJ[1];
}

// a: aspect, safeFrac: the safe line as a fraction of the height (or -1), cssH: css height.
function tuneFrame(F, a, safeFrac, cssH) {
  const land = smoothstep(0.6, 1.5, a); // 0 portrait .. 1 landscape
  F.land = land;
  F.tanY = Math.max(Math.tan(18 * DEG), lerp(0.4, 0.32, land) / a);
  F.dist = lerp(10, 11, land);
  F.zBack = -8;
  F.amp = lerp(0.48, 0.42, land);
  F.cloudH = lerp(0.78, 0.7, land);
  F.halfWK = F.tanY * a * 1.22; // the sheet is 1.22 times wider than the view at every depth
  const pitch0 = lerp(22, 15, land);
  const zFront0 = lerp(4.4, 3.2, land);
  // Tall screens keep the band in their lower half even when the copy above it ends high.
  const tall = smoothstep(1000, 1250, cssH || 0);
  let target = 0.5;
  let h = 0.36;
  for (let i = 0; i <= REFIT_STEPS; i++) {
    // Refit: when the front row would leave the screen below the safe line, the sheet is framed
    // flatter and further away, step by step, before anything is cropped.
    const k = i / REFIT_STEPS;
    F.pitch = (pitch0 - 6 * k) * DEG;
    F.zFront = zFront0 - 1.2 * k;
    bandNdc(F, a);
    h = (BAND2[0] - BAND2[1]) / 2; // band height as a fraction of the canvas height
    // Target line for the top of the band, as a fraction of the height from the top. Landscape:
    // half way, a little lower on wide, short screens (their headline scales with the width, so
    // it is taller). Portrait: as low as possible with the front row still on screen.
    const fallback = lerp(clamp(0.95 - h, 0.45, 0.62), clamp(0.5 + 0.25 * (a - 1.6), 0.5, 0.62), land);
    target = safeFrac >= 0 ? clamp(Math.max(safeFrac, fallback * tall), 0.3, 0.8) : fallback;
    if (target + h <= 0.96) break;
  }
  // Still too tall: the band rises above the safe line (the copy over it stays protected).
  if (target + h > 0.96) target = Math.max(0.12, 0.96 - h);
  F.target = target;
  F.height = h;
  F.shift = BAND2[0] - (1 - 2 * target);
  return F;
}

// Rows of the tune grid: the settled rows sit about TUNE_ROW_PX apart at the front and compress
// behind it; the columns take the rest of the particles, so each row is dense enough to be a thread.
function tuneRows(count, a, cssH) {
  const H = cssH > 0 ? cssH : 800;
  const F = tuneFrame(TF_BUILD, a, -1, H);
  setCam(F.dist, 0, F.pitch, F.tanY, a, 0);
  orbitEye(EYE0);
  viewProj(TMP_M, EYE0);
  project(TMP_M, 0, 0, F.zFront, PRJ);
  const y0 = PRJ[1];
  project(TMP_M, 0, 0, F.zFront - 0.05, PRJ);
  const pxPerZ = (Math.abs(PRJ[1] - y0) * 0.5 * H) / 0.05;
  const rows = Math.round(((F.zFront - F.zBack) * TUNE_GAMMA * pxPerZ) / TUNE_ROW_PX);
  return clamp(rows, 20, Math.floor(count / 120));
}

/* ------------------------------------------------------------------------------------------
   Static particle buffers: one vec4 of layout per particle, meaning per mode. Everything that is
   only random (offsets, phases, flags) is hashed from gl_VertexID in the shader, so building a
   buffer is a short loop with no more than a few random numbers per particle.
------------------------------------------------------------------------------------------ */

function buildTune(count, rows) {
  // Rows from back to front (stored in that order so the soft "over" blending layers correctly).
  // Every row is a thread: evenly spaced particles from a random phase (so the columns never line
  // up), with only a hair of jitter across, so the settled sheet reads as fine striations.
  rows = Math.max(20, rows || 50);
  const cols = Math.max(120, Math.floor(count / rows));
  const n = rows * cols;
  const d = new Float32Array(n * 4);
  const r = rng(0x51f7a1);
  let i = 0;
  for (let row = 0; row < rows; row++) {
    const off = r();
    for (let c = 0; c < cols; c++, i += 4) {
      const s = clamp((row + 0.5 + (r() - 0.5) * 0.12) / rows, 0, 1);
      d[i] = (c + off + (r() - 0.5) * 0.3) / cols;
      d[i + 1] = Math.pow(s, TUNE_GAMMA);
    }
  }
  return { data: d, count: n };
}

function buildStream(count) {
  // Ambient static first (drawn behind), then the channel as parallel threads of particles.
  const r = rng(0x5f12e3);
  const ambient = Math.round(count * 0.25);
  const threads = Math.max(10, Math.round(Math.sqrt(count) / 9));
  const per = Math.floor((count - ambient) / threads);
  const n = ambient + per * threads;
  const d = new Float32Array(n * 4);
  let k = 0;
  for (; k < ambient; k++) d[k * 4 + 3] = 1;
  for (let th = 0; th < threads; th++) {
    const w = (th / (threads - 1)) * 2 - 1;
    const off = r();
    for (let j = 0; j < per; j++, k++) {
      d[k * 4] = (j + off + (r() - 0.5) * 0.3) / per;
      d[k * 4 + 1] = w;
    }
  }
  return { data: d, count: n };
}

function buildCalm(count) {
  const r = rng(0xca1a51);
  const ringN = Math.round(count * 0.32);
  const nodeN = Math.max(32, Math.round(count * 0.012));
  const strands = 7;
  const per = Math.floor((count - ringN - nodeN) / strands);
  const n = per * strands + ringN + nodeN;
  const d = new Float32Array(n * 4);
  let k = 0;
  const put = (a0, a1, a2, a3) => {
    const i = k * 4;
    d[i] = a0; d[i + 1] = a1; d[i + 2] = a2; d[i + 3] = a3;
    k++;
  };
  for (let s = 0; s < strands; s++) {
    const w = (s / (strands - 1)) * 2 - 1;
    const off = r();
    for (let j = 0; j < per; j++) put((j + off + (r() - 0.5) * 0.3) / per, w, 0, 0);
  }
  const perRing = Math.floor(ringN / 3);
  for (let ring = 0; ring < 3; ring++) {
    const cnt = ring < 2 ? perRing : ringN - perRing * 2;
    for (let j = 0; j < cnt; j++) put((j + r() * 0.7) / cnt, 0, 1, ring);
  }
  for (let j = 0; j < nodeN; j++) put(0, 0, 2, 0);
  return { data: d, count: n };
}

function buildNoise(count) {
  // Fully random: the shader hashes everything from the vertex id. The buffer only keeps
  // attribute 0 enabled (drawing without it is slow on some desktop GL drivers).
  return { data: new Float32Array(count * 4), count };
}

const BUILDERS = { tune: buildTune, stream: buildStream, calm: buildCalm, noise: buildNoise };

/* ------------------------------------------------------------------------------------------
   Shaders
------------------------------------------------------------------------------------------ */

const VS_HEAD = `#version 300 es
precision highp float;
precision highp int;
layout(location = 0) in vec4 a_a; // layout (meaning per mode); random numbers come from rnd()
uniform mat4 u_viewProj;
uniform mat4 u_aux;
uniform vec3 u_eye;      // camera position without pointer parallax
// Scalars travel packed in two vec4s (set from typed arrays, so the frame loop boxes no numbers).
uniform vec4 u_frame;    // time, progress, device pixel ratio, px per world unit at distance 1
uniform vec4 u_view;     // size compensation for narrow screens, max point size, css width, css height
#define u_time u_frame.x
#define u_progress u_frame.y
#define u_dpr u_frame.z
#define u_pxScale u_frame.w
#define u_sizeK u_view.x
#define u_maxPoint u_view.y
#define u_res u_view.zw
uniform vec3 u_cNoise;
uniform vec3 u_cSignal;
uniform vec3 u_cText;
uniform vec4 u_fog;      // near depth, far depth, intensity at far, curve
uniform vec4 u_protect;  // default calm zone without page rects (uv, y down): right edge, top or bottom
                         // edge (y > 0: the zone is above it; y < 0: the zone is below -y), strength, feather
uniform vec4 u_prot[4];  // copy rects from the page in css px: left, top, right, bottom
uniform vec4 u_protN;    // rect count, strength, feather (px), corner radius (px)
uniform vec4 u_vig;      // edge vignette strength, defocus start size (css px), unused, unused
uniform vec4 u_p0;
uniform vec4 u_p1;
uniform vec4 u_p2;
uniform vec4 u_p3;
out vec4 v_col;
out float v_core;
out vec4 v_shape;        // sprite long axis (point coord space), stretch, glow

const float PI = 3.14159265;
const float TAU = 6.28318531;

// Sprite shape, set by a mode before it calls emitPoint.
vec3 g_tan = vec3(1.0, 0.0, 0.0); // world direction of the long axis
float g_stretch = 1.0;            // 1 round; 2.5 a thread two and a half times longer than wide
float g_glow = 0.0;               // wide faint halo
vec2 g_minS = vec2(1.5, 1.5);     // minimum point size in css px: near, and beyond depth 18

uint hashU(uint x) {
  x ^= x >> 16u; x *= 0x7feb352du;
  x ^= x >> 15u; x *= 0x846ca68bu;
  x ^= x >> 16u;
  return x;
}
float hash1(uint x) { return float(hashU(x)) * (1.0 / 4294967295.0); }
vec3 hash3(uint x) { return vec3(hash1(x), hash1(x + 0x9e3779b9u), hash1(x + 0x7f4a7c15u)); }
// Fixed random numbers of one particle in 0..1 (k up to 15), and a bell shaped one in -1..1.
float rnd(uint id, uint k) { return hash1(id * 16u + k + 0x51f7a1u); }
float bellR(uint id, uint k) { return (rnd(id, k) + rnd(id, k + 1u) + rnd(id, k + 2u) - 1.5) / 1.5; }

// How much of the light is taken away to keep the copy readable at this screen position.
float protectZone(vec2 ndc) {
  if (u_protN.x < 0.5) {
    vec2 uv = vec2(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);
    float zx = 1.0 - smoothstep(u_protect.x - u_protect.w, u_protect.x, uv.x);
    float zy = u_protect.y >= 0.0
      ? 1.0 - smoothstep(u_protect.y - u_protect.w, u_protect.y, uv.y)
      : smoothstep(-u_protect.y, -u_protect.y + u_protect.w, uv.y);
    return u_protect.z * zx * zy;
  }
  vec2 px = vec2(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5) * u_res;
  float zone = 0.0;
  for (int i = 0; i < 4; i++) {
    if (float(i) >= u_protN.x) break;
    vec4 rc = u_prot[i];
    vec2 q = abs(px - 0.5 * (rc.xy + rc.zw)) - 0.5 * (rc.zw - rc.xy) + u_protN.w;
    float sd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - u_protN.w;
    zone = max(zone, 1.0 - smoothstep(0.0, u_protN.z, sd));
  }
  return u_protN.y * zone;
}

void emitPoint(vec3 world, vec3 rgb, float I, float occl, float worldSize, float core) {
  vec4 clip = u_viewProj * vec4(world, 1.0);
  gl_Position = clip;
  float w = max(clip.w, 1e-3);
  vec2 ndc = clip.xy / w;
  float size = u_pxScale * worldSize * u_sizeK / w;
  // Below the minimum size, fade instead of shrinking (no sub-pixel shimmer).
  float minS = u_dpr * mix(g_minS.x, g_minS.y, smoothstep(14.0, 18.0, w));
  float k = clamp(size / minS, 0.0, 1.0);
  I *= k * k;
  size = max(size, minS);
  // Very close particles spread their light (soft defocus) instead of growing brighter.
  float bokeh = u_vig.y * u_dpr;
  if (size > bokeh) I *= pow(bokeh / size, 1.25);
  // Threads: the sprite grows to hold the long axis and spreads the same total light over it.
  vec2 axis = vec2(1.0, 0.0);
  if (g_stretch > 1.01) {
    vec4 c2 = u_viewProj * vec4(world + g_tan * 0.05, 1.0);
    vec2 dp = (c2.xy / max(c2.w, 1e-3) - ndc) * u_res;
    float l = length(dp);
    if (l > 1e-6) axis = vec2(dp.x, -dp.y) / l;
    float grow = 1.0 + (g_stretch - 1.0) * 0.67;
    size *= grow;
    I *= g_stretch / (grow * grow);
  }
  size = min(size, u_maxPoint);
  // Atmospheric depth.
  float f = clamp((w - u_fog.x) / max(u_fog.y - u_fog.x, 1e-3), 0.0, 1.0);
  I *= mix(1.0, u_fog.z, pow(f, u_fog.w));
  // Keep the copy calm.
  I *= 1.0 - protectZone(ndc);
  float vg = 1.0 - smoothstep(0.7, 1.3, length(ndc * vec2(0.85, 1.0)));
  I *= mix(1.0 - u_vig.x, 1.0, vg);
  if (clip.w <= 0.0) I = 0.0;
  gl_PointSize = size;
  v_col = vec4(rgb * I, I * occl);
  v_core = core;
  v_shape = vec4(axis, g_stretch, g_glow);
}
`;

// Mode "tune": static noise in depth (progress 0) tunes into a flowing wave sheet (progress 1).
const VS_TUNE = VS_HEAD + `
// a_a: u (across), v (0 back .. 1 front), unused, unused
// u_p0: zBack, zFront, camera distance, sheet half width per unit of depth
// u_p1: amplitude, wave number, angular speed, phase per unit z
// u_p2: cos(pitch), cloud half height, landscape (0 portrait .. 1 landscape), tuning side (1 right, 0 left)
// u_p3: ripple x, ripple z, ripple strength, unused
// u_aux: base view-projection without pointer parallax (tuning order and composition)
void main() {
  uint id = uint(gl_VertexID);
  float u = a_a.x;
  float v = a_a.y;
  float r0 = rnd(id, 0u), r1 = rnd(id, 1u), r2 = rnd(id, 2u), r3 = rnd(id, 3u), r4 = rnd(id, 4u);
  float r5 = rnd(id, 5u);
  float t = u_time;
  float p = u_progress;

  float z = mix(u_p0.x, u_p0.y, v);
  float halfW = (u_p0.z - z * u_p2.x) * u_p0.w;
  float x = (u * 2.0 - 1.0) * halfW;

  // Screen x without pointer parallax: it orders the tuning and shapes the composition.
  vec4 bc = u_aux * vec4(x, 0.0, z, 1.0);
  float ndcX = bc.x / max(bc.w, 1e-3);
  // Under the copy on the left the sheet runs lower and calmer; the crest rises on the right.
  float right = smoothstep(-0.75, 0.15, ndcX);

  // Signal: one clean travelling sine, its phase drifting slowly with depth.
  float ph = u_p1.y * x - u_p1.z * t + u_p1.w * z;
  float crest = sin(ph);
  float slope = cos(ph);
  float swell = 0.85 + 0.15 * sin(0.19 * x - 0.27 * t + 0.8);
  float envZ = mix(0.55, 1.0, smoothstep(0.0, 0.75, v));
  float amp = u_p1.x * envZ * swell * mix(0.55, 1.0, right);
  // Soft ripple around the pointer (u_p3.z is its strength), with its analytic slope.
  vec2 rd = vec2(x, z) - u_p3.xy;
  float rr = max(length(rd), 1e-4);
  float renv = u_p3.z * 0.1 * exp(-rr * rr * 0.4);
  float rph = rr * 3.4 - t * 3.2;
  float dRip = renv * (3.4 * cos(rph) - 0.8 * rr * sin(rph));
  vec2 gRip = dRip * rd / rr;
  vec3 sig = vec3(x, amp * crest + renv * sin(rph) - 0.3 * (1.0 - right), z);

  // Slope-aware light: slopes seen at a grazing angle pack more points per pixel, so they are
  // dimmed by the same factor (no caustic streaks); slopes facing the light read a bit brighter.
  float dydx = amp * u_p1.y * slope + gRip.x;
  vec3 nrm = normalize(vec3(-dydx, 1.0, -amp * u_p1.w * slope - gRip.y));
  vec3 V = normalize(u_eye - sig);
  float facing = dot(nrm, V) / max(V.y, 0.08);
  float shade = pow(clamp(facing, 0.06, 2.2), 0.7);
  float lit = 0.72 + 0.36 * dot(nrm, vec3(-0.34, 0.9, 0.27));

  // Static: a wide, shallow band over the same footprint. Every particle re-rolls on its own
  // 30 Hz phase (a fizz, not a strobe), mostly up and down, so the rows read as jagged lines;
  // the cloud sways slowly, more in front than behind.
  uint tick = uint(floor(t * 30.0 + r3));
  vec3 jit = hash3(id * 0x9e3779b1u ^ tick * 0x85ebca77u) - 0.5;
  vec3 noi = vec3(x + (rnd(id, 6u) * 2.0 - 1.0) * 0.22, bellR(id, 7u) * u_p2.y * mix(0.4, 1.0, v) + sig.y * 0.45,
                  z + (rnd(id, 10u) * 2.0 - 1.0) * 0.6);
  noi.x += 0.08 * (1.0 + v) * sin(0.35 * t + r2 * TAU);
  noi.y += 0.07 * sin(0.55 * noi.x + 0.45 * t + r2 * TAU);
  noi += jit * vec3(0.025, 0.07, 0.03);

  // Tuning. The clean wave grows out of one side (u_p2.w: 1 the right, the SIGNAAL side) and eats
  // the noise toward the other. The front is a tide line, not a wipe: the front rows lead and it
  // curves through depth. On portrait screens it sweeps mostly from the front row back, so a
  // phone first shows a full width clean front wave. Load (progress about 0.18) already shows one
  // clean crest; everything has settled at 0.9, so the finished wave holds for the end.
  float X = clamp(ndcX * 0.5 + 0.5, 0.0, 1.0);
  float Xs = mix(X, 1.0 - X, u_p2.w);
  float d = Xs + 0.05 * sin(5.0 * v + 3.0 * Xs) + 0.1 * (1.0 - v) + (r0 - 0.5) * 0.08;
  d = mix(d, 0.95 * (1.0 - v) + (r0 - 0.5) * 0.08, 0.7 * (1.0 - u_p2.z));
  float tide = -0.1 + 1.3 * p + 0.36 * smoothstep(0.0, 0.2, p);
  float lp = clamp((tide - d) / 0.2, 0.0, 1.0);
  float e = lp * lp * (3.0 - 2.0 * lp);
  // A sparse residue of static stays at the far edges. Sparse enough that the threads it leaves
  // keep running: every sprite overlaps several neighbours, so one missing barely shows.
  float stay = step(r1, 0.14 * smoothstep(0.8, 1.1, abs(ndcX)));
  e *= 1.0 - stay;
  float arc = sin(PI * e);
  float drift = mix(1.0, -1.0, u_p2.w) * 0.15 * (r2 - 0.2); // in flight, a small arc with the tide
  vec3 pos = mix(noi, sig, e) + vec3(drift, 0.03 + 0.05 * r3, 0.0) * arc;
  // Lock-in flash: the front reads as one bright line as particles snap into place.
  float fq = (lp - 0.86) / 0.06;
  float flash = exp(-fq * fq) * (1.0 - stay);

  // Static light: flickering grain with the odd brighter spark, present before the signal comes.
  float fl = hash1(id * 0x27d4eb2du ^ tick * 0x165667b1u);
  float spark = step(0.992, hash1(id * 0x2545f491u ^ (tick / 2u) * 0x9e3779b9u));
  float nI = mix(0.3 + 0.75 * fl * fl, 1.0, spark);
  vec3 nC = mix(u_cNoise, u_cText, spark * 0.35);
  // Volume: grains differ in size; the big ones are softer, so the cloud reads as depth.
  float grain = r5 * r5;
  float vol = 1.0 - smoothstep(0.3, 0.5, e);

  // Signal light: brighter front rows, crests catch a little more, rare paper-white glints that
  // flicker briefly as short streaks on the crest line.
  float frontRow = pow(v, 1.15);
  float sI = mix(0.55, 1.2, frontRow) * shade * lit * (0.84 + 0.16 * crest) * (1.0 + 2.2 * renv);
  float twinkle = pow(max(0.5 + 0.5 * sin(t * 1.9 + r4 * TAU), 0.0), 6.0);
  float glint = step(rnd(id, 11u), 0.008) * step(0.45, v) * smoothstep(0.7, 1.0, crest) * twinkle;
  vec3 sC = mix(u_cSignal, u_cText, glint * 0.4);
  sI += glint * 0.35;

  // In flight, particles dim (the mess is never the brightest part) and change color late.
  vec3 rgb = mix(nC, sC, smoothstep(0.45, 0.65, e));
  rgb = mix(rgb, u_cText, 0.15 * flash);
  float I = mix(nI * mix(1.0, 0.75, grain * vol), sI, e) * mix(1.0, 0.55, arc * (1.0 - flash)) * (1.0 + 1.6 * flash);
  // Past full intensity red clips first and the hue drifts to peach: only glints may go there.
  I = min(I, 1.3 + 0.8 * glint);
  // Settled threads are drawn mostly "over" (alpha near the light): many overlapping sprites then
  // converge on the signal color instead of clipping it to peach.
  float silk = smoothstep(0.5, 0.95, e);
  float occ = mix(mix(0.35, 0.62, e), 0.9, silk);
  float silkSize = u_res.x < 600.0 ? 0.024 : 0.03;
  float size = mix(0.022 * mix(1.0, mix(0.8, 1.6, grain), vol), silkSize, e) + spark * 0.008 + glint * 0.012;
  // Static grains are short horizontal dashes (analog snow); settled particles become fine threads
  // along the wave that overlap their neighbours, so every row fuses into one line. In flight they
  // are round.
  float core = mix(mix(0.2, 0.6, e), 0.12, silk);
  core = mix(core, 0.3, glint) + spark * 0.3;
  g_tan = vec3(1.0, dydx * e, 0.0);
  g_stretch = mix(mix(2.2, 4.5, silk), 1.0, arc);
  g_glow = 0.2 * silk * smoothstep(0.45, 0.8, v);
  emitPoint(pos, rgb, I, occ, size, core);
}
`;

// Shared Catmull-Rom helpers for the stream channel (control points in world and screen space).
const VS_CURVE = `
uniform vec3 u_cpw[7];
uniform vec3 u_cpn[7];
uniform vec3 u_camR;
uniform vec3 u_camU;
uniform vec3 u_camF;
vec3 crom(vec3 a, vec3 b, vec3 c, vec3 d, float t) {
  float t2 = t * t, t3 = t2 * t;
  return 0.5 * (2.0 * b + (c - a) * t + (2.0 * a - 5.0 * b + 4.0 * c - d) * t2 + (3.0 * b - a - 3.0 * c + d) * t3);
}
vec3 curveW(float s) {
  float f = clamp(s, 0.0, 0.99999) * 4.0;
  int i = int(f);
  return crom(u_cpw[i], u_cpw[i + 1], u_cpw[i + 2], u_cpw[i + 3], f - float(i));
}
vec3 curveN(float s) {
  float f = clamp(s, 0.0, 0.99999) * 4.0;
  int i = int(f);
  return crom(u_cpn[i], u_cpn[i + 1], u_cpn[i + 2], u_cpn[i + 3], f - float(i));
}
`;

// Mode "stream": a river of light flowing along a smooth 3D channel, static outside it.
const VS_STREAM = VS_HEAD + VS_CURVE + `
// a_a: s0, across (-1..1), unused, kind (0 channel, 1 ambient)
// u_p0: flow phase, flow spread phase, channel half width, twist
// u_p1: tanX, tanY, ambient near depth, ambient far depth

// A point on one thread of the channel. Loose, every thread wanders on its own as one continuous,
// wavy line (a turbulent river, not knotted yarn); the phases belong to the thread, not the
// particle, so the threads never dissolve into dust. The tangle billows where the channel runs on
// the right of the frame, away from copy on the left.
vec3 threadPos(float s, float lane, float w, float th, float t, float loose) {
  vec3 c = curveW(s);
  vec3 T = normalize(curveW(s + 0.003) - curveW(s - 0.003));
  vec3 N = normalize(cross(T, normalize(u_eye - c)));
  vec3 B = cross(N, T);
  float tw = u_p0.w * sin(s * 6.0 + t * 0.3);
  float R = u_p0.z;
  vec3 pos = c + R * (N * (w * cos(tw) - th * sin(tw)) + B * (w * sin(tw) + th * cos(tw)));
  float seed = lane * 13.7;
  float k23 = mix(0.125, 0.25, smoothstep(0.35, 0.65, u_progress));
  vec3 turb = vec3(
    0.65 * sin(s * 9.0 + t * 0.8 + seed) + k23 * sin(s * 23.0 - t * 1.3 + seed * 2.1),
    0.5 * sin(s * 11.0 - t * 0.7 + seed * 1.3) + 0.1 * sin(s * 37.0 + t * 1.5 + seed * 2.9),
    sin(s * 23.0 + t * 1.3 + seed * 1.7));
  float side = mix(0.3, 1.0, smoothstep(-0.1, 0.4, curveN(s).x));
  return pos + (N * turb.x + B * turb.y + T * turb.z * 0.1) * R * 0.8 * loose * side;
}

void main() {
  uint id = uint(gl_VertexID);
  float t = u_time;
  float p = u_progress;
  float loose = 1.0 - p;
  float r0 = rnd(id, 0u), r1 = rnd(id, 1u), r2 = rnd(id, 2u), r3 = rnd(id, 3u);
  if (a_a.w < 0.5) {
    float s = fract(a_a.x + u_p0.x + (r3 - 0.5) * u_p0.y);
    float lane = a_a.y;
    // Across and thickness jitter, scaled with looseness, so tight threads are clean.
    float w = lane + (rnd(id, 4u) - 0.5) * 0.015 * loose;
    float th = (rnd(id, 5u) - 0.5) * 0.025 * loose;
    vec3 pos = threadPos(s, lane, w, th, t, loose);
    // Each particle is drawn along its own thread, so a tangled thread still reads as one line.
    g_tan = threadPos(min(s + 0.002, 1.0), lane, w, th, t, loose) - pos;
    uint tick = uint(floor(t * 24.0 + r0));
    pos += (hash3(id * 0x9e3779b1u ^ tick * 0x85ebca77u) - 0.5) * 0.01 * loose;
    float core = clamp(1.0 - abs(lane), 0.0, 1.0);
    float hl = step(rnd(id, 6u), 0.03) * smoothstep(0.3, 0.9, p);
    // Colour by thread, never a blend of hues: a vermilion core that widens as the flow tightens,
    // gray threads outside it.
    float sel = 1.0 - smoothstep(mix(0.3, 0.9, p), mix(0.42, 1.0, p), abs(lane));
    vec3 rgb = mix(mix(u_cNoise, u_cSignal, sel), u_cText, hl * 0.9);
    float I = (0.5 + 0.75 * pow(core, 1.2)) * mix(0.62, 1.0, sel) * mix(1.08, 1.0, p) + hl * 0.6;
    I *= smoothstep(0.0, 0.05, s) * (1.0 - smoothstep(0.8, 1.0, s));
    // Far away the threads stay at least 2.2px wide and dim instead, so they never break up.
    // Overlaps converge to rgb / alpha: an alpha of 0.65 or more keeps piled-up vermilion vermilion.
    // Loose threads are longer (their wiggles spread the particles), so the sprites stretch more.
    g_minS = vec2(1.5, 2.2);
    g_stretch = mix(3.4, 2.6, p);
    emitPoint(pos, rgb, I, mix(0.65, 0.7, p), 0.032 + hl * 0.01, 0.4 + 0.3 * core + hl * 0.4);
  } else {
    float depth = mix(u_p1.z, u_p1.w, rnd(id, 6u));
    vec2 nd = (vec2(rnd(id, 4u), rnd(id, 5u)) * 2.0 - 1.0) * 1.08;
    vec3 pos = u_eye + depth * (u_camF + u_camR * (nd.x * u_p1.x) + u_camU * (nd.y * u_p1.y));
    // Where is the channel at this screen x? Bisection on the screen-space curve.
    float lo = 0.0, hi = 1.0;
    for (int k = 0; k < 10; k++) {
      float mid = 0.5 * (lo + hi);
      if (curveN(mid).x < nd.x) lo = mid; else hi = mid;
    }
    vec3 cn = curveN(0.5 * (lo + hi));
    float dy = nd.y - cn.y;
    float halfN = u_p0.z / (max(cn.z, 1.0) * u_p1.y);
    float above = step(0.0, dy);
    // Denser close to the channel, thinning out with distance from it.
    float far = abs(dy) / max(halfN, 0.02);
    float keep = step(r1, exp(-max(far - 3.0, 0.0) * 0.3));
    // Above the channel: stress (fast, bright, sparks). Below: boredom (dim, a slow drift).
    uint tick = uint(floor(t * mix(4.0, 30.0, above) + r2));
    vec3 j = hash3(id * 0x9e3779b1u ^ tick * 0x85ebca77u) - 0.5;
    pos += (u_camR * j.x + u_camU * j.y) * mix(0.002, 0.012, above) * depth;
    pos += u_camU * ((1.0 - above) * 0.012 * depth * sin(t * 1.88 + r0 * TAU));
    float fl = hash1(id * 0x27d4eb2du ^ tick * 0x165667b1u);
    float spark = above * step(0.993, hash1(id * 0x2545f491u ^ (tick / 2u) * 0x9e3779b9u));
    float I = mix(0.18, 0.5 + 0.35 * fl, above);
    I = mix(I, 1.0, spark);
    I *= smoothstep(halfN * 1.3, halfN * 3.0, abs(dy)) * keep;
    emitPoint(pos, mix(u_cNoise, u_cText, spark * 0.4), I, 0.35, 0.045, 0.2 + spark * 0.3);
  }
}
`;

// Mode "calm": one slow breathing ribbon and three broadcast rings from a node on it.
const VS_CALM = VS_HEAD + `
// a_a: u along ribbon | ring angle, strand (-1..1), kind (0 ribbon, 1 ring, 2 node), ring index
// u_p0: ribbon half width, amplitude, wave number, angular speed
// u_p1: ring phase, ring max radius, node x, ring tilt
// u_p2: ring period (s), ribbon width, ribbon y, twist base
float ribbonY(float x, float t) {
  float breath = 0.8 + 0.2 * sin(t * 0.42);
  return u_p2.z + u_p0.y * breath * sin(u_p0.z * x - u_p0.w * t) * (0.84 + 0.16 * cos(0.37 * x + 0.2 * t));
}
void main() {
  uint id = uint(gl_VertexID);
  float t = u_time;
  float kind = a_a.z;
  float r0 = rnd(id, 0u);
  // Every ring is centred on the node as it is now, so the rings stay concentric around it.
  vec3 node = vec3(u_p1.z, ribbonY(u_p1.z, t), 0.0);
  if (kind < 0.5) {
    float x = (a_a.x * 2.0 - 1.0) * u_p0.x;
    float y = ribbonY(x, t);
    float tw = u_p2.w + 0.62 * sin(0.38 * x + 0.17 * t);
    vec3 pos = vec3(x, y, 0.0) + a_a.y * u_p2.y * vec3(0.0, cos(tw), sin(tw));
    float crest = sin(u_p0.z * x - u_p0.w * t);
    float twinkle = pow(max(0.5 + 0.5 * sin(t * 1.7 + r0 * TAU), 0.0), 3.0);
    float glint = step(rnd(id, 4u), 0.03) * smoothstep(0.7, 1.0, crest) * twinkle;
    float edge = abs(a_a.y);
    float I = (0.62 + 0.22 * (0.5 + 0.5 * crest)) * mix(1.0, 0.7, edge) + glint * 0.5;
    vec3 rgb = mix(u_cSignal, u_cText, glint * 0.6);
    // The strands are fine threads along the ribbon.
    g_tan = vec3(1.0, (ribbonY(x + 0.02, t) - y) / 0.02, 0.0);
    g_stretch = mix(2.2, 1.0, smoothstep(0.0, 0.3, glint));
    emitPoint(pos, rgb, I, 0.6, 0.026 + glint * 0.02, mix(0.3, 0.25, glint));
  } else if (kind < 1.5) {
    float age = fract(u_p1.x + a_a.w / 3.0);
    float ease = 1.0 - pow(1.0 - age, 2.2);
    float R = mix(0.05, u_p1.y, ease) * (1.0 + bellR(id, 4u) * (0.006 + 0.05 * age));
    float th = a_a.x * TAU;
    vec3 off = vec3(cos(th) * cos(u_p1.w), sin(th), -cos(th) * sin(u_p1.w)) * R;
    // A newborn ring is small and dense: it fades in and is capped, so it stays vermilion.
    float I = min(pow(1.0 - age, 1.25) * smoothstep(0.0, 0.12, age) * 1.15, 0.85);
    vec3 rgb = mix(u_cSignal, u_cText, step(0.94, r0) * 0.5);
    emitPoint(node + off, rgb, I, 0.5, 0.024, 0.5);
  } else {
    float young = fract(u_p1.x * 3.0) / 3.0;
    float pulse = min(exp(-young * u_p2.x * 3.0), 0.6);
    float I = 0.42 + 0.35 * pulse;
    vec3 rgb = mix(u_cSignal, u_cText, 0.12 + 0.3 * pulse);
    vec3 nodeOff = vec3(bellR(id, 4u), bellR(id, 7u), bellR(id, 10u));
    emitPoint(node + nodeOff * 0.035, rgb, I, 0.5, 0.024, 0.8);
  }
}
`;

// Mode "noise": agitated static that calms into a clean wave fragment around the pointer.
const VS_NOISE = VS_HEAD + `
// a_a: unused (every number is hashed from the vertex id)
// u_p0: tanX, tanY, near depth, far depth
// u_p1: spot x, spot y (ndc), strength, catchment radius (ndc y units)
// u_p2: wave amplitude (ndc), wave number, angular speed, aspect
// u_p3: wave plane depth, frame margin, fragment half length (ndc y units), unused
void main() {
  uint id = uint(gl_VertexID);
  float t = u_time;
  vec3 q = vec3(rnd(id, 0u), rnd(id, 1u), rnd(id, 2u)) * 2.0 - 1.0;
  float r0 = rnd(id, 3u), r1 = rnd(id, 4u), r2 = rnd(id, 5u);
  float depth = mix(u_p0.z, u_p0.w, q.z * 0.5 + 0.5);
  vec2 n = q.xy * u_p3.y;
  n += 0.022 * vec2(sin(t * 0.9 + q.y * 3.1 + r0 * TAU), cos(t * 0.7 + q.x * 2.7 + r1 * TAU));
  vec2 dv = (n - u_p1.xy) * vec2(u_p2.w, 1.0);
  float calm = (1.0 - smoothstep(u_p1.w * 0.72, u_p1.w, length(dv))) * u_p1.z;

  // Each particle re-rolls on its own 30 Hz phase: a steady fizz instead of a whole-field flip.
  uint tick = uint(floor(t * 30.0 + r0));
  vec3 j = hash3(id * 0x9e3779b1u ^ tick * 0x85ebca77u) - 0.5;
  vec3 noisePos = vec3(n.x * depth * u_p0.x, n.y * depth * u_p0.y, -depth) + j * vec3(0.012, 0.006, 0.03) * depth;

  // The clean wave fragment through the spot.
  float dx = clamp(dv.x, -u_p3.z, u_p3.z);
  float win = 1.0 - smoothstep(u_p3.z * 0.25, u_p3.z, abs(dx));
  float crest = sin(u_p2.y * dx - u_p2.z * t);
  float wy = u_p1.y + u_p2.x * crest * win + (r1 - 0.5) * 0.004;
  float D0 = u_p3.x;
  vec3 target = vec3((u_p1.x + dx / u_p2.w) * D0 * u_p0.x, wy * D0 * u_p0.y, -D0);
  vec3 pos = mix(noisePos, target, calm);

  float fl = hash1(id * 0x27d4eb2du ^ tick * 0x165667b1u);
  float spark = step(0.995, hash1(id * 0x2545f491u ^ (tick / 3u) * 0x9e3779b9u));
  float nI = mix(0.2 + 0.5 * fl, 0.85, spark);
  vec3 nC = mix(u_cNoise, u_cText, spark * 0.35);
  float glint = step(0.97, r2) * smoothstep(0.75, 1.0, crest);
  float sI = (0.75 + 0.2 * crest) * mix(0.5, 1.0, win) + glint * 0.4;
  vec3 sC = mix(u_cSignal, u_cText, glint * 0.6);
  vec3 rgb = mix(nC, sC, smoothstep(0.1, 0.8, calm));
  float I = mix(nI, sI, calm);
  // Static as short horizontal dashes; the calm fragment as one fine line along the wave.
  float dwy = u_p2.x * u_p2.y * cos(u_p2.y * dx - u_p2.z * t) * win;
  g_tan = vec3(1.0, dwy * calm, 0.0);
  g_stretch = mix(1.7, 2.4, calm);
  emitPoint(pos, rgb, I, mix(0.35, 0.66, calm), mix(0.017, 0.024, calm) + spark * 0.006, mix(0.2, 0.6, calm) + spark * 0.3);
}
`;

const FS = `#version 300 es
precision mediump float;
in vec4 v_col;
in float v_core;
in vec4 v_shape;
out vec4 outColor;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  // Ellipse along the sprite axis (a circle when the stretch is 1).
  float a = dot(c, v_shape.xy);
  float b = (v_shape.x * c.y - v_shape.y * c.x) * v_shape.z;
  float r2 = a * a + b * b;
  float halo = max(1.0 - r2, 0.0);
  halo *= halo;
  float core = exp(-r2 * 8.0);
  float glow = max(1.0 - dot(c, c), 0.0);
  glow *= glow * v_shape.w;
  outColor = v_col * (halo * 0.7 + core * mix(0.3, 0.75, v_core) + glow);
}
`;

const VERTEX_SHADERS = { tune: VS_TUNE, stream: VS_STREAM, calm: VS_CALM, noise: VS_NOISE };

// [uniform name, kind (0 mat4, 1 vec3 or vec3[], 2 vec4 or vec4[]), key in the uniform bag]
const UNIFORMS = [
  ['u_viewProj', 0, 'viewProj'], ['u_aux', 0, 'aux'], ['u_eye', 1, 'eye'],
  ['u_frame', 2, 'frame'], ['u_view', 2, 'view'],
  ['u_cNoise', 1, 'cNoise'], ['u_cSignal', 1, 'cSignal'], ['u_cText', 1, 'cText'],
  ['u_camR', 1, 'camR'], ['u_camU', 1, 'camU'], ['u_camF', 1, 'camF'],
  ['u_fog', 2, 'fog'], ['u_protect', 2, 'protect'], ['u_prot', 2, 'prot'], ['u_protN', 2, 'protN'], ['u_vig', 2, 'vig'],
  ['u_p0', 2, 'p0'], ['u_p1', 2, 'p1'], ['u_p2', 2, 'p2'], ['u_p3', 2, 'p3'],
  ['u_cpw', 1, 'cpw'], ['u_cpn', 1, 'cpn'],
];

/* ------------------------------------------------------------------------------------------
   Per-mode framing: camera and uniforms, written in place. What depends only on the aspect
   (or the safe line, or the path) is rebuilt when that changes; the pointer camera when the
   pointer moves. The rest is a few element writes per frame, and nothing is allocated.
------------------------------------------------------------------------------------------ */

function makeUniformBag() {
  return {
    viewProj: new Float32Array(16), aux: new Float32Array(16),
    eye: new Float32Array(3), camR: new Float32Array(3), camU: new Float32Array(3), camF: new Float32Array(3),
    frame: new Float32Array(4), view: new Float32Array(4),
    cNoise: new Float32Array(3), cSignal: new Float32Array(3), cText: new Float32Array(3),
    fog: new Float32Array(4), protect: new Float32Array(4), prot: new Float32Array(16), protN: new Float32Array(4),
    vig: new Float32Array(4),
    p0: new Float32Array(4), p1: new Float32Array(4), p2: new Float32Array(4), p3: new Float32Array(4),
    cpw: new Float32Array(21), cpn: new Float32Array(21),
    // Cache keys: 0 aspect, 1 safe line, 2 to 4 pointer x, y and presence of the last camera,
    // 5 css height, 6 tuning side.
    key: new Float64Array(7).fill(NaN), mode: '', pathFor: null,
    pxScaleTan: 0.5, tanY: 0.5, scaleR: 0.5, len: 0.5, portrait: 0.5, spotK: 0.5,
    tf: makeTuneFrame(), // this field's tune framing (one per instance, never shared)
  };
}

// The stream channel, drawn in screen terms: [ndc x, ndc y, depth]. The visible part runs from the
// second to the sixth point. Landscape: it rises from the bottom edge and leaves at the right, away
// from a headline on the left. Portrait: it crosses the top third, above the copy.
const STREAM_PATH = [
  [-0.6, -2.0, 5.0],
  [-0.05, -1.1, 6.6],
  [0.3, -0.62, 9.4],
  [0.58, -0.25, 13.5],
  [0.86, 0.08, 19.5],
  [1.3, 0.42, 29],
  [2.0, 0.8, 40],
];
const STREAM_PATH_PORTRAIT = [
  [-2.4, 0.26, 5.0],
  [-1.3, 0.42, 6.6],
  [-0.5, 0.52, 9.4],
  [0.08, 0.6, 13.5],
  [0.58, 0.67, 19.5],
  [1.25, 0.78, 29],
  [2.0, 0.88, 40],
];
const streamPathFor = (S) => S.path || (S.aspect < 0.85 ? STREAM_PATH_PORTRAIT : STREAM_PATH);
const STREAM_R0 = 1.4; // channel half width when loose (progress 0); 0.72 when tight

function validPath(path) {
  if (!Array.isArray(path) || path.length !== 7) return null;
  for (const q of path) {
    if (!Array.isArray(q) || q.length < 3 || !q.every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
    if (q[2] <= 0.5) return null;
  }
  return path.map((q) => [q[0], q[1], q[2]]);
}

// Pointer camera: rebuilt only when the pointer (or the framing) moved since the last one.
function pointerChanged(S, K) {
  if (K[2] === S.px && K[3] === S.py && K[4] === S.pres) return false;
  K[2] = S.px; K[3] = S.py; K[4] = S.pres;
  return true;
}

const FRAMES = {
  tune(S, U) {
    const K = U.key;
    const a = S.aspect;
    const safe = S.safeTop >= 0 && S.cssH > 0 ? S.safeTop / S.cssH : -1;
    const F = U.tf;
    if (K[0] !== a || K[1] !== safe || K[5] !== S.cssH || K[6] !== S.tuneSide) {
      K[0] = a; K[1] = safe; K[2] = NaN; K[5] = S.cssH; K[6] = S.tuneSide;
      tuneFrame(F, a, safe, S.cssH);
      // Base camera without parallax: tuning order, composition and light.
      setCam(F.dist, 0, F.pitch, F.tanY, a, F.shift);
      orbitEye(EYE0);
      viewProj(U.aux, EYE0);
      set3(U.eye, EYE0[0], EYE0[1], EYE0[2]);
      U.pxScaleTan = F.tanY;
      const cosP = Math.cos(F.pitch);
      set4(U.p0, F.zBack, F.zFront, F.dist, F.halfWK);
      set4(U.p1, F.amp, 1.45, 0.75, 0.42);
      set4(U.p2, cosP, F.cloudH, F.land, S.tuneSide);
      set4(U.fog, F.dist - F.zFront * cosP, F.dist - F.zBack * cosP, 0.4, 0.9);
      if (F.land > 0.5) set4(U.protect, 0.6, 0.56, 0.4, 0.22);
      else set4(U.protect, 1.3, 0.5, 0.4, 0.2);
      set4(U.vig, 0.3, 9, 0, 0);
    }
    if (pointerChanged(S, K)) {
      CAM[0] = F.dist;
      CAM[1] = S.px * S.pres * 3 * DEG * (a < 1 ? a : 1);
      CAM[2] = F.pitch + S.py * S.pres * 1.5 * DEG;
      CAM[3] = F.tanY; CAM[4] = a; CAM[5] = F.shift;
      CAM[6] = S.px; CAM[7] = S.py;
      CAM[8] = 0; CAM[9] = 0; CAM[10] = 0;
      orbitEye(EYE);
      viewProj(U.viewProj, EYE);
      const p3 = U.p3;
      if (S.pres > 0.01 && rayToFloor(EYE, HIT)) {
        p3[0] = HIT[0]; p3[1] = HIT[1]; p3[2] = S.pres;
      } else {
        p3[0] = 0; p3[1] = 0; p3[2] = 0;
      }
      p3[3] = 0;
    }
  },

  stream(S, U) {
    const K = U.key;
    const a = S.aspect;
    const path = streamPathFor(S);
    const dist = 12;
    if (K[0] !== a || U.pathFor !== path) {
      K[0] = a; K[2] = NaN;
      U.pathFor = path;
      const tanY = Math.max(Math.tan(20 * DEG), 0.3 / a);
      const tanX = tanY * a;
      U.tanY = tanY;
      U.pxScaleTan = tanY;
      U.scaleR = clamp(tanX / 0.58, 0.6, 1);
      for (let i = 0; i < 7; i++) {
        const q = path[i], o = i * 3;
        U.cpn[o] = q[0]; U.cpn[o + 1] = q[1]; U.cpn[o + 2] = q[2];
        U.cpw[o] = q[2] * q[0] * tanX; U.cpw[o + 1] = q[2] * q[1] * tanY; U.cpw[o + 2] = dist - q[2];
      }
      set3(U.eye, 0, 0, dist);
      set3(U.camR, 1, 0, 0);
      set3(U.camU, 0, 1, 0);
      set3(U.camF, 0, 0, -1);
      set4(U.p1, tanX, tanY, 8, 30);
      set4(U.fog, 7, 30, 0.2, 0.8);
      // Without page rects: calm the lower left, where the over ons headline and lead sit (on
      // portrait the copy starts lower, under the channel).
      set4(U.protect, 0.7, a < 0.85 ? -0.38 : -0.22, 0.6, 0.2);
      set4(U.vig, 0.25, 9, 0, 0);
    }
    if (pointerChanged(S, K)) {
      CAM[0] = dist;
      CAM[1] = S.px * S.pres * 3 * DEG * (a < 1 ? a : 1);
      CAM[2] = S.py * S.pres * 2 * DEG;
      CAM[3] = U.tanY; CAM[4] = a; CAM[5] = 0;
      CAM[8] = 0; CAM[9] = 0; CAM[10] = 0;
      orbitEye(EYE);
      viewProj(U.viewProj, EYE);
    }
    const p0 = U.p0;
    p0[0] = S.flowA;
    p0[1] = S.flowB;
    p0[2] = (STREAM_R0 + (0.72 - STREAM_R0) * S.progress) * U.scaleR;
    p0[3] = 0.9;
  },

  calm(S, U) {
    const K = U.key;
    const a = S.aspect;
    const dist = 9;
    const pitch = 4 * DEG;
    if (K[0] !== a) {
      K[0] = a; K[2] = NaN;
      const tanY = Math.max(Math.tan(17 * DEG), 0.34 / a);
      U.tanY = tanY;
      U.pxScaleTan = tanY;
      set3(U.eye, 0, dist * Math.sin(pitch), dist * Math.cos(pitch));
      const halfW = dist * tanY * a, halfH = dist * tanY;
      const lam = (2 * halfW) / 1.25;
      set4(U.p0, halfW * 1.3, Math.min(halfH * 0.18, halfW * 0.2), (2 * Math.PI) / lam, 0.5);
      set4(U.p1, 0, Math.min(halfH * 0.8, halfW * 0.85), halfW * 0.2, 18 * DEG);
      set4(U.p2, 6, 0.26, -halfH * 0.05, 0.78);
      set4(U.p3, 0, 0, 0, 0);
      set4(U.fog, dist - 2, dist + 3, 0.6, 1);
      set4(U.protect, 0, 0, 0, 0.1);
      set4(U.vig, 0.25, 9, 0, 0);
    }
    if (pointerChanged(S, K)) {
      CAM[0] = dist;
      CAM[1] = S.px * S.pres * 4 * DEG;
      CAM[2] = pitch + S.py * S.pres * 2 * DEG;
      CAM[3] = U.tanY; CAM[4] = a; CAM[5] = 0;
      CAM[8] = 0; CAM[9] = 0; CAM[10] = 0;
      orbitEye(EYE);
      viewProj(U.viewProj, EYE);
    }
    U.p1[0] = S.flowA;
    U.p2[0] = 1 / (S.flowSpeedA > 1e-3 ? S.flowSpeedA : 1e-3);
  },

  noise(S, U) {
    const K = U.key;
    const a = S.aspect;
    if (K[0] !== a) {
      K[0] = a;
      const tanY = Math.tan(22.5 * DEG);
      const tanX = tanY * a;
      U.pxScaleTan = tanY;
      setCam(0, 0, 0, tanY, a, 0);
      CAM[10] = -1; // look along -z from the origin
      set3(EYE, 0, 0, 0);
      viewProj(U.viewProj, EYE);
      set3(U.eye, 0, 0, 0);
      // On portrait screens the spot stays near the middle and the fragment gets shorter,
      // so it never leaves the frame.
      U.portrait = 1 - smoothstep(0.7, 1.0, a);
      U.len = Math.min(1, 1.4 * a);
      set4(U.p0, tanX, tanY, 4.5, 13);
      set4(U.p2, 0.06, 19, 2.2, a);
      set4(U.p3, 7, 1.06, 0.3 * U.len, 0);
      set4(U.fog, 4.5, 13, 0.35, 1);
      set4(U.protect, 0, 0, 0, 0.1);
      set4(U.vig, 0.3, 8, 0, 0);
    }
    // The calm spot follows the pointer, or wanders slowly when there is none.
    const s13 = Math.sin(S.time * 0.13);
    const wl = 0.3 + 0.2 * s13;
    const wx = wl + (0.12 * s13 - wl) * U.portrait;
    const wy = -0.2 + 0.14 * Math.sin(S.time * 0.21 + 1);
    const p1 = U.p1;
    p1[0] = wx + (S.px - wx) * S.pres;
    p1[1] = wy + (S.py - wy) * S.pres;
    // Over protected copy (and NOISE_AVOID px around it) the clean fragment fades out, so the
    // field only calms where nothing is printed. Eased; out-of-loop draws (dt 0) snap.
    const sx = (p1[0] * 0.5 + 0.5) * S.cssW, sy = (0.5 - p1[1] * 0.5) * S.cssH;
    let away = 1;
    for (let i = 0; i < S.protN; i++) {
      const o = i * 4;
      const qx = Math.max(S.prot[o] - sx, 0, sx - S.prot[o + 2]);
      const qy = Math.max(S.prot[o + 1] - sy, 0, sy - S.prot[o + 3]);
      let k = Math.sqrt(qx * qx + qy * qy) / NOISE_AVOID;
      k = k > 1 ? 1 : k;
      k = k * k * (3 - 2 * k);
      if (k < away) away = k;
    }
    U.spotK += (away - U.spotK) * (S.dt > 0 ? 1 - Math.exp(-S.dt * 6) : 1);
    p1[2] = U.spotK;
    p1[3] = 0.32 * U.len;
  },
};

// Integrated phase speeds (so changing progress never makes particles jump). Written into S.
function flowSpeeds(S) {
  const p = S.progress;
  if (S.mode === 'stream') {
    S.flowSpeedA = 0.02 + (0.075 - 0.02) * p;
    S.flowSpeedB = S.flowSpeedA * 0.9 * (1 - p);
  } else if (S.mode === 'calm') {
    S.flowSpeedA = 1 / (6 + (4.2 - 6) * p);
    S.flowSpeedB = 0;
  } else {
    S.flowSpeedA = 0;
    S.flowSpeedB = 0;
  }
}

/* ------------------------------------------------------------------------------------------
   WebGL2 renderer
------------------------------------------------------------------------------------------ */

function createGLRenderer(canvas, hooks) {
  // failIfMajorPerformanceCaveat: a software-rendered context would run every particle on the CPU,
  // so it counts as "no WebGL2" and the light 2D fallback takes over.
  const attrs = {
    alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: true,
    preserveDrawingBuffer: false, powerPreference: 'default', failIfMajorPerformanceCaveat: true,
  };
  let gl = null;
  try { gl = canvas.getContext('webgl2', attrs); } catch (e) { gl = null; }
  if (!gl) return null;

  const U = makeUniformBag();
  let par = gl.getExtension('KHR_parallel_shader_compile');
  let programs = {};
  let vao = null, vbo = null, count = 0, scene = null;
  let maxPoint = 64;
  let lost = false;
  let error = '';
  let clearFor = null; // the background color the clear color was last set from

  function compile(type, src) {
    const sh = gl.createShader(type);
    if (!sh) return null;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    return sh;
  }

  // Compiles and links without waiting: with KHR_parallel_shader_compile the driver works on it in
  // the background and the first frames only clear, until the program reports it is done.
  function link(mode) {
    if (gl.isContextLost()) return null;
    const vs = compile(gl.VERTEX_SHADER, VERTEX_SHADERS[mode]);
    const fs = compile(gl.FRAGMENT_SHADER, FS);
    const prog = vs && fs ? gl.createProgram() : null;
    if (!prog) {
      if (vs) gl.deleteShader(vs);
      if (fs) gl.deleteShader(fs);
      return null;
    }
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    const P = { prog, vs, fs, ready: false, failed: false, table: null };
    programs[mode] = P;
    if (!par) finish(P);
    return P;
  }

  function finish(P) {
    if (gl.getProgramParameter(P.prog, gl.LINK_STATUS)) {
      const locs = [], kinds = [], refs = [];
      for (let i = 0; i < UNIFORMS.length; i++) {
        const l = gl.getUniformLocation(P.prog, UNIFORMS[i][0]);
        if (l === null) continue;
        locs.push(l);
        kinds.push(UNIFORMS[i][1]);
        refs.push(U[UNIFORMS[i][2]]);
      }
      P.table = { n: locs.length, locs, kinds, refs };
      P.ready = true;
    } else if (!gl.isContextLost()) {
      // Only now ask for the details: they are the expensive, blocking part.
      error = gl.getShaderInfoLog(P.vs) || gl.getShaderInfoLog(P.fs) || gl.getProgramInfoLog(P.prog) || 'shader program failed';
      P.failed = true;
      hooks.onFail(error);
    }
    if (P.vs) gl.deleteShader(P.vs);
    if (P.fs) gl.deleteShader(P.fs);
    P.vs = null;
    P.fs = null;
  }

  function isReady(P) {
    if (P.ready || P.failed) return P.ready;
    if (par && !gl.getProgramParameter(P.prog, par.COMPLETION_STATUS_KHR)) return false;
    finish(P);
    return P.ready;
  }

  function initState() {
    const range = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE);
    maxPoint = range && range[1] ? Math.min(range[1], 256) : 64;
    par = gl.getExtension('KHR_parallel_shader_compile');
    clearFor = null;
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  function upload(mode, n, layout) {
    if (vbo) gl.deleteBuffer(vbo);
    if (vao) gl.deleteVertexArray(vao);
    const built = BUILDERS[mode](n, layout);
    vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, built.data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 16, 0);
    gl.bindVertexArray(null);
    count = built.count;
  }

  function onLost(e) {
    e.preventDefault();
    lost = true;
    programs = {};
    vao = null; vbo = null;
    hooks.onLost();
  }
  function onRestored() {
    if (gl.isContextLost()) return; // lost again before this event ran: wait for the next one
    lost = false;
    initState();
    if (scene && link(scene.mode)) upload(scene.mode, scene.n, scene.layout);
    hooks.onRestored();
  }
  canvas.addEventListener('webglcontextlost', onLost, false);
  canvas.addEventListener('webglcontextrestored', onRestored, false);
  initState();

  return {
    supported: true,
    get count() { return count; },
    get error() { return error; },
    get pending() {
      const P = scene && programs[scene.mode];
      return !!P && !P.ready && !P.failed;
    },
    setScene(mode, n, layout) {
      scene = { mode, n, layout };
      // While the context is lost nothing can be built; onRestored does it. Never a reason for 2D.
      if (lost || gl.isContextLost()) return true;
      const P = programs[mode] || link(mode);
      if (!P) return gl.isContextLost();
      if (P.failed) return false;
      upload(mode, n, layout);
      return true;
    },
    resize(bw, bh) {
      if (canvas.width !== bw) canvas.width = bw;
      if (canvas.height !== bh) canvas.height = bh;
    },
    // Returns true when the field was drawn (false: lost, empty or still compiling).
    draw(S) {
      if (lost || !scene || gl.isContextLost()) return false;
      const bw = canvas.width, bh = canvas.height;
      if (!bw || !bh) return false;
      const c = S.colors;
      if (clearFor !== c.bg) {
        clearFor = c.bg;
        gl.clearColor(c.bg[0], c.bg[1], c.bg[2], 1);
      }
      gl.viewport(0, 0, bw, bh);
      gl.clear(gl.COLOR_BUFFER_BIT);
      const P = programs[scene.mode];
      if (!P || !vao || !isReady(P)) return false;
      if (U.mode !== scene.mode) {
        U.mode = scene.mode;
        U.key.fill(NaN);
      }
      FRAMES[scene.mode](S, U);
      // Every per-frame number goes into a typed array, so no number is boxed on its way to GL.
      U.prot.set(S.prot);
      const pn = U.protN;
      pn[0] = S.protN; pn[1] = S.protStrength; pn[2] = PROTECT_FEATHER; pn[3] = S.protRadius;
      const fr = U.frame;
      fr[0] = S.time; fr[1] = S.progress; fr[2] = S.dpr; fr[3] = bh / (2 * U.pxScaleTan);
      // Points are sized in world units; on narrow screens a world unit covers far fewer pixels,
      // so grow them a little to keep the same presence. Tune threads grow less (or they turn to
      // rice on a phone) and thin a little on large screens, so they keep about the same width.
      const unitPx = S.cssH / (2 * U.pxScaleTan);
      const tune = scene.mode === 'tune';
      let sizeK = 1;
      if (unitPx < 1100) {
        sizeK = Math.pow(1100 / (unitPx > 1 ? unitPx : 1), 0.85);
        const kMax = tune ? 1.35 : 2.1;
        if (sizeK > kMax) sizeK = kMax;
      } else if (tune && unitPx > 1400) {
        sizeK = Math.pow(1400 / unitPx, 0.85);
        if (sizeK < 0.65) sizeK = 0.65;
      }
      const vw = U.view;
      vw[0] = sizeK; vw[1] = maxPoint; vw[2] = S.cssW; vw[3] = S.cssH;
      U.cNoise.set(c.noise);
      U.cSignal.set(c.signal);
      U.cText.set(c.text);
      gl.useProgram(P.prog);
      const T = P.table;
      for (let i = 0; i < T.n; i++) {
        const k = T.kinds[i];
        if (k === 0) gl.uniformMatrix4fv(T.locs[i], false, T.refs[i]);
        else if (k === 1) gl.uniform3fv(T.locs[i], T.refs[i]);
        else gl.uniform4fv(T.locs[i], T.refs[i]);
      }
      gl.bindVertexArray(vao);
      gl.drawArrays(gl.POINTS, 0, count);
      gl.bindVertexArray(null);
      return true;
    },
    destroy() {
      canvas.removeEventListener('webglcontextlost', onLost, false);
      canvas.removeEventListener('webglcontextrestored', onRestored, false);
      if (!gl.isContextLost()) {
        for (const k of Object.keys(programs)) gl.deleteProgram(programs[k].prog);
        if (vbo) gl.deleteBuffer(vbo);
        if (vao) gl.deleteVertexArray(vao);
      }
      programs = {};
      vao = null; vbo = null;
      // Release the context itself: browsers keep only a few per page and evict the oldest one,
      // which could be another live field.
      const lc = gl.getExtension('WEBGL_lose_context');
      if (lc) lc.loseContext();
      canvas.width = 1;
      canvas.height = 1;
    },
  };
}

/* ------------------------------------------------------------------------------------------
   2D canvas fallback: layered lines with the same idea (noise to sine), drawn at 30fps.
------------------------------------------------------------------------------------------ */

function hashF(n) {
  let x = (n | 0) ^ 0x5bd1e995;
  x = Math.imul(x ^ (x >>> 15), 0x2c1b3c6d);
  x = Math.imul(x ^ (x >>> 12), 0x297a2d39);
  x ^= x >>> 15;
  return (x >>> 0) / 4294967296;
}

function rgba(c, a) {
  return `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${clamp(a, 0, 1).toFixed(3)})`;
}

// Catmull-Rom through the screen-space stream path: x, y in px and depth at s (0..1).
function pathAt(path, s, W, H, out) {
  const f = clamp(s, 0, 0.99999) * 4;
  const i = Math.floor(f);
  const t = f - i, t2 = t * t, t3 = t2 * t;
  for (let k = 0; k < 3; k++) {
    const a = path[i][k], b = path[i + 1][k], c = path[i + 2][k], d = path[i + 3][k];
    out[k] = 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (3 * b - a - 3 * c + d) * t3);
  }
  out[0] = (out[0] * 0.5 + 0.5) * W;
  out[1] = (0.5 - out[1] * 0.5) * H;
  return out;
}

// Tuning order shared by both renderers (the vertex shader has the same formulas): the tide line
// at progress p, and how far a point is from the side that tunes in first. x: 0..1 across the
// screen, f: 0 back .. 1 front row, side: 1 right first, land: 0 portrait .. 1 landscape.
function tuneTide(p) {
  return -0.1 + 1.3 * p + 0.36 * smoothstep(0, 0.2, p);
}
function tuneSettle(tide, x, f, side, land) {
  const xs = side > 0.5 ? 1 - x : x;
  let d = xs + 0.05 * Math.sin(5 * f + 3 * xs) + 0.1 * (1 - f);
  d += (0.95 * (1 - f) - d) * 0.7 * (1 - land);
  const lp = clamp((tide - d) / 0.2, 0, 1);
  return lp * lp * (3 - 2 * lp);
}

function create2DRenderer(canvas) {
  let ctx = null;
  try { ctx = canvas.getContext('2d'); } catch (e) { ctx = null; }
  if (!ctx) return null;
  let mode = 'tune';
  const P0 = [0, 0, 0], P1 = [0, 0, 0];
  const TUNE_ROWS = 18;
  // Row gradients of the tune fallback, rebuilt only when the tuning state, size or colors change.
  const grads = new Array(TUNE_ROWS).fill(null);
  const gKey = { tide: NaN, W: 0, side: -1, land: -1, noise: null, signal: null };

  function tune(S, W, H, d) {
    const c = S.colors, t = S.time;
    const tick = Math.floor(t * 30);
    const rows = TUNE_ROWS;
    const step = Math.max(4, Math.round(W / 220));
    const tide = tuneTide(S.progress);
    const side = S.tuneSide;
    const land = smoothstep(0.6, 1.5, S.aspect);
    // Same place as the WebGL wave: between the band's top line and its front edge.
    const top = (S.band ? S.band.top : H / d * 0.5) * d;
    const bottom = Math.max(top + 40 * d, (S.band ? S.band.bottom : H / d * 0.86) * d);
    const fresh = gKey.tide !== tide || gKey.W !== W || gKey.side !== side || gKey.land !== land || gKey.noise !== c.noise || gKey.signal !== c.signal;
    if (fresh) {
      gKey.tide = tide; gKey.W = W; gKey.side = side; gKey.land = land; gKey.noise = c.noise; gKey.signal = c.signal;
    }
    for (let r = 0; r < rows; r++) {
      const f = r / (rows - 1);
      const yBase = lerp(top, bottom, 0.12 + 0.7 * f);
      const amp = (bottom - top) * (0.03 + 0.12 * f);
      if (fresh || !grads[r]) {
        const alpha = 0.1 + 0.62 * f * f;
        const g = ctx.createLinearGradient(0, 0, W, 0);
        for (let s = 0; s <= 8; s++) {
          const e = tuneSettle(tide, s / 8, f, side, land);
          g.addColorStop(s / 8, rgba(e > 0.55 ? c.signal : c.noise, alpha * lerp(0.7, 1, e)));
        }
        grads[r] = g;
      }
      ctx.strokeStyle = grads[r];
      ctx.lineWidth = (0.6 + 1.4 * f) * d;
      ctx.beginPath();
      for (let x = -step; x <= W + step; x += step) {
        const e = tuneSettle(tide, x / W, f, side, land);
        const noise = (hashF(r * 7919 + Math.round(x / step) * 131 + tick * 104729) - 0.5) * (bottom - top) * 0.3 * (0.4 + 0.6 * f);
        const sine = amp * Math.sin((x / W) * 9.5 * (1.4 - 0.5 * f) - t * 0.75 + r * 0.16 + 0.6);
        const y = yBase + noise * (1 - e) + sine * e;
        if (x === -step) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }

  function stream(S, W, H, d) {
    const c = S.colors, p = S.progress, t = S.time;
    const path = streamPathFor(S);
    const tanY = Math.max(Math.tan(20 * DEG), 0.3 / S.aspect);
    const scale = clamp((tanY * S.aspect) / 0.58, 0.6, 1);
    const R = lerp(STREAM_R0, 0.72, p) * scale;
    const lines = 14;
    for (let i = 0; i < lines; i++) {
      const o = (i / (lines - 1)) * 2 - 1;
      const core = 1 - Math.abs(o);
      const sel = 1 - smoothstep(lerp(0.3, 0.9, p), lerp(0.42, 1, p), Math.abs(o));
      ctx.strokeStyle = rgba(sel > 0.5 ? c.signal : c.noise, 0.15 + 0.55 * core);
      ctx.lineWidth = (0.8 + 1.2 * core) * d;
      ctx.beginPath();
      for (let s = 0; s <= 60; s++) {
        const q = s / 60;
        pathAt(path, q, W, H, P0);
        pathAt(path, Math.min(q + 0.01, 1), W, H, P1);
        let nx = -(P1[1] - P0[1]), ny = P1[0] - P0[0];
        const l = Math.sqrt(nx * nx + ny * ny) || 1;
        nx /= l; ny /= l;
        const half = (R / (Math.max(P0[2], 1) * tanY)) * (H / 2);
        const off = o * half + Math.sin(q * 23 + t * 1.6 + i * 0.6) * half * 0.22 * (1 - p);
        const x = P0[0] + nx * off, y = P0[1] + ny * off;
        if (s === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    const tick = Math.floor(t * 20);
    ctx.fillStyle = rgba(c.noise, 0.35);
    for (let k = 0; k < 140; k++) {
      const x = hashF(k * 17 + 3) * W, y = hashF(k * 29 + 7) * H;
      const j = (hashF(k * 31 + tick * 977) - 0.5) * 3 * d;
      ctx.fillRect(x + j, y - j, 1.5 * d, 1.5 * d);
    }
  }

  function calm(S, W, H, d) {
    const c = S.colors, t = S.time;
    const amp = H * 0.08 * (0.8 + 0.2 * Math.sin(t * 0.42));
    const yc = H * 0.54;
    const k = (2 * Math.PI * 1.25) / W;
    const xStep = 4 * Math.max(1, d); // sampled in css px, so the work does not grow with the DPR
    for (let sIdx = 0; sIdx < 5; sIdx++) {
      const o = (sIdx - 2) * 3 * d;
      ctx.strokeStyle = rgba(c.signal, sIdx === 2 ? 0.9 : 0.4);
      ctx.lineWidth = (sIdx === 2 ? 1.6 : 0.8) * d;
      ctx.beginPath();
      for (let x = 0; x <= W + xStep; x += xStep) {
        const y = yc + o + amp * Math.sin(k * x - t * 0.55);
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    // Rings stay concentric around the node where it is now.
    const ex = W * 0.62, ey = yc + amp * Math.sin(k * ex - t * 0.55);
    for (let i = 0; i < 3; i++) {
      const age = (((S.flowA + i / 3) % 1) + 1) % 1;
      const R = (1 - (1 - age) * (1 - age)) * Math.min(W, H) * 0.42;
      ctx.strokeStyle = rgba(c.signal, Math.min(Math.pow(1 - age, 1.6) * 0.7, smoothstep(0, 0.12, age)));
      ctx.lineWidth = 1.2 * d;
      ctx.beginPath();
      ctx.ellipse(ex, ey, R * 0.85, R, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = rgba(c.signal, 0.95);
    ctx.beginPath();
    ctx.arc(ex, ey, 2.5 * d, 0, Math.PI * 2);
    ctx.fill();
  }

  function noise(S, W, H, d) {
    const c = S.colors, t = S.time;
    const tick = Math.floor(t * 30);
    const portrait = W < H;
    const wx = portrait ? 0.5 + 0.06 * Math.sin(t * 0.13) : 0.65 + 0.11 * Math.sin(t * 0.13);
    const wy = 0.58 - 0.07 * Math.sin(t * 0.21 + 1);
    const sx = lerp(wx, S.px * 0.5 + 0.5, S.pres) * W;
    const sy = lerp(wy, 0.5 - S.py * 0.5, S.pres) * H;
    const R = 0.24 * Math.min(H, W * 0.8);
    const rows = 34;
    const dd1 = Math.max(1, d);
    const xStep = 6 * dd1; // sampled in css px, so the work does not grow with the DPR
    const kw = 0.05 / dd1; // the wave keeps its css wavelength
    ctx.lineWidth = d;
    ctx.strokeStyle = rgba(c.noise, 0.22);
    ctx.beginPath();
    for (let r = 0; r < rows; r++) {
      const yBase = ((r + 0.5) / rows) * H;
      const ry = (yBase - sy) / R;
      for (let i = 0, x = 0; x <= W + xStep; i++, x += xStep) {
        const rx = (x - sx) / R;
        const dd = Math.sqrt(rx * rx + ry * ry);
        const calmK = dd >= 1 ? 0 : 1 - smoothstep(0.3, 1, dd);
        const jit = (hashF(r * 7919 + i * 13 + tick * 104729) - 0.5) * (H / rows) * 1.6;
        let y = yBase + jit;
        if (calmK > 0) y += (sy + Math.sin((x - sx) * kw - t * 2.4) * H * 0.03 - y) * calmK;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
    }
    ctx.stroke(); // all static rows share one style: one path, one stroke
    ctx.strokeStyle = rgba(c.signal, 0.9);
    ctx.lineWidth = 1.5 * d;
    ctx.beginPath();
    const sStep = 3 * dd1;
    for (let x = sx - R; x <= sx + R; x += sStep) {
      const y = sy + Math.sin((x - sx) * kw - t * 2.4) * H * 0.03;
      if (x === sx - R) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  const DRAW = { tune, stream, calm, noise };
  return {
    supported: false,
    count: 0,
    error: '',
    pending: false,
    setScene(m) { mode = m; return true; },
    resize(bw, bh) {
      if (canvas.width !== bw) canvas.width = bw;
      if (canvas.height !== bh) canvas.height = bh;
    },
    draw(S) {
      const W = canvas.width, H = canvas.height;
      if (!W || !H) return false;
      ctx.fillStyle = rgba(S.colors.bg, 1);
      ctx.fillRect(0, 0, W, H);
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      DRAW[mode](S, W, H, S.dpr);
      return true;
    },
    destroy() { canvas.width = 1; canvas.height = 1; },
  };
}

/* ------------------------------------------------------------------------------------------
   The field
------------------------------------------------------------------------------------------ */

// An Element, an array of them or a NodeList.
function asElements(v) {
  if (!v) return [];
  const list = typeof v.getBoundingClientRect === 'function' ? [v] : typeof v.length === 'number' ? Array.from(v) : [];
  return list.filter((el) => el && typeof el.getBoundingClientRect === 'function');
}

export function createSignalField(container, options = {}) {
  if (!container || typeof container.appendChild !== 'function') {
    throw new TypeError('createSignalField: a container element is required');
  }
  const opts = Object.assign({ mode: 'tune', progress: 0, interactive: true, density: 'auto' }, options);
  const protectEls = asElements(opts.protect).slice(0, MAX_PROTECT);
  const safeEls = typeof opts.safeTop === 'number' ? [] : asElements(opts.safeTop);
  const userStrength = typeof opts.protectStrength === 'number' && Number.isFinite(opts.protectStrength) ? clamp(opts.protectStrength, 0, 1) : null;
  const userPath = opts.path == null ? null : validPath(opts.path);
  if (opts.path != null && !userPath) warnOnce('path', 'options.path needs 7 points [ndcX, ndcY, depth > 0.5]; using the default channel');

  const S = {
    mode: MODES.includes(opts.mode) ? opts.mode : 'tune',
    densityPref: opts.density || 'auto',
    density: 'high',
    layout: 0,
    progress: clamp(Number(opts.progress) || 0, 0, 1),
    target: 0.5,
    vel: 0.5,
    time: 0.5,
    frozen: !!opts.frozen,
    flowA: 0.5, flowB: 0.5, flowSpeedA: 0.5, flowSpeedB: 0.5,
    px: 0.5, py: 0.5, pres: 0.5, dt: 0.5, now: 0.5,
    aspect: 1, dpr: 1, cssW: 0, cssH: 0,
    colors: readColors(container),
    prot: new Float32Array(16), protN: 0, protRadius: PROTECT_RADIUS, protStrength: 0,
    safeTop: typeof opts.safeTop === 'number' && Number.isFinite(opts.safeTop) ? opts.safeTop : -1,
    tuneSide: opts.tuneFrom === 'left' ? 0 : 1,
    count: 0,
    path: userPath,
    band: null,
  };
  // The numeric fields above start as fractions so they are stored as doubles from the start
  // (the frame loop then updates them in place); these are their real starting values.
  S.px = 0; S.py = 0; S.pres = 0; S.dt = 0; S.now = 0; S.vel = 0;
  S.target = S.progress;
  S.protStrength = userStrength !== null ? userStrength : PROTECT_STRENGTH[S.mode];
  const hasTime = typeof opts.time === 'number' && Number.isFinite(opts.time);
  let timeSet = hasTime;

  const mql = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  let reduced = !!(mql && mql.matches);

  // The canvas fills the container, so it needs a positioned container. Undone on destroy().
  // A detached container has no computed position yet: it is checked again once it is in the
  // document with a size (see resize).
  const prevPosition = container.style.position;
  let positioned = false;
  let positionChecked = false;
  function ensurePositioned() {
    if (positionChecked || !container.isConnected) return;
    positionChecked = true;
    if (getComputedStyle(container).position === 'static') {
      container.style.position = 'relative';
      positioned = true;
    }
  }
  ensurePositioned();

  let canvas = null;
  let R = null;
  let raf = 0, frameRaf = 0, last = 0, lastDraw = 0;
  let userPaused = false, inView = true, hidden = document.hidden, lost = false, destroyed = false;
  let fps = 0, fpsFrames = 0, fpsStart = 0;
  let ro = null, io = null, dprMql = null;
  let lossTimer = 0, rectTimer = 0, copyTimer = 0;
  let lastError = '';
  const ptr = { cx: 0, cy: 0, seen: false, out: true, touch: false, lastMove: 0, tx: 0, ty: 0, inside: false };
  const BF = makeTuneFrame(); // scratch for the band
  const BM = new Float64Array(16);
  let range = null; // reused to measure the copy

  function makeCanvas() {
    const c = document.createElement('canvas');
    c.setAttribute('aria-hidden', 'true');
    c.setAttribute('role', 'presentation');
    c.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none;';
    container.appendChild(c);
    return c;
  }

  // Tells the page that the 2D renderer took over. Async, so a listener added right after
  // createSignalField() still hears about a fallback that happened during creation.
  function announceFallback(reason) {
    setTimeout(() => {
      if (destroyed) return;
      try {
        container.dispatchEvent(new CustomEvent('signalfield:fallback', { detail: { reason, error: lastError } }));
      } catch (e) { /* CustomEvent unsupported: field.supported still says it */ }
    }, 0);
  }

  const glHooks = {
    onLost() {
      lost = true;
      updateLoop();
      armLossTimer();
    },
    onRestored() {
      lost = false;
      clearTimeout(lossTimer);
      lossTimer = 0;
      resize(true); // redraws (retrying while the program compiles) and restarts the loop
    },
    onFail(msg) {
      lastError = String(msg || 'shader program failed');
      warnOnce('shader:' + lastError, 'WebGL2 shader program failed, using the 2D fallback. ' + lastError);
      setTimeout(() => swapTo2D('shader'), 0);
    },
  };

  canvas = makeCanvas();
  if (!opts.forceFallback) R = createGLRenderer(canvas, glHooks);
  if (!R) {
    canvas.remove();
    canvas = makeCanvas();
    R = create2DRenderer(canvas);
    if (R) announceFallback(opts.forceFallback ? 'forced' : 'no-webgl2');
  }

  // A context that does not come back (the browser evicted it, or the GPU process is gone)
  // must not leave an empty hero: after a while, switch to the 2D renderer.
  function armLossTimer() {
    clearTimeout(lossTimer);
    lossTimer = setTimeout(function check() {
      lossTimer = 0;
      if (destroyed || !lost) return;
      if (document.hidden) {
        lossTimer = setTimeout(check, LOSS_TIMEOUT);
        return;
      }
      lastError = 'WebGL context lost and not restored';
      swapTo2D('context-lost');
    }, LOSS_TIMEOUT);
  }

  function swapTo2D(reason) {
    if (destroyed || (R && !R.supported)) return;
    if (R) R.destroy();
    if (canvas) canvas.remove();
    canvas = makeCanvas();
    R = create2DRenderer(canvas);
    lost = false;
    clearTimeout(lossTimer);
    lossTimer = 0;
    if (R) {
      R.setScene(S.mode, 0, 0);
      announceFallback(reason || 'shader');
    }
    resize(true);
  }

  function syncFlowFromTime() {
    flowSpeeds(S);
    S.flowA = (S.time * S.flowSpeedA) % 1;
    S.flowB = S.time * S.flowSpeedB;
  }

  function setTimeInternal(t) {
    S.time = ((Number(t) || 0) % TIME_WRAP + TIME_WRAP) % TIME_WRAP;
    syncFlowFromTime();
  }
  setTimeInternal(hasTime ? opts.time : (reduced ? STILL_TIME[S.mode] : 0));

  // The container's css size (the last known one while it has none).
  const SZ = new Float64Array(2);
  function containerSize() {
    const w = container.clientWidth, h = container.clientHeight;
    if (w > 0 && h > 0) { SZ[0] = w; SZ[1] = h; } else if (S.cssW > 0 && S.cssH > 0) { SZ[0] = S.cssW; SZ[1] = S.cssH; } else { SZ[0] = 1280; SZ[1] = 800; }
    return SZ;
  }

  function applyScene() {
    S.density = resolveDensity(S.densityPref);
    const sz = containerSize();
    const n = particleCount(S.mode, S.density, sz[0], sz[1]);
    S.count = n;
    S.layout = S.mode === 'tune' ? tuneRows(n, sz[0] / sz[1], sz[1]) : 0;
    if (!R) return;
    if (!R.setScene(S.mode, n, S.layout)) swapTo2D('shader'); // shader problem: 2D on a fresh canvas
  }
  applyScene();

  // The tune grid is laid out for a size (rows) and an area (particles); rebuild it when the
  // screen turns or grows a lot. A rebuild is a short loop and one buffer upload.
  function layoutDrift() {
    if (S.mode !== 'tune' || !S.layout || !R || !R.supported) return false;
    const sz = containerSize();
    if (Math.abs(particleCount('tune', S.density, sz[0], sz[1]) - S.count) / S.count > 0.1) return true;
    const want = tuneRows(S.count, sz[0] / sz[1], sz[1]);
    return Math.abs(want - S.layout) / S.layout > 0.12;
  }

  /* ---------- copy rects, safe line and band ---------- */

  // The box of what an element shows: its text and child boxes, not its full block width (a button
  // row or a heading in a wide column would otherwise darken the whole width).
  function contentRect(el) {
    try {
      if (!range) range = document.createRange();
      range.selectNodeContents(el);
      const r = range.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return r;
    } catch (e) { /* fall back to the element box */ }
    return el.getBoundingClientRect();
  }

  // Positions of the protected copy and the safe line, relative to the container. Runs on resize,
  // after fonts load and after entrance animations; never in the frame loop.
  function measureCopy() {
    if (destroyed || (!protectEls.length && !safeEls.length)) return false;
    const cr = container.getBoundingClientRect();
    let changed = false;
    let n = 0, rad = PROTECT_RADIUS;
    for (let i = 0; i < protectEls.length && n < MAX_PROTECT; i++) {
      const el = protectEls[i];
      if (!el.isConnected) continue;
      const r = contentRect(el);
      if (r.width <= 0 || r.height <= 0) continue;
      const x0 = r.left - cr.left - PROTECT_PAD, y0 = r.top - cr.top - PROTECT_PAD;
      const x1 = r.right - cr.left + PROTECT_PAD, y1 = r.bottom - cr.top + PROTECT_PAD;
      rad = Math.min(rad, (x1 - x0) / 2, (y1 - y0) / 2);
      const o = n * 4;
      if (Math.abs(S.prot[o] - x0) > 0.5 || Math.abs(S.prot[o + 1] - y0) > 0.5 || Math.abs(S.prot[o + 2] - x1) > 0.5 || Math.abs(S.prot[o + 3] - y1) > 0.5) changed = true;
      S.prot[o] = x0; S.prot[o + 1] = y0; S.prot[o + 2] = x1; S.prot[o + 3] = y1;
      n++;
    }
    if (n !== S.protN) changed = true;
    S.protN = n;
    S.protRadius = rad;
    if (safeEls.length) {
      let bottom = -1;
      for (const el of safeEls) {
        if (!el.isConnected) continue;
        const r = contentRect(el);
        if (r.height > 0) bottom = Math.max(bottom, r.bottom - cr.top);
      }
      const st = bottom >= 0 ? Math.round(bottom + SAFE_GAP) : -1;
      if (st !== S.safeTop) changed = true;
      S.safeTop = st;
    }
    return changed;
  }

  // Where the wave sits on screen (css px from the container top), for labels on the page.
  function updateBand() {
    if (S.mode !== 'tune' || S.cssW <= 0 || S.cssH <= 0) {
      S.band = null;
      return;
    }
    const a = S.aspect, H = S.cssH;
    const F = tuneFrame(BF, a, S.safeTop >= 0 ? S.safeTop / H : -1, H);
    setCam(F.dist, 0, F.pitch, F.tanY, a, F.shift);
    orbitEye(EYE0);
    viewProj(BM, EYE0);
    const toPx = (ndcY) => Math.round((0.5 - ndcY * 0.5) * H * 10) / 10;
    project(BM, 0, -F.amp, F.zFront, PRJ);
    const bottom = toPx(PRJ[1]);
    const zMid = (F.zBack + F.zFront) / 2;
    const halfW = ((F.dist - zMid * Math.cos(F.pitch)) * F.halfWK) / 1.22;
    project(BM, -0.9 * halfW, -0.3, zMid, PRJ);
    const left = toPx(PRJ[1]);
    project(BM, 0.9 * halfW, 0, zMid, PRJ);
    const right = toPx(PRJ[1]);
    const band = { top: Math.round(F.target * H * 10) / 10, bottom, left, right };
    const prev = S.band;
    S.band = band;
    if (!prev || Math.abs(prev.top - band.top) > 0.5 || Math.abs(prev.bottom - band.bottom) > 0.5 || Math.abs(prev.left - band.left) > 0.5) {
      try {
        container.dispatchEvent(new CustomEvent('signalfield:band', { detail: { top: band.top, bottom: band.bottom, left: band.left, right: band.right } }));
      } catch (e) { /* CustomEvent unsupported: the getter still works */ }
    }
  }

  function onCopyLayout() {
    if (destroyed) return;
    if (measureCopy()) {
      updateBand();
      // The loop picks the new rects up by itself; a paused or reduced field draws once.
      if (!raf) requestFrame();
    }
  }

  /* ---------- size ---------- */

  // Device pixels per css px for the backing store: the screen's ratio, capped (2; 1.5 at low
  // density, except a small tune canvas, whose threads stay crisp at 2 for little cost; 1 for the
  // 2D fallback, which often runs in software), and within a pixel budget for very large screens.
  function backingRatio(w, h) {
    const area = w * h;
    let cap = 1;
    if (R && R.supported) cap = S.density !== 'low' || (S.mode === 'tune' && area <= 520000) ? 2 : 1.5;
    let dpr = Math.min(window.devicePixelRatio || 1, cap);
    if (area > 0) dpr = Math.min(dpr, Math.sqrt((R && R.supported ? PIXEL_BUDGET : PIXEL_BUDGET_2D) / area));
    return Math.max(dpr, 0.5);
  }

  // Returns true when the size (or the pixel ratio) changed and was applied.
  function resize(force) {
    if (destroyed || !R) return false;
    const w = container.clientWidth, h = container.clientHeight;
    const wasEmpty = S.cssW <= 0 || S.cssH <= 0;
    if (w > 0 && h > 0) ensurePositioned();
    if (S.densityPref === 'auto' && resolveDensity('auto') !== S.density) applyScene();
    if (!R) return false;
    const dpr = backingRatio(w, h);
    if (!force && w === S.cssW && h === S.cssH && dpr === S.dpr) return false;
    S.cssW = w; S.cssH = h; S.dpr = dpr;
    S.aspect = w > 0 && h > 0 ? w / h : 1;
    if (w > 0 && h > 0) {
      // A container that was hidden or detached at creation may only now have its theme colors.
      if (wasEmpty) S.colors = readColors(container);
      if (layoutDrift()) applyScene();
    }
    R.resize(Math.max(1, Math.round(w * dpr)), Math.max(1, Math.round(h * dpr)));
    measureCopy();
    updateBand();
    // Draw right away so a resize never shows an empty buffer (retried while a program compiles,
    // so a paused field is never left blank).
    if (w > 0 && h > 0) drawNow();
    // A container that starts at zero size (display: none) starts its loop once it gets one.
    updateLoop();
    return true;
  }

  /* ---------- time, spring, pointer ---------- */

  // The frame loop passes dt and now through S (numbers as arguments would be boxed).
  function stepSpring() {
    const dt = S.dt;
    const x0 = S.progress - S.target;
    if (Math.abs(x0) < 1e-5 && Math.abs(S.vel) < 1e-5) {
      // At rest: settle exactly, and leave the fields alone once settled.
      if (x0 !== 0) S.progress = S.target;
      if (S.vel !== 0) S.vel = 0;
      return;
    }
    const e = Math.exp(-SPRING_OMEGA * dt);
    const tmp = (S.vel + SPRING_OMEGA * x0) * dt;
    const p = S.target + (x0 + tmp) * e;
    S.progress = p < 0 ? 0 : p > 1 ? 1 : p;
    S.vel = (S.vel - SPRING_OMEGA * tmp) * e;
  }

  // The pointer position relative to the container is read in a task after the frame is painted,
  // when layout is clean, so the frame loop never forces a style or layout pass.
  function scheduleRectRead() {
    if (rectTimer || destroyed) return;
    rectTimer = setTimeout(readPointerRect, 0);
  }
  function readPointerRect() {
    rectTimer = 0;
    if (destroyed) return;
    const r = container.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      const nx = ((ptr.cx - r.left) / r.width) * 2 - 1;
      const ny = 1 - ((ptr.cy - r.top) / r.height) * 2;
      ptr.inside = nx >= -1 && nx <= 1 && ny >= -1 && ny <= 1;
      ptr.tx = clamp(nx, -1, 1);
      ptr.ty = clamp(ny, -1, 1);
    }
  }

  function stepPointer() {
    const dt = S.dt;
    const active = opts.interactive && ptr.seen && ptr.inside && !ptr.out && (!ptr.touch || S.now - ptr.lastMove < 2500);
    // Eased toward the target; snaps once close, so an idle pointer stops rebuilding the camera.
    const k = 1 - Math.exp(-dt * 5);
    S.px = Math.abs(ptr.tx - S.px) < 1e-4 ? ptr.tx : S.px + (ptr.tx - S.px) * k;
    S.py = Math.abs(ptr.ty - S.py) < 1e-4 ? ptr.ty : S.py + (ptr.ty - S.py) * k;
    const goal = active ? 1 : 0;
    S.pres = Math.abs(goal - S.pres) < 1e-4 ? goal : S.pres + (goal - S.pres) * (1 - Math.exp(-dt * 2.5));
  }

  function advance() {
    stepSpring();
    flowSpeeds(S);
    if (!S.frozen) {
      const dt = S.dt;
      S.time = (S.time + dt) % TIME_WRAP;
      S.flowA = (S.flowA + S.flowSpeedA * dt) % 1;
      S.flowB = (S.flowB + S.flowSpeedB * dt) % 1000;
    }
    stepPointer();
  }

  /* ---------- loop ---------- */

  function shouldRun() {
    return !destroyed && !reduced && !userPaused && inView && !hidden && !lost && !!R && S.cssW > 0 && S.cssH > 0;
  }

  function frame(now) {
    raf = 0;
    if (!shouldRun()) return;
    raf = requestAnimationFrame(frame);
    const dt = last ? (now - last) / 1000 : 1 / 60;
    last = now;
    S.dt = dt < 0 ? 0 : dt > 0.1 ? 0.1 : dt;
    S.now = now;
    advance();
    // Time keeps running every frame; drawing is capped (every vsync up to about 100 Hz, every
    // other one above; 30fps 2D), so a 120 Hz screen does not double the work for a background.
    if (lastDraw && now - lastDraw < (R.supported ? MIN_FRAME_MS : MIN_FRAME_MS_2D)) return;
    lastDraw = now;
    if (!R.draw(S)) return;
    fpsFrames++;
    if (!fpsStart) fpsStart = now;
    if (now - fpsStart >= 500) {
      fps = (fpsFrames * 1000) / (now - fpsStart);
      fpsFrames = 0;
      fpsStart = now;
    }
  }

  function updateLoop() {
    if (shouldRun()) {
      if (!raf) {
        last = 0; lastDraw = 0; fpsStart = 0; fpsFrames = 0;
        raf = requestAnimationFrame(frame);
      }
    } else {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      fps = 0;
    }
  }

  // One draw outside the loop: after a resize or a context restore, a change while paused, and the
  // reduced-motion still (the finished state at a calm moment). While the program still compiles
  // in the background the draw lands nothing, so it retries on the next frames until one frame
  // is drawn, paused or not.
  function drawNow() {
    if (!R || lost || destroyed || S.cssW <= 0 || S.cssH <= 0) return;
    S.dt = 0;
    if (reduced) {
      S.progress = S.target;
      S.vel = 0;
      S.pres = 0;
      if (!timeSet && !S.frozen) setTimeInternal(STILL_TIME[S.mode]);
      else syncFlowFromTime();
    }
    if (!R.draw(S) && R.pending) requestFrame();
  }

  function requestFrame() {
    if (frameRaf || destroyed) return;
    frameRaf = requestAnimationFrame(() => {
      frameRaf = 0;
      if (!raf) drawNow(); // a running loop draws anyway
    });
  }

  /* ---------- listeners ---------- */

  function onPointerMove(e) {
    ptr.cx = e.clientX;
    ptr.cy = e.clientY;
    ptr.seen = true;
    ptr.out = false;
    ptr.touch = e.pointerType === 'touch';
    ptr.lastMove = performance.now();
    scheduleRectRead();
  }
  function onPointerOut(e) {
    if (!e.relatedTarget) ptr.out = true;
  }
  function onScroll() {
    if (ptr.seen) scheduleRectRead();
  }
  function onVisibility() {
    hidden = document.hidden;
    updateLoop();
  }
  function onMotionPref() {
    reduced = !!(mql && mql.matches);
    updateLoop();
    if (reduced) requestFrame();
  }
  // A size change re-measures the copy and moves the band itself; otherwise the copy alone may
  // have moved. Either way the band is computed once, with the current size.
  function onLayoutChange() {
    if (!resize(false)) onCopyLayout();
  }
  // A devicePixelRatio change alone (a window dragged to another screen) fires no resize.
  function watchDpr() {
    if (dprMql) {
      if (dprMql.removeEventListener) dprMql.removeEventListener('change', onDprChange);
      else if (dprMql.removeListener) dprMql.removeListener(onDprChange);
    }
    dprMql = null;
    if (destroyed || !window.matchMedia) return;
    try { dprMql = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`); } catch (e) { dprMql = null; }
    if (!dprMql) return;
    if (dprMql.addEventListener) dprMql.addEventListener('change', onDprChange);
    else if (dprMql.addListener) dprMql.addListener(onDprChange);
  }
  function onDprChange() {
    watchDpr();
    resize(false);
  }

  if (opts.interactive) {
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerdown', onPointerMove, { passive: true });
    window.addEventListener('pointerout', onPointerOut, { passive: true });
    window.addEventListener('scroll', onScroll, { passive: true });
  }
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('resize', onLayoutChange, { passive: true });
  if (mql) {
    if (mql.addEventListener) mql.addEventListener('change', onMotionPref);
    else if (mql.addListener) mql.addListener(onMotionPref);
  }
  watchDpr();
  if (typeof ResizeObserver === 'function') {
    ro = new ResizeObserver(onLayoutChange);
    ro.observe(container);
    for (const el of protectEls) ro.observe(el);
    for (const el of safeEls) if (!protectEls.includes(el)) ro.observe(el);
  }
  if (typeof IntersectionObserver === 'function') {
    io = new IntersectionObserver((entries) => {
      const en = entries[entries.length - 1];
      inView = !!en && en.isIntersecting;
      updateLoop();
    }, { rootMargin: '64px' });
    io.observe(container);
  }
  if (protectEls.length || safeEls.length) {
    // Web fonts and entrance animations move the copy after creation.
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(onCopyLayout, () => {});
    copyTimer = setTimeout(onCopyLayout, 1300);
  }

  resize(true); // draws the first frame (or the reduced-motion still) and starts the loop

  /* ---------- public API ---------- */

  // A change while no loop runs (paused, offscreen or reduced motion) is drawn once.
  function redrawIdle() {
    if (!raf && (reduced || (inView && !hidden))) requestFrame();
  }

  const api = {
    get supported() { return !!(R && R.supported); },
    get band() {
      const b = S.band;
      return b ? { top: b.top, bottom: b.bottom, left: b.left, right: b.right } : null;
    },
    setProgress(p, immediate) {
      if (destroyed) return;
      S.target = clamp(Number(p) || 0, 0, 1);
      if (immediate) { S.progress = S.target; S.vel = 0; }
      if (reduced || immediate) redrawIdle();
    },
    pause() {
      userPaused = true;
      updateLoop();
    },
    resume() {
      userPaused = false;
      updateLoop();
    },
    refreshColors() {
      if (destroyed) return;
      S.colors = readColors(container);
      redrawIdle();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      if (frameRaf) cancelAnimationFrame(frameRaf);
      raf = 0; frameRaf = 0;
      clearTimeout(lossTimer);
      clearTimeout(rectTimer);
      clearTimeout(copyTimer);
      lossTimer = 0; rectTimer = 0; copyTimer = 0;
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerdown', onPointerMove);
      window.removeEventListener('pointerout', onPointerOut);
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('resize', onLayoutChange);
      if (mql) {
        if (mql.removeEventListener) mql.removeEventListener('change', onMotionPref);
        else if (mql.removeListener) mql.removeListener(onMotionPref);
      }
      watchDpr(); // destroyed: only removes the listener
      if (ro) ro.disconnect();
      if (io) io.disconnect();
      ro = null; io = null;
      if (R) R.destroy();
      R = null;
      if (canvas) canvas.remove();
      canvas = null;
      if (positioned) container.style.position = prevPosition;
    },

    /* Lab and tooling extras. */
    setMode(mode) {
      if (destroyed || !MODES.includes(mode) || mode === S.mode) return;
      S.mode = mode;
      if (userStrength === null) S.protStrength = PROTECT_STRENGTH[mode];
      syncFlowFromTime();
      applyScene();
      updateBand();
      redrawIdle();
    },
    setDensity(density) {
      if (destroyed) return;
      S.densityPref = density || 'auto';
      applyScene();
      resize(true);
    },
    setTime(t) {
      if (destroyed) return;
      timeSet = true;
      setTimeInternal(t);
      redrawIdle();
    },
    setFrozen(f) {
      S.frozen = !!f;
    },
    get progress() { return S.progress; },
    get mode() { return S.mode; },
    get density() { return S.density; },
    get particleCount() { return R ? R.count : 0; },
    get fps() { return fps; },
    get time() { return S.time; },
    get error() { return lastError || (R ? R.error : ''); },
    get canvas() { return canvas; },
  };
  return api;
}

export default createSignalField;
