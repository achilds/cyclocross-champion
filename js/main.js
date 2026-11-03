// Cyclocross Champion: app shell, menus, input, rendering loop, HUD.
import * as THREE from 'three';
import { G, LEVELS, BIKES, TIRES, SHOES, COLORS, SKIN_TONES, SURFACES } from './config.js';
import { Race } from './race.js';
import { effectiveSurface, BASE_POWER } from './racer.js';
import { RiderModel, makeLabel } from './models.js';
import { buildWorld } from './world.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const STEP = 1 / 60;

// ---------------------------------------------------------------- Save data
const SAVE_KEY = 'cycle-cross-champion-v1';
const DEFAULT_SETUP = {
  gender: 'woman', skin: SKIN_TONES[1], jersey: '#e63946', shorts: '#111111', helmet: '#f1f1f1',
  bikeColor: '#3a86ff', bike: 'cx', tire: 'gravel', shoes: 'clipless',
};
let save;
try { save = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch { save = null; }
save = { unlocked: 1, best: {}, ...(save || {}) };
save.setup = { ...DEFAULT_SETUP, ...(save.setup || {}) };
const persist = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch { /* private mode */ } };

// ---------------------------------------------------------------- Renderer
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 1500);
function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

function addLights(scene, sky) {
  scene.add(new THREE.HemisphereLight(sky, 0x3d5a2a, 1.1));
  const sun = new THREE.DirectionalLight(0xfff4e0, 2.0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -35; sc.right = sc.top = 35; sc.near = 1; sc.far = 200;
  sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);
  return sun;
}

// ---------------------------------------------------------------- Audio
let actx = null;
function beep(freq = 440, dur = 0.12, type = 'square', vol = 0.06) {
  try {
    actx = actx || new AudioContext();
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, actx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + dur);
    o.connect(g).connect(actx.destination);
    o.start(); o.stop(actx.currentTime + dur);
  } catch { /* audio unavailable */ }
}

// ---------------------------------------------------------------- Showroom (menus)
const showroom = new THREE.Scene();
showroom.background = new THREE.Color(0x8fcfff);
showroom.fog = new THREE.Fog(0x8fcfff, 20, 90);
addLights(showroom, 0x8fcfff).position.set(5, 10, 6);
{
  const ground = new THREE.Mesh(new THREE.CircleGeometry(200, 48), new THREE.MeshStandardMaterial({ color: '#5c9a36', roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  showroom.add(ground);
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.7, 0.12, 40), new THREE.MeshStandardMaterial({ color: '#8b6b4a' }));
  pad.position.y = 0.06; pad.receiveShadow = true;
  showroom.add(pad);
  for (let i = 0; i < 40; i++) {
    const a = Math.random() * Math.PI * 2, r = 14 + Math.random() * 40;
    const h = 4 + Math.random() * 5;
    const tree = new THREE.Mesh(new THREE.ConeGeometry(1.8, h, 8), new THREE.MeshStandardMaterial({ color: '#2f6b2a' }));
    tree.position.set(Math.cos(a) * r, h / 2, Math.sin(a) * r - 10);
    showroom.add(tree);
  }
}
let previewModel = null;
function rebuildPreview() {
  if (previewModel) showroom.remove(previewModel.root);
  previewModel = new RiderModel(save.setup);
  previewModel.root.position.y = 0.12;
  showroom.add(previewModel.root);
}
const fakeRacer = { v: 3, state: 'ride', crank: 0, steerVal: 0, power: 300, runPhase: 0, braking: {}, cheering: 0, eating: 0, drinking: 0, carry: false };

// ---------------------------------------------------------------- Screens
const screens = ['title', 'help', 'garage', 'levels', 'pause', 'results'];
let mode = 'menu'; // menu | race
function show(name) {
  for (const s of screens) $('screen-' + s).classList.toggle('hidden', s !== name);
  if (name === 'garage') buildGarage();
  if (name === 'levels') buildLevels();
}
document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => { beep(660, 0.05); show(b.dataset.go); }));

// ---------------------------------------------------------------- Garage
// Steady top speed on flat ground: solve power = (rolling + air drag) * v by bisection
// (resistance only grows with speed, so this always converges).
function solveSpeed(power, crr, cda) {
  let lo = 0, hi = 40;
  for (let i = 0; i < 50; i++) {
    const v = (lo + hi) / 2;
    if ((85 * G * crr + 0.6 * cda * v * v) * v > power) hi = v; else lo = v;
  }
  return (lo + hi) / 2;
}

