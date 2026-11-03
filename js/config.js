// Game data: surfaces, equipment and levels. Pure data, no rendering.

export const G = 9.81;

// crr: rolling resistance, grip: cornering/braking grip, wobble: balance drain per second
// while riding, run: running speed multiplier when on foot.
export const SURFACES = {
  pavement: { name: 'Pavement', crr: 0.008, grip: 1.0,  wobble: 0,  run: 1.05, color: [0.36, 0.36, 0.38] },
  grass:    { name: 'Grass',    crr: 0.022, grip: 0.85, wobble: 0,  run: 1.0,  color: [0.47, 0.52, 0.27] },
  gravel:   { name: 'Gravel',   crr: 0.030, grip: 0.68, wobble: 7,  run: 0.95, color: [0.58, 0.55, 0.50] },
  roots:    { name: 'Roots',    crr: 0.042, grip: 0.62, wobble: 11, run: 0.9,  color: [0.40, 0.31, 0.19] },
  mud:      { name: 'Mud',      crr: 0.070, grip: 0.48, wobble: 15, run: 0.75, color: [0.33, 0.22, 0.12] },
  sand:     { name: 'Sand',     crr: 0.110, grip: 0.52, wobble: 26, run: 0.72, color: [0.88, 0.78, 0.52] },
};

// roughMul scales the *extra* rolling resistance of loose surfaces (above pavement).
export const BIKES = {
  road: {
    name: 'Road', blurb: 'Fastest on smooth ground, but twitchy and slides out on slippery stuff.',
    power: 1.07, aero: 0.92, roughMul: 1.45, stability: 0.65, gripMul: 0.82, logs: 'crash',
  },
  cx: {
    name: 'Cyclocross', blurb: 'The all-rounder built for this sport.',
    power: 1.0, aero: 1.0, roughMul: 1.0, stability: 1.0, gripMul: 1.0, logs: 'slow',
  },
  mtb: {
    name: 'Mountain', blurb: 'A little slower, but rolls over roots and logs and is very stable.',
    power: 0.93, aero: 1.08, roughMul: 0.62, stability: 1.4, gripMul: 1.12, logs: 'ok',
  },
};

// Per-surface multipliers for rolling resistance (crr) and grip. Missing = 1.
export const TIRES = {
  road: {
    name: 'Road', blurb: 'Slick and quick on pavement, sketchy everywhere else.',
    crr: { pavement: 0.8, grass: 1.15, gravel: 1.3, roots: 1.35, mud: 1.4, sand: 1.35 },
    grip: { pavement: 1.05, grass: 0.85, gravel: 0.72, roots: 0.7, mud: 0.6, sand: 0.7 },
  },
  gravel: {
    name: 'Gravel', blurb: 'Fast-rolling with light tread. Great on gravel and grass.',
    crr: { pavement: 0.95, grass: 0.95, gravel: 0.82, roots: 1.0, mud: 1.1, sand: 1.0 },
    grip: { pavement: 1.0, grass: 1.0, gravel: 1.12, roots: 0.95, mud: 0.85, sand: 0.95 },
  },
  mountain: {
    name: 'Mountain', blurb: 'Big knobs. Grips roots and sand, drags on pavement.',
    crr: { pavement: 1.3, grass: 1.05, gravel: 1.0, roots: 0.75, mud: 0.95, sand: 0.85 },
    grip: { pavement: 0.95, grass: 1.08, gravel: 1.05, roots: 1.18, mud: 1.0, sand: 1.12 },
  },
  mud: {
    name: 'Mud', blurb: 'Spiky tread that clears mud. Slow on hard ground.',
    crr: { pavement: 1.4, grass: 1.05, gravel: 1.1, roots: 1.0, mud: 0.68, sand: 1.0 },
    grip: { pavement: 0.9, grass: 1.12, gravel: 1.0, roots: 1.05, mud: 1.32, sand: 1.0 },
  },
};

export const SHOES = {
  clipless: { name: 'Clipless', blurb: 'More power when pedaling, slower to hop on and off.', power: 1.06, mount: 0.8, dismount: 0.62 },
  flats:    { name: 'Flats',    blurb: 'Quick on and off the bike, a bit less power.',        power: 0.95, mount: 0.34, dismount: 0.25 },
};

export const COLORS = ['#e63946', '#f4a261', '#ffd60a', '#2a9d8f', '#3a86ff', '#8338ec', '#ff006e', '#111111', '#f1f1f1', '#06d6a0'];
export const SKIN_TONES = ['#f6d7c3', '#e8b796', '#c68a62', '#8d5a3b', '#5a3825'];

export const RIDER_NAMES = [
  'Sven', 'Marianne', 'Wout', 'Lucinda', 'Tom', 'Fem', 'Eli', 'Ceylin', 'Lars', 'Puck',
  'Toon', 'Shirin', 'Michael', 'Inge', 'Joris', 'Zoe', 'Niels', 'Hannah',
];

