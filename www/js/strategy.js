// Estrategia compartida por los bots en vivo y por el backtest (así lo que pruebas es lo que opera).
//
// Tres familias (campo b.strategy):
//   'ema'      → cruce / tendencia de medias móviles (versión original)
//   'breakout' → ruptura del máximo/mínimo de N velas (canal Donchian) con stop que sigue al precio (trailing)
//   'meanrev'  → rebote a la media: compra caídas exageradas (bajo la banda de Bollinger) en tendencia alcista
//                y vende subidas exageradas en tendencia bajista; sale al volver a la media
//
// Entrada (según la dirección del bot):
//   - modo 'cross': solo en el cruce de EMAs a favor.
//   - modo 'trend': en cuanto la EMA rápida está del lado correcto de la lenta (entra ya),
//                   sin perseguir el precio (no entra si está a más de maxExtAtr ATR de la EMA rápida)
//                   y respetando una espera (cooldown) de N velas después de cada salida.
// Filtros: tendencia de fondo (precio sobre/bajo la EMA larga) y RSI.
// Salida: stop-loss / take-profit (en % o en múltiplos de ATR) o cruce en contra.
// Tamaño: margen fijo, o por riesgo (arriesga riskPct % del saldo si toca el stop), con tope de margen.

import { ema, rsi } from './indicators.js';

export function atr(candles, period = 14) {
  const out = new Array(candles.length).fill(null);
  if (candles.length <= period) return out;
  const tr = candles.map((c, i) => i === 0 ? c.h - c.l
    : Math.max(c.h - c.l, Math.abs(c.h - candles[i - 1].c), Math.abs(c.l - candles[i - 1].c)));
  let a = 0;
  for (let i = 1; i <= period; i++) a += tr[i];
  a /= period;
  out[period] = a;
  for (let i = period + 1; i < candles.length; i++) { a = (a * (period - 1) + tr[i]) / period; out[i] = a; }
  return out;
}

function rolling(arr, n, fn) {
  const out = new Array(arr.length).fill(null);
  for (let i = n - 1; i < arr.length; i++) out[i] = fn(arr.slice(i - n + 1, i + 1));
  return out;
}
// Máximo / mínimo de las N velas ANTERIORES (sin incluir la actual)
function donchian(candles, n) {
  const hi = new Array(candles.length).fill(null), lo = new Array(candles.length).fill(null);
  for (let i = n; i < candles.length; i++) {
    let h = -Infinity, l = Infinity;
    for (let k = i - n; k < i; k++) { if (candles[k].h > h) h = candles[k].h; if (candles[k].l < l) l = candles[k].l; }
    hi[i] = h; lo[i] = l;
  }
  return { hi, lo };
}

export function indicators(candles, b) {
  const closes = candles.map(c => c.c);
  const strat = b.strategy || 'ema';
  const extra = {};
  if (strat === 'breakout') {
    const en = donchian(candles, b.entryN || 20), ex = donchian(candles, b.exitN || 10);
    Object.assign(extra, { dcHi: en.hi, dcLo: en.lo, exHi: ex.hi, exLo: ex.lo });
  }
  if (strat === 'meanrev') {
    const n = b.bbN || 20, k = b.bbK || 2;
    const mid = rolling(closes, n, w => w.reduce((a, x) => a + x, 0) / n);
    const sd = rolling(closes, n, w => { const m = w.reduce((a, x) => a + x, 0) / n; return Math.sqrt(w.reduce((a, x) => a + (x - m) ** 2, 0) / n); });
    Object.assign(extra, { mid, bbUp: mid.map((m, i) => m == null ? null : m + k * sd[i]), bbLo: mid.map((m, i) => m == null ? null : m - k * sd[i]) });
  }
  return {
    ...extra,
    fast: ema(closes, b.emaFast || 9),
    slow: ema(closes, b.emaSlow || 21),
    rsi: rsi(closes, b.rsiPeriod || 14),
    trend: b.trendEma > 0 ? ema(closes, b.trendEma) : null,
    atr: atr(candles, 14),
    close: closes,
  };
}

// Velas necesarias para calcular todo con precisión
export const candlesNeeded = b => Math.min(1000, Math.max((b.trendEma || 0) * 3, (b.emaSlow || 21) * 4, (b.entryN || 0) * 3, 200));

const dirOf = b => (b.direction === 'SHORT' ? -1 : 1);

export function crossDir(ind, i) {
  if (i < 1) return 0;
  const f0 = ind.fast[i - 1], s0 = ind.slow[i - 1], f1 = ind.fast[i], s1 = ind.slow[i];
  if ([f0, s0, f1, s1].some(v => v == null)) return 0;
  if (f0 <= s0 && f1 > s1) return 1;
  if (f0 >= s0 && f1 < s1) return -1;
  return 0;
}

