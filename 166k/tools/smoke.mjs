/**
 * smoke.mjs — run the browser app headlessly against a stubbed DOM.
 *
 * There is no browser here, so we fake just enough of one to execute
 * main.js and render.js for real: element stubs, a recording WebGL context
 * and a manually pumped requestAnimationFrame. It will not tell us whether
 * the brain looks good, but it does catch the errors that matter most —
 * typos, wrong APIs, and crashes on the first thousand frames.
 *
 *   node tools/smoke.mjs [frames]
 */

const FRAMES = Number(process.argv[2] || 240);

// ------------------------------------------------------------- DOM stub
const noop = () => {};
function makeEl(id = '') {
  const el = {
    id,
    style: new Proxy({}, { set: () => true, get: () => '' }),
    dataset: {},
    value: '1',
    textContent: '',
    innerHTML: '',
    width: 800, height: 600, clientWidth: 800, clientHeight: 600,
    children: [],
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    _on: {},
    addEventListener(type, fn) { (this._on[type] ||= []).push(fn); },
    removeEventListener: noop,
    dispatchEvent: noop,
    setPointerCapture: noop,
    releasePointerCapture: noop,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    appendChild: noop,
    remove: noop,
    querySelector: () => makeEl(),
    // Hand back real stubs so code that wires up generated markup (region
    // rows, lesion buttons) is actually exercised. Recorded on the element
    // so the test can fire their handlers afterwards.
    _q: {},
    querySelectorAll(sel) {
      if (!this._q[sel]) {
        this._q[sel] = Array.from({ length: 3 }, (_, i) => {
          const c = makeEl();
          c.dataset.i = String(i + 2);
          return c;
        });
      }
      return this._q[sel];
    },
  };
  return el;
}

// Slider defaults, mirroring index.html, so the app is exercised at the
// values a real user would start from rather than at 1.
const SLIDERS = {
  arousal: '0.25', inhib: '1.55', lr: '0.003',
  speed: '1', size: '1', exposure: '1', wires: '1',
};

const els = new Map();
function getEl(id) {
  if (!els.has(id)) {
    const el = makeEl(id);
    if (SLIDERS[id] !== undefined) el.value = SLIDERS[id];
    els.set(id, el);
  }
  return els.get(id);
}

// A WebGL context that answers every call plausibly.
const glCalls = { drawArrays: 0, bufferSubData: 0, bufferData: 0 };
function makeGL() {
  const target = {
    VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4,
    ARRAY_BUFFER: 5, STATIC_DRAW: 6, DYNAMIC_DRAW: 7, FLOAT: 8,
    POINTS: 9, BLEND: 10, SRC_ALPHA: 11, ONE: 12, DEPTH_TEST: 13,
    COLOR_BUFFER_BIT: 14,
    createShader: () => ({}), createProgram: () => ({}), createBuffer: () => ({}),
    shaderSource: noop, compileShader: noop, attachShader: noop, linkProgram: noop,
    useProgram: noop,
    getShaderParameter: () => true, getProgramParameter: () => true,
    getShaderInfoLog: () => '', getProgramInfoLog: () => '',
    getAttribLocation: () => 0, getUniformLocation: () => ({}),
    bindBuffer: noop, enableVertexAttribArray: noop, vertexAttribPointer: noop,
    bufferData: () => { glCalls.bufferData++; },
    bufferSubData: () => { glCalls.bufferSubData++; },
    drawArrays: () => { glCalls.drawArrays++; },
    uniformMatrix4fv: noop, uniform1f: noop,
    viewport: noop, clear: noop, clearColor: noop,
    enable: noop, disable: noop, blendFunc: noop,
  };
  return new Proxy(target, { get: (t, k) => (k in t ? t[k] : noop) });
}

const canvas2d = new Proxy({}, {
  get: (t, k) => (k in t ? t[k] : noop),
  set: () => true,
});

globalThis.document = {
  getElementById: (id) => getEl(id),
  querySelector: () => makeEl(),
  querySelectorAll: () => [],
  createElement: (tag) => makeEl(),
  addEventListener: (type, fn) => { (globalThis.document._on ||= {})[type] = fn; },
  removeEventListener: noop,
  body: makeEl(),
};
globalThis.window = { devicePixelRatio: 1, addEventListener: noop };
globalThis.location = { search: '?n=20000' };
globalThis.performance = globalThis.performance || { now: () => Date.now() };
globalThis.HTMLCanvasElement = function () {};
globalThis.Int32Array = Int32Array;

// canvas element stub: WebGL for #gl, 2d for the trace
const glCanvas = makeEl('gl');
glCanvas.getContext = (kind) => (kind === '2d' ? canvas2d : makeGL());
els.set('gl', glCanvas);
for (const id of ['trace']) {
  const c = makeEl(id);
  c.getContext = () => canvas2d;
  els.set(id, c);
}

