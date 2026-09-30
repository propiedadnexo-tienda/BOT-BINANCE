// Motor de varios bots de Futuros (hasta 10) en modo cobertura (hedge).
// Cada bot opera UN activo en UNA dirección:
//   Bot LONG : abre long en el cruce alcista (si RSI < límite) y cierra en el cruce bajista.
//   Bot SHORT: abre short en el cruce bajista (si RSI > límite) y cierra en el cruce alcista.
// Cada posición lleva su propio stop-loss y take-profit en Binance (Algo Orders con su algoId).
// Un límite de pérdida diaria GLOBAL detiene todos los bots.

import { computeIndicators, crossAt, slTpPrices } from './indicators.js';
import { floorStep, ceilStep, roundTick } from './binance.js';
import { fmt } from './bot.js';

const STATE_KEY = 'mbot_state_v1';
export const MAX_BOTS = 10;
const today = () => new Date().toLocaleDateString('sv-SE');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const uid = () => Math.random().toString(36).slice(2, 8);

export const BOT_DEFAULTS = {
  symbol: 'BTCUSDT', direction: 'LONG', interval: '15m', emaFast: 9, emaSlow: 21, rsiPeriod: 14,
  rsiLimit: 70, amount: 100, leverage: 2, slPct: 1.5, tpPct: 3, maxTrades: 10, feePct: 0.05, enabled: true,
};

// Margen mínimo (USDT) para que la cantidad redondeada supere el mínimo del par, con 3 % de holgura
export function minMargin(info, price, leverage) {
  const q = Math.max(+ceilStep(info.minNotional * 1.03 / price, info.marketStep), info.minQty);
  return Math.ceil(q * price * 1.03 / leverage);
}

export const botLabel = b => `${b.direction === 'LONG' ? '📈' : '📉'} ${b.symbol.replace(/USDT$/, '')} ${b.direction}`;

function defaultState() {
  return {
    running: false, global: { tickSec: 20, maxDailyLoss: 50 },
    bots: [], trades: [], log: [], day: today(), pnlToday: 0, pnlTotal: 0,
  };
}

export class MultiBot {
  constructor(getClient, emit) {
    this.getClient = getClient;
    this.emit = emit || (() => {});
    this.timer = null;
    this.busy = false;
    this.snap = {}; // por bot: precio, EMAs, RSI, señal, PnL no realizado
    this.info = {};
    this.state = this._load();
  }

  _load() {
    try {
      const s = { ...defaultState(), ...JSON.parse(localStorage.getItem(STATE_KEY) || '{}') };
      s.global = { ...defaultState().global, ...s.global };
      return s;
    } catch { return defaultState(); }
  }
  save() { try { localStorage.setItem(STATE_KEY, JSON.stringify(this.state)); } catch {} }

  log(msg, level = 'info', bot) {
    const e = { t: Date.now(), msg: bot ? `[${botLabel(bot)}] ${msg}` : msg, level };
    this.state.log.unshift(e);
    if (this.state.log.length > 300) this.state.log.length = 300;
    this.save();
    this.emit('log', e);
  }

  get running() { return this.state.running; }
  get bots() { return this.state.bots; }
  bot(id) { return this.state.bots.find(b => b.id === id); }
  get openCount() { return this.state.bots.filter(b => b.position).length; }

  // ---------- Gestión de bots ----------
  _validate(cfg) {
    if (!/^[A-Z0-9]{3,20}USDT$/.test(cfg.symbol)) throw new Error('Elige un activo válido (terminado en USDT)');
    if (!['LONG', 'SHORT'].includes(cfg.direction)) throw new Error('Dirección inválida');
    if (cfg.emaFast >= cfg.emaSlow) throw new Error('La EMA rápida debe ser menor que la lenta');
    if (!(cfg.amount > 0)) throw new Error('Margen inválido');
    if (!(cfg.leverage >= 1 && cfg.leverage <= 20)) throw new Error('Apalancamiento entre 1x y 20x');
    if (cfg.slPct * cfg.leverage >= 80) throw new Error(`Con ${cfg.leverage}x, un stop-loss de ${cfg.slPct}% está demasiado cerca de la liquidación`);
    const twin = this.state.bots.find(b => b.symbol === cfg.symbol && b.id !== cfg.id);
    if (twin && twin.leverage !== cfg.leverage) throw new Error(`Binance usa un solo apalancamiento por activo: el otro bot de ${cfg.symbol} usa ${twin.leverage}x`);
    const same = this.state.bots.find(b => b.symbol === cfg.symbol && b.direction === cfg.direction && b.id !== cfg.id);
    if (same) throw new Error(`Ya existe un bot ${cfg.direction} para ${cfg.symbol}`);
  }

