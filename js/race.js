// Race state: course, racers, AI control, cheering and standings. No rendering.
import { G, LEVELS, COLORS, RIDER_NAMES } from './config.js';
import { Course } from './course.js';
import { Racer, effectiveSurface, requiredLean, leanTolerance } from './racer.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

const CHEERS_GIVEN = ['Allez allez!', 'Go go go!', 'You got this!', 'Dig deep!', 'Looking strong!', 'Hup hup hup!'];

export class Race {
  constructor(levelIndex, playerSetup) {
    this.levelIndex = levelIndex;
    this.level = LEVELS[levelIndex];
    this.course = new Course(this.level);
    this.totalDistance = this.course.length * this.level.laps;
    this.time = -3.5; // countdown
    this.events = [];
    this.crowdCd = 0;

    // Drain tuned so a full-effort race needs roughly 2 gels and 1 bottle.
    const expectedTime = this.totalDistance / 6.2;
    this.energyRate = (100 * 1.75) / expectedTime;
    this.hydRate = (100 * 1.3) / expectedTime;

    const n = this.level.riders + 1;
    const hw = this.course.halfWidth;
    const lanes = [-hw * 0.55, 0, hw * 0.55];
    const playerSlot = Math.floor(n / 2);
    const names = [...RIDER_NAMES].sort(() => Math.random() - 0.5);
    this.racers = [];
    for (let i = 0; i < n; i++) {
      const row = Math.floor(i / 3), col = i % 3;
      const base = { d: -3 - row * 2.6, x: lanes[col], gels: 3, bottles: 2 };
      if (i === playerSlot) {
        this.player = new Racer({ ...base, id: i, name: 'You', isPlayer: true, setup: playerSetup });
        this.racers.push(this.player);
      } else {
        const setup = {
          gender: Math.random() < 0.5 ? 'man' : 'woman',
          bike: Math.random() < 0.85 ? 'cx' : 'mtb',
          tire: pick(['gravel', 'mud', 'mountain']),
          shoes: 'clipless',
          jersey: pick(COLORS), shorts: pick(['#111111', '#222244', '#333333', pick(COLORS)]),
          helmet: pick(COLORS), bikeColor: pick(COLORS), skin: pick(['#f6d7c3', '#e8b796', '#c68a62', '#8d5a3b', '#5a3825']),
        };
        const skill = this.level.aiSkill * (0.93 + Math.random() * 0.12);
        this.racers.push(new Racer({ ...base, id: i, name: names[i % names.length], setup, skill, powerMul: skill }));
      }
    }
  }

  get started() { return this.time >= 0; }

  emit(racer, type, text) {
    this.events.push({ racer, type, text, time: this.time });
  }

  lapOf(r) { return clamp(Math.floor(Math.max(0, r.d) / this.course.length) + 1, 1, this.level.laps); }

  // Distance between racers along the course (positive = other is ahead).
  gap(a, b) { return b.d - a.d; }

  tryCheer(r) {
    if (r.cheerCd > 0) return;
    let best = null, bd = 16;
    for (const o of this.racers) {
      if (o === r || o.done) continue;
      const dd = Math.hypot(this.gap(r, o), o.x - r.x);
      if (dd < bd) { bd = dd; best = o; }
    }
    if (!best) {
      r.cheerCd = 0.6;
      if (r.isPlayer) this.emit(r, 'info', 'Nobody close enough to cheer on.');
      return;
    }
    r.cheerCd = 3;
    r.cheering = 1.2;
    r.energy = Math.min(100, r.energy + 3);
    best.energy = Math.min(100, best.energy + 2);
    this.emit(r, 'cheer', `You cheered on ${best.name}! "${pick(CHEERS_GIVEN)}" +energy`);
  }

  update(dt, playerCtl) {
    this.time += dt;
    for (const r of this.racers) {
      const ctl = r.isPlayer ? playerCtl : this.aiControl(r, dt);
      r.update(dt, ctl, this);
    }
    this.resolveCollisions();
    if (this.started) this.receiveCheers(dt);
  }