// ¿Por qué no entra? Devuelve null si SÍ debe entrar, o un texto con el motivo.
export function entryBlock(ind, i, b, candlesSinceExit = Infinity) {
  const d = dirOf(b);
  const f = ind.fast[i], s = ind.slow[i], c = ind.close[i], r = ind.rsi[i], a = ind.atr[i];
  if (a == null) return 'calculando indicadores';
  const strat = b.strategy || 'ema';
  if (strat === 'breakout') {
    const lvl = d > 0 ? ind.dcHi[i] : ind.dcLo[i];
    if (lvl == null) return 'calculando canal';
    if ((c - lvl) * d <= 0) return d > 0 ? `esperando ruptura del máximo de ${b.entryN || 20} velas (${lvl.toPrecision(6)})` : `esperando ruptura del mínimo de ${b.entryN || 20} velas (${lvl.toPrecision(6)})`;
    if (candlesSinceExit < (b.cooldown ?? 0)) return `pausa tras la última salida (${candlesSinceExit}/${b.cooldown} velas)`;
  } else if (strat === 'meanrev') {
    const band = d > 0 ? ind.bbLo[i] : ind.bbUp[i];
    if (band == null) return 'calculando bandas';
    if ((band - c) * d <= 0) return d > 0 ? 'esperando una caída exagerada (bajo la banda inferior)' : 'esperando una subida exagerada (sobre la banda superior)';
    if (candlesSinceExit < (b.cooldown ?? 0)) return `pausa tras la última salida (${candlesSinceExit}/${b.cooldown} velas)`;
  } else if (f == null || s == null) {
    return 'calculando indicadores';
  } else if (b.entryMode === 'trend') {
    if ((f - s) * d <= 0) return d > 0 ? 'EMA rápida bajo la lenta (sin tendencia alcista)' : 'EMA rápida sobre la lenta (sin tendencia bajista)';
    if (candlesSinceExit < (b.cooldown ?? 3)) return `pausa tras la última salida (${candlesSinceExit}/${b.cooldown ?? 3} velas)`;
    if (b.maxExtAtr > 0 && (c - f) * d > b.maxExtAtr * a) return 'precio muy estirado, espera un retroceso';
  } else if (crossDir(ind, i) !== d) {
    return 'esperando cruce de EMAs';
  }
  if (ind.trend) {
    const t = ind.trend[i];
    if (t == null) return 'calculando tendencia de fondo';
    if ((c - t) * d <= 0) return d > 0 ? `precio bajo la EMA ${b.trendEma} (tendencia de fondo bajista)` : `precio sobre la EMA ${b.trendEma} (tendencia de fondo alcista)`;
  }
  if (r != null && b.rsiLimit != null && strat === 'meanrev') {
    if (d > 0 && r > b.rsiLimit) return `RSI ${r.toFixed(0)} aún no está en sobreventa (≤ ${b.rsiLimit})`;
    if (d < 0 && r < 100 - b.rsiLimit) return `RSI ${r.toFixed(0)} aún no está en sobrecompra (≥ ${100 - b.rsiLimit})`;
  } else if (r != null && b.rsiLimit != null) {
    if (d > 0 && r >= b.rsiLimit) return `RSI ${r.toFixed(0)} ≥ ${b.rsiLimit} (sobrecompra)`;
    if (d < 0 && r <= b.rsiLimit) return `RSI ${r.toFixed(0)} ≤ ${b.rsiLimit} (sobreventa)`;
  }
  return null;
}

// Salida por señal (al cierre de vela). Devuelve el motivo o null.
export function exitSignal(ind, i, b, barsInTrade = 0) {
  const d = dirOf(b), c = ind.close[i];
  const strat = b.strategy || 'ema';
  if (strat === 'breakout') {
    const lvl = d > 0 ? ind.exLo[i] : ind.exHi[i];
    if (lvl != null && (lvl - c) * d > 0) return `rompió el ${d > 0 ? 'mínimo' : 'máximo'} de ${b.exitN || 10} velas`;
    return null;
  }
  if (strat === 'meanrev') {
    if (ind.mid[i] != null && (c - ind.mid[i]) * d >= 0) return 'volvió a la media';
    if (b.maxBars > 0 && barsInTrade >= b.maxBars) return `tiempo máximo (${b.maxBars} velas)`;
    return null;
  }
  return crossDir(ind, i) === -d ? 'cruce en contra' : null;
}

// Stop que sigue al precio (trailing): nunca retrocede. Devuelve el nuevo stop o null si no cambia.
export function trailStop(b, pos, ind, i) {
  if (!(b.trailAtr > 0) || ind.atr[i] == null) return null;
  const d = dirOf(b);
  pos.best = pos.best == null ? ind.close[i] : (d > 0 ? Math.max(pos.best, ind.close[i]) : Math.min(pos.best, ind.close[i]));
  const cand = pos.best - d * b.trailAtr * ind.atr[i];
  return (cand - pos.sl) * d > 0 ? cand : null;
}