  addBot(cfg) {
    if (this.state.bots.length >= MAX_BOTS) throw new Error(`Máximo ${MAX_BOTS} bots`);
    const b = { ...BOT_DEFAULTS, ...cfg, id: uid(), position: null, lastActedCandle: null, tradesToday: 0, pnlToday: 0, pnlTotal: 0, day: today() };
    if (!('rsiLimit' in cfg)) b.rsiLimit = b.direction === 'LONG' ? 70 : 30;
    this._validate(b);
    this.state.bots.push(b);
    this.save(); this.emit('update');
    return b;
  }

  updateBot(id, cfg) {
    const b = this.bot(id);
    if (!b) throw new Error('Bot no encontrado');
    if (b.position && (cfg.symbol !== b.symbol || cfg.direction !== b.direction)) throw new Error('Este bot tiene una posición abierta: no puedes cambiar activo ni dirección');
    const next = { ...b, ...cfg, id };
    this._validate(next);
    Object.assign(b, next);
    if (this.running) this._prepared = false; // re-aplicar apalancamiento en el próximo ciclo
    this.save(); this.emit('update');
  }

  removeBot(id) {
    const b = this.bot(id);
    if (b?.position) throw new Error('Cierra primero la posición de este bot');
    this.state.bots = this.state.bots.filter(x => x.id !== id);
    this.save(); this.emit('update');
  }

  setEnabled(id, on) {
    const b = this.bot(id); if (!b) return;
    b.enabled = on;
    this.save();
    this.log(on ? 'Activado' : 'Pausado (si tiene posición, su SL/TP sigue en Binance)', 'info', b);
    this.emit('update');
  }

  // ---------- Arranque / parada ----------
  async start() {
    if (this.state.running) return;
    const active = this.state.bots.filter(b => b.enabled);
    if (!active.length) throw new Error('Agrega o activa al menos un bot');
    const c = this.getClient();
    await c.syncTime();
    await c.usdt();
    await c.ensureHedge();
    await this._prepare(true);
    this.state.running = true;
    this.save();
    this.log(`▶️ ${active.length} bot(s) iniciados · ${c.testnet ? 'DEMO' : 'CUENTA REAL'}`, 'ok');
    this._schedule(0);
    this.emit('update');
  }

  // Valida mínimos y configura margen aislado + apalancamiento por activo
  async _prepare(strict) {
    const c = this.getClient();
    const symbols = [...new Set(this.state.bots.map(b => b.symbol))];
    for (const sym of symbols) {
      const info = this.info[sym] = await c.symbolInfo(sym);
      if (info.status !== 'TRADING') throw new Error(`${sym} no está operando (${info.status})`);
      const price = await c.price(sym);
      for (const b of this.state.bots.filter(x => x.symbol === sym && x.enabled)) {
        const need = minMargin(info, price, b.leverage);
        if (b.amount < need) {
          const msg = `${botLabel(b)}: con ${b.leverage}x necesita al menos ${need} USDT de margen (posición mínima ${info.minNotional} USDT)`;
          if (strict) throw new Error(msg);
          this.log(msg, 'warn');
        }
      }
      const hasPos = this.state.bots.some(b => b.symbol === sym && b.position);
      if (!hasPos) {
        await c.setMarginType(sym, 'ISOLATED');
        const lev = this.state.bots.find(b => b.symbol === sym).leverage;
        await c.setLeverage(sym, lev);
      }
    }
    this._prepared = true;
  }

  async resume() {
    if (!this.state.running) return;
    this.state.running = false;
    try { await this.start(); this.log('Bots reanudados al abrir la app'); }
    catch (e) { this.log(`No se pudieron reanudar: ${e.message}`, 'error'); this.emit('update'); }
  }