// ------------------------------------------------- animation frame pump
let queue = [];
let now = 0;
globalThis.requestAnimationFrame = (fn) => { queue.push(fn); return queue.length; };
globalThis.setTimeout = (fn, ms) => { queue.push(fn); return 0; };
globalThis.clearTimeout = noop;

/**
 * Run queued callbacks one batch at a time, yielding to the macrotask queue
 * between batches so promise continuations inside boot()/frame() can run.
 */
async function pump(n) {
  for (let i = 0; i < n; i++) {
    const batch = queue;
    queue = [];
    now += 16.7;
    for (const fn of batch) fn(now);
    await new Promise((r) => setImmediate(r));
    if (!queue.length) break;
  }
}

// ------------------------------------------------------------------ run
const failures = [];
process.on('uncaughtException', (e) => failures.push(e));

console.log(`\nsmoke: booting app with 20,000 neurons, ${FRAMES} frames\n`);

const t0 = Date.now();
await import('../js/main.js');
// let boot()'s awaited rAFs resolve
for (let i = 0; i < 12; i++) await pump(1);

await pump(FRAMES);

// --------------------------------------------------- exercise the controls
const fired = [];
function click(id) {
  const el = getEl(id);
  const hs = el._on.click || [];
  if (!hs.length) { fired.push(`${id}: NO HANDLER`); return; }
  for (const h of hs) h({ clientX: 400, clientY: 300, preventDefault: noop });
  fired.push(id);
}
function change(id, value) {
  const el = getEl(id);
  if (value !== undefined) el.value = value;
  for (const h of (el._on.change || [])) h({ target: el });
  for (const h of (el._on.input || [])) h({ target: el });
}

// pause / resume, sliders, checkboxes
click('play'); click('play');
change('arousal', '0.24');
change('lr', '0.006');
change('speed', '1.5');
change('size', '1.4');
await pump(30);

// conditioning: aversive x3 should run to completion inside the frame loop
click('train-aversive');
await pump(400);
click('probe');
await pump(60);
click('measure');
await pump(120);

// capture this BEFORE 'forget' wipes the weights back to naive
const plastAfterTraining = getEl('plast-readout').innerHTML;
const memAfterTraining = getEl('memory-readout').innerHTML;

change('showwires', undefined);   // toggle the synapse pass off and on
change('wires', '1.5');
await pump(30);

// Click on the canvas: exercises ray picking + the k-nearest search.
const gl = getEl('gl');
for (const h of (gl._on.pointerdown || [])) {
  h({ clientX: 400, clientY: 300, pointerId: 1, preventDefault: noop });
}
for (const h of (gl._on.pointerup || [])) {
  h({ clientX: 400, clientY: 300, pointerId: 1, preventDefault: noop });
}
const card = getEl('neuron').innerHTML;
const pickedOk = String(card).includes('neuron #');

// lesion a region via its generated button, then put it back
const lesionBtns = getEl('region-rates')._q['.rr-x'] || [];
const lesionLog = [];
for (const b of lesionBtns) {
  for (const h of (b._on.click || [])) h({ stopPropagation: noop });
  lesionLog.push(String(getEl('log').innerHTML).split('</div>')[0].replace(/<[^>]+>/g, ''));
}
click('restore-all');
await pump(20);

click('forget');
click('reset');
await pump(30);

const ms = Date.now() - t0;
const st = getEl('stat-fps');
console.log(`  boot status         "${getEl('overlay-status').innerHTML || getEl('overlay-status').textContent}"`);
console.log(`  frames pumped       ${FRAMES}`);
console.log(`  drawArrays calls    ${glCalls.drawArrays}`);
console.log(`  glow uploads        ${glCalls.bufferSubData}`);
console.log(`  fps readout         "${st.textContent}"`);
console.log(`  wall time           ${ms} ms`);
console.log(`  controls fired      ${fired.join(', ')}`);
console.log(`  neuron pick         ${pickedOk ? 'ok' : 'FAILED'}`);
console.log(`  memory (trained)    "${memAfterTraining}"`);
console.log(`  synapses (trained)  "${plastAfterTraining}"`);
console.log(`  after forget        "${getEl('plast-readout').innerHTML}"`);
console.log(`  lesion clicks       ${lesionLog.length ? lesionLog.join(' | ') : 'NONE'}`);
console.log(`  log tail            "${String(getEl('log').innerHTML).slice(0, 90)}"`);
console.log(`  uncaught errors     ${failures.length}`);

// A run that never reached the render loop is a failure, however quiet it was.
const rendered = glCalls.drawArrays > 0;
let bad = failures.length > 0;
if (!rendered) {
  console.log('\n  FAILED: boot never reached the render loop');
  console.log(`   ${getEl('overlay-status').innerHTML || getEl('overlay-status').textContent}`);
  bad = true;
}
if (failures.length) {
  console.log('\n  first error:');
  console.log('   ', failures[0].stack.split('\n').slice(0, 6).join('\n    '));
}
if (bad) { console.log(''); process.exit(1); }
console.log('\n  ok — app boots and runs headlessly\n');
