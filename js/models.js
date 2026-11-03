// 3D rider + bike models built from simple primitives, with procedural poses.
// Local frame: rider faces +Z, +Y up, rider's right side is -X.
import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const FWD = new THREE.Vector3(0, 0, 1);
const _t = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3();

const matCache = new Map();
function mat(color, rough = 0.7, metal = 0) {
  const key = color + rough + metal;
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal }));
  return matCache.get(key);
}

const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 8);
const sphGeo = new THREE.SphereGeometry(1, 12, 10);

// Cylinder of unit height, stretched between two points each frame.
class Limb extends THREE.Mesh {
  constructor(radius, material, radius2) {
    super(radius2 ? new THREE.CylinderGeometry(radius2, radius, 1, 8) : cylGeo, material);
    if (!radius2) this.r = radius; else this.r = 1;
    this.castShadow = true;
  }
  set(a, b) {
    _t.subVectors(b, a);
    const len = _t.length() || 1e-3;
    this.position.copy(a).addScaledVector(_t, 0.5);
    this.scale.set(this.r, len, this.r);
    this.quaternion.setFromUnitVectors(UP, _t.divideScalar(len));
    return this;
  }
}

function ball(r, material) {
  const m = new THREE.Mesh(sphGeo, material);
  m.scale.setScalar(r);
  m.castShadow = true;
  return m;
}

// Two-bone IK: returns the middle joint for a limb from a to c, bending toward `bend`.
function ik(a, c, l1, l2, bend, out) {
  _a.subVectors(c, a);
  let d = _a.length();
  d = Math.min(d, l1 + l2 - 1e-3);
  _a.normalize();
  const along = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - along * along));
  _b.copy(bend).addScaledVector(_a, -bend.dot(_a)).normalize();
  return out.copy(a).addScaledVector(_a, along).addScaledVector(_b, h);
}

const TIRE_WIDTH = { road: 0.022, gravel: 0.03, mountain: 0.048, mud: 0.04 };