  stop(reason = '') {
    clearTimeout(this.timer);
    this.timer = null;
    if (!this.state.running) return;
    this.state.running = false;
    this.save();
    this.log(`⏹️ Bots detenidos${reason ? `: ${reason}` : ''}. Las posiciones abiertas conservan su SL/TP en Binance.`, reason ? 'warn' : 'info');
    this.emit('update');
  }

  _schedule(ms) { clearTimeout(this.timer); this.timer = setTimeout(() => this._tick(), ms); }

  async _tick() {
    if (!this.state.running) return;
    if (this.busy) { this._schedule(1000); return; }
    this.busy = true;
    let failed = false;
    try {
      await this._cycle();
    } catch (e) {
      failed = true;
      this.log(`Error: ${e.message}`, 'error');
      if ([-2014, -2015, -1022].includes(e.code)) this.stop('la API Key no es válida o no tiene permiso de Futuros');
    } finally {
      this.busy = false;
      if (this.state.running) this._schedule((failed ? 3 : 1) * this.state.global.tickSec * 1000);
      this.emit('update');
    }
  }

  _rollDay() {
    const d = today();
    if (this.state.day === d) return;
    this.state.day = d; this.state.pnlToday = 0;
    for (const b of this.state.bots) { b.day = d; b.tradesToday = 0; b.pnlToday = 0; }
    this.save();
  }

  async _cycle() {
    const c = this.getClient();
    this._rollDay();
    if (!this._prepared) await this._prepare(false);
    const positions = await c.positions();
    const klineCache = new Map();
    for (const b of [...this.state.bots]) {
      if (!this.state.running) break;
      if (!b.enabled && !b.position) continue;
      try {
        await this._step(b, positions, klineCache);
      } catch (e) {
        this.log(`Error: ${e.message}`, 'error', b);
        if ([-2014, -2015, -1022].includes(e.code)) throw e;
      }
    }
  }

  async _step(b, positions, cache) {
    const c = this.getClient();
    if (!this.info[b.symbol]) this.info[b.symbol] = await c.symbolInfo(b.symbol);
    const key = `${b.symbol}|${b.interval}`;
    const limit = Math.min(1000, Math.max(b.emaSlow * 4, b.rsiPeriod * 4, 150));
    let all = cache.get(key);
    if (!all || all.length < limit) { all = await c.klines(b.symbol, b.interval, limit); cache.set(key, all); }
    const closed = all.filter(k => k.ct < c.now());
    if (closed.length < b.emaSlow + 2) throw new Error('No hay suficientes velas para calcular');

    const price = all[all.length - 1].c;
    const ind = computeIndicators(closed, b);
    const i = closed.length - 1;
    const cross = crossAt(ind, i);
    const r = ind.rsi[i];
    const candleT = closed[i].t;
    const snap = this.snap[b.id] = {
      price, fast: ind.fast[i], slow: ind.slow[i], rsi: r, at: Date.now(),
      signal: cross === 'UP' ? 'LONG' : cross === 'DOWN' ? 'SHORT' : null,
    };

    // 1) Sincronizar con Binance
    if (b.position) {
      const ex = positions.find(p => p.symbol === b.symbol && p.side === b.direction);
      if (!ex) { await this._onClosedOnExchange(b); }
      else {
        snap.upnl = ex.upnl; snap.mark = ex.mark;
        b.position.liq = ex.liq; b.position.qty = ex.qty;
        const p = b.position;
        if (!p.slAlgoId && !p.tpAlgoId) {
          const hitSl = b.direction === 'LONG' ? ex.mark <= p.sl : ex.mark >= p.sl;
          const hitTp = b.direction === 'LONG' ? ex.mark >= p.tp : ex.mark <= p.tp;
          if (hitSl) { await this._close(b, 'Stop-loss'); return; }
          if (hitTp) { await this._close(b, 'Take-profit'); return; }
        }
      }
    }

    // 2) Señales (una vez por vela)
    if (!cross || b.lastActedCandle === candleT) return;
    const opens = (b.direction === 'LONG' && cross === 'UP') || (b.direction === 'SHORT' && cross === 'DOWN');
    if (b.position && !opens) {
      await this._close(b, `Cruce ${cross === 'UP' ? 'alcista' : 'bajista'}`);
    } else if (!b.position && opens && b.enabled && this.state.running) {
      const rsiOk = r == null || (b.direction === 'LONG' ? r < b.rsiLimit : r > b.rsiLimit);
      if (!rsiOk) this.log(`Señal, pero el RSI (${fmt(r, 1)}) no permite abrir`, 'warn', b);
      else if (b.tradesToday >= b.maxTrades) this.log('Señal ignorada: límite de operaciones del día', 'warn', b);
      else await this._open(b, price);
    }
    b.lastActedCandle = candleT;
    this.save();
  }

