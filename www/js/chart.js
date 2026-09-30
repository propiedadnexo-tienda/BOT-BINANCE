// Gráfico de velas en <canvas> (sin librerías externas: funciona offline dentro del APK)

export function drawChart(canvas, candles, ind = {}, markers = [], opts = {}) {
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth, H = canvas.clientHeight;
  if (!W || !H) return;
  canvas.width = W * dpr; canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const css = getComputedStyle(document.documentElement);
  const col = n => css.getPropertyValue(n).trim();
  ctx.clearRect(0, 0, W, H);

  const n = Math.min(opts.visible || 90, candles.length);
  if (n < 2) return;
  const start = candles.length - n;
  const vis = candles.slice(start);
  const axisW = 62, padT = 10, padB = 18;
  const plotW = W - axisW, plotH = H - padT - padB;

  let lo = Infinity, hi = -Infinity;
  for (const c of vis) { lo = Math.min(lo, c.l); hi = Math.max(hi, c.h); }
  for (const arr of [ind.fast, ind.slow]) if (arr) for (let i = start; i < candles.length; i++) if (arr[i] != null) { lo = Math.min(lo, arr[i]); hi = Math.max(hi, arr[i]); }
  for (const lv of opts.levels || []) { lo = Math.min(lo, lv.price); hi = Math.max(hi, lv.price); }
  const pad = (hi - lo) * 0.06 || hi * 0.001;
  lo -= pad; hi += pad;
  const y = p => padT + (hi - p) / (hi - lo) * plotH;
  const step = plotW / n;
  const x = i => (i - start) * step + step / 2;

  // Rejilla y eje de precios
  ctx.font = '10px system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  for (let k = 0; k <= 4; k++) {
    const p = lo + (hi - lo) * k / 4, yy = y(p);
    ctx.strokeStyle = col('--grid'); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(plotW, yy); ctx.stroke();
    ctx.fillStyle = col('--muted');
    ctx.fillText(fmtAxis(p), plotW + 6, yy);
  }

  // Niveles (entrada / SL / TP)
  for (const lv of opts.levels || []) {
    const yy = y(lv.price);
    ctx.setLineDash([4, 4]); ctx.strokeStyle = lv.color; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(plotW, yy); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = lv.color; ctx.fillText(lv.label, 4, yy - 7);
  }

  // Velas
  const bw = Math.max(1, step * 0.65);
  for (let i = start; i < candles.length; i++) {
    const c = candles[i], up = c.c >= c.o;
    ctx.strokeStyle = ctx.fillStyle = up ? col('--up') : col('--down');
    ctx.beginPath(); ctx.moveTo(x(i), y(c.h)); ctx.lineTo(x(i), y(c.l)); ctx.stroke();
    const top = y(Math.max(c.o, c.c)), bot = y(Math.min(c.o, c.c));
    ctx.fillRect(x(i) - bw / 2, top, bw, Math.max(1, bot - top));
  }

  // EMAs
  const line = (arr, color) => {
    if (!arr) return;
    ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.beginPath();
    let started = false;
    for (let i = start; i < candles.length; i++) {
      if (arr[i] == null) continue;
      if (!started) { ctx.moveTo(x(i), y(arr[i])); started = true; } else ctx.lineTo(x(i), y(arr[i]));
    }
    ctx.stroke();
  };
  line(ind.slow, col('--ema-slow'));
  line(ind.fast, col('--ema-fast'));

  // Marcadores de compra/venta
  const t0 = vis[0].t, dt = candles[1].t - candles[0].t;
  for (const m of markers) {
    const i = start + Math.floor((m.time - t0) / dt);
    if (i < start || i >= candles.length) continue;
    const buy = m.side === 'BUY';
    const yy = buy ? y(candles[i].l) + 10 : y(candles[i].h) - 10;
    ctx.fillStyle = buy ? col('--up') : col('--down');
    ctx.beginPath();
    if (buy) { ctx.moveTo(x(i), yy - 6); ctx.lineTo(x(i) - 5, yy + 3); ctx.lineTo(x(i) + 5, yy + 3); }
    else { ctx.moveTo(x(i), yy + 6); ctx.lineTo(x(i) - 5, yy - 3); ctx.lineTo(x(i) + 5, yy - 3); }
    ctx.fill();
  }

  // Precio actual
  const last = candles[candles.length - 1];
  const ly = y(last.c);
  ctx.fillStyle = last.c >= last.o ? col('--up') : col('--down');
  ctx.fillRect(plotW, ly - 8, axisW, 16);
  ctx.fillStyle = '#fff'; ctx.fillText(fmtAxis(last.c), plotW + 6, ly);

  // Horas
  ctx.fillStyle = col('--muted'); ctx.textBaseline = 'alphabetic';
  for (let k = 0; k < 4; k++) {
    const i = start + Math.floor(n * (k + 0.5) / 4);
    const d = new Date(candles[i].t);
    ctx.fillText(d.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' }), x(i) - 14, H - 4);
  }
}

function fmtAxis(p) {
  if (p >= 1000) return p.toFixed(1);
  if (p >= 1) return p.toFixed(3);
  return p.toPrecision(4);
}
