/* ==========================================================================
   ui.js — panels, inspector, search, HUD
   ========================================================================== */

import { labelOf, membersOfLabel, searchLabels } from './data.js';
import { legendFor } from './palette.js';

export const $ = (s) => document.querySelector(s);
export const $$ = (s) => [...document.querySelectorAll(s)];
export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const fmt = (v) => v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e4 ? (v / 1e3).toFixed(0) + 'k' : v.toLocaleString('en-US');

let toastTimer;
export function toast(msg, ms = 2100) {
  let el = $('#toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); }
  el.textContent = msg;
  el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('on'), ms);
}

/* ------------------------------------------------------------ legend ---- */
export function renderLegend(D, mode, onPick) {
  const el = $('#legend');
  const rows = legendFor(mode, D);
  el.innerHTML = rows.map((r) => `
    <div class="lg-row" data-key="${r.key}">
      <i class="lg-sw" style="background:${r.hex};box-shadow:0 0 7px ${r.hex}66"></i>
      <span>${esc(r.label)}</span>
      ${r.count != null ? `<em>${fmt(r.count)}</em>` : ''}
    </div>`).join('');
  el.querySelectorAll('.lg-row').forEach((n) => {
    n.onclick = () => onPick(+n.dataset.key, n);
  });
}

/* ---------------------------------------------------------- inspector --- */
export function renderNeuron(D, i, ctx) {
  const body = $('#inspBody');
  if (i < 0) {
    body.className = 'insp-empty';
    body.innerHTML = `<p>Click any neuron in the cloud.</p>
      <p class="dim">${esc(ctx.hint || 'drag to orbit · scroll to zoom')}</p>`;
    return;
  }
  body.className = '';
  const lbl = labelOf(D, i);
  const sup = D.meta.superclasses[D.sup[i]].replace(/_/g, ' ');
  const nt = D.nt[i] === 255 ? 'unknown' : D.meta.neurotransmitters[D.nt[i]];
  const side = { L: 'left', R: 'right', M: 'midline', '?': 'unknown' }[D.meta.sides[D.side[i]]];
  const dimName = D.meta.dimorphisms[D.dim[i]];
  const total = D.pre[i] + D.post[i];

  // strongest partners
  const outs = [];
  for (let e = D.offsets[i]; e < D.offsets[i + 1]; e++) outs.push([D.dst[e], D.wgt[e]]);
  outs.sort((a, b) => b[1] - a[1]);
  const ins = [];
  for (let e = D.inOff[i]; e < D.inOff[i + 1]; e++) ins.push([D.inSrc[e], D.inW[e]]);
  ins.sort((a, b) => b[1] - a[1]);

  const row = ([j, w]) => `<div class="pt" data-goto="${j}"><b>${esc(labelOf(D, j))}</b><em>${w}</em></div>`;

  body.innerHTML = `
    <div class="insp-head">
      <div class="insp-name">${esc(lbl)}</div>
      <div class="insp-sub">body ${D.bodyId[i]}${D.hasSoma[i] ? '' : ' · soma estimated'}</div>
      <div class="insp-tags">
        <span class="tag c">${esc(sup)}</span>
        <span class="tag">${esc(nt)}</span>
        <span class="tag">${side}</span>
        ${dimName !== 'none' ? `<span class="tag m">${esc(dimName)}</span>` : ''}
      </div>
    </div>
    <dl class="kv">
      <dt>incoming synapses</dt><dd>${D.pre[i].toLocaleString('en-US')}</dd>
      <dt>outgoing synapses</dt><dd>${D.post[i].toLocaleString('en-US')}</dd>
      <dt>partners</dt><dd>${D.offsets[i + 1] - D.offsets[i]} out · ${D.inOff[i + 1] - D.inOff[i]} in</dd>
    </dl>
    <div class="bar"><i style="width:${Math.min(100, total / 60)}%"></i></div>
    ${outs.length ? `<div class="partners"><h3>strongest outputs</h3>${outs.slice(0, 8).map(row).join('')}</div>` : ''}
    ${ins.length ? `<div class="partners"><h3>strongest inputs</h3>${ins.slice(0, 6).map(row).join('')}</div>` : ''}
  `;
  body.querySelectorAll('[data-goto]').forEach((n) => {
    n.onclick = () => ctx.onGoto(+n.dataset.goto);
  });
}

/* -------------------------------------------------------------- search --- */
export function renderSearch(D, q) {
  const box = $('#searchResults');
  if (!q.trim()) { box.hidden = true; return []; }
  const hits = searchLabels(D, q, 22);
  if (!hits.length) {
    box.innerHTML = `<div class="sr-none">no cell type matches “${esc(q)}”</div>`;
    box.hidden = false;
    return [];
  }
  box.innerHTML = hits.map((li) => {
    const c = D.lstart[li + 1] - D.lstart[li];
    const sup = c ? D.meta.superclasses[D.sup[D.lmembers[D.lstart[li]]]].replace(/_/g, ' ') : '';
    return `<div class="sr-item" data-li="${li}"><b>${esc(D.labels[li])}</b><span>${c} · ${esc(sup)}</span></div>`;
  }).join('');
  box.hidden = false;
  box.querySelectorAll('.sr-item').forEach((n) => {
    n.onclick = () => { box.hidden = true; $('#search').blur(); n.dispatchEvent(new CustomEvent('picktype', { bubbles: true, detail: +n.dataset.li })); };
  });
  return hits;
}