export function buildBike(setup) {
  const g = new THREE.Group();
  const type = setup.bike;
  const frame = mat(setup.bikeColor || '#e63946', 0.35, 0.3);
  const black = mat('#151515', 0.9);
  const metal = mat('#9a9a9a', 0.3, 0.8);
  const tw = TIRE_WIDTH[setup.tire] * (type === 'mtb' ? 1.25 : 1);
  const R = type === 'mtb' ? 0.37 : 0.34;
  const tubeR = type === 'mtb' ? 0.028 : type === 'road' ? 0.018 : 0.022;

  const wheels = [];
  const makeWheel = (z) => {
    const w = new THREE.Group();
    const tire = new THREE.Mesh(new THREE.TorusGeometry(R - tw, tw, 8, 28), black);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(R - tw * 2 - 0.012, 0.012, 6, 28), metal);
    tire.castShadow = true;
    w.add(tire, rim);
    for (let i = 0; i < 6; i++) {
      const sp = new THREE.Mesh(cylGeo, metal);
      sp.scale.set(0.004, (R - tw * 2) * 2, 0.004);
      sp.rotation.z = (i / 6) * Math.PI;
      w.add(sp);
    }
    const holder = new THREE.Group();
    holder.position.set(0, R, z);
    w.rotation.y = Math.PI / 2;
    holder.add(w);
    g.add(holder);
    wheels.push(w);
    return holder;
  };
  makeWheel(-0.5);
  const front = makeWheel(0.52);

  const P = (x, y, z) => new THREE.Vector3(x, y, z);
  const BB = P(0, 0.3, -0.06), S = P(0, 0.93, -0.24), H = P(0, 0.92, 0.36), Hb = P(0, 0.76, 0.41);
  const RA = P(0, R, -0.5), FA = P(0, R, 0.52);
  const tube = (a, b, r, m = frame) => g.add(new Limb(r, m).set(a, b));
  tube(BB, S, tubeR);
  tube(S, H, tubeR);
  tube(BB, Hb, tubeR * 1.2);
  tube(P(0.05, BB.y, BB.z), P(0.05, RA.y, RA.z), tubeR * 0.7);
  tube(P(-0.05, BB.y, BB.z), P(-0.05, RA.y, RA.z), tubeR * 0.7);
  tube(P(0.05, S.y - 0.05, S.z), P(0.05, RA.y, RA.z), tubeR * 0.6);
  tube(P(-0.05, S.y - 0.05, S.z), P(-0.05, RA.y, RA.z), tubeR * 0.6);
  tube(Hb, H, tubeR * 1.1);
  // Fork (thicker suspension fork on MTB)
  const forkR = type === 'mtb' ? 0.03 : 0.016;
  tube(P(0.05, Hb.y, Hb.z), P(0.05, FA.y, FA.z), forkR, type === 'mtb' ? metal : frame);
  tube(P(-0.05, Hb.y, Hb.z), P(-0.05, FA.y, FA.z), forkR, type === 'mtb' ? metal : frame);
  // Seatpost + saddle
  tube(S, P(0, 1.0, -0.27), 0.013, metal);
  const saddle = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.04, 0.26), black);
  saddle.position.set(0, 1.02, -0.25);
  g.add(saddle);
  // Stem + bars
  const barY = type === 'mtb' ? 1.0 : 0.97, barZ = 0.45;
  tube(H, P(0, barY, barZ), 0.016, black);
  const barW = type === 'mtb' ? 0.36 : 0.21;
  tube(P(-barW, barY, barZ), P(barW, barY, barZ), 0.013, black);
  if (type !== 'mtb') {
    for (const sx of [-1, 1]) {
      tube(P(sx * barW, barY, barZ), P(sx * barW, barY - 0.1, barZ + 0.1), 0.012, black);
      tube(P(sx * barW, barY - 0.1, barZ + 0.1), P(sx * barW, barY - 0.15, barZ + 0.02), 0.012, black);
    }
  }
  // Cranks + chainring
  const crank = new THREE.Group();
  crank.position.copy(BB);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.008, 6, 20), metal);
  ring.rotation.y = Math.PI / 2;
  ring.position.x = -0.06;
  crank.add(ring);
  g.add(crank);

  g.userData = { wheels, front, R, barY, barZ, barW, BB };
  return g;
}