// Serpentine ("snake") section: n parallel legs joined by tight 180° hairpins, like the
// zig-zags in a real cyclocross start field. Progresses along du, legs extend along dw.
function serp(x0, z0, n, gap, len, du = [1, 0], dw = [0, -1]) {
  const P = (u, w) => [x0 + du[0] * u + dw[0] * w, z0 + du[1] * u + dw[1] * w];
  const out = [];
  for (let k = 0; k < n; k++) {
    const u = k * gap, down = k % 2 === 0;
    out.push(P(u, down ? 0 : len), P(u, down ? len : 0));
    if (k < n - 1) out.push(P(u + gap / 2, down ? len + gap * 0.5 : -gap * 0.5));
  }
  return out;
}

// Courses. points: closed loop control points (meters, x/z).
// hills: gaussian bumps {x, z, h, r}. sections: surface by lap fraction.
// cambers: sideways tilt by lap fraction (slope = rise per meter across the track,
//   + means the right-hand side is higher). Off-camber ground is hard to balance on.
// obstacles: {at: lap fraction, type: barriers|stairs|logs}.
// crowds: lap fractions where spectators gather.
export const LEVELS = [
  {
    name: 'Riverside Park', subtitle: 'Grass loop, a little snake and one set of barriers',
    laps: 2, riders: 5, aiSkill: 0.8, halfWidth: 3.4, sky: 0x9fd3ff,
    points: [[0, 0], ...serp(20, -4, 3, 15, 20), [80, -20], [105, 10], [110, 50], [80, 80], [30, 70], [0, 90], [-50, 85], [-90, 50], [-85, 10], [-50, -10]],
    hills: [{ x: 95, z: 60, h: 6, r: 35 }, { x: -60, z: 70, h: 5, r: 40 }],
    sections: [
      { from: 0, to: 0.02, surface: 'pavement' },
      { from: 0.3, to: 0.38, surface: 'gravel' },
      { from: 0.96, to: 1, surface: 'pavement' },
    ],
    cambers: [{ from: 0.45, to: 0.52, slope: 0.12 }],
    obstacles: [{ at: 0.62, type: 'barriers' }],
    crowds: [0.02, 0.12, 0.62, 0.85],
  },
  {
    name: 'Muddy Meadows', subtitle: 'Mud, an off-camber bank and your first staircase',
    laps: 2, riders: 7, aiSkill: 0.86, halfWidth: 3.2, sky: 0xb8c8d8,
    points: [[0, 0], ...serp(15, -5, 4, 14, 24), [68, 6], [84, -8], [100, -30], [130, -10], [130, 30], [95, 45], [60, 30], [40, 60], [70, 95], [30, 120], [-20, 100], [-40, 60], [-80, 50], [-100, 10], [-60, -15]],
    hills: [{ x: 130, z: 10, h: 8, r: 30 }, { x: 40, z: 110, h: 7, r: 35 }, { x: -70, z: 30, h: 5, r: 30 }],
    sections: [
      { from: 0, to: 0.02, surface: 'pavement' },
      { from: 0.1, to: 0.16, surface: 'mud' },
      { from: 0.36, to: 0.42, surface: 'gravel' },
      { from: 0.62, to: 0.7, surface: 'mud' },
      { from: 0.97, to: 1, surface: 'pavement' },
    ],
    cambers: [{ from: 0.28, to: 0.34, slope: 0.16 }, { from: 0.74, to: 0.8, slope: -0.15 }],
    obstacles: [{ at: 0.25, type: 'barriers' }, { at: 0.84, type: 'stairs' }],
    crowds: [0.02, 0.12, 0.25, 0.84],
  },
  {
    name: 'Dune Valley', subtitle: 'Deep sand, a long snake and a steep run-up',
    laps: 2, riders: 8, aiSkill: 0.92, halfWidth: 3.0, sky: 0xffe2b0,
    points: [[0, 0], ...serp(15, -4, 5, 13, 22), [120, -20], [160, 10], [150, 60], [110, 70], [90, 110], [130, 140], [90, 170], [30, 150], [0, 110], [-40, 130], [-90, 110], [-100, 60], [-60, 30], [-30, -10]],
    hills: [{ x: 155, z: 35, h: 14, r: 32 }, { x: 60, z: 160, h: 9, r: 40 }, { x: -95, z: 85, h: 8, r: 35 }],
    sections: [
      { from: 0, to: 0.01, surface: 'pavement' },
      { from: 0.12, to: 0.16, surface: 'sand' },
      { from: 0.3, to: 0.36, surface: 'gravel' },
      { from: 0.4, to: 0.45, surface: 'sand' },
      { from: 0.6, to: 0.66, surface: 'mud' },
      { from: 0.82, to: 0.87, surface: 'sand' },
      { from: 0.98, to: 1, surface: 'pavement' },
    ],
    cambers: [{ from: 0.25, to: 0.29, slope: 0.18 }, { from: 0.55, to: 0.6, slope: -0.18 }, { from: 0.74, to: 0.78, slope: 0.15 }],
    obstacles: [{ at: 0.235, type: 'barriers' }, { at: 0.67, type: 'stairs' }],
    crowds: [0.02, 0.14, 0.24, 0.42, 0.67, 0.85],
  },
  {
    name: 'Forest Switchbacks', subtitle: 'Hairpins everywhere, roots, logs and off-camber hillsides',
    laps: 2, riders: 9, aiSkill: 0.97, halfWidth: 2.8, sky: 0xa8d8b0,
    points: [[0, 0], ...serp(10, -3, 5, 12, 20), [95, -5], [112, 20], [80, 40], [20, 40], [-5, 60], [20, 80], [100, 80], [125, 100], [100, 120], [30, 125], [-40, 120], [-80, 90], [-70, 50], [-90, 20], [-60, -10]],
    hills: [{ x: 110, z: 60, h: 10, r: 30 }, { x: -60, z: 100, h: 12, r: 32 }, { x: 20, z: 60, h: 5, r: 25 }],
    sections: [
      { from: 0, to: 0.01, surface: 'pavement' },
      { from: 0.08, to: 0.12, surface: 'mud' },
      { from: 0.21, to: 0.26, surface: 'roots' },
      { from: 0.44, to: 0.5, surface: 'roots' },
      { from: 0.6, to: 0.65, surface: 'gravel' },
      { from: 0.7, to: 0.75, surface: 'sand' },
      { from: 0.82, to: 0.87, surface: 'mud' },
      { from: 0.98, to: 1, surface: 'pavement' },
    ],
    cambers: [{ from: 0.3, to: 0.35, slope: 0.2 }, { from: 0.5, to: 0.54, slope: -0.2 }, { from: 0.66, to: 0.69, slope: 0.18 }, { from: 0.9, to: 0.94, slope: -0.16 }],
    obstacles: [{ at: 0.23, type: 'logs' }, { at: 0.37, type: 'barriers' }, { at: 0.59, type: 'stairs' }, { at: 0.78, type: 'logs' }],
    crowds: [0.02, 0.1, 0.37, 0.59, 0.73],
  },
  {
    name: 'Championship Ridge', subtitle: 'Everything at once. Win this to become champion!',
    laps: 2, riders: 11, aiSkill: 1.03, halfWidth: 2.7, sky: 0x8fb8e8,
    points: [[0, 0], ...serp(12, -4, 6, 12, 22), [105, -8], [135, 15], [100, 40], [40, 35], [15, 60], [50, 85], [120, 80], [160, 110], [140, 150], [90, 140], [70, 172], ...serp(55, 172, 4, 12, 18, [-1, 0], [0, 1]), [-5, 172], [-40, 140], [-20, 105], [-70, 90], [-110, 60], [-100, 20], [-60, -5]],
    hills: [{ x: 145, z: 125, h: 16, r: 32 }, { x: 30, z: 60, h: 9, r: 28 }, { x: -60, z: 140, h: 12, r: 35 }, { x: -105, z: 40, h: 8, r: 30 }],
    sections: [
      { from: 0, to: 0.01, surface: 'pavement' },
      { from: 0.12, to: 0.16, surface: 'mud' },
      { from: 0.21, to: 0.23, surface: 'sand' },
      { from: 0.28, to: 0.33, surface: 'roots' },
      { from: 0.4, to: 0.45, surface: 'gravel' },
      { from: 0.63, to: 0.67, surface: 'mud' },
      { from: 0.72, to: 0.735, surface: 'sand' },
      { from: 0.83, to: 0.87, surface: 'roots' },
      { from: 0.98, to: 1, surface: 'pavement' },
    ],
    cambers: [{ from: 0.37, to: 0.4, slope: 0.2 }, { from: 0.47, to: 0.52, slope: -0.22 }, { from: 0.81, to: 0.83, slope: 0.2 }, { from: 0.88, to: 0.92, slope: -0.18 }],
    obstacles: [{ at: 0.2, type: 'barriers' }, { at: 0.3, type: 'logs' }, { at: 0.43, type: 'stairs' }, { at: 0.745, type: 'barriers' }, { at: 0.86, type: 'logs' }, { at: 0.94, type: 'stairs' }],
    crowds: [0.02, 0.1, 0.2, 0.43, 0.65, 0.745, 0.94],
  },
];

export const OBSTACLE_INFO = {
  barriers: { length: 6.5, label: 'BARRIERS', mustRun: true },
  stairs:   { length: 9, label: 'STAIRS', mustRun: true, rise: 2.7 },
  logs:     { length: 7, label: 'LOGS', mustRun: false },
};