/* ----------------------------------------------------------------- hud --- */
export function setHUD(stats) {
  $('#hudStats').innerHTML = stats.map((s) =>
    `<div class="stat ${s.cls || ''}"><b>${esc(s.value)}</b><span>${esc(s.label)}</span></div>`).join('');
}

export function setHint(t) { $('#hudHint').textContent = t; }

/* ------------------------------------------------------------ timeline --- */
export function drawTimeline(canvas, hist, playT, colour = '#38e8ff') {
  const dpr = Math.min(devicePixelRatio, 2);
  const w = canvas.clientWidth, h = 46;
  if (canvas.width !== w * dpr) { canvas.width = w * dpr; canvas.height = h * dpr; }
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  if (!hist || !hist.length) return;
  const max = Math.max(...hist, 1);
  const bw = w / hist.length;
  for (let i = 0; i < hist.length; i++) {
    const bh = (hist[i] / max) * (h - 12);
    const x = i * bw;
    const passed = playT != null && i <= playT;
    g.fillStyle = passed ? colour : '#1b3348';
    g.globalAlpha = passed ? 0.85 : 0.55;
    g.fillRect(x + 0.5, h - bh - 2, Math.max(bw - 1, 1), bh);
  }
  g.globalAlpha = 1;
  if (playT != null) {
    const x = (playT + 0.5) * bw;
    g.fillStyle = '#ff4fd8';
    g.fillRect(x - 1, 0, 2, h);
  }
  // hop labels
  g.fillStyle = '#46617f';
  g.font = '9px ui-monospace, monospace';
  for (let i = 0; i < hist.length; i += Math.max(1, Math.round(hist.length / 14))) {
    g.fillText(String(i), i * bw + 2, h - 1);
  }
}

/* -------------------------------------------------------- action panels -- */
export function actionAtlas(ctx) {
  return `
    <div class="act">
      <p>Every dot is one of the 166,700 reconstructed neurons, placed at its real soma.
      Click one to read its wiring.</p>
      <button class="big" id="aPing" ${ctx.sel < 0 ? 'disabled' : ''}>⚡ poke this neuron</button>
      <button class="big mag" id="aRandom">🎲 ping a random sensory cell</button>
      <button class="big" id="aResetCam" style="border-color:#21385a;background:transparent;color:#8fb6cf">↺ reset view</button>
    </div>`;
}

export function actionPoke(ctx) {
  return `
    <div class="act">
      <p>Drop a spike into <b>${ctx.sel >= 0 ? esc(ctx.selLabel) : 'a neuron'}</b> and watch it travel
      across real synapses. The wave only follows connections that actually exist.</p>
      <button class="big" id="aPing" ${ctx.sel < 0 ? 'disabled' : ''}>⚡ ping</button>
      <button class="big mag" id="aRandom">🎲 random sensory cell</button>
      <div class="slider"><label>reach</label><input id="sDecay" type="range" min="70" max="99" value="${Math.round(ctx.decay * 100)}"><em>${ctx.decay.toFixed(2)}</em></div>
      <div class="slider"><label>cut-off</label><input id="sThresh" type="range" min="1" max="12" value="${Math.round(ctx.threshold * 1000 / 10)}"><em>${ctx.threshold.toFixed(3)}</em></div>
      <div class="slider"><label>speed</label><input id="sSpeed" type="range" min="1" max="12" value="${ctx.speed}"><em>${ctx.speed}×</em></div>
    </div>`;
}

export function actionReverse(ctx) {
  return `
    <div class="act">
      <p>Pick a behaviour. MUSCA searches the connectome <b>backwards</b> for the strongest
      anatomical route from sensory cells to the motor neurons that carry it out.</p>
      <div class="behaviours">
        ${ctx.behaviours.map((b) => `
          <button class="bh ${b.id === ctx.active ? 'is-on' : ''}" data-bh="${b.id}">
            <b>${esc(b.name)}</b><span>${esc(b.blurb)}</span>
          </button>`).join('')}
      </div>
      <div id="pathOut">${ctx.pathHTML || ''}</div>
    </div>`;
}

export function actionLesion(ctx) {
  return `
    <div class="act">
      <p>Silence cells and measure the damage. Cut a cell type, then re-run the last ping
      to see how many motor neurons the signal can no longer reach.</p>
      ${ctx.selLabel
        ? `<button class="big red" id="aCutOne">✂ cut ${esc(ctx.selLabel)} (${ctx.selCount})</button>`
        : `<p class="dim">Click a neuron first, or search a cell type.</p>`}
      <button class="big red" id="aCutRandom">✂ cut a random cell type</button>
      <button class="big" id="aHeal" style="border-color:#21385a;background:transparent;color:#8fb6cf">✚ heal everything</button>
      <div class="kv" style="margin-top:6px">
        <dt>cells cut</dt><dd>${fmt(ctx.cutCount)}</dd>
      </div>
      ${ctx.lesionHTML || ''}
    </div>`;
}

export function renderPath(beh, step) {
  return `
    <div class="path">
      ${beh.chain.map((name, i) => `
        <div class="step ${i <= step ? 'hot' : ''}">
          <i>${i + 1}</i>
          <div><b>${esc(name)}</b><span>${i === 0 ? 'sensory input' : i === beh.chain.length - 1 ? 'motor output' : 'interneuron'}</span></div>
        </div>`).join('')}
    </div>
    <p class="dim" style="margin-top:8px">${beh.chain.length} neurons end-to-end ·
    strongest anatomical route found by the search</p>`;
}
