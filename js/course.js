// Course geometry: closed spline centerline, elevation, surfaces and obstacles.
// No rendering here so it can be unit tested in Node.
import { SURFACES, OBSTACLE_INFO } from './config.js';

const mod = (a, n) => ((a % n) + n) % n;
const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// Centripetal Catmull-Rom through closed control points.
function catmullRomClosed(pts, steps = 160) {
  const out = [];
  const n = pts.length;
  const dist = (a, b) => Math.max(1e-4, Math.hypot(b[0] - a[0], b[1] - a[1]) ** 0.5);
  for (let i = 0; i < n; i++) {
    const P0 = pts[mod(i - 1, n)], P1 = pts[i], P2 = pts[mod(i + 1, n)], P3 = pts[mod(i + 2, n)];
    const t0 = 0, t1 = t0 + dist(P0, P1), t2 = t1 + dist(P1, P2), t3 = t2 + dist(P2, P3);
    for (let j = 0; j < steps; j++) {
      const t = t1 + (t2 - t1) * (j / steps);
      const lerp = (A, B, ta, tb) => [
        ((tb - t) * A[0] + (t - ta) * B[0]) / (tb - ta),
        ((tb - t) * A[1] + (t - ta) * B[1]) / (tb - ta),
      ];
      const A1 = lerp(P0, P1, t0, t1), A2 = lerp(P1, P2, t1, t2), A3 = lerp(P2, P3, t2, t3);
      const B1 = lerp(A1, A2, t0, t2), B2 = lerp(A2, A3, t1, t3);
      out.push(lerp(B1, B2, t1, t2));
    }
  }
  return out;
}

function smoothClosed(arr, radius) {
  const n = arr.length, out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let j = -radius; j <= radius; j++) sum += arr[mod(i + j, n)];
    out[i] = sum / (2 * radius + 1);
  }
  return out;
}