export function stopsFor(b, entry, atrVal) {
  const d = dirOf(b);
  if (b.stopMode === 'atr' && atrVal > 0) {
    // tpAtr = 0 → sin take-profit fijo (se sale por trailing o por señal)
    return { sl: entry - d * b.slAtr * atrVal, tp: b.tpAtr > 0 ? entry + d * b.tpAtr * atrVal : null };
  }
  return { sl: entry * (1 - d * b.slPct / 100), tp: entry * (1 + d * b.tpPct / 100) };
}

// Tamaño de la posición en USDT (nocional) y margen necesario
export function sizeFor(b, balance, entry, sl) {
  const maxNotional = b.amount * b.leverage;
  if (b.sizeMode !== 'risk') return { notional: maxNotional, margin: b.amount, capped: false };
  const risk = balance * (b.riskPct || 1) / 100;
  const dist = Math.abs(entry - sl) / entry;
  const want = dist > 0 ? risk / dist : maxNotional;
  const notional = Math.min(want, maxNotional);
  return { notional, margin: notional / b.leverage, capped: want > maxNotional, risk };
}

// Backtest de UN bot (una dirección). balance fijo (sin interés compuesto) para medir la estrategia.
export function backtestBot(candles, b, { balance = 5000, feePct = 0.05 } = {}) {
  const ind = indicators(candles, b);
  const fee = feePct / 100, d = dirOf(b);
  const trades = [];
  let pos = null, lastExit = -Infinity, equity = 0, peak = 0, maxDD = 0;
  const close = (i, exit, reason) => {
    const gross = pos.notional * d * (exit / pos.entry - 1);
    const pnl = gross - pos.notional * fee - pos.notional * (exit / pos.entry) * fee;
    trades.push({ side: b.direction, entryTime: candles[pos.i].t, exitTime: candles[i].t, entry: pos.entry, exit, reason, pnl, r: pos.risk ? pnl / pos.risk : null });
    equity += pnl; peak = Math.max(peak, equity); maxDD = Math.max(maxDD, peak - equity);
    pos = null; lastExit = i;
  };
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    if (pos) {
      const hitSl = d > 0 ? c.l <= pos.sl : c.h >= pos.sl;
      const hitTp = pos.tp != null && (d > 0 ? c.h >= pos.tp : c.l <= pos.tp);
      if (hitSl) { close(i, d > 0 ? Math.min(c.o, pos.sl) : Math.max(c.o, pos.sl), pos.trailed ? 'Trailing' : 'SL'); continue; }
      if (hitTp) { close(i, d > 0 ? Math.max(c.o, pos.tp) : Math.min(c.o, pos.tp), 'TP'); continue; }
      if (exitSignal(ind, i, b, i - pos.i)) { close(i, c.c, 'Señal'); continue; }
      const nt = trailStop(b, pos, ind, i);
      if (nt != null) { pos.sl = nt; pos.trailed = true; }
    }
    if (!pos && !entryBlock(ind, i, b, i - lastExit)) {
      const { sl, tp } = stopsFor(b, c.c, ind.atr[i]);
      const { notional } = sizeFor(b, balance, c.c, sl);
      pos = { i, entry: c.c, sl, tp, notional, risk: Math.abs(c.c - sl) / c.c * notional };
    }
  }
  return summarize(trades, equity, maxDD, candles, pos);
}

export function summarize(trades, equity, maxDD, candles, openPos = null) {
  const wins = trades.filter(t => t.pnl > 0);
  const losses = trades.filter(t => t.pnl <= 0);
  const gw = wins.reduce((a, t) => a + t.pnl, 0), gl = -losses.reduce((a, t) => a + t.pnl, 0);
  return {
    trades, count: trades.length, wins: wins.length,
    winRate: trades.length ? wins.length / trades.length * 100 : 0,
    totalPnl: equity, maxDD,
    profitFactor: gl > 0 ? gw / gl : (gw > 0 ? Infinity : 0),
    avgWin: wins.length ? gw / wins.length : 0,
    avgLoss: losses.length ? gl / losses.length : 0,
    openPosition: openPos,
    from: candles[0]?.t, to: candles[candles.length - 1]?.t,
  };
}

// Combina los resultados de varios bots en una curva de capital (ordenada por hora de cierre)
export function combine(results) {
  const all = results.flatMap(r => r.trades).sort((a, b) => a.exitTime - b.exitTime);
  let eq = 0, peak = 0, dd = 0;
  for (const t of all) { eq += t.pnl; peak = Math.max(peak, eq); dd = Math.max(dd, peak - eq); }
  const s = summarize(all, eq, dd, []);
  s.from = Math.min(...results.map(r => r.from || Infinity));
  s.to = Math.max(...results.map(r => r.to || 0));
  return s;
}
