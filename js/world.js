// Builds the 3D scenery for a course: terrain, track, tape, obstacles, trees, crowds, arch.
import * as THREE from 'three';
import { SURFACES } from './config.js';

const rand = (a, b) => a + Math.random() * (b - a);

function yawAcross(c, i) {
  // Rotation so a mesh's local +X lies along the track normal.
  return Math.atan2(-c.nz[i], c.nx[i]);
}

export function buildWorld(course, scene) {
  const group = new THREE.Group();
  scene.add(group);
  const hw = course.halfWidth;

  // ---------- Terrain ----------
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, minH = Infinity;
  for (let i = 0; i < course.N; i++) {
    minX = Math.min(minX, course.px[i]); maxX = Math.max(maxX, course.px[i]);
    minZ = Math.min(minZ, course.pz[i]); maxZ = Math.max(maxZ, course.pz[i]);
    minH = Math.min(minH, course.h[i]);
  }
  const margin = 110, step = 2.5;
  const x0 = minX - margin, z0 = minZ - margin;
  const nx = Math.ceil((maxX - minX + 2 * margin) / step) + 1, nz = Math.ceil((maxZ - minZ + 2 * margin) / step) + 1;
  const pos = new Float32Array(nx * nz * 3), col = new Float32Array(nx * nz * 3);
  const grassA = new THREE.Color('#4f8a2f'), grassB = new THREE.Color('#79a843'), worn = new THREE.Color('#6b7a3a');
  const tmpC = new THREE.Color();
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = x0 + i * step, z = z0 + j * step;
    const n = course.nearest(x, z);
    const h = course.terrainHeight(x, z);
    const k = (j * nx + i) * 3;
    pos[k] = x; pos[k + 1] = h; pos[k + 2] = z;
    tmpC.copy(grassA).lerp(grassB, 0.5 + 0.5 * Math.sin(x * 0.07) * Math.cos(z * 0.05) * Math.random());
    if (n && n.d < hw + 3) tmpC.lerp(worn, 0.5);
    col[k] = tmpC.r; col[k + 1] = tmpC.g; col[k + 2] = tmpC.b;
  }
  const idx = [];
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const tg = new THREE.BufferGeometry();
  tg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  tg.setAttribute('color', new THREE.BufferAttribute(col, 3));
  tg.setIndex(idx);
  tg.computeVertexNormals();
  const terrain = new THREE.Mesh(tg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
  terrain.receiveShadow = true;
  group.add(terrain);

  const far = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshStandardMaterial({ color: '#4f8a2f', roughness: 1 }));
  far.rotation.x = -Math.PI / 2;
  far.position.set((minX + maxX) / 2, minH - 3, (minZ + maxZ) / 2);
  group.add(far);

  // ---------- Track ribbon ----------
  const offs = [-hw - 0.25, -hw * 0.5, 0, hw * 0.5, hw + 0.25];
  const lift = [0.0, 0.05, 0.05, 0.05, 0.0];
  const N = course.N, W = offs.length;
  const tp = new Float32Array((N + 1) * W * 3), tc = new Float32Array((N + 1) * W * 3);
  for (let ii = 0; ii <= N; ii++) {
    const i = ii % N;
    const S = SURFACES[course.surface[i]];
    for (let w = 0; w < W; w++) {
      const k = (ii * W + w) * 3;
      tp[k] = course.px[i] + course.nx[i] * offs[w];
      tp[k + 1] = course.h[i] + lift[w] + course.camber[i] * offs[w];
      tp[k + 2] = course.pz[i] + course.nz[i] * offs[w];
      let f = 0.85 + Math.random() * 0.3;
      if (course.surface[i] === 'mud' && Math.random() < 0.3) f *= 0.6;
      if (w === 0 || w === W - 1) f *= 0.8;
      tc[k] = S.color[0] * f; tc[k + 1] = S.color[1] * f; tc[k + 2] = S.color[2] * f;
    }
  }
  const ti = [];
  for (let ii = 0; ii < N; ii++) for (let w = 0; w < W - 1; w++) {
    const a = ii * W + w, b = a + 1, c = a + W, d = c + 1;
    ti.push(a, b, c, b, d, c);
  }
  const trg = new THREE.BufferGeometry();
  trg.setAttribute('position', new THREE.BufferAttribute(tp, 3));
  trg.setAttribute('color', new THREE.BufferAttribute(tc, 3));
  trg.setIndex(ti);
  trg.computeVertexNormals();
  const track = new THREE.Mesh(trg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2, side: THREE.DoubleSide }));
  track.receiveShadow = true;
  group.add(track);

  // ---------- Course tape + stakes ----------
  const stakeEvery = 4;
  const stakes = Math.floor(N / stakeEvery) * 2;
  const stakeMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.03, 0.03, 1, 5), new THREE.MeshStandardMaterial({ color: '#dddddd' }), stakes);
  const m4 = new THREE.Matrix4();
  const tapePos = [], tapeCol = [];
  const red = [0.9, 0.1, 0.1], white = [0.95, 0.95, 0.95];
  let si = 0;
  const stakePt = (i, side) => {
    const o = side * (hw + 0.35);
    return [course.px[i] + course.nx[i] * o, course.h[i] + course.camber[i] * o, course.pz[i] + course.nz[i] * o];
  };
  for (const side of [-1, 1]) {
    for (let k = 0; k < Math.floor(N / stakeEvery); k++) {
      const i = k * stakeEvery;
      const p = stakePt(i, side);
      m4.makeTranslation(p[0], p[1] + 0.5, p[2]);
      stakeMesh.setMatrixAt(si++, m4);
      const q = stakePt(((k + 1) * stakeEvery) % N, side);
      const c = k % 2 ? red : white;
      for (const [y0, y1] of [[0.78, 0.86]]) {
        const quad = [[p, y0], [q, y0], [q, y1], [p, y0], [q, y1], [p, y1]];
        for (const [pt, y] of quad) { tapePos.push(pt[0], pt[1] + y, pt[2]); tapeCol.push(...c); }
      }
    }
  }
  group.add(stakeMesh);
  const tapeGeo = new THREE.BufferGeometry();
  tapeGeo.setAttribute('position', new THREE.Float32BufferAttribute(tapePos, 3));
  tapeGeo.setAttribute('color', new THREE.Float32BufferAttribute(tapeCol, 3));
  group.add(new THREE.Mesh(tapeGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide })));

  // ---------- Obstacles ----------
  const wood = new THREE.MeshStandardMaterial({ color: '#9b7650', roughness: 0.9 });
  const plankMat = new THREE.MeshStandardMaterial({ color: '#f2f2f2', roughness: 0.6 });
  const logMat = new THREE.MeshStandardMaterial({ color: '#6b4a2b', roughness: 1 });
  const at = (s) => course.sample(s);
  const place = (mesh, s, y = 0) => {
    const sm = at(s);
    mesh.position.set(sm.x, sm.h + y, sm.z);
    mesh.rotation.y = yawAcross(course, sm.i);
    mesh.castShadow = true; mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };
  for (const ob of course.obstacles) {
    if (ob.type === 'barriers') {
      for (const off of [1, 5.5]) {
        const b = new THREE.Group();
        const plank = new THREE.Mesh(new THREE.BoxGeometry(hw * 2 + 0.4, 0.22, 0.05), plankMat);
        plank.position.y = 0.29;
        const stripe = new THREE.Mesh(new THREE.BoxGeometry(hw * 2 + 0.41, 0.05, 0.055), new THREE.MeshStandardMaterial({ color: '#e63946' }));
        stripe.position.y = 0.29;
        b.add(plank, stripe);
        for (const sx of [-1, 1]) {
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.42, 0.06), wood);
          post.position.set(sx * (hw + 0.15), 0.21, 0);
          b.add(post);
        }
        b.traverse((o) => { o.castShadow = true; });
        place(b, ob.s0 + off);
      }
    } else if (ob.type === 'stairs') {
      const steps = Math.round(ob.length);
      const base = at(ob.s0).h;
      const rise = ob.rise / steps;
      for (let k = 0; k < steps; k++) {
        const top = base + (k + 1) * rise;
        const sm = at(ob.s0 + k + 0.5);
        const hgt = top - (sm.h - 0.6);
        const st = new THREE.Mesh(new THREE.BoxGeometry(hw * 2, hgt, 1.0), k % 2 ? wood : new THREE.MeshStandardMaterial({ color: '#8a6845', roughness: 0.9 }));
        st.position.set(sm.x, top - hgt / 2, sm.z);
        st.rotation.y = yawAcross(course, sm.i);
        st.castShadow = st.receiveShadow = true;
        group.add(st);
      }
      // Handrails
      for (const side of [-1, 1]) {
        const a = at(ob.s0), b = at(ob.s1);
        const pa = new THREE.Vector3(a.x + a.nx * side * (hw + 0.1), a.h + 1.0, a.z + a.nz * side * (hw + 0.1));
        const pb = new THREE.Vector3(b.x + b.nx * side * (hw + 0.1), b.h + 1.0, b.z + b.nz * side * (hw + 0.1));
        const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, pa.distanceTo(pb), 6), wood);
        rail.position.copy(pa).add(pb).multiplyScalar(0.5);
        rail.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), pb.clone().sub(pa).normalize());
        group.add(rail);
      }
    } else if (ob.type === 'logs') {
      for (const off of [1, 3.5, 6]) {
        const g = new THREE.Group();
        const log = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, hw * 2 + 0.6, 10), logMat);
        log.rotation.z = Math.PI / 2;
        log.position.y = 0.16;
        log.castShadow = true;
        g.add(log);
        place(g, ob.s0 + off);
      }
    }
  }

  // ---------- Start / finish arch ----------
  {
    const sm = at(0);
    const arch = new THREE.Group();
    const postMat = new THREE.MeshStandardMaterial({ color: '#222' });
    for (const sx of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, 4, 0.3), postMat);
      post.position.set(sx * (hw + 0.8), 2, 0);
      arch.add(post);
    }
    const cv = document.createElement('canvas');
    cv.width = 1024; cv.height = 128;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#e63946'; ctx.fillRect(0, 0, 1024, 128);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 80px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('CYCLOCROSS CHAMPION', 512, 68);
    const banner = new THREE.Mesh(new THREE.BoxGeometry(hw * 2 + 1.9, 0.9, 0.2), [
      postMat, postMat, postMat, postMat,
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv) }),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv) }),
    ]);
    banner.position.y = 3.7;
    arch.add(banner);
    const ck = document.createElement('canvas');
    ck.width = 64; ck.height = 8;
    const cx = ck.getContext('2d');
    for (let i = 0; i < 16; i++) for (let j = 0; j < 2; j++) { cx.fillStyle = (i + j) % 2 ? '#111' : '#fff'; cx.fillRect(i * 4, j * 4, 4, 4); }
    const ckTex = new THREE.CanvasTexture(ck);
    ckTex.magFilter = THREE.NearestFilter;
    const line = new THREE.Mesh(new THREE.PlaneGeometry(hw * 2, 0.5), new THREE.MeshBasicMaterial({ map: ckTex, polygonOffset: true, polygonOffsetFactor: -4 }));
    line.rotation.x = -Math.PI / 2;
    line.position.y = 0.07;
    arch.add(line);
    place(arch, 0);
  }

  // ---------- Trees ----------
  const treeCount = 420;
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.18, 0.25, 1, 6), new THREE.MeshStandardMaterial({ color: '#5a3d22' }), treeCount);
  const crowns = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 8), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9 }), treeCount);
  const q = new THREE.Quaternion(), sc = new THREE.Vector3(), p3 = new THREE.Vector3();
  let placed = 0, tries = 0;
  while (placed < treeCount && tries++ < 8000) {
    const x = rand(x0, x0 + (nx - 1) * step), z = rand(z0, z0 + (nz - 1) * step);
    const n = course.nearest(x, z);
    if (n && n.d < hw + 7) continue;
    const y = course.terrainHeight(x, z);
    const hgt = rand(4, 9);
    m4.compose(p3.set(x, y + hgt * 0.25, z), q, sc.set(1, hgt * 0.5, 1));
    trunks.setMatrixAt(placed, m4);
    const cw = rand(1.4, 2.4);
    m4.compose(p3.set(x, y + hgt * 0.5 + hgt * 0.35, z), q, sc.set(cw, hgt * 0.75, cw));
    crowns.setMatrixAt(placed, m4);
    crowns.setColorAt(placed, tmpC.setHSL(rand(0.24, 0.33), rand(0.4, 0.6), rand(0.2, 0.32)));
    placed++;
  }
  trunks.count = crowns.count = placed;
  trunks.castShadow = crowns.castShadow = true;
  group.add(trunks, crowns);

  // ---------- Spectators ----------
  const fans = [];
  for (const cs of course.crowdS) {
    for (let k = 0; k < 26; k++) {
      const s = cs + rand(-16, 16), side = Math.random() < 0.5 ? -1 : 1;
      const sm = at(s);
      const off = side * (hw + rand(1.0, 4.0));
      const x = sm.x + sm.nx * off, z = sm.z + sm.nz * off;
      fans.push({ x, z, y: course.terrainHeight(x, z), phase: Math.random() * 6, s: course.wrap(s), h: rand(0.85, 1.1) });
    }
  }
  const bodies = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.2, 0.24, 1.1, 7), new THREE.MeshStandardMaterial({ roughness: 0.8 }), Math.max(1, fans.length));
  const heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.15, 8, 6), new THREE.MeshStandardMaterial({ roughness: 0.8 }), Math.max(1, fans.length));
  const skins = ['#f6d7c3', '#e8b796', '#c68a62', '#8d5a3b', '#5a3825'];
  fans.forEach((f, i) => {
    bodies.setColorAt(i, tmpC.setHSL(Math.random(), 0.7, 0.5));
    heads.setColorAt(i, tmpC.set(skins[i % skins.length]));
  });
  bodies.count = heads.count = fans.length;
  bodies.castShadow = true;
  group.add(bodies, heads);

  function update(time, player) {
    const ps = course.wrap(player.d);
    fans.forEach((f, i) => {
      let d = Math.abs(f.s - ps); d = Math.min(d, course.length - d);
      const excite = d < 30 ? 1 : 0.15;
      const jump = Math.abs(Math.sin(time * 7 + f.phase)) * 0.25 * excite;
      m4.compose(p3.set(f.x, f.y + 0.55 * f.h + jump, f.z), q, sc.set(1, f.h, 1));
      bodies.setMatrixAt(i, m4);
      m4.compose(p3.set(f.x, f.y + 1.25 * f.h + jump, f.z), q, sc.set(1, 1, 1));
      heads.setMatrixAt(i, m4);
    });
    bodies.instanceMatrix.needsUpdate = true;
    heads.instanceMatrix.needsUpdate = true;
  }

  function dispose() {
    scene.remove(group);
    group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { if (m.map) m.map.dispose(); m.dispose(); });
    });
  }

  return { group, update, dispose };
}