  receiveCheers(dt) {
    const p = this.player;
    if (p.done) return;
    for (const o of this.racers) {
      if (o === p || o.done || o.cheerCd > 0) continue;
      if (Math.abs(this.gap(p, o)) < 12 && Math.random() < 0.035 * dt) {
        o.cheerCd = 8; o.cheering = 1.2;
        p.energy = Math.min(100, p.energy + 2);
        this.emit(o, 'cheered', `${o.name}: "${pick(CHEERS_GIVEN)}" +energy`);
      }
    }
    this.crowdCd -= dt;
    const s = this.course.wrap(p.d);
    for (const cs of this.course.crowdS) {
      const dd = Math.abs(s - cs);
      if (Math.min(dd, this.course.length - dd) < 18) {
        p.energy = Math.min(100, p.energy + 0.5 * dt);
        if (this.crowdCd <= 0) { this.crowdCd = 6; this.emit(null, 'cheered', `Crowd: "${pick(CHEERS_GIVEN)}"`); }
      }
    }
  }

  // Riding into another rider = crash. Riding into a crashed rider lying on the course = crash.
  // A gentle touch (similar speeds) just slows the rider behind.
  resolveCollisions() {
    const rs = this.racers;
    for (const a of rs) {
      if (a.done || a.state === 'fallen') continue;
      const riding = a.state === 'ride' || a.state === 'mount';
      for (const b of rs) {
        if (a === b || b.done) continue;
        const g = b.d - a.d;
        if (!(g > 0 && g < 1.6 && Math.abs(b.x - a.x) < 0.7)) continue;
        if (b.state === 'fallen') {
          if (riding && a.v > 1.5) { a.fall(this, `Rode into ${b.isPlayer ? 'you' : b.name} lying on the course! Dodge crashed riders.`, 9); break; }
          a.v = Math.min(a.v, 0.6); // runners step around
        } else if (riding && a.v - b.v > 1.3) {
          a.fall(this, `Crashed into ${b.isPlayer ? 'you' : b.name}! Steer around other riders.`, 9);
          b.v *= 0.6;
          if (b.isPlayer) this.emit(b, 'info', `${a.name} crashed into the back of you!`);
          break;
        } else if (a.v > b.v) {
          a.v = b.v * 0.95;
          a.x += (a.x <= b.x ? -1 : 1) * 0.02;
        }
      }
    }
  }

