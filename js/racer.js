// Rider physics shared by the player and computer riders. No rendering.
import { G, SURFACES, BIKES, TIRES, SHOES } from './config.js';

export const BASE_POWER = 435;   // watts (a bit above real life: arcade pace)
const MASS = 85;                 // rider + bike, kg
const RUN_SPEED = 4.8;           // m/s on flat grass
const LEAN_RATE = 1.7;           // rad/s while holding a lean key
const LEAN_RETURN = 0.7;         // rad/s back toward upright when released
const MAX_LEAN = 0.95;           // rad (~54 degrees)

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function effectiveSurface(key, bike, tire) {
  const S = SURFACES[key];
  const tc = tire.crr[key] ?? 1, tg = tire.grip[key] ?? 1;
  return {
    key,
    crr: (0.008 + (S.crr - 0.008) * bike.roughMul) * tc,
    grip: S.grip * tg * bike.gripMul,
    wobble: S.wobble / bike.stability / tg,
    run: S.run,
  };
}

// Lean angle (rad, + = right) needed to balance through a turn of curvature k at speed v.
export const requiredLean = (v, k) => Math.atan((v * v * k) / G);

// How far off the required lean you can be before the tyres start to let go.
export function leanTolerance(bike, grip) {
  return 0.2 * Math.sqrt(bike.stability) * (0.75 + 0.25 * Math.min(1, grip / 0.85));
}

export class Racer {
  constructor(o) {
    this.id = o.id;
    this.name = o.name;
    this.isPlayer = !!o.isPlayer;
    this.setup = o.setup; // {bike, tire, shoes, gender, colors...}
    this.bike = BIKES[o.setup.bike];
    this.tire = TIRES[o.setup.tire];
    this.shoes = SHOES[o.setup.shoes];
    this.skill = o.skill ?? 1;
    this.powerMul = o.powerMul ?? 1;
    this.d = o.d;      // total distance travelled along course (can start negative on the grid)
    this.x = o.x;      // lateral offset, + = right
    this.lane = o.x;
    this.psi = 0;      // heading relative to track
    this.v = 0;
    this.state = 'ride';
    this.timer = 0;
    this.steerVal = 0;
    this.omega = 0;
    this.lean = 0;       // actual lean angle (rad, + = right)
    this.leanReq = 0;    // lean the current corner needs
    this.leanTol = 0.2;
    this.leanMiss = 0;   // signed lean error (lean - leanReq) when in a corner
    this.balance = 100;
    this.slip = 0;
    this.energy = 100;
    this.hydration = 100;
    this.gels = o.gels ?? 3;
    this.bottles = o.bottles ?? 2;
    this.eating = 0;
    this.drinking = 0;
    this.cheerCd = 0;
    this.cheering = 0;
    this.finishTime = null;
    this.dnfReason = null;
    this.crank = Math.random() * 6;
    this.runPhase = 0;
    this.power = 0;
    this.braking = false;
    this.fallSide = 1;  // which way the rider fell: +1 right, -1 left
    this.aiHold = 0;
  }

  get done() { return this.state === 'finished' || this.state === 'dnf'; }
  get onFoot() { return this.state === 'run' || this.state === 'dismount' || this.state === 'fallen'; }

  fall(race, reason, energyLoss = 3) {
    if (this.state === 'fallen' || this.done) return;
    this.state = 'fallen';
    this.timer = 2.2;
    this.v = 0;
    this.slip = 0;
    this.balance = 70;
    // Fall toward the side you were leaning (head that way, wheels slide out the other way).
    // If upright, a slide-out still drops the bike toward the inside of the turn.
    this.fallSide = Math.abs(this.lean) > 0.05 ? Math.sign(this.lean)
      : Math.abs(this.leanReq) > 0.05 ? Math.sign(this.leanReq) : (Math.random() < 0.5 ? -1 : 1);
    this.psi = 0;
    this.lean = 0;
    this.energy = Math.max(1, this.energy - energyLoss);
    race.emit(this, 'fall', reason);
  }

  dnf(race, reason) {
    if (this.done) return;
    this.state = 'dnf';
    this.dnfReason = reason;
    this.v = 0;
    race.emit(this, 'dnf', reason);
  }

