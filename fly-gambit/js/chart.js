/* FlyGambit - chart.js : tiny dual-line sparkline (no dependencies) */
(function (global) {
  'use strict';
  function Sparkline(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.a = []; this.b = [];
    this.maxLen = 180;
  }
  Sparkline.prototype.push = function (aVal, bVal) {
    this.a.push(aVal); this.b.push(bVal);
    if (this.a.length > this.maxLen) { this.a.shift(); this.b.shift(); }
  };
  Sparkline.prototype.draw = function () {
    var c = this.ctx, W = this.cv.width, H = this.cv.height;
    c.clearRect(0, 0, W, H);
    c.strokeStyle = 'rgba(107,255,176,0.08)';
    c.lineWidth = 1;
    for (var g = 1; g < 4; g++) {
      c.beginPath(); c.moveTo(0, H * g / 4); c.lineTo(W, H * g / 4); c.stroke();
    }
    var maxY = 0.35;
    for (var i = 0; i < this.a.length; i++) {
      if (this.a[i] > maxY) maxY = this.a[i];
      if (this.b[i] > maxY) maxY = this.b[i];
    }
    line(this.a, '#6bffb0'); line(this.b, '#ff7043');
    var self = this;
    function line(arr, color) {
      if (arr.length < 2) return;
      c.beginPath();
      var n = arr.length, smooth = 4;
      for (var k = 0; k < n; k++) {
        var v = 0, m = 0;
        for (var s = Math.max(0, k - smooth); s <= Math.min(n - 1, k + smooth); s++) { v += arr[s]; m++; }
        var x = k / (n - 1) * W, y = H - 6 - (v / m) / maxY * (H - 14);
        if (k === 0) c.moveTo(x, y); else c.lineTo(x, y);
      }
      c.strokeStyle = color; c.lineWidth = 1.8;
      c.shadowColor = color; c.shadowBlur = 7;
      c.stroke(); c.shadowBlur = 0;
    }
  };
  global.FG = global.FG || {};
  global.FG.Sparkline = Sparkline;
})(window);
