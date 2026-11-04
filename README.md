# Cyclocross Champion

A 3D cyclocross racing game that runs in the browser. Race computer riders over five
courses that get harder each time, with mud, sand, gravel, roots, barriers, stairs, logs,
hills, hairpin serpentines and off-camber slopes.

## Play

```bash
python3 -m http.server 8000      # or: npm start
```
Open http://localhost:8000. Because it uses ES modules, the page has to be served over http.
Opening `index.html` directly as a file won't work. Three.js is included in `vendor/`, so it
works offline.

## Controls

| Key | Action |
|-----|--------|
| W / ↑ | Pedal (run when on foot) |
| Shift | Sprint (faster, burns more energy) |
| ← → / A D | Lean. Leaning is how you turn. Match the green zone on the lean gauge in corners: too upright or too far over and you slide out |
| ↓ / S | Brake (front and rear together) |
| Space | Jump off / back on the bike |
| B | Balance: mash it in sand, mud, gravel, roots |
| E / Q | Eat a gel / drink |
| C | Cheer on a nearby rider (you both gain a little energy) |
| M | Music on / off |
| Esc | Pause |

Riding into another rider, or into a rider who has crashed in front of you, makes you crash
and lose energy. Finish in the top 3 to unlock the next course. Progress and your racer are saved in localStorage.

## Credits and licenses

The code is under the MIT License (see `LICENSE`). The music in `assets/music/` is not covered by
the MIT License:

- "Pit Fighter" (menus) and "Race to Mars" (races) by [DOS-88](https://dos88.bandcamp.com/), from the
  album *Retrograde Motion*. "Race to Mars": https://dos88.bandcamp.com/track/race-to-mars-2.
  Licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The tracks are unmodified.
- Three.js (`vendor/`) is under the MIT License.

## Code layout

| File | What it does |
|------|--------------|
| `js/config.js` | All tuning data: surfaces, bikes, tires, shoes, the 5 courses |
| `js/course.js` | Builds a course from control points: spline, elevation, surfaces, obstacles |
| `js/racer.js` | Rider physics shared by player and AI (power, grip, brakes, balance, energy, falls) |
| `js/race.js` | Race state, AI riders, cheering, collisions, standings |
| `js/models.js` | 3D rider and bike built from primitives, with animated poses |
| `js/world.js` | Terrain, track, tape, obstacles, trees, crowds, start arch |
| `js/main.js` | Menus, garage, input, game loop, chase camera, HUD, minimap, results |

`course.js`, `racer.js` and `race.js` don't touch the DOM or Three.js, so they can run in Node.

### Adding a course
Add an entry to `LEVELS` in `js/config.js`: closed-loop `points` (meters; `serp()` makes a
chain of hairpins), `hills`, surface `sections`, `cambers` (sideways slopes) and `obstacles`
(positions given as a fraction of a lap). Then run `node test/courses.js` to check that the
track doesn't overlap itself and that no obstacle sits on a turn, and `npm test` to check
that a bot can finish it.

## Tests

```bash
npm test                 # bot races every course with 3 bike setups and reports results
node test/courses.js     # track clearance, sharp-turn map, obstacles not on turns
node test/keyboard.js    # bot using on/off lean keys with reaction lag can get round
node test/shot.mjs "http://127.0.0.1:8000/?race=1&bot=1&skip=20" out.png 8000   # headless Chrome screenshot
```
Debug URL options: `?race=N` jumps straight into course N (0-4), `&bot=1` lets the AI ride for you,
`&skip=S` fast-forwards S seconds, `&at=M` puts you M meters into the lap, `?screen=garage` opens a menu screen.