  async _open(b, price) {
    const c = this.getClient(), info = this.info[b.symbol];
    const bal = await c.usdt(info.quote);
    if (bal.available < b.amount) {
      this.log(`Señal, pero el saldo disponible (${fmt(bal.available, 2)} USDT) es menor al margen (${b.amount})`, 'warn', b);
      return;
    }
    const qty = floorStep(Math.min(b.amount * b.leverage / price, info.maxMarketQty), info.marketStep);
    if (+qty < info.minQty || +qty * price < info.minNotional) {
      this.log(`Margen insuficiente para la posición mínima (${info.minNotional} USDT)`, 'warn', b);
      return;
    }
    const side = b.direction;
    this.log(`Abriendo ${side} de ${qty} ${info.base} (${fmt(b.amount, 2)} USDT × ${b.leverage}x)…`, 'info', b);
    const ord = await c.marketOpen(b.symbol, side === 'LONG' ? 'BUY' : 'SELL', qty, side);
    const openTime = c.now() - 5000;

    let ex = null;
    for (let k = 0; k < 5 && !ex; k++) { if (k) await sleep(600); ex = await c.position(b.symbol, side); }
    if (!ex) throw new Error('La orden se envió pero no aparece la posición en Binance');

    const { sl, tp } = slTpPrices(side, ex.entry, b);
    b.position = {
      symbol: b.symbol, base: info.base, quote: info.quote, side,
      entry: ex.entry, qty: ex.qty, margin: b.amount, leverage: b.leverage,
      sl, tp, liq: ex.liq, time: Date.now(), openTime, openOrderId: ord && ord.orderId,
      slAlgoId: null, tpAlgoId: null,
    };
    b.tradesToday++;
    this.save();
    this.log(`✅ ${side} abierto: ${ex.qty} ${info.base} a ${fmt(ex.entry)} · SL ${fmt(sl)} · TP ${fmt(tp)}`, 'ok', b);
    this.emit('trade');
    await this._protect(b);
  }

  async _protect(b) {
    const c = this.getClient(), info = this.info[b.symbol], p = b.position;
    const closeSide = p.side === 'LONG' ? 'SELL' : 'BUY';
    const place = async (type, price) => (await c.algoClose({
      symbol: p.symbol, side: closeSide, type, triggerPrice: roundTick(price, info.tickSize), positionSide: p.side,
    })).algoId;
    try { p.slAlgoId = await place('STOP_MARKET', p.sl); }
    catch (e) { this.log(`No se pudo colocar el stop-loss en Binance (${e.message})`, 'warn', b); }
    try { p.tpAlgoId = await place('TAKE_PROFIT_MARKET', p.tp); }
    catch (e) { this.log(`No se pudo colocar el take-profit en Binance (${e.message})`, 'warn', b); }
    this.save();
    if (p.slAlgoId && p.tpAlgoId) this.log('🛡️ Stop-loss y take-profit colocados en Binance', 'ok', b);
    else if (!p.slAlgoId && !p.tpAlgoId) this.log('La app vigilará SL/TP mientras esté abierta', 'warn', b);
  }

  // Cancela SOLO las órdenes de protección de este bot (no las del otro bot del mismo activo)
  async _cancelProtection(b) {
    const c = this.getClient(), p = b.position;
    for (const id of [p.slAlgoId, p.tpAlgoId]) {
      if (id == null) continue;
      try { await c.cancelAlgo(id); } catch { /* ya ejecutada o cancelada */ }
    }
  }