// Garage stat values for a setup. Bars are scaled between the worst and best possible setups.
function setupStats(s) {
  const bike = BIKES[s.bike], tire = TIRES[s.tire], shoes = SHOES[s.shoes];
  const P = BASE_POWER * bike.power * shoes.power, cda = 0.38 * bike.aero;
  const spd = (k) => solveSpeed(P, effectiveSurface(k, bike, tire).crr, cda);
  const avg = (keys, f) => keys.reduce((a, k) => a + f(k), 0) / keys.length;
  const off = ['mud', 'sand', 'roots'];
  return {
    'Pavement speed': spd('pavement'),
    'Grass speed': spd('grass'),
    'Mud & sand speed': avg(off, spd),
    'Grip': avg([...off, 'gravel'], (k) => effectiveSurface(k, bike, tire).grip),
    'Stability': bike.stability,
    'Hop on / off': 1 / (shoes.mount + shoes.dismount),
  };
}
let statRanges = null;
function getStatRanges() {
  if (statRanges) return statRanges;
  statRanges = {};
  for (const bike in BIKES) for (const tire in TIRES) for (const shoes in SHOES) {
    for (const [name, v] of Object.entries(setupStats({ bike, tire, shoes }))) {
      const r = statRanges[name] || (statRanges[name] = [Infinity, -Infinity]);
      r[0] = Math.min(r[0], v); r[1] = Math.max(r[1], v);
    }
  }
  return statRanges;
}

function buildGarage() {
  const s = save.setup;
  const opts = [
    { key: 'gender', label: 'Racer', choices: [['man', 'Man'], ['woman', 'Woman']] },
    { key: 'skin', label: 'Skin tone', swatches: SKIN_TONES },
    { key: 'jersey', label: 'Jersey color', swatches: COLORS },
    { key: 'shorts', label: 'Shorts color', swatches: COLORS },
    { key: 'helmet', label: 'Helmet color', swatches: COLORS },
    { key: 'bike', label: 'Bike type', choices: Object.entries(BIKES).map(([k, b]) => [k, b.name]), blurb: (k) => BIKES[k].blurb },
    { key: 'bikeColor', label: 'Bike color', swatches: COLORS },
    { key: 'tire', label: 'Tires', choices: Object.entries(TIRES).map(([k, t]) => [k, t.name]), blurb: (k) => TIRES[k].blurb },
    { key: 'shoes', label: 'Pedals & shoes', choices: Object.entries(SHOES).map(([k, t]) => [k, t.name]), blurb: (k) => SHOES[k].blurb },
  ];
  const root = $('garage-options');
  root.innerHTML = '';
  for (const o of opts) {
    const div = document.createElement('div');
    div.className = 'opt';
    div.innerHTML = `<label>${o.label}</label><div class="choices"></div>${o.blurb ? `<div class="blurb">${o.blurb(s[o.key])}</div>` : ''}`;
    const ch = div.querySelector('.choices');
    const items = o.swatches ? o.swatches.map((c) => [c, '']) : o.choices;
    for (const [val, text] of items) {
      const b = document.createElement('button');
      b.textContent = text;
      if (o.swatches) { b.className = 'swatch'; b.style.background = val; b.title = val; }
      if (s[o.key] === val) b.classList.add('sel');
      b.addEventListener('click', () => { s[o.key] = val; persist(); beep(880, 0.04); buildGarage(); rebuildPreview(); });
      ch.appendChild(b);
    }
    root.appendChild(div);
  }
  // Stats
  const ranges = getStatRanges();
  $('stats').innerHTML = Object.entries(setupStats(s)).map(([n, v]) => {
    const [lo, hi] = ranges[n];
    const pct = hi > lo ? 10 + 90 * (v - lo) / (hi - lo) : 100;
    return `<span>${n}</span><div class="stat"><i style="width:${pct.toFixed(0)}%"></i></div>`;
  }).join('');
}

