// Headless race simulation: a bot plays every level, checks the courses are sane.
import { LEVELS } from '../js/config.js';
import { Race } from '../js/race.js';

const setups = {
  cx: { bike: 'cx', tire: 'mud', shoes: 'clipless', gender: 'woman' },
  road: { bike: 'road', tire: 'road', shoes: 'clipless', gender: 'man' },
  mtb: { bike: 'mtb', tire: 'mountain', shoes: 'flats', gender: 'man' },
};
let failures = 0;
for (let li = 0; li < LEVELS.length; li++) {
  for (const [label, setup] of Object.entries(setups)) {
    const race = new Race(li, setup);
    const c = race.course;
    const maxK = Math.max(...c.k.map(Math.abs)), maxG = Math.max(...c.grade), minG = Math.min(...c.grade);
    const p = race.player;
    const counts = {};
    const dt = 1 / 60;
    while (!p.done && race.time < 1500) {
      const ctl = race.aiControl(p, dt);
      ctl.balanceTaps = p.balance < 60 && Math.random() < 0.4 ? 1 : 0;
      ctl.eat = p.energy < 35; ctl.drink = p.hydration < 35;
      race.update(dt, ctl);
    }
    for (const e of race.events) if (e.racer === p && (e.type === 'fall' || e.type === 'dnf')) counts[e.text] = (counts[e.text] || 0) + 1;
    const pos = race.positionOf(p);
    const aiFalls = race.events.filter((e) => e.racer && e.racer !== p && e.type === 'fall').length;
    console.log(`L${li + 1} ${LEVELS[li].name.padEnd(20)} ${label.padEnd(4)} lap=${c.length.toFixed(0)}m kmax=${maxK.toFixed(3)} grade=[${minG.toFixed(2)},${maxG.toFixed(2)}] ` +
      `state=${p.state} t=${race.time.toFixed(0)}s pos=${pos}/${race.racers.length} E=${p.energy.toFixed(0)} H=${p.hydration.toFixed(0)} gels=${p.gels} bottles=${p.bottles} aiFalls=${aiFalls}`);
    for (const [k, v] of Object.entries(counts)) console.log('     ', v, 'x', k);
    if (p.state !== 'finished' && label === 'cx') failures++;
  }
}
process.exit(failures ? 1 : 0);