export class RiderModel {
  constructor(setup) {
    this.setup = setup;
    this.root = new THREE.Group();
    this.tilt = new THREE.Group();
    this.root.add(this.tilt);
    this.bike = buildBike(setup);
    this.tilt.add(this.bike);
    this.body = new THREE.Group();
    this.tilt.add(this.body);

    const woman = setup.gender === 'woman';
    this.shoulderW = woman ? 0.16 : 0.2;
    const jersey = mat(setup.jersey || '#3a86ff', 0.8);
    const shorts = mat(setup.shorts || '#111111', 0.8);
    const skin = mat(setup.skin || '#e8b796', 0.75);
    const helmet = mat(setup.helmet || '#ffffff', 0.4, 0.1);
    const shoe = mat(setup.shoes === 'flats' ? '#5a5a5a' : '#f1f1f1', 0.6);
    const dark = mat('#111', 0.3, 0.2);

    const B = this.body;
    this.torso = new Limb(0.12, jersey, woman ? 0.13 : 0.15);
    B.add(this.torso);
    this.pelvis = ball(0.13, shorts); B.add(this.pelvis);
    this.head = new THREE.Group(); B.add(this.head);
    this.head.add(ball(0.105, skin));
    const helm = new THREE.Mesh(new THREE.SphereGeometry(0.125, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), helmet);
    helm.scale.set(1, 1, 1.25);
    helm.position.y = 0.015;
    helm.castShadow = true;
    this.head.add(helm);
    const glasses = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.04, 0.03), dark);
    glasses.position.set(0, 0.01, 0.095);
    this.head.add(glasses);
    if (woman) {
      const tail = new Limb(0.035, mat(setup.hair || '#5b3a1e', 0.9), 0.015);
      tail.set(new THREE.Vector3(0, 0.0, -0.11), new THREE.Vector3(0, -0.17, -0.17));
      this.head.add(tail);
    }
    const limbs = (upperMat, lowerMat, r1, r2) => ({ upper: new Limb(r1, upperMat), lower: new Limb(r2, lowerMat), joint: ball(r2 * 1.05, lowerMat) });
    this.legs = [limbs(shorts, skin, 0.075, 0.05), limbs(shorts, skin, 0.075, 0.05)];
    this.arms = [limbs(jersey, skin, 0.045, 0.035), limbs(jersey, skin, 0.045, 0.035)];
    this.feet = [];
    for (const l of [...this.legs, ...this.arms]) B.add(l.upper, l.lower, l.joint);
    for (let i = 0; i < 2; i++) {
      const f = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.07, 0.24), shoe);
      f.castShadow = true;
      B.add(f);
      this.feet.push(f);
    }
    this.hands = [ball(0.04, skin), ball(0.04, skin)];
    B.add(...this.hands);

    this.v = {
      hipL: new THREE.Vector3(), hipR: new THREE.Vector3(), sh: new THREE.Vector3(), shL: new THREE.Vector3(), shR: new THREE.Vector3(),
      footL: new THREE.Vector3(), footR: new THREE.Vector3(), handL: new THREE.Vector3(), handR: new THREE.Vector3(),
      knee: new THREE.Vector3(), elbow: new THREE.Vector3(), hip: new THREE.Vector3(), neck: new THREE.Vector3(),
    };
    this.bendKnee = new THREE.Vector3(0, 0.3, 1);
    this.root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  }

  _leg(i, hip, foot) {
    const L = this.legs[i];
    const knee = ik(hip, foot, 0.47, 0.47, this.bendKnee, this.v.knee);
    L.upper.set(hip, knee); L.lower.set(knee, foot); L.joint.position.copy(knee);
    this.feet[i].position.copy(foot).add(_t.set(0, 0.0, 0.05));
  }

  _arm(i, sh, hand, bend) {
    const A = this.arms[i];
    const elbow = ik(sh, hand, 0.3, 0.3, bend, this.v.elbow);
    A.upper.set(sh, elbow); A.lower.set(elbow, hand); A.joint.position.copy(elbow);
    this.hands[i].position.copy(hand);
  }

  // r: racer state from the simulation; dt for wheel spin.
  update(r, dt) {
    const v = this.v, ud = this.bike.userData;
    for (const w of ud.wheels) w.rotation.z += (r.v / ud.R) * dt; // top of wheel rolls forward
    ud.front.rotation.y = r.steerVal * 0.25;

    const onFoot = r.state === 'run' || r.state === 'dismount';
    const fallen = r.state === 'fallen' || r.state === 'dnf';
    const raise = r.cheering > 0;
    const eat = r.eating > 0 || r.drinking > 0;

    if (!onFoot) {
      // ----- Riding pose -----
      this.bike.position.set(0, 0, 0);
      this.bike.rotation.set(0, 0, 0);
      const crouch = r.braking ? -0.03 : 0;
      const stand = r.state === 'ride' && r.power > 450 ? 0.12 : 0; // stand to sprint
      v.hip.set(0, 1.04 + stand, -0.2 + stand * 0.5);
      v.hipL.set(0.09, v.hip.y, v.hip.z); v.hipR.set(-0.09, v.hip.y, v.hip.z);
      v.neck.set(0, 1.42 + crouch + stand * 0.8, 0.14 + stand * 0.3);
      const a = r.crank, BB = ud.BB, cr = 0.17;
      // Forward pedaling: foot goes front -> bottom -> back -> top.
      v.footR.set(-0.11, BB.y - Math.sin(a) * cr, BB.z + Math.cos(a) * cr);
      v.footL.set(0.11, BB.y + Math.sin(a) * cr, BB.z - Math.cos(a) * cr);
      if (r.state === 'mount') { v.footL.set(0.25, 0.25, -0.1); v.hip.y += 0.05; }
      v.handL.set(ud.barW, ud.barY, ud.barZ); v.handR.set(-ud.barW, ud.barY, ud.barZ);
      this.bendKnee.set(0, 0.35, 1);
    } else {
      // ----- Running beside the bike (left side), carrying it over obstacles -----
      const ph = r.runPhase, carry = r.carry ? 0.55 : 0;
      this.bike.position.set(r.carry ? 0.15 : 0, carry, 0);
      this.bike.rotation.set(0, 0, r.carry ? -0.1 : 0);
      const bob = Math.abs(Math.sin(ph)) * 0.05 * Math.min(1, r.v);
      const ox = 0.55;
      v.hip.set(ox, 0.95 + bob, 0.0);
      v.hipL.set(ox + 0.09, v.hip.y, 0); v.hipR.set(ox - 0.09, v.hip.y, 0);
      v.neck.set(ox, 1.45 + bob, 0.1);
      const stride = Math.min(0.38, 0.12 * r.v);
      v.footL.set(ox + 0.1, 0.05 + Math.max(0, Math.cos(ph)) * 0.2 * Math.min(1, r.v), Math.sin(ph) * stride + 0.03);
      v.footR.set(ox - 0.1, 0.05 + Math.max(0, -Math.cos(ph)) * 0.2 * Math.min(1, r.v), -Math.sin(ph) * stride + 0.03);
      v.handR.set(0.08, ud.barY + carry - 0.02, ud.barZ - 0.05);
      v.handL.set(ox + 0.25, 1.0 + bob, 0.1 + Math.sin(ph + Math.PI) * 0.18);
      if (r.carry) v.handL.set(0.15, 0.95 + carry, -0.05);
      this.bendKnee.set(0, 0.1, 1);
    }
    if (raise) v.handL.set(v.neck.x + 0.2, v.neck.y + 0.45, v.neck.z + 0.05);
    if (eat) v.handR.set(v.neck.x - 0.05, v.neck.y + 0.08, v.neck.z + 0.12);

    v.shL.set(v.neck.x + this.shoulderW, v.neck.y - 0.03, v.neck.z);
    v.shR.set(v.neck.x - this.shoulderW, v.neck.y - 0.03, v.neck.z);
    this.torso.set(v.hip, v.neck);
    this.pelvis.position.copy(v.hip);
    this.head.position.set(v.neck.x, v.neck.y + 0.15, v.neck.z + (onFoot ? 0.03 : 0.1));
    this._leg(0, v.hipL, v.footL);
    this._leg(1, v.hipR, v.footR);
    this._arm(0, v.shL, v.handL, _a.set(0.6, -0.4, -0.7));
    this._arm(1, v.shR, v.handR, _b.set(-0.6, -0.4, -0.7));

    // Crash: lie the whole thing on its side.
    const targetRoll = fallen ? 1.35 : 0;
    this.fallRoll = (this.fallRoll || 0) + (targetRoll - (this.fallRoll || 0)) * Math.min(1, dt * 8);
  }
}

// Floating name label (canvas sprite).
export function makeLabel(text, color = '#fff', bg = 'rgba(0,0,0,0.55)') {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const ctx = c.getContext('2d');
  const draw = (t, col = color) => {
    ctx.clearRect(0, 0, 256, 64);
    ctx.font = 'bold 30px system-ui, sans-serif';
    const w = Math.min(250, ctx.measureText(t).width + 24);
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.roundRect(128 - w / 2, 10, w, 44, 14);
    ctx.fill();
    ctx.fillStyle = col;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(t, 128, 33);
    tex.needsUpdate = true;
  };
  const tex = new THREE.CanvasTexture(c);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true, sizeAttenuation: false }));
  sprite.scale.set(0.12, 0.03, 1);
  sprite.userData.draw = draw;
  draw(text);
  return sprite;
}

export { FWD };