// ---------------------------------------------------------------- Level select
const ordinal = (n) => n + (['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : n % 10] || 'th');
function fmtTime(t) {
  if (t == null) return '-';
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}
function buildLevels() {
  const list = $('level-list');
  list.innerHTML = '';
  LEVELS.forEach((L, i) => {
    const locked = i >= save.unlocked;
    const best = save.best[i];
    const div = document.createElement('div');
    div.className = 'level' + (locked ? ' locked' : '');
    div.innerHTML = `<div class="num">${locked ? '🔒' : i + 1}</div>
      <div class="info"><b>${L.name}</b><small>${L.subtitle}</small><small>${L.laps} laps · ${L.riders} rivals</small></div>
      <div class="best">${best ? `Best: ${ordinal(best.pos)}<br>${fmtTime(best.time)}` : locked ? 'Top 3 on the<br>previous course' : 'Not raced yet'}</div>`;
    if (!locked) div.addEventListener('click', () => startRace(i));
    list.appendChild(div);
  });
}

// ---------------------------------------------------------------- Input
const keys = new Set();
const edges = new Set();
let balanceTaps = 0;
const GAME_KEYS = ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
window.addEventListener('keydown', (e) => {
  if (mode === 'race' && GAME_KEYS.includes(e.code)) e.preventDefault();
  if (!e.repeat) {
    edges.add(e.code);
    if (e.code === 'KeyB') balanceTaps++;
    if ((e.code === 'Escape' || e.code === 'KeyP') && mode === 'race' && !race.player.done) togglePause();
  }
  keys.add(e.code);
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => { keys.clear(); if (mode === 'race' && !paused && race && !race.player.done) togglePause(); });

function readControls() {
  const k = (...c) => c.some((x) => keys.has(x));
  const ctl = {
    pedal: k('KeyW', 'ArrowUp'),
    sprint: k('ShiftLeft', 'ShiftRight'),
    lean: (k('KeyD', 'ArrowRight') ? 1 : 0) - (k('KeyA', 'ArrowLeft') ? 1 : 0),
    brake: k('ArrowDown', 'KeyS'),
    toggleMount: edges.has('Space'),
    eat: edges.has('KeyE'),
    drink: edges.has('KeyQ'),
    cheer: edges.has('KeyC'),
    balanceTaps,
  };
  edges.clear();
  balanceTaps = 0;
  return ctl;
}

// ---------------------------------------------------------------- Race
let race = null, raceScene = null, world = null, sun = null, models = [], labels = [];
let paused = false, acc = 0, eventIdx = 0, endTimer = -1, lastBeepSec = 99, warnCd = 0;
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
const feed = [];
let minimapBg = null, mmXform = null;

function togglePause() {
  paused = !paused;
  $('screen-pause').classList.toggle('hidden', !paused);
}
$('btn-resume').onclick = () => togglePause();
$('btn-restart').onclick = () => { paused = false; startRace(race.levelIndex); };
$('btn-quit').onclick = () => { paused = false; toMenu(); };
$('btn-retry').onclick = () => startRace(race.levelIndex);
$('btn-garage').onclick = () => toMenu('garage');
$('btn-next').onclick = () => startRace(race.levelIndex + 1);

function disposeRace() {
  if (world) world.dispose();
  raceScene = null; world = null; models = []; labels = [];
}

function toMenu(screen = 'title') {
  disposeRace();
  mode = 'menu';
  $('hud').classList.add('hidden');
  show(screen);
}

function startRace(levelIndex) {
  disposeRace();
  show(null);
  mode = 'race';
  paused = false; acc = 0; eventIdx = 0; endTimer = -1; lastBeepSec = 99;
  feed.length = 0;
  $('hud-feed').innerHTML = '';
  race = new Race(levelIndex, { ...save.setup });
  const L = race.level;
  raceScene = new THREE.Scene();
  raceScene.background = new THREE.Color(L.sky);
  raceScene.fog = new THREE.Fog(L.sky, 70, 330);
  sun = addLights(raceScene, L.sky);
  world = buildWorld(race.course, raceScene);
  for (const r of race.racers) {
    const m = new RiderModel(r.setup);
    m.lean = 0;
    raceScene.add(m.root);
    models.push(m);
    let label = null;
    if (!r.isPlayer) { label = makeLabel(r.name); raceScene.add(label); label.userData.text = r.name; }
    labels.push(label);
  }
  buildMinimap();
  updateVisuals(0, true);
  $('hud').classList.remove('hidden');
}

function pushFeed(text, cls = '') {
  const el = document.createElement('div');
  el.textContent = text;
  el.className = cls;
  $('hud-feed').prepend(el);
  feed.push({ el, t: performance.now() });
  while ($('hud-feed').children.length > 5) $('hud-feed').lastChild.remove();
}

function centerMsg(html, secs = 2) {
  $('hud-center').innerHTML = html;
  centerMsg.until = performance.now() + secs * 1000;
}
centerMsg.until = 0;

function processEvents() {
  const p = race.player;
  for (; eventIdx < race.events.length; eventIdx++) {
    const e = race.events[eventIdx];
    if (e.racer === p) {
      if (e.type === 'fall') { centerMsg(`CRASH!<small>${e.text}</small>`, 2.6); beep(140, 0.4, 'sawtooth', 0.1); }
      if (e.type === 'dnf') { centerMsg(`OUT OF THE RACE<small>${e.text}</small>`, 99); beep(110, 0.8, 'sawtooth', 0.1); endTimer = 3.5; }
      if (e.type === 'finish') { centerMsg(`FINISHED!<small>${ordinal(race.positionOf(p))} place</small>`, 99); beep(880, 0.15); setTimeout(() => beep(1320, 0.3), 160); endTimer = 3.5; }
      if (e.type === 'cheer') { pushFeed(e.text, 'cheer'); beep(990, 0.06, 'triangle'); }
      if (e.type === 'info') pushFeed(e.text);
    } else if (e.type === 'cheered') {
      pushFeed(e.text, 'cheer'); beep(1200, 0.05, 'triangle', 0.04);
    } else if (e.racer && e.type === 'fall' && Math.abs(e.racer.d - p.d) < 60) {
      pushFeed(`${e.racer.name} crashed!`, 'bad');
    } else if (e.racer && e.type === 'finish' && !p.done) {
      pushFeed(`${e.racer.name} finished in ${ordinal(race.positionOf(e.racer))}`);
    }
  }
}

const _fwd = new THREE.Vector3(), _pos = new THREE.Vector3();
function updateVisuals(dt, snap = false) {
  const c = race.course;
  race.racers.forEach((r, i) => {
    const m = models[i];
    const sm = c.sample(r.d);
    const cp = Math.cos(r.psi), sp = Math.sin(r.psi);
    const fx = sm.tx * cp + sm.nx * sp, fz = sm.tz * cp + sm.nz * sp;
    m.root.position.set(sm.x + sm.nx * r.x, c.groundHeight(r.d, r.x) + 0.04, sm.z + sm.nz * r.x);
    m.root.rotation.y = Math.atan2(fx, fz);
    m.update(r, dt);
    const riding = r.state === 'ride' || r.state === 'mount';
    let leanT = riding ? r.lean : 0;
    if (r.isPlayer && riding && r.balance < 70) leanT += Math.sin(race.time * 13) * (70 - r.balance) / 70 * 0.18;
    m.lean += (leanT - m.lean) * Math.min(1, dt * 8 || 1);
    m.tilt.rotation.x = -Math.atan(sm.grade) * (r.onFoot ? 0.4 : 1);
    // Crashes: roll toward the side the rider was leaning, wheels sliding out the other way.
    m.tilt.rotation.z = m.lean + m.fallRoll * r.fallSide;
    m.tilt.position.x = r.fallSide * (m.fallRoll / 1.35) * 0.6;
    const lb = labels[i];
    if (lb) {
      lb.position.set(m.root.position.x, m.root.position.y + 2.3, m.root.position.z);
      const gap = r.d - race.player.d;
      lb.visible = gap > -1 && gap < 40;
      const want = r.cheering > 0 ? `${r.name}: Allez!` : r.name;
      if (lb.userData.text !== want) { lb.userData.text = want; lb.userData.draw(want, r.cheering > 0 ? '#ffd60a' : '#fff'); }
    }
  });

  // Chase camera
  const p = race.player, pm = models[race.racers.indexOf(p)];
  const sm = c.sample(p.d + 2);
  _fwd.set(sm.tx, 0, sm.tz).normalize();
  _pos.copy(pm.root.position);
  const desired = new THREE.Vector3().copy(_pos).addScaledVector(_fwd, -6.5).add(new THREE.Vector3(0, 2.7, 0));
  const look = new THREE.Vector3().copy(_pos).addScaledVector(_fwd, 3.5).add(new THREE.Vector3(0, 1.0, 0));
  const k = snap ? 1 : 1 - Math.exp(-dt * 4.5);
  camPos.lerp(desired, k);
  camLook.lerp(look, snap ? 1 : 1 - Math.exp(-dt * 8));
  const floor = c.terrainHeight(camPos.x, camPos.z) + 1.2;
  if (camPos.y < floor) camPos.y = floor;
  camera.position.copy(camPos);
  camera.lookAt(camLook);

  sun.position.set(_pos.x + 30, _pos.y + 60, _pos.z + 20);
  sun.target.position.copy(_pos);
  world.update(race.time, p);
}

// ---------------------------------------------------------------- Minimap
function buildMinimap() {
  const c = race.course;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < c.N; i++) { minX = Math.min(minX, c.px[i]); maxX = Math.max(maxX, c.px[i]); minZ = Math.min(minZ, c.pz[i]); maxZ = Math.max(maxZ, c.pz[i]); }
  const size = 200, pad = 16;
  const sc = (size - pad * 2) / Math.max(maxX - minX, maxZ - minZ);
  const ox = (size - (maxX - minX) * sc) / 2, oz = (size - (maxZ - minZ) * sc) / 2;
  mmXform = (x, z) => [ox + (x - minX) * sc, oz + (z - minZ) * sc];
  minimapBg = document.createElement('canvas');
  minimapBg.width = minimapBg.height = size;
  const g = minimapBg.getContext('2d');
  g.lineCap = 'round';
  g.lineWidth = 7; g.strokeStyle = 'rgba(0,0,0,0.6)';
  g.beginPath();
  for (let i = 0; i <= c.N; i++) { const [x, y] = mmXform(c.px[i % c.N], c.pz[i % c.N]); i ? g.lineTo(x, y) : g.moveTo(x, y); }
  g.stroke();
  g.lineWidth = 4;
  for (let i = 0; i < c.N; i++) {
    const col = SURFACES[c.surface[i]].color;
    g.strokeStyle = `rgb(${col.map((v) => Math.min(255, v * 300) | 0).join(',')})`;
    const [x1, y1] = mmXform(c.px[i], c.pz[i]), [x2, y2] = mmXform(c.px[(i + 1) % c.N], c.pz[(i + 1) % c.N]);
    g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
  }
  for (const ob of c.obstacles) {
    const sm = c.sample(ob.s0);
    const [x, y] = mmXform(sm.x, sm.z);
    g.fillStyle = ob.mustRun ? '#ff4d5a' : '#ffa630';
    g.fillRect(x - 3, y - 3, 6, 6);
  }
  const s0 = c.sample(0); const [sx, sy] = mmXform(s0.x, s0.z);
  g.fillStyle = '#fff'; g.fillRect(sx - 1, sy - 6, 2, 12);
}
function drawMinimap() {
  const ctx = $('minimap').getContext('2d');
  ctx.clearRect(0, 0, 200, 200);
  ctx.drawImage(minimapBg, 0, 0);
  const c = race.course;
  for (const r of race.racers) {
    if (r.isPlayer) continue;
    const sm = c.sample(r.d); const [x, y] = mmXform(sm.x, sm.z);
    ctx.fillStyle = r.setup.jersey; ctx.strokeStyle = '#000'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(x, y, 3.5, 0, 7); ctx.fill(); ctx.stroke();
  }
  const sm = c.sample(race.player.d); const [x, y] = mmXform(sm.x, sm.z);
  ctx.fillStyle = '#fff'; ctx.strokeStyle = '#e63946'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(x, y, 6, 0, 7); ctx.fill(); ctx.stroke();
}

// ---------------------------------------------------------------- HUD
// Lean gauge: needle = your lean, green arc = the lean this corner needs.
function drawLeanGauge(p) {
  const cv = $('lean-gauge'), g = cv.getContext('2d');
  const W = cv.width, H = cv.height, cx = W / 2, cy = H - 8, R = H - 22;
  const ang = (t) => -Math.PI / 2 + clamp(t, -1.05, 1.05);
  g.clearRect(0, 0, W, H);
  g.lineCap = 'round';
  g.lineWidth = 12; g.strokeStyle = 'rgba(0,0,0,0.45)';
  g.beginPath(); g.arc(cx, cy, R, ang(-1.05), ang(1.05)); g.stroke();
  const riding = p.state === 'ride' || p.state === 'mount';
  const inCorner = riding && Math.abs(p.leanReq) > 0.12 && p.v > 3;
  const lo = p.leanReq - p.leanTol, hi = p.leanReq + p.leanTol;
  g.strokeStyle = inCorner ? 'rgba(6,214,160,0.95)' : 'rgba(255,255,255,0.25)';
  g.beginPath(); g.arc(cx, cy, R, ang(lo), ang(hi)); g.stroke();
  const ok = !inCorner || (p.lean >= lo && p.lean <= hi);
  const t = ang(p.lean);
  g.lineWidth = 5; g.strokeStyle = ok ? '#ffffff' : '#ff4d5a';
  g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(t) * (R + 8), cy + Math.sin(t) * (R + 8)); g.stroke();
  g.fillStyle = '#fff'; g.font = 'bold 13px system-ui'; g.textAlign = 'center';
  g.fillText('← LEAN →', cx, cy - 14);
}

function setBar(id, val, low) {
  const el = $(id);
  el.querySelector('i').style.width = clamp(val, 0, 100) + '%';
  el.classList.toggle('low', low);
}
function alertText() {
  const p = race.player, c = race.course;
  if (p.done) return null;
  const s = c.wrap(p.d);
  const riding = p.state === 'ride' || p.state === 'mount';
  if (p.slip > 0.25) {
    const more = p.leanMiss && Math.abs(p.lean) < Math.abs(p.leanReq);
    const fix = p.leanMiss ? (more ? `LEAN MORE ${p.leanReq > 0 ? '→' : '←'}` : 'LEAN LESS') : 'SLOW DOWN';
    return [`SLIDING! ${fix}`, true];
  }
  const down = race.racers.find((o) => o !== p && o.state === 'fallen' && o.d - p.d > 0 && o.d - p.d < 30);
  if (down && !p.onFoot) return [`RIDER DOWN AHEAD (${down.name})! Steer around them!`, down.d - p.d < 12];
  const f = c.nextFeature(s, 70);
  const ob = c.obstacleAt(s);
  if (ob && p.onFoot && (ob.mustRun || ob.type === 'logs')) return [`RUN! Hold W to carry your bike over the ${ob.label.toLowerCase()}`, false];
  if (f.ob && f.ob.dist < 60) {
    const o = f.ob.ob, d = Math.round(f.ob.dist);
    const mustRun = o.mustRun || (o.type === 'logs' && p.bike.logs === 'crash');
    if (mustRun && riding) return [`⚠ ${o.label} in ${d} m: GET OFF (Space)!`, d < 25];
    if (o.type === 'logs' && riding) return [p.bike.logs === 'ok' ? `LOGS in ${d} m: your mountain bike can roll them` : `LOGS in ${d} m: ride slowly with balance, or run`, false];
  }
  if (p.state === 'run' && !ob && !(f.ob && f.ob.dist < 10 && f.ob.ob.mustRun)) return ['Back on the bike: Space', false];
  if (riding && p.v < 2 && c.sample(s).grade > 0.1 && race.started) return ['Steep! Pedal hard or get off and run it (Space)', p.v < 1.2];
  const here = effectiveSurface(c.surfaceAt(s), p.bike, p.tire);
  if (riding && here.wobble > 0 && p.balance < 75) return [`${SURFACES[here.key].name.toUpperCase()}! Mash B to keep your balance`, p.balance < 35];
  const camHere = c.sample(s).camber;
  if (riding && Math.abs(camHere) > 0.06) return ['OFF-CAMBER! Mash B, go easy on the brakes', p.balance < 40];
  if (riding) for (let d = 5; d < 40; d += 5) if (Math.abs(c.sample(s + d).camber) > 0.08) return [`OFF-CAMBER in ${d} m: slow down, get ready to mash B`, false];
  if (f.surf && f.surf.dist < 45 && riding) return [`${SURFACES[f.surf.surface].name.toUpperCase()} ahead: get ready to mash B`, false];
  if (f.turn && riding) {
    const surf = effectiveSurface(c.surfaceAt(s + f.turn.dist), p.bike, p.tire);
    const vSafe = Math.sqrt((surf.grip * G * 0.85) / Math.abs(f.turn.k));
    const dir = f.turn.dir > 0 ? 'RIGHT ↱' : 'LEFT ↰', key = f.turn.dir > 0 ? '→' : '←';
    if (p.v > vSafe + 0.5) return [`SHARP ${dir}: brake (↓), then lean ${key}`, p.v > vSafe + 2.5];
    return [`SHARP ${dir}: lean ${key} into it`, false];
  }
  return null;
}

function updateHUD(dt) {
  const p = race.player;
  const pos = race.positionOf(p);
  $('hud-pos').innerHTML = `${pos}<sup>${ordinal(pos).slice(-2)}</sup><small> / ${race.racers.length}</small>`;
  $('hud-lap').textContent = `Lap ${race.lapOf(p)}/${race.level.laps}`;
  $('hud-time').textContent = fmtTime(Math.max(0, p.finishTime ?? race.time));
  $('hud-speed').innerHTML = `${Math.round(p.v * 3.6)}<small> km/h</small>`;
  const surfName = SURFACES[race.course.surfaceAt(p.d)].name.toUpperCase();
  const modeTxt = { ride: 'RIDING', mount: 'GETTING ON…', dismount: 'GETTING OFF…', run: 'RUNNING', fallen: 'CRASHED', finished: 'FINISHED', dnf: 'OUT' }[p.state];
  $('hud-mode').textContent = `${modeTxt} · ${surfName}`;
  $('brk').classList.toggle('on', p.braking);
  drawLeanGauge(p);
  $('hud-danger').textContent = p.slip > 0.3 ? '⚠ SLIDING' : '';

  const eLow = p.energy < 25, wLow = p.hydration < 25;
  setBar('bar-energy', p.energy, eLow);
  setBar('bar-water', p.hydration, wLow);
  const surf = effectiveSurface(race.course.surfaceAt(p.d), p.bike, p.tire);
  setBar('bar-balance', p.balance, p.balance < 35 && !p.onFoot);
  $('bar-balance').classList.toggle('idle', surf.wobble === 0 && p.balance > 95);
  warnCd -= dt;
  if ((eLow || wLow) && !p.done && warnCd <= 0) { beep(520, 0.1, 'square', 0.05); warnCd = 2.5; }

  $('hud-gels').textContent = p.gels;
  $('hud-bottles').textContent = p.bottles;
  $('hud-cheer').textContent = p.cheerCd > 0 ? p.cheerCd.toFixed(1) + 's' : 'ready';

  const al = alertText();
  const ae = $('hud-alert');
  ae.style.display = al ? 'block' : 'none';
  if (al) { ae.textContent = al[0]; ae.classList.toggle('danger', al[1]); }

  // Countdown
  if (race.time < 0) {
    const n = Math.ceil(-race.time);
    if (n <= 3) {
      $('hud-center').innerHTML = `${n}<small>Hold W to pedal when it says GO</small>`;
      if (n !== lastBeepSec) { beep(440, 0.15); lastBeepSec = n; }
    } else $('hud-center').innerHTML = `${race.level.name}<small>${race.level.laps} laps · ${race.level.riders} rivals</small>`;
    centerMsg.until = 0;
  } else if (race.time < 1.2) {
    if (lastBeepSec !== 0) { beep(880, 0.35); lastBeepSec = 0; }
    $('hud-center').innerHTML = 'GO!';
  } else if (performance.now() > centerMsg.until) $('hud-center').innerHTML = '';

  const now = performance.now();
  for (const f of feed) if (now - f.t > 4500) f.el.style.opacity = '0';
  drawMinimap();
}

// ---------------------------------------------------------------- Results
function showResults() {
  const p = race.player;
  const res = race.projectedResults();
  const myIdx = res.findIndex((r) => r.racer === p);
  const pos = myIdx + 1;
  const li = race.levelIndex;
  let title, sub;
  if (p.state === 'dnf') {
    title = 'DNF: Did Not Finish'; sub = p.dnfReason;
  } else {
    const prev = save.best[li];
    if (!prev || pos < prev.pos || (pos === prev.pos && p.finishTime < prev.time)) save.best[li] = { pos, time: p.finishTime };
    if (pos <= 3) save.unlocked = Math.max(save.unlocked, Math.min(LEVELS.length, li + 2));
    persist();
    if (pos === 1 && li === LEVELS.length - 1) title = '🏆 CYCLOCROSS CHAMPION! 🏆';
    else if (pos === 1) title = '🏆 You won!';
    else if (pos <= 3) title = `🥈 Podium! ${ordinal(pos)} place`;
    else title = `Finished ${ordinal(pos)}`;
    sub = pos <= 3
      ? (li < LEVELS.length - 1 ? `Next course unlocked: ${LEVELS[li + 1].name}` : 'You conquered Championship Ridge!')
      : 'Finish in the top 3 to unlock the next course.';
  }
  $('res-title').textContent = title;
  $('res-sub').textContent = sub;
  const winner = res[0].time;
  $('res-table').innerHTML = '<tr><th>#</th><th>Rider</th><th>Time</th><th>Gap</th></tr>' + res.map((r, i) =>
    `<tr class="${r.racer === p ? 'me' : ''}"><td>${r.time == null ? '-' : i + 1}</td><td><span class="dot" style="background:${r.racer.setup.jersey}"></span>${r.racer.name}</td>` +
    `<td>${r.time == null ? 'DNF' : fmtTime(r.time)}</td><td>${r.time == null || i === 0 ? '' : '+' + (r.time - winner).toFixed(1) + 's'}</td></tr>`).join('');
  const nextOk = li < LEVELS.length - 1 && save.unlocked > li + 1;
  $('btn-next').disabled = !nextOk;
  $('btn-next').style.display = li < LEVELS.length - 1 ? '' : 'none';
  $('hud').classList.add('hidden');
  show('results');
}

// ---------------------------------------------------------------- Main loop
let last = performance.now(), clock = 0;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  clock += dt;
  if (mode === 'race' && race) {
    if (!paused) {
      acc += dt;
      let ctl = readControls();
      if (DEBUG.bot && race.started) {
        const p = race.player;
        ctl = { ...race.aiControl(p, dt), balanceTaps: p.balance < 60 ? 1 : 0, eat: p.energy < 35, drink: p.hydration < 35 };
      }
      while (acc >= STEP) {
        race.update(STEP, ctl);
        ctl = { ...ctl, toggleMount: false, eat: false, drink: false, cheer: false, balanceTaps: 0 };
        acc -= STEP;
      }
      processEvents();
      updateVisuals(dt);
      updateHUD(dt);
      if (endTimer > 0) { endTimer -= dt; if (endTimer <= 0) showResults(); }
    } else readControls();
    renderer.render(raceScene || showroom, camera);
  } else {
    readControls();
    fakeRacer.crank = clock * 4; fakeRacer.runPhase = clock * 6;
    if (previewModel) { previewModel.update(fakeRacer, dt); previewModel.root.rotation.y = clock * 0.5; }
    camera.position.set(-0.6, 1.5, 4.4);
    camera.lookAt(1.1, 0.85, 0);
    renderer.render(showroom, camera);
  }
  requestAnimationFrame(frame);
}

// Debug: ?race=N starts course N, &bot=1 lets the AI ride for you, &skip=S fast-forwards S seconds.
const params = new URLSearchParams(location.search);
const DEBUG = { bot: params.has('bot') };
rebuildPreview();
show(params.has('screen') ? params.get('screen') : 'title');
if (params.has('race')) {
  startRace(clamp(+params.get('race') || 0, 0, LEVELS.length - 1));
  const skip = +params.get('skip') || 0;
  for (let t = 0; t < skip; t += STEP) {
    const p = race.player;
    race.update(STEP, { ...race.aiControl(p, STEP), balanceTaps: p.balance < 60 ? 1 : 0, eat: p.energy < 35, drink: p.hydration < 35 });
  }
  if (params.has('at')) { // &at=M places you M meters into the lap, on foot
    race.time = Math.max(race.time, 0.1);
    Object.assign(race.player, { d: +params.get('at'), state: 'run', v: 2, x: 0 });
  }
  eventIdx = race.events.length;
  updateVisuals(0, true);
}
requestAnimationFrame(frame);

// Exposed for debugging in the console.
window.__ccc = { get race() { return race; }, startRace, save };
