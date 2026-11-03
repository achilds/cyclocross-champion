// Headless Chrome screenshot + console error capture via the DevTools protocol.
// usage: node test/shot.mjs <url> <out.png> [waitMs] [keys...]
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const [url, out, waitMs = '2500', ...keys] = process.argv.slice(2);
const port = 9333 + Math.floor(Math.random() * 500);
const chrome = spawn('google-chrome', ['--headless=new', `--remote-debugging-port=${port}`, '--window-size=1280,760', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-first-run', '--user-data-dir=' + process.cwd() + '/.tmp/chrome-' + port, 'about:blank'], { stdio: 'ignore', env: { ...process.env, TMPDIR: process.cwd() + '/.tmp' } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
for (let i = 0; i < 150; i++) { try { const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); const pg = list.find((t) => t.type === 'page'); if (pg) { ws = new WebSocket(pg.webSocketDebuggerUrl); break; } } catch {} await sleep(200); }
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pending = new Map();
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const logs = [];
ws.addEventListener('message', (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d.result ?? d.error); pending.delete(d.id); }
  if (d.method === 'Runtime.consoleAPICalled') logs.push(`[${d.params.type}] ` + d.params.args.map((a) => a.value ?? a.description).join(' '));
  if (d.method === 'Runtime.exceptionThrown') logs.push('[exception] ' + (d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text));
  if (d.method === 'Log.entryAdded' && d.params.entry.level === 'error') logs.push('[log] ' + d.params.entry.text + ' ' + (d.params.entry.url || ''));
});
await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
await send('Page.navigate', { url });
await sleep(+waitMs);
if (process.env.EVAL) { await send('Runtime.evaluate', { expression: process.env.EVAL }); await sleep(+(process.env.EVAL_WAIT || 1500)); }
for (const k of keys) {
  const [code, ms] = k.split(':');
  const key = code.startsWith('Key') ? code.slice(3).toLowerCase() : code === 'Space' ? ' ' : code;
  await send('Input.dispatchKeyEvent', { type: 'keyDown', code, key });
  await sleep(+ms || 100);
  await send('Input.dispatchKeyEvent', { type: 'keyUp', code, key });
}
const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(out, Buffer.from(shot.data, 'base64'));
const fps = await send('Runtime.evaluate', { expression: 'JSON.stringify((()=>{const r=window.__ccc&&window.__ccc.race; return r? {t:r.time.toFixed(1), state:r.player.state, d:r.player.d.toFixed(0), v:r.player.v.toFixed(1)}:null})())', returnByValue: true });
console.log('state:', fps.result?.value);
console.log(logs.join('\n') || '(no console errors)');
ws.close(); chrome.kill();
process.exit(0);
