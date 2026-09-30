// Indicadores técnicos y estrategia (EMA cruzada + filtro RSI)
// Se usa igual en el bot en vivo y en el backtest, para que lo que pruebas sea lo que opera.

export function ema(values, period) {
  const out = new Array(values.length).fill(null);
  if (period < 1 || values.length < period) return out;
  const k = 2 / (period + 1);
  let prev = 0;
  for (let i = 0; i < period; i++) prev += values[i];
  prev /= period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

// RSI de Wilder
export function rsi(values, period = 14) {
  const out = new Array(values.length).fill(null);
  if (values.length <= period) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gain += d; else loss -= d;
  }
  gain /= period; loss /= period;
  out[period] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    gain = (gain * (period - 1) + Math.max(d, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

export function computeIndicators(candles, cfg) {
  const closes = candles.map(c => c.c);
  return {
    fast: ema(closes, cfg.emaFast),
    slow: ema(closes, cfg.emaSlow),
    rsi: rsi(closes, cfg.rsiPeriod),
  };
}

// Señal en la vela i (ya cerrada):
//  BUY  -> la EMA rápida cruza por encima de la lenta y el RSI no está sobrecomprado
//  SELL -> la EMA rápida cruza por debajo de la lenta
export function signalAt(ind, i, cfg) {
  if (i < 1) return null;
  const f0 = ind.fast[i - 1], s0 = ind.slow[i - 1], f1 = ind.fast[i], s1 = ind.slow[i];
  if ([f0, s0, f1, s1].some(v => v == null)) return null;
  if (f0 <= s0 && f1 > s1) {
    const r = ind.rsi[i];
    if (r != null && r >= cfg.rsiMax) return null;
    return 'BUY';
  }
  if (f0 >= s0 && f1 < s1) return 'SELL';
  return null;
}

// Backtest simple: long-only, un trade a la vez, comisión por lado, SL/TP por high/low.
// Si en una misma vela se tocan SL y TP se asume SL (criterio conservador).
export function backtest(candles, cfg) {
  const ind = computeIndicators(candles, cfg);
  const fee = (cfg.feePct ?? 0.1) / 100;
  const trades = [];
  let pos = null, equity = 0, peak = 0, maxDD = 0;

  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    if (pos) {
      let exit = null, reason = null;
      if (c.l <= pos.sl) { exit = Math.min(c.o, pos.sl); reason = 'SL'; }
      else if (c.h >= pos.tp) { exit = Math.max(c.o, pos.tp); reason = 'TP'; }
      else if (signalAt(ind, i, cfg) === 'SELL') { exit = c.c; reason = 'Señal'; }
      if (exit != null) {
        const qty = cfg.amount * (1 - fee) / pos.entry;
        const pnl = qty * exit * (1 - fee) - cfg.amount;
        trades.push({ entryTime: pos.t, exitTime: c.t, entry: pos.entry, exit, reason, pnl, pnlPct: pnl / cfg.amount * 100 });
        equity += pnl;
        peak = Math.max(peak, equity);
        maxDD = Math.max(maxDD, peak - equity);
        pos = null;
        continue;
      }
    }
    if (!pos && signalAt(ind, i, cfg) === 'BUY') {
      pos = { entry: c.c, t: c.t, sl: c.c * (1 - cfg.slPct / 100), tp: c.c * (1 + cfg.tpPct / 100) };
    }
  }

  const wins = trades.filter(t => t.pnl > 0).length;
  const first = candles[0]?.c, last = candles[candles.length - 1]?.c;
  return {
    trades,
    count: trades.length,
    wins,
    winRate: trades.length ? wins / trades.length * 100 : 0,
    totalPnl: equity,
    totalPct: equity / cfg.amount * 100,
    maxDD,
    openPosition: pos,
    holdPct: first ? (last / first - 1) * 100 : 0,
    from: candles[0]?.t,
    to: candles[candles.length - 1]?.t,
  };
}

// ---------------- Futuros (long + short) ----------------

// Cruce puro en la vela i: 'UP' (rápida cruza hacia arriba) | 'DOWN' | null
export function crossAt(ind, i) {
  if (i < 1) return null;
  const f0 = ind.fast[i - 1], s0 = ind.slow[i - 1], f1 = ind.fast[i], s1 = ind.slow[i];
  if ([f0, s0, f1, s1].some(v => v == null)) return null;
  if (f0 <= s0 && f1 > s1) return 'UP';
  if (f0 >= s0 && f1 < s1) return 'DOWN';
  return null;
}

// ¿Se permite abrir esta dirección según el RSI?
export function rsiAllows(side, rsiVal, cfg) {
  if (rsiVal == null) return true;
  return side === 'LONG' ? rsiVal < cfg.rsiMax : rsiVal > cfg.rsiMin;
}

export function slTpPrices(side, entry, cfg) {
  const d = side === 'LONG' ? 1 : -1;
  return { sl: entry * (1 - d * cfg.slPct / 100), tp: entry * (1 + d * cfg.tpPct / 100) };
}

// Backtest long/short con apalancamiento. amount = margen por operación.
// Cruce alcista: cierra short y abre long (si RSI lo permite). Cruce bajista: al revés.
export function backtestFutures(candles, cfg) {
  const ind = computeIndicators(candles, cfg);
  const fee = (cfg.feePct ?? 0.05) / 100;
  const notional = cfg.amount * cfg.leverage;
  const trades = [];
  let pos = null, equity = 0, peak = 0, maxDD = 0;

  const close = (exit, t, reason) => {
    const d = pos.side === 'LONG' ? 1 : -1;
    const pnl = notional * d * (exit / pos.entry - 1) - notional * fee - notional * (exit / pos.entry) * fee;
    trades.push({ side: pos.side, entryTime: pos.t, exitTime: t, entry: pos.entry, exit, reason, pnl, pnlPct: pnl / cfg.amount * 100 });
    equity += pnl; peak = Math.max(peak, equity); maxDD = Math.max(maxDD, peak - equity);
    pos = null;
  };

  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    if (pos) {
      if (pos.side === 'LONG') {
        if (c.l <= pos.sl) { close(Math.min(c.o, pos.sl), c.t, 'SL'); continue; }
        if (c.h >= pos.tp) { close(Math.max(c.o, pos.tp), c.t, 'TP'); continue; }
      } else {
        if (c.h >= pos.sl) { close(Math.max(c.o, pos.sl), c.t, 'SL'); continue; }
        if (c.l <= pos.tp) { close(Math.min(c.o, pos.tp), c.t, 'TP'); continue; }
      }
    }
    const x = crossAt(ind, i);
    if (!x) continue;
    const want = x === 'UP' ? 'LONG' : 'SHORT';
    if (pos && pos.side !== want) close(c.c, c.t, 'Cruce');
    if (!pos && rsiAllows(want, ind.rsi[i], cfg)) {
      pos = { side: want, entry: c.c, t: c.t, ...slTpPrices(want, c.c, cfg) };
    }
  }

  const wins = trades.filter(t => t.pnl > 0).length;
  const first = candles[0]?.c, last = candles[candles.length - 1]?.c;
  return {
    trades, count: trades.length, wins,
    longs: trades.filter(t => t.side === 'LONG').length,
    shorts: trades.filter(t => t.side === 'SHORT').length,
    winRate: trades.length ? wins / trades.length * 100 : 0,
    totalPnl: equity, totalPct: equity / cfg.amount * 100, maxDD,
    openPosition: pos, holdPct: first ? (last / first - 1) * 100 : 0,
    from: candles[0]?.t, to: candles[candles.length - 1]?.t,
  };
}