  update(dt, ctl, race) {
    if (this.done) { this.v *= Math.max(0, 1 - 2 * dt); this.d += this.v * dt; return; }
    const c = race.course;
    const s = c.wrap(this.d);
    const sm = c.sample(s);
    const surf = effectiveSurface(sm.surface, this.bike, this.tire);
    const ob = this.d >= 0 ? c.obstacleAt(s) : null;
    const slope = sm.grade / Math.sqrt(1 + sm.grade * sm.grade);
    this.cheerCd = Math.max(0, this.cheerCd - dt);
    this.cheering = Math.max(0, this.cheering - dt);
    this.braking = !!ctl.brake;

    // Mount / dismount toggle.
    if (ctl.toggleMount) {
      if (this.state === 'ride') {
        this.state = 'dismount'; this.timer = this.shoes.dismount;
      } else if (this.state === 'run') {
        if (ob && ob.mustRun) race.emit(this, 'info', `Can't get back on in the middle of the ${ob.label.toLowerCase()}!`);
        else { this.state = 'mount'; this.timer = this.shoes.mount; }
      }
    }

    // Food & drink.
    if (ctl.eat && this.eating <= 0 && this.state !== 'fallen') {
      if (this.gels > 0) { this.gels--; this.eating = 1.3; race.emit(this, 'info', 'Eating an energy gel…'); }
      else race.emit(this, 'info', 'No food left!');
    }
    if (ctl.drink && this.drinking <= 0 && this.state !== 'fallen') {
      if (this.bottles > 0) { this.bottles--; this.drinking = 1.1; race.emit(this, 'info', 'Drinking…'); }
      else race.emit(this, 'info', 'No bottles left!');
    }
    if (this.eating > 0) { this.eating -= dt; this.energy = Math.min(100, this.energy + (40 / 1.3) * dt); }
    if (this.drinking > 0) { this.drinking -= dt; this.hydration = Math.min(100, this.hydration + (45 / 1.1) * dt); }

    if (ctl.cheer) race.tryCheer(this);

    const fatigue = (this.energy < 15 ? 0.55 + 0.45 * this.energy / 15 : 1) * (this.hydration < 15 ? 0.7 + 0.3 * this.hydration / 15 : 1);
    const busy = this.eating > 0 || this.drinking > 0 ? 0.55 : 1;

    // Steering on foot: player uses the lean keys, computer riders send steer.
    const footSteer = this.isPlayer ? (ctl.lean || 0) : (ctl.steer || 0);

    let omega = 0;
    let effort = 0.2;

    if (this.state === 'fallen') {
      this.timer -= dt;
      this.v = 0;
      if (this.timer <= 0) { this.state = 'run'; this.v = 0; }
    } else if (this.state === 'ride' || this.state === 'mount') {
      // --- Riding ---
      const mounting = this.state === 'mount';
      if (mounting) { this.timer -= dt; if (this.timer <= 0) this.state = 'ride'; }
      const pedal = !mounting && ctl.pedal && race.started;
      const sprint = pedal && ctl.sprint;
      this.power = pedal ? BASE_POWER * this.bike.power * this.shoes.power * this.powerMul * (sprint ? 1.35 : 1) * fatigue * busy : 0;
      let drive = this.power / Math.max(this.v, 1.5);
      drive = Math.min(drive, surf.grip * MASS * G * 0.75);
      const cda = 0.38 * this.bike.aero;
      const resist = MASS * G * (surf.crr + slope) + 0.6 * cda * this.v * this.v;
      // One brake control applies front and rear evenly: as hard as the surface's grip allows.
      const brake = ctl.brake ? G * surf.grip * 0.95 : 0;
      let a = (drive - resist) / MASS - (this.v > 0 ? brake : 0);
      this.v = Math.max(0, this.v + a * dt);
      if (!race.started) this.v = 0;
      effort = this.power / BASE_POWER + 0.15;

      // ---- Leaning & cornering ----
      // Lean keys change the lean angle; the lean is what turns the bike (like a real bike).
      if (ctl.leanTarget !== undefined) this.lean += clamp(ctl.leanTarget - this.lean, -3 * dt, 3 * dt);
      else if (ctl.lean) this.lean += ctl.lean * LEAN_RATE * dt;
      else this.lean -= Math.sign(this.lean) * Math.min(Math.abs(this.lean), LEAN_RETURN * dt);
      this.lean = clamp(this.lean, -MAX_LEAN, MAX_LEAN);
      const lamReq = requiredLean(this.v, sm.k);
      const vEff = Math.max(this.v, 3);
      omega = this.v * sm.k + (G * (Math.tan(this.lean) - Math.tan(lamReq))) / vEff;
      this.steerVal = clamp((this.lean - lamReq) * 0.8 + sm.k * 1.5, -0.6, 0.6);

      // Grip: cornering force plus the sideways pull of a cambered slope, minus what braking uses.
      const camberGrip = 1 / Math.sqrt(1 + sm.camber * sm.camber);
      const latMax = surf.grip * G * 0.95 * camberGrip * Math.sqrt(1 - 0.6 * (brake / (surf.grip * G)) ** 2);
      const latNeed = this.v * omega + G * sm.camber;
      let slipping = false;
      if (Math.abs(latNeed) > latMax && this.v > 2) {
        slipping = true;
        omega = (Math.sign(latNeed) * latMax - G * sm.camber) / Math.max(this.v, 0.5);
        this.slip += (Math.abs(latNeed) / latMax - 1) * dt * 2.0;
      }
      // Wrong lean for the corner (too upright, or leaning too far) also breaks traction.
      this.leanReq = lamReq;
      this.leanTol = leanTolerance(this.bike, surf.grip * camberGrip);
      const miss = this.lean - lamReq;
      const inCorner = Math.abs(lamReq) > 0.12 && this.v > 3;
      this.leanMiss = inCorner ? miss : 0;
      if (inCorner && Math.abs(miss) > this.leanTol) {
        slipping = true;
        this.slip += (Math.abs(miss) - this.leanTol) * this.v * 0.45 * dt;
      }
      if (!slipping) this.slip = Math.max(0, this.slip - dt * 0.9);
      if (slipping && sm.camber) this.x -= sm.camber * this.slip * 3 * dt; // slide down the slope
      if (this.slip >= 1) {
        const overLean = Math.abs(this.lean) > Math.abs(lamReq) + this.leanTol * 0.8 || (Math.abs(lamReq) < 0.12 && Math.abs(this.lean) > 0.5);
        const underLean = inCorner && Math.abs(this.lean) < Math.abs(lamReq) - this.leanTol * 0.8;
        const why = overLean ? 'Leaned too far and slid out! Ease off the lean.'
          : underLean ? 'Not leaning enough. The bike slid out! Lean into corners (\u2190 \u2192).'
          : Math.abs(sm.camber) > 0.05 ? 'Slid out on the off-camber! Slow down and keep your line.'
          : 'Slid out! Too fast for that corner. Brake before turns.';
        this.fall(race, why);
        return;
      }

      // Balance (player mashes the balance key; computer riders take a random chance).
      if (this.isPlayer) {
        let drain = surf.wobble * (0.45 + Math.min(this.v, 8) / 9);
        drain += (Math.abs(sm.camber) * 85) / this.bike.stability; // off-camber is hard to balance on
        if (surf.wobble > 0 && Math.abs(this.lean) > 0.4) drain *= 1.3;
        const stalling = race.time > 1.5 && this.v < 1.0 && sm.grade > 0.1 && !mounting;
        if (stalling) drain += 40;
        if (drain === 0) this.balance += 30 * dt;
        this.balance = clamp(this.balance - drain * dt + (ctl.balanceTaps || 0) * 7, 0, 100);
        if (this.balance <= 0) { this.fall(race, stalling ? 'Stalled on the climb and toppled over! Run steep hills.' : 'Lost your balance! Mash B in sand and mud.'); return; }
      } else if (race.started && Math.random() < (1.12 - this.skill) * (surf.wobble + Math.abs(sm.camber) * 60) * 0.0015 * dt) {
        this.fall(race, 'lost balance');
        return;
      }

      // Riding into obstacles.
      if (ob && this.v > 0.8 && !mounting) {
        if (ob.mustRun) { this.fall(race, `Crashed into the ${ob.label.toLowerCase()}! Get off and run (Space).`); return; }
        if (ob.type === 'logs') {
          if (this.bike.logs === 'crash') { this.fall(race, 'Road bikes can’t ride over logs!'); return; }
          if (this.bike.logs === 'slow') { this.v = Math.max(2.2, this.v * (1 - 1.6 * dt)); if (this.isPlayer) this.balance -= 18 * dt; }
          else this.v *= 1 - 0.35 * dt;
        }
      }
    } else {
      // --- On foot (running or dismounting) ---
      if (this.state === 'dismount') {
        this.timer -= dt;
        this.v *= Math.max(0, 1 - 0.7 * dt);
        if (this.timer <= 0) this.state = 'run';
      } else {
        const go = ctl.pedal && race.started;
        let target = 0;
        if (go) {
          const up = Math.max(0, sm.grade), dn = Math.max(0, -sm.grade);
          const slopeF = clamp(1 - up * 2.0 - dn * 0.6, 0.45, 1.1);
          const obF = ob ? (ob.type === 'stairs' ? 0.5 : ob.type === 'barriers' ? 0.7 : 0.85) : 1;
          target = RUN_SPEED * surf.run * slopeF * obF * (ctl.sprint ? 1.2 : 1) * fatigue * busy * (0.9 + 0.1 * this.powerMul);
        }
        if (ctl.brake) target = 0;
        const acc = this.v < target ? 2.5 : 4;
        this.v += clamp(target - this.v, -acc * dt, acc * dt);
        effort = go ? (ctl.sprint ? 1.4 : 1.0) : 0.2;
        this.power = 0;
      }
      this.steerVal += clamp(footSteer - this.steerVal, -5 * dt, 5 * dt);
      omega = this.v * sm.k + this.steerVal * 2.0;
      this.lean -= Math.sign(this.lean) * Math.min(Math.abs(this.lean), 3 * dt);
      this.leanMiss = 0; this.leanReq = 0;
      this.slip = 0;
      this.balance = Math.min(100, this.balance + 30 * dt);
    }

    this.omega = omega;
    this.carry = this.onFoot && !!ob && (ob.mustRun || ob.type === 'logs');

    // Heading & position in track frame.
    this.psi += (omega - this.v * sm.k) * dt;
    if (this.isPlayer) {
      const riding = this.state === 'ride' || this.state === 'mount';
      const settled = riding ? Math.abs(this.lean - this.leanReq) < 0.06 : !footSteer;
      this.psi -= this.psi * (settled ? 2.2 : 0.4) * dt;
    }
    this.psi = clamp(this.psi, -1.0, 1.0);
    const lim = c.halfWidth - 0.35;
    this.x += this.v * Math.sin(this.psi) * dt;
    if (Math.abs(this.x) > lim) {
      const lateral = this.v * Math.abs(Math.sin(this.psi));
      this.x = Math.sign(this.x) * lim;
      if (this.state === 'ride' && lateral > 3.2) { this.fall(race, 'Tangled in the course tape!'); return; }
      this.psi *= 0.3;
      this.v *= Math.max(0, 1 - 1.5 * dt);
    }
    this.d += this.v * Math.cos(this.psi) * dt;

    // Animation phases.
    if (this.state === 'ride' || this.state === 'mount') this.crank += (this.power > 0 ? 1 : 0) * (this.v / 2.1) * dt * 2;
    this.runPhase += this.v * dt * 2.4;

    // Energy & hydration (only once racing).
    if (race.started) {
      this.energy -= race.energyRate * effort * dt;
      this.hydration -= race.hydRate * (0.6 + 0.4 * effort) * dt;
      if (this.isPlayer) {
        if (this.energy <= 0) { this.energy = 0; this.dnf(race, 'Ran out of energy and collapsed! Eat before the warning runs out.'); return; }
        if (this.hydration <= 0) { this.hydration = 0; this.dnf(race, 'Dehydrated and collapsed! Drink before the warning runs out.'); return; }
      } else {
        // Computer riders refuel automatically.
        if (this.energy < 30) this.energy += 50;
        if (this.hydration < 30) this.hydration += 50;
      }
    }

    if (this.d >= race.totalDistance && !this.done) {
      this.state = 'finished';
      this.finishTime = race.time;
      race.emit(this, 'finish');
    }
  }
}