  aiControl(r, dt) {
    const c = this.course;
    const s = c.wrap(r.d);
    const ctl = { pedal: true, brake: false, steer: 0, toggleMount: false, sprint: false };
    if (r.done || r.state === 'fallen') return ctl;
    r.aiHold = Math.max(0, r.aiHold - dt);
    const sm = c.sample(s);

    // Get off before obstacles that need running; get back on after.
    const next = r.d > -1 ? c.nextObstacle(s, 40) : null;
    const needsRun = (ob) => ob.mustRun || (ob.type === 'logs' && r.bike.logs === 'crash');
    const inOb = c.obstacleAt(s);
    const runUp = sm.grade > 0.17;
    if (r.state === 'ride' && r.aiHold <= 0) {
      if ((next && needsRun(next.ob) && next.dist < r.v * r.shoes.dismount + 3.5) || (runUp && r.v < 2.3)) {
        ctl.toggleMount = true; r.aiHold = 1;
      }
    } else if (r.state === 'run' && r.aiHold <= 0) {
      const blocked = (inOb && needsRun(inOb)) || (next && needsRun(next.ob) && next.dist < 8) || sm.grade > 0.12;
      if (!blocked) { ctl.toggleMount = true; r.aiHold = 1; }
    }

    // Speed: brake for upcoming corners.
    if (r.state === 'ride') {
      let vmax = 99;
      for (let d = 0; d <= 40; d += 2) {
        const k = Math.abs(c.curvatureAt(s + d));
        const surf = effectiveSurface(c.surfaceAt(s + d), r.bike, r.tire);
        const cam = Math.abs(c.sample(s + d).camber);
        const vc = Math.sqrt(Math.max(0.6, surf.grip * G * 0.75 - G * cam) / Math.max(k, 1e-3));
        vmax = Math.min(vmax, Math.sqrt(vc * vc + 2 * 4 * d));
      }
      if (r.v > vmax + 0.4) { ctl.pedal = false; ctl.brake = true; }
      else if (r.v > vmax - 0.3) ctl.pedal = false;
    }

    // Line: drift toward the inside of upcoming corners, avoid riders ahead.
    let kAhead = 0;
    for (let d = 8; d <= 24; d += 4) kAhead += c.curvatureAt(s + d);
    kAhead /= 5;
    const hw = c.halfWidth;
    let target = r.lane * 0.6 + clamp(kAhead * 25, -1, 1) * hw * 0.45;
    const look = 4 + r.skill * 10; // better riders spot trouble earlier
    for (const o of this.racers) {
      if (o === r || o.done) continue;
      const g = o.d - r.d;
      const down = o.state === 'fallen';
      const width = down ? 1.5 : 1.1;
      if (g > 0 && g < (down ? look : 5) && Math.abs(o.x - r.x) < width && (down || o.v < r.v + 0.3)) {
        const side = r.x <= o.x ? -1 : 1;
        target = o.x + side * (width + 0.3);
        if (Math.abs(target) > hw - 0.5) target = o.x - side * (width + 0.3);
        // Can't get round in time: brake.
        if (g < 2 + r.v * 0.5 && r.v > o.v + 0.8 && Math.abs(o.x - r.x) < 0.8) { ctl.pedal = false; ctl.brake = true; }
      }
    }
    target = clamp(target, -hw + 0.6, hw - 0.6);
    const psiDes = clamp((target - r.x) * 0.35, -0.3, 0.3);
    ctl.steer = clamp((psiDes - r.psi) * 2.5, -1, 1); // used on foot

    // On the bike: lean to match the corner, plus a little extra to change line.
    const surf = effectiveSurface(sm.surface, r.bike, r.tire);
    const lamReq = requiredLean(r.v, sm.k);
    const vEff = Math.max(r.v, 3);
    const wantOmega = clamp((psiDes - r.psi) * 2.5, -1, 1);
    let tanL = Math.tan(lamReq) + (wantOmega * vEff) / G * 0.6;
    tanL = clamp(tanL, -surf.grip * 0.75, surf.grip * 0.75);
    const tol = leanTolerance(r.bike, surf.grip) * 0.7;
    ctl.leanTarget = clamp(Math.atan(tanL), lamReq - tol, lamReq + tol);
    return ctl;
  }

  standings() {
    const rank = (r) => (r.state === 'finished' ? 0 : r.state === 'dnf' ? 2 : 1);
    return [...this.racers].sort((a, b) => {
      if (rank(a) !== rank(b)) return rank(a) - rank(b);
      if (a.state === 'finished') return a.finishTime - b.finishTime;
      return b.d - a.d;
    });
  }

  positionOf(r) { return this.standings().indexOf(r) + 1; }

  // Estimate finish times for riders still out on course once the player is done.
  projectedResults() {
    const res = this.racers.map((r) => {
      let t = r.finishTime;
      if (r.state !== 'finished' && r.state !== 'dnf') {
        const avg = Math.max(2, r.d / Math.max(1, this.time));
        t = this.time + (this.totalDistance - r.d) / avg;
      }
      return { racer: r, time: r.state === 'dnf' ? null : t };
    });
    res.sort((a, b) => (a.time ?? 1e9) - (b.time ?? 1e9));
    return res;
  }
}
