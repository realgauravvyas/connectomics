/* FlySprint - chart.js : best-time curve (seconds; lower is better) */
(function (global) {
  'use strict';
  function TimeChart(canvas) {
    this.cv = canvas; this.ctx = canvas.getContext('2d'); this.data = [];
    this.maxLen = 260;
  }
  TimeChart.prototype.push = function (v) {
    this.data.push(v);
    if (this.data.length > this.maxLen) this.data.shift();
  };
  TimeChart.prototype.draw = function () {
    var c = this.ctx, W = this.cv.width, H = this.cv.height, d = this.data;
    c.clearRect(0, 0, W, H);
    if (d.length < 2) return;
    var min = Infinity, max = -Infinity;
    for (var i = 0; i < d.length; i++) { if (d[i] < min) min = d[i]; if (d[i] > max) max = d[i]; }
    var pad = Math.max(0.4, (max - min) * 0.12); min -= pad; max += pad;
    c.strokeStyle = 'rgba(255,207,95,0.10)'; c.lineWidth = 1;
    for (var g = 1; g < 4; g++) { c.beginPath(); c.moveTo(0, H * g / 4); c.lineTo(W, H * g / 4); c.stroke(); }
    var grad = c.createLinearGradient(0, 0, W, 0);
    grad.addColorStop(0, '#ff5540'); grad.addColorStop(1, '#6bffb0');
    c.beginPath();
    for (var k = 0; k < d.length; k++) {
      var x = k / (d.length - 1) * W;
      var y = H - 4 - (max - d[k]) / (max - min) * (H - 8);
      if (k === 0) c.moveTo(x, y); else c.lineTo(x, y);
    }
    c.strokeStyle = grad; c.lineWidth = 2;
    c.shadowColor = '#6bffb0'; c.shadowBlur = 6; c.stroke(); c.shadowBlur = 0;
    c.fillStyle = 'rgba(223,233,255,0.75)'; c.font = '10px monospace';
    c.fillText(max.toFixed(1) + 's', 4, 11);
    c.fillText(min.toFixed(1) + 's', 4, H - 4);
    c.fillStyle = 'rgba(255,207,95,0.8)';
    c.fillText('gen ' + d.length, W - 52, H - 4);
  };
  global.FG = global.FG || {};
  global.FG.TimeChart = TimeChart;
})(window);
