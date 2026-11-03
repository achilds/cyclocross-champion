// Can a player using on/off arrow keys (with human reaction lag) get round the corners?
import { LEVELS } from '../js/config.js';
import { Race } from '../js/race.js';
const lagSteps = 9; // 0.15s
for (let li = 0; li < LEVELS.length; li++) {
  const race = new Race(li, { bike: 'cx', tire: 'mud', shoes: 'clipless' });
  const p = race.player, dt = 1 / 60, queue = [];
  while (!p.done && race.time < 900) {
    const ai = race.aiControl(p, dt);
    // Decide keys from what the rider saw `lag` ago.
    queue.push(ai.leanTarget ?? 0);
    const target = queue.length > lagSteps ? queue.shift() : 0;
    const diff = target - p.lean;
    const ctl = { ...ai, leanTarget: undefined, lean: Math.abs(diff) > 0.07 ? Math.sign(diff) : 0,
      balanceTaps: p.balance < 60 && Math.random() < 0.3 ? 1 : 0, eat: p.energy < 35, drink: p.hydration < 35 };
    race.update(dt, ctl);
  }
  const falls = {};
  for (const e of race.events) if (e.racer === p && (e.type === 'fall' || e.type === 'dnf')) falls[e.text.slice(0, 50)] = (falls[e.text.slice(0, 50)] || 0) + 1;
  console.log(`L${li + 1} ${p.state} t=${race.time.toFixed(0)}s pos=${race.positionOf(p)}/${race.racers.length}`, falls);
}