  async _result(p) {
    const c = this.getClient();
    const closeSide = p.side === 'LONG' ? 'SELL' : 'BUY';
    const mine = t => !t.positionSide || t.positionSide === 'BOTH' || t.positionSide === p.side;
    for (let k = 0; k < 3; k++) {
      if (k) await sleep(800);
      const trades = (await c.userTrades(p.symbol, p.openTime - 60000)).filter(mine);
      const opens = trades.filter(t => p.openOrderId != null && t.orderId === p.openOrderId);
      const tOpen = opens.length ? Math.min(...opens.map(t => t.time)) : p.openTime;
      const closing = trades.filter(t => t.side === closeSide && t.orderId !== p.openOrderId && t.time >= tOpen);
      if (!closing.length) continue;
      let pnl = 0, fees = 0;
      for (const t of [...opens, ...closing]) {
        pnl += +t.realizedPnl;
        if (t.commissionAsset === p.quote) fees += +t.commission;
      }
      return { pnl: pnl - fees, exit: +closing[closing.length - 1].price };
    }
    return null;
  }

  async _onClosedOnExchange(b) {
    const c = this.getClient(), p = b.position;
    const status = async id => { try { return id ? (await c.getAlgo(id)).algoStatus : null; } catch { return null; } };
    const [s1, s2] = await Promise.all([status(p.slAlgoId), status(p.tpAlgoId)]);
    const fired = s => s === 'TRIGGERED' || s === 'FINISHED';
    const reason = fired(s1) ? 'Stop-loss (Binance)' : fired(s2) ? 'Take-profit (Binance)' : 'Cerrada fuera del bot';
    await this._cancelProtection(b);
    this._record(b, await this._result(p), reason);
  }

  async _close(b, reason) {
    const c = this.getClient(), p = b.position;
    if (!p) return;
    await this._cancelProtection(b);
    const ex = await c.position(p.symbol, p.side);
    if (!ex) { await this._onClosedOnExchange(b); return; }
    this.log(`Cerrando ${p.side} (${reason})…`, 'info', b);
    await c.marketClose(p.symbol, p.side, ex.qty, ex.positionSide !== 'BOTH');
    this._record(b, await this._result(p), reason);
  }

  _record(b, res, reason) {
    const st = this.state, p = b.position;
    let pnl, exit;
    if (res) ({ pnl, exit } = res);
    else {
      exit = this.snap[b.id]?.price ?? p.entry;
      pnl = +p.qty * (exit - p.entry) * (p.side === 'LONG' ? 1 : -1);
      reason += ' (resultado estimado)';
    }
    st.trades.unshift({
      botId: b.id, label: botLabel(b), symbol: p.symbol, side: p.side, entry: p.entry, exit, qty: +p.qty,
      leverage: p.leverage, entryTime: p.time, exitTime: Date.now(), reason, pnl, pnlPct: pnl / p.margin * 100,
    });
    if (st.trades.length > 300) st.trades.length = 300;
    b.pnlToday += pnl; b.pnlTotal += pnl;
    st.pnlToday += pnl; st.pnlTotal += pnl;
    b.position = null;
    this.save();
    this.log(`${pnl >= 0 ? '🟢' : '🔴'} Cerrado (${reason}): ${pnl >= 0 ? '+' : ''}${fmt(pnl, 2)} USDT (${fmt(pnl / p.margin * 100, 2)}% del margen)`, pnl >= 0 ? 'ok' : 'error', b);
    this.emit('trade');
    const lim = st.global.maxDailyLoss;
    if (lim > 0 && st.pnlToday <= -lim) this.stop(`se alcanzó la pérdida diaria máxima de todos los bots (${fmt(st.pnlToday, 2)} USDT)`);
  }

  async closeBot(id) {
    const b = this.bot(id);
    if (!b?.position) return;
    while (this.busy) await sleep(200);
    this.busy = true;
    try {
      const c = this.getClient();
      if (!this.info[b.symbol]) this.info[b.symbol] = await c.symbolInfo(b.symbol);
      await c.syncTime();
      await this._close(b, 'Cierre manual');
    } finally { this.busy = false; this.emit('update'); }
  }

  forgetPosition(id) {
    const b = this.bot(id); if (!b) return;
    b.position = null; this.save();
    this.log('Posición olvidada manualmente (no se envió ninguna orden)', 'warn', b);
    this.emit('update');
  }

  setGlobal(g) { Object.assign(this.state.global, g); this.save(); this.emit('update'); }

  resetStats() {
    Object.assign(this.state, { trades: [], log: [], pnlToday: 0, pnlTotal: 0 });
    for (const b of this.state.bots) Object.assign(b, { pnlToday: 0, pnlTotal: 0, tradesToday: 0 });
    this.save(); this.emit('update');
  }
}
