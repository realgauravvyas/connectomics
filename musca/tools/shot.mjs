/* Screenshot + interaction harness for MUSCA.
   Drives headless Chrome over the DevTools protocol so we can wait for the
   28 MB of connectome data to actually finish loading, poke the brain, and
   capture what it looks like.

   node tools/shot.mjs <url> <outDir> [--shot name:jsToRunBefore:waitMs ...]
*/
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9333;
const URL_ = process.argv[2] || 'http://127.0.0.1:8123/';
const OUT = process.argv[3] || './_shots';
mkdirSync(OUT, { recursive: true });

const chrome = spawn(CHROME, [
  '--headless=new', '--enable-unsafe-swiftshader', '--no-sandbox',
  '--hide-scrollbars', '--mute-audio', '--window-size=1600,950',
  // needed when URL_ is a file:// URL: ES modules are otherwise blocked by CORS
  '--allow-file-access-from-files',
  `--remote-debugging-port=${PORT}`, '--user-data-dir=' + join(tmpdir(), 'musca-shot-profile'),
  'about:blank',
], { stdio: 'ignore' });

const j = async (p) => (await fetch(`http://127.0.0.1:${PORT}${p}`)).json();

let version = null;
for (let i = 0; i < 60; i++) {
  try { version = await j('/json/version'); break; } catch { await sleep(400); }
}
if (!version) { chrome.kill(); throw new Error('chrome did not start'); }

const target = await j('/json/new?about:blank').catch(async () => (await fetch(
  `http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json());

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => { ws.onopen = r; });

let id = 0;
const pending = new Map();
const logs = [];
ws.onclose = () => {
  for (const [n, p] of pending) { p({ __closed: true }); pending.delete(n); }
};
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.consoleAPICalled') {
    logs.push('console.' + m.params.type + ': ' + m.params.args.map((a) => a.value ?? a.description ?? a.type).join(' '));
  }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    logs.push('EXCEPTION: ' + (d.exception?.description || d.text));
  }
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
    logs.push('LOG: ' + m.params.entry.text);
  }
};

// every request is bounded, so a wedged renderer can never hang the harness
const send = (method, params = {}, timeoutMs = 45000) => new Promise((res) => {
  const n = ++id;
  const timer = setTimeout(() => { pending.delete(n); res({ __timeout: method }); }, timeoutMs);
  pending.set(n, (m) => { clearTimeout(timer); res(m); });
  ws.send(JSON.stringify({ id: n, method, params }));
});

const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.__timeout || r.__closed) return { error: r.__timeout || 'socket closed' };
  if (r.result?.exceptionDetails) return { error: r.result.exceptionDetails.text };
  return r.result?.result?.value;
};

const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' }, 90000);
  if (!r.result?.data) { console.log('  ! screenshot failed for', name); return false; }
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.result.data, 'base64'));
  console.log('  saved', name + '.png');
  return true;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Log.enable');
await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Page.setCacheDisabled', { cacheDisabled: true }).catch(() => {});

console.log('→ loading', URL_);
await send('Page.navigate', { url: URL_ });

let ready = false;
for (let i = 0; i < 150; i++) {
  await sleep(500);
  const v = await evaluate('!!window.__muscaReady');
  if (v === true) { ready = true; break; }
  if (i % 10 === 0) {
    const msg = await evaluate('document.getElementById("bootMsg")?.textContent');
    console.log(`  …${i / 2}s  ${msg ?? ''}`);
  }
}
console.log(ready ? '✓ app ready' : '✗ app never became ready');
await sleep(2500);

const script = process.argv.slice(4);
const steps = script.length ? script : ['atlas::1500'];

for (const s of steps) {
  const [name, js = '', waitMs = '1500'] = s.split('::');
  if (js.trim()) {
    const r = await evaluate(js);
    if (r && r.error) console.log('  ! eval error:', r.error);
  }
  await sleep(+waitMs);
  await shot(name);
}

if (logs.length) {
  console.log('\n--- browser log ---');
  for (const l of logs.slice(0, 40)) console.log(' ', l);
} else {
  console.log('\n(no console output)');
}

ws.close();
chrome.kill();
process.exit(0);
