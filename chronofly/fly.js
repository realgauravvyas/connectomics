export function drawFly(ctx, x, y, heading, size, rgb, now, active) {
  const s = size;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(heading + Math.PI / 2);

  const wingA = Math.sin(now / (active ? 16 : 60)) * (active ? 0.9 : 0.15);
  for (let w = 0; w < 2; w += 1) {
    const side = w ? 1 : -1;
    ctx.save();
    ctx.rotate(wingA * side * 0.5);
    ctx.fillStyle = `rgba(${rgb},0.18)`;
    ctx.strokeStyle = `rgba(${rgb},0.6)`;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.ellipse(-15 * s * side, -5 * s, 16 * s, 5.5 * s, 0.5 * side, 0, 7);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  const grad = ctx.createLinearGradient(-8 * s, 0, 8 * s, 0);
  grad.addColorStop(0, `rgba(${rgb},0.06)`);
  grad.addColorStop(0.5, `rgba(${rgb},0.16)`);
  grad.addColorStop(1, `rgba(${rgb},0.06)`);
  ctx.fillStyle = grad;
  ctx.strokeStyle = `rgba(${rgb},0.8)`;
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.ellipse(11 * s, 0, 12 * s, 7 * s, 0, 0, 7);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(-2 * s, 0, 8 * s, 6.5 * s, 0, 0, 7);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(-12 * s, 0, 5.5 * s, 0, 7);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = 'rgba(255,209,102,0.85)';
  ctx.beginPath();
  ctx.arc(-13.5 * s, -2.5 * s, 2 * s, 0, 7);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(-13.5 * s, 2.5 * s, 2 * s, 0, 7);
  ctx.fill();

  ctx.fillStyle = `rgba(${rgb},0.9)`;
  ctx.beginPath();
  ctx.arc(2 * s, -7 * s, 1.4 * s, 0, 7);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(2 * s, 7 * s, 1.4 * s, 0, 7);
  ctx.fill();

  ctx.restore();
}