export class Course {
  constructor(level) {
    this.level = level;
    this.halfWidth = level.halfWidth;

    // 1. Dense spline, then resample at ~1m.
    const dense = catmullRomClosed(level.points);
    const cum = [0];
    for (let i = 1; i <= dense.length; i++) {
      const a = dense[i - 1], b = dense[i % dense.length];
      cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
    }
    const total = cum[cum.length - 1];
    const N = Math.round(total);
    this.N = N;
    this.ds = total / N;
    this.length = total;
    const px = new Float64Array(N), pz = new Float64Array(N);
    let k = 0;
    for (let i = 0; i < N; i++) {
      const target = i * this.ds;
      while (cum[k + 1] < target) k++;
      const f = (target - cum[k]) / (cum[k + 1] - cum[k]);
      const a = dense[k], b = dense[(k + 1) % dense.length];
      px[i] = a[0] + (b[0] - a[0]) * f;
      pz[i] = a[1] + (b[1] - a[1]) * f;
    }
    this.px = px; this.pz = pz;

    // 2. Tangent, right-hand normal (screen-right when looking along tangent), curvature.
    const tx = new Float64Array(N), tz = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const dx = px[mod(i + 1, N)] - px[mod(i - 1, N)], dz = pz[mod(i + 1, N)] - pz[mod(i - 1, N)];
      const l = Math.hypot(dx, dz);
      tx[i] = dx / l; tz[i] = dz / l;
    }
    this.tx = tx; this.tz = tz;
    this.nx = tx.map((_, i) => -tz[i]);
    this.nz = tx.map((_, i) => tx[i]);
    const kr = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const dtx = tx[mod(i + 1, N)] - tx[mod(i - 1, N)], dtz = tz[mod(i + 1, N)] - tz[mod(i - 1, N)];
      kr[i] = (dtx * this.nx[i] + dtz * this.nz[i]) / (2 * this.ds);
    }
    this.k = smoothClosed(kr, 3);

    // 3. Surfaces.
    this.surface = new Array(N).fill('grass');
    for (const sec of level.sections) {
      for (let i = Math.floor(sec.from * N); i < Math.min(N, Math.ceil(sec.to * N)); i++) this.surface[i] = sec.surface;
    }

    // 4. Obstacles.
    this.obstacles = level.obstacles.map((o) => {
      const info = OBSTACLE_INFO[o.type];
      const s0 = o.at * total;
      return { type: o.type, s0, s1: s0 + info.length, ...info };
    });
    for (const ob of this.obstacles) {
      for (let s = ob.s0 - 2; s < ob.s1 + 2; s++) this.surface[mod(Math.floor(s / this.ds), N)] = 'grass';
    }

    // 5. Elevation: terrain under the centerline, smoothed, plus stair ramps.
    const raw = new Float64Array(N);
    for (let i = 0; i < N; i++) raw[i] = this.hillHeight(px[i], pz[i]);
    const h = smoothClosed(smoothClosed(raw, 8), 8);
    for (const ob of this.obstacles) {
      if (ob.type !== 'stairs') continue;
      const down = 45;
      for (let s = ob.s0; s < ob.s1 + down; s += this.ds) {
        const i = mod(Math.round(s / this.ds), N);
        h[i] += s < ob.s1 ? ob.rise * (s - ob.s0) / ob.length : ob.rise * (1 - smoothstep(ob.s1, ob.s1 + down, s));
      }
    }
    this.h = h;
    this.grade = new Float64Array(N);
    for (let i = 0; i < N; i++) this.grade[i] = (h[mod(i + 1, N)] - h[mod(i - 1, N)]) / (2 * this.ds);

    // 6. Camber (sideways slope), eased in and out so the track twists smoothly.
    const camber = new Float64Array(N);
    for (const cb of level.cambers || []) {
      const a = cb.from * N, b = cb.to * N, ease = 10;
      for (let i = Math.floor(a); i < Math.ceil(b); i++) {
        camber[mod(i, N)] += cb.slope * Math.min(1, (i - a) / ease, (b - i) / ease);
      }
    }
    this.camber = camber;

    this.crowdS = (level.crowds || []).map((f) => f * total);
    this._buildGrid();
  }

  hillHeight(x, z) {
    let y = 1.3 * Math.sin(x * 0.045 + 1.0) * Math.cos(z * 0.038) + 0.6 * Math.sin(x * 0.11 + z * 0.07);
    for (const hl of this.level.hills) {
      const d2 = (x - hl.x) ** 2 + (z - hl.z) ** 2;
      y += hl.h * Math.exp(-d2 / (2 * hl.r * hl.r));
    }
    return y;
  }

  _buildGrid() {
    this.cell = 8;
    this.grid = new Map();
    for (let i = 0; i < this.N; i++) {
      const key = Math.floor(this.px[i] / this.cell) + ',' + Math.floor(this.pz[i] / this.cell);
      if (!this.grid.has(key)) this.grid.set(key, []);
      this.grid.get(key).push(i);
    }
  }

  // Nearest centerline sample to (x, z) within ~16m, or null.
  nearest(x, z) {
    const cx = Math.floor(x / this.cell), cz = Math.floor(z / this.cell);
    let best = -1, bd = Infinity;
    for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) {
      const list = this.grid.get((cx + a) + ',' + (cz + b));
      if (!list) continue;
      for (const i of list) {
        const d = (this.px[i] - x) ** 2 + (this.pz[i] - z) ** 2;
        if (d < bd) { bd = d; best = i; }
      }
    }
    return best < 0 ? null : { i: best, d: Math.sqrt(bd) };
  }

  terrainHeight(x, z) {
    const raw = this.hillHeight(x, z);
    const n = this.nearest(x, z);
    if (!n) return raw;
    const w = smoothstep(this.halfWidth + 1.2, this.halfWidth + 14, n.d);
    const lat = (x - this.px[n.i]) * this.nx[n.i] + (z - this.pz[n.i]) * this.nz[n.i];
    const edge = this.halfWidth + 1.2;
    const ht = this.h[n.i] + this.camber[n.i] * Math.max(-edge, Math.min(edge, lat));
    return (ht - 0.06) * (1 - w) + raw * w;
  }

  wrap(s) { return mod(s, this.length); }

  // Interpolated sample at lap distance s.
  sample(s) {
    s = this.wrap(s);
    const f = s / this.ds, i = Math.floor(f) % this.N, j = (i + 1) % this.N, t = f - Math.floor(f);
    const L = (arr) => arr[i] + (arr[j] - arr[i]) * t;
    return {
      x: L(this.px), z: L(this.pz), h: L(this.h),
      tx: L(this.tx), tz: L(this.tz), nx: L(this.nx), nz: L(this.nz),
      k: L(this.k), grade: L(this.grade), camber: L(this.camber), surface: this.surface[i], i,
    };
  }

  // Height of the riding surface at lap distance s and lateral offset x.
  // On stairs this is the top of the current step, not the smooth ramp underneath.
  groundHeight(s, x = 0) {
    const sm = this.sample(s);
    let h = sm.h + sm.camber * x;
    const ob = this.obstacleAt(s);
    if (ob && ob.type === 'stairs') {
      const steps = Math.round(ob.length);
      const k = Math.min(steps - 1, Math.floor((this.wrap(s) - ob.s0) / (ob.length / steps)));
      h = this.sample(ob.s0).h + (k + 1) * (ob.rise / steps);
    }
    return h;
  }

  surfaceAt(s) { return this.surface[Math.floor(this.wrap(s) / this.ds) % this.N]; }
  curvatureAt(s) { return this.k[Math.floor(this.wrap(s) / this.ds) % this.N]; }

  obstacleAt(s) {
    s = this.wrap(s);
    for (const ob of this.obstacles) if (s >= ob.s0 && s <= ob.s1) return ob;
    return null;
  }

  // Next obstacle ahead of s (distance to its start), within range.
  nextObstacle(s, range) {
    s = this.wrap(s);
    let best = null;
    for (const ob of this.obstacles) {
      const dist = mod(ob.s0 - s, this.length);
      if (dist <= range && (!best || dist < best.dist)) best = { ob, dist };
    }
    return best;
  }

  // Upcoming thing worth warning the player about.
  nextFeature(s, range = 70) {
    const ob = this.nextObstacle(s, range);
    let surf = null, turn = null;
    const here = this.surfaceAt(s);
    for (let d = 2; d < range; d += 2) {
      const sf = this.surfaceAt(s + d);
      if (!surf && sf !== here && SURFACES[sf].wobble > 0) surf = { surface: sf, dist: d };
      const kk = this.curvatureAt(s + d);
      if (!turn && d < 45 && Math.abs(kk) > 0.06) turn = { dir: Math.sign(kk), dist: d, k: kk };
    }
    return { ob, surf, turn };
  }
}
