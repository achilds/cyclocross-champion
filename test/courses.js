// Course geometry checker: track clearance, sharp turns, and what sits on them.
import { LEVELS } from '../js/config.js';
import { Course } from '../js/course.js';
let bad = 0;
for (const [li, L] of LEVELS.entries()) {
  const c = new Course(L);
  const need = 2 * c.halfWidth + 2.5;
  let minD = Infinity, where = null;
  for (let i = 0; i < c.N; i += 2) for (let j = i + 1; j < c.N; j += 2) {
    const arc = Math.min(j - i, c.N - (j - i)) * c.ds;
    if (arc < 30) continue;
    const d = Math.hypot(c.px[i] - c.px[j], c.pz[i] - c.pz[j]);
    if (d < minD) { minD = d; where = [i / c.N, j / c.N]; }
  }
  // sharp turn ranges
  const turns = []; let start = -1;
  for (let i = 0; i <= c.N; i++) {
    const sharp = i < c.N && Math.abs(c.k[i]) > 0.08;
    if (sharp && start < 0) start = i;
    if (!sharp && start >= 0) { turns.push([start / c.N, i / c.N, Math.max(...Array.from(c.k.slice(start, i)).map(Math.abs))]); start = -1; }
  }
  const ok = minD >= need;
  if (!ok) bad++;
  console.log(`L${li + 1} ${L.name}: lap ${c.length.toFixed(0)}m, clearance ${minD.toFixed(1)}m (need ${need.toFixed(1)}) ${ok ? 'OK' : 'TOO CLOSE at ' + where.map((f) => f.toFixed(3)).join('/')}, maxK ${Math.max(...c.k.map(Math.abs)).toFixed(3)}, sharp turns ${turns.length}`);
  console.log('   turns: ' + turns.map(([a, b, k]) => `${a.toFixed(2)}-${b.toFixed(2)}(r${(1 / k).toFixed(0)})`).join(' '));
  const kIn = (a, b) => { let m = 0; for (let i = Math.floor(a * c.N); i < b * c.N; i++) m = Math.max(m, Math.abs(c.k[i % c.N])); return m; };
  for (const o of c.obstacles) { const k = kIn(o.s0 / c.length, o.s1 / c.length); if (k > 0.05) { console.log(`   ! ${o.type} at ${(o.s0 / c.length).toFixed(2)} is on a turn (k=${k.toFixed(2)})`); bad++; } }
  for (const cb of L.cambers || []) { const k = kIn(cb.from, cb.to); if (k > 0.08) console.log(`   ~ camber ${cb.from}-${cb.to} has turn k=${k.toFixed(2)}`); }
}
process.exit(bad ? 1 : 0);
