/*
 * FlySprint - brain2d.js
 * Live wiring diagram of the selected fly's 10-6-4 gait network.
 * Nodes pulse with actual activations during the race; edges are
 * thickness-mapped weights (GFP green = excitatory, scarlet = inhibitory).
 */
(function (global) {
  'use strict';
  function BrainView(canvas) {
    this.cv = canvas; this.ctx = canvas.getContext('2d');
  }
  BrainView.prototype.draw = function (w, x, act) {
    var c = this.ctx, W = this.cv.width, H = this.cv.height, S = global.FG.SPEC;
    c.clearRect(0, 0, W, H);
    var colX = [W * 0.14, W * 0.5, W * 0.86];
    function ys(n) { var a = []; for (var i = 0; i < n; i++) a.push(H * (i + 0.6) / (n + 0.2)); return a; }
    var ly = ys(S.NI), my = ys(S.NH), oy = ys(S.NO);
    var self = this, NNH = S.NI * S.NH;
    // hidden->out weights start at NNH + S.NH
    function edge(aPos, bPos, weight, srcAct) {
      c.beginPath(); c.moveTo(aPos[0], aPos[1]); c.lineTo(bPos[0], bPos[1]);
      var t = Math.min(2.2, Math.abs(weight) * 0.55);
      c.lineWidth = t;
      c.strokeStyle = weight >= 0
        ? 'rgba(107,255,176,' + (0.08 + 0.5 * Math.min(1, srcAct * Math.abs(weight)) * 0.35) + ')'
        : 'rgba(255,85,64,' + (0.08 + 0.5 * Math.min(1, srcAct * Math.abs(weight)) * 0.35) + ')';
      c.stroke();
    }
    for (var i = 0; i < S.NH; i++) for (var j = 0; j < S.NI; j++)
      edge([colX[0], ly[j]], [colX[1], my[i]], w[j * S.NH + i], x[j] * 0.5 + act[i] * 0.5);
    for (var o = 0; o < S.NO; o++) for (var h = 0; h < S.NH; h++)
      edge([colX[1], my[h]], [colX[2], oy[o]], w[NNH + S.NH + h * S.NO + o], act[h] * act[S.NH + o]);
    function node(px, py, a, label) {
      var r = 3.4 + a * 4.2;
      c.beginPath(); c.arc(px, py, r, 0, 7);
      c.fillStyle = 'rgba(107,255,176,' + (0.15 + 0.85 * Math.min(1, a)) + ')';
      c.shadowColor = '#6bffb0'; c.shadowBlur = a * 14;
      c.fill(); c.shadowBlur = 0;
      if (label) { c.fillStyle = 'rgba(223,233,255,0.6)'; c.font = '8px monospace'; c.fillText(label, px + 8, py + 3); }
    }
    var L = ['sin', 'cos', 'vel', 'sta', 'rem', 'gap', 'air', 'push', 'jump', 'done'];
    for (var k = 0; k < S.NI; k++) node(colX[0], ly[k], Math.min(1, Math.abs(x[k])), L[k]);
    for (var m = 0; m < S.NH; m++) node(colX[1], my[m], Math.abs(act[m]));
    var O = ['push', 'freq', 'JUMP', 'pace'];
    for (var n = 0; n < S.NO; n++) node(colX[2], oy[n], act[S.NH + n], O[n]);
  };
  global.FG = global.FG || {};
  global.FG.BrainView = BrainView;
})(window);
