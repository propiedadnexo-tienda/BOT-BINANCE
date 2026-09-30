// Motor de varios bots de Futuros (hasta 10) en modo cobertura (hedge).
// Cada bot opera UN activo en UNA dirección:
//   Bot LONG : abre long en el cruce alcista (si RSI < límite) y cierra en el cruce bajista.
//   Bot SHORT: abre short en el cruce bajista (si RSI > límite) y cierra en el cruce alcista.
// Cada posición lleva su propio stop-loss y take-profit en Binance (Algo Orders con su algoId).
// Un límite de pérdida diaria GLOBAL detiene todos los bots y hay un máximo de posiciones abiertas a la vez.
// La lógica de entrada/salida/stops/tamaño vive en strategy.js (la misma que usa el backtest).

import { indicators, candlesNeeded, entryBlock, exitSignal, stopsFor, sizeFor, trailStop } from './strategy.js';
import { floorStep, ceilStep, roundTick } from './binance.js';
import { fmt } from './bot.js';
import { nameOf } from './names.js';

const STATE_KEY = 'mbot_state_v1';
export const MAX_BOTS = 10;
const today = () => new Date().toLocaleDateString('sv-SE');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const uid = () => Math.random().toString(36).slice(2, 8);

// Valores por defecto = estrategia validada con datos reales (rebote a la media en 4h con filtro de tendencia)
export const BOT_DEFAULTS = {
  symbol: 'BTCUSDT', direction: 'LONG', interval: '4h', enabled: true,
  strategy: 'meanrev', bbN: 20, bbK: 2, rsiPeriod: 14, rsiLimit: 50, trendEma: 200, maxBars: 30, cooldown: 2,
  entryMode: 'cross', emaFast: 20, emaSlow: 50, maxExtAtr: 1.5, entryN: 20, exitN: 10,
  stopMode: 'atr', slAtr: 2, tpAtr: 0, trailAtr: 0, slPct: 1.5, tpPct: 3,
  sizeMode: 'risk', riskPct: 1, amount: 400, leverage: 5,
  maxTrades: 3, feePct: 0.05,
};

export const STRATEGY_NAMES = { meanrev: 'Rebote a la media', breakout: 'Ruptura + trailing', ema: 'Cruce de medias' };

// Plan de Claude: la única estrategia que ganó tanto en los meses de entrenamiento (ene 2025–mar 2026)
// como en los de validación (abr–sep 2026) con datos reales de Binance Futuros.
// 5 criptomonedas grandes × (Long + Short) = 10 bots. Riesgo 1 % del saldo por operación.
export const PLAN_ASSETS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT'];
export function buildPlan(balance) {
  const bal = balance > 0 ? balance : 5000;
  const bot = { ...BOT_DEFAULTS, amount: Math.max(50, Math.round(bal * 0.08)) };
  const bots = PLAN_ASSETS.flatMap(symbol => ['LONG', 'SHORT'].map(direction => ({ ...bot, symbol, direction })));
  return { bots, global: { maxOpen: 6, maxDailyLoss: Math.round(bal * 0.03), tickSec: 30 } };
}

// Margen mínimo (USDT) para que la cantidad redondeada supere el mínimo del par, con 3 % de holgura
export function minMargin(info, price, leverage) {
  const q = Math.max(+ceilStep(info.minNotional * 1.03 / price, info.marketStep), info.minQty);
  return Math.ceil(q * price * 1.03 / leverage);
}

export const botLabel = b => `${b.direction === 'LONG' ? '📈' : '📉'} ${nameOf(b.symbol.replace(/USDT$/, ''))} ${b.direction}`;

function defaultState() {
  return {
    running: false, global: { tickSec: 20, maxDailyLoss: 200, maxOpen: 5 },
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
    if (cfg.stopMode !== 'atr' && cfg.slPct * cfg.leverage >= 80) throw new Error(`Con ${cfg.leverage}x, un stop-loss de ${cfg.slPct}% está demasiado cerca de la liquidación`);
    if (cfg.sizeMode === 'risk' && !(cfg.riskPct > 0 && cfg.riskPct <= 5)) throw new Error('El riesgo por operación debe estar entre 0.1 % y 5 %');
    const same = this.state.bots.find(b => b.symbol === cfg.symbol && b.direction === cfg.direction && b.id !== cfg.id);
    if (same) throw new Error(`Ya existe un bot ${cfg.direction} para ${cfg.symbol}`);
    const twin = this.state.bots.find(b => b.symbol === cfg.symbol && b.id !== cfg.id);
    if (twin && twin.leverage !== cfg.leverage) throw new Error(`Binance usa un solo apalancamiento por activo: el otro bot de ${cfg.symbol} usa ${twin.leverage}x`);
  }

  addBot(cfg) {
    if (this.state.bots.length >= MAX_BOTS) throw new Error(`Máximo ${MAX_BOTS} bots`);
    const b = { ...BOT_DEFAULTS, ...cfg, id: uid(), position: null, lastActedCandle: null, lastExitT: 0, tradesToday: 0, pnlToday: 0, pnlTotal: 0, day: today() };
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
    try {
      await c.syncTime();
      await c.usdt();
      await c.ensureHedge();
      await this._prepare(true);
    } catch (e) {
      this.log(`❌ No se pudieron iniciar los bots: ${e.message}`, 'error');
      throw e;
    }
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
    const limit = candlesNeeded(b);
    let all = cache.get(key);
    if (!all || all.length < limit) { all = await c.klines(b.symbol, b.interval, limit); cache.set(key, all); }
    const closed = all.filter(k => k.ct < c.now());
    if (closed.length < b.emaSlow + 2) throw new Error('No hay suficientes velas para calcular');

    const price = all[all.length - 1].c;
    const ind = indicators(closed, b);
    const i = closed.length - 1;
    const candleT = closed[i].t;
    const snap = this.snap[b.id] = {
      price, fast: ind.fast[i], slow: ind.slow[i], rsi: ind.rsi[i], trend: ind.trend?.[i], atr: ind.atr[i], at: Date.now(),
    };

    // 1) Sincronizar con Binance
    if (b.position) {
      const ex = positions.find(p => p.symbol === b.symbol && p.side === b.direction);
      if (!ex) { await this._onClosedOnExchange(b); }
      else {
        snap.upnl = ex.upnl; snap.mark = ex.mark;
        b.position.liq = ex.liq; b.position.qty = ex.qty;
        const p = b.position;
        if (!p.slAlgoId) {
          const hitSl = b.direction === 'LONG' ? ex.mark <= p.sl : ex.mark >= p.sl;
          const hitTp = p.tp != null && !p.tpAlgoId && (b.direction === 'LONG' ? ex.mark >= p.tp : ex.mark <= p.tp);
          if (hitSl) { await this._close(b, 'Stop-loss'); return; }
          if (hitTp) { await this._close(b, 'Take-profit'); return; }
        }
      }
    }

    // Stop que sigue al precio (trailing): se mueve una vez por vela y se actualiza en Binance
    if (b.position && b.trailAtr > 0 && b.position.trailCandle !== candleT) {
      const p = b.position;
      const ns = trailStop(b, p, ind, i);
      p.trailCandle = candleT;
      if (ns != null && Math.abs(ns - p.sl) > 0.25 * (ind.atr[i] || 0)) await this._moveStop(b, ns);
      this.save();
    }

    // Motivo por el que no entra (se evalúa DESPUÉS de sincronizar, por si Binance acaba de cerrar la posición)
    const sinceExit = b.lastExitT ? closed.filter(k => k.t > b.lastExitT).length : Infinity;
    const block = b.position ? null : entryBlock(ind, i, b, sinceExit);
    snap.block = block; snap.ready = !b.position && !block;

    // 2) Decidir una vez por vela cerrada
    if (b.lastActedCandle === candleT) return;
    if (b.position) {
      const bars = closed.filter(k => k.t > (b.position.entryCandleT || 0)).length;
      const why = exitSignal(ind, i, b, bars);
      if (why) await this._close(b, why.charAt(0).toUpperCase() + why.slice(1));
    } else if (!block && b.enabled && this.state.running) {
      if (b.tradesToday >= b.maxTrades) this.log('Señal ignorada: límite de operaciones del día', 'warn', b);
      else if (this.openCount >= this.state.global.maxOpen) this.log(`Señal ignorada: ya hay ${this.openCount} posiciones abiertas (máximo ${this.state.global.maxOpen})`, 'warn', b);
      else await this._open(b, price, ind.atr[i], candleT);
    }
    b.lastActedCandle = candleT;
    this.save();
  }

  async _open(b, price, atrVal, candleT) {
    const c = this.getClient(), info = this.info[b.symbol];
    const bal = await c.usdt(info.quote);
    const side = b.direction;
    const st0 = stopsFor(b, price, atrVal);
    const size = sizeFor(b, bal.balance, price, st0.sl);
    let qty = floorStep(Math.min(size.notional / price, info.maxMarketQty), info.marketStep);
    if (+qty * price < info.minNotional || +qty < info.minQty) {
      const minQ = Math.max(+ceilStep(info.minNotional * 1.03 / price, info.marketStep), info.minQty);
      if (minQ * price > b.amount * b.leverage) { this.log(`El margen máximo (${b.amount} USDT × ${b.leverage}x) no alcanza la posición mínima de ${info.minNotional} USDT`, 'warn', b); return; }
      qty = ceilStep(minQ, info.marketStep);
    }
    const margin = +qty * price / b.leverage;
    if (bal.available < margin * 1.02) {
      this.log(`Señal, pero el saldo disponible (${fmt(bal.available, 2)} USDT) no cubre el margen (${fmt(margin, 2)})`, 'warn', b);
      return;
    }
    const riskTxt = `riesgo ≈ ${fmt(Math.abs(price - st0.sl) / price * qty * price, 2)} USDT`;
    this.log(`Abriendo ${side} de ${qty} ${info.base} (≈${fmt(+qty * price, 0)} USDT, margen ${fmt(margin, 2)}, ${riskTxt})…`, 'info', b);
    const ord = await c.marketOpen(b.symbol, side === 'LONG' ? 'BUY' : 'SELL', qty, side);
    const openTime = c.now() - 5000;

    let ex = null;
    for (let k = 0; k < 5 && !ex; k++) { if (k) await sleep(600); ex = await c.position(b.symbol, side); }
    if (!ex) throw new Error('La orden se envió pero no aparece la posición en Binance');

    const { sl, tp } = stopsFor(b, ex.entry, atrVal);
    b.position = {
      symbol: b.symbol, base: info.base, quote: info.quote, side,
      entry: ex.entry, qty: ex.qty, margin, leverage: b.leverage, risk: Math.abs(ex.entry - sl) * +ex.qty,
      sl, tp, liq: ex.liq, time: Date.now(), openTime, openOrderId: ord && ord.orderId, entryCandleT: candleT, best: null,
      slAlgoId: null, tpAlgoId: null,
    };
    b.tradesToday++;
    this.save();
    this.log(`✅ ${side} abierto: ${ex.qty} ${info.base} a ${fmt(ex.entry)} · SL ${fmt(sl)} · ${tp != null ? `TP ${fmt(tp)}` : 'sin TP fijo (sale por señal)'}`, 'ok', b);
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
    if (p.tp != null) {
      try { p.tpAlgoId = await place('TAKE_PROFIT_MARKET', p.tp); }
      catch (e) { this.log(`No se pudo colocar el take-profit en Binance (${e.message})`, 'warn', b); }
    }
    this.save();
    if (p.slAlgoId && (p.tp == null || p.tpAlgoId)) this.log(`🛡️ ${p.tp != null ? 'Stop-loss y take-profit colocados' : 'Stop-loss colocado'} en Binance`, 'ok', b);
    else if (!p.slAlgoId) this.log('La app vigilará el stop-loss mientras esté abierta', 'warn', b);
  }

  // Mueve el stop-loss en Binance (trailing): coloca el nuevo y luego cancela el anterior
  async _moveStop(b, newSl) {
    const c = this.getClient(), info = this.info[b.symbol], p = b.position;
    const old = p.slAlgoId;
    try {
      const r = await c.algoClose({ symbol: p.symbol, side: p.side === 'LONG' ? 'SELL' : 'BUY', type: 'STOP_MARKET', triggerPrice: roundTick(newSl, info.tickSize), positionSide: p.side });
      p.slAlgoId = r.algoId; p.sl = newSl;
      if (old != null) { try { await c.cancelAlgo(old); } catch { /* ya no existe */ } }
      this.log(`🔒 Stop movido a ${fmt(newSl)} (asegura ganancia)`, 'info', b);
    } catch (e) {
      if (e.code === -2021) { this.log('El precio ya tocó el nuevo stop: cerrando', 'warn', b); await this._close(b, 'Trailing'); }
      else this.log(`No se pudo mover el stop (${e.message})`, 'warn', b);
    }
    this.save();
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
      const openId = p.openOrderId ?? -1;
      const closing = trades.filter(t => t.side === closeSide && t.orderId !== openId && (t.time > tOpen || (t.time === tOpen && t.orderId > openId)));
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
    const reason = fired(s1) ? (p.best != null && p.trailCandle ? 'Stop / trailing (Binance)' : 'Stop-loss (Binance)') : fired(s2) ? 'Take-profit (Binance)' : 'Cerrada fuera del bot';
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
      r: p.risk ? pnl / p.risk : null,
    });
    if (st.trades.length > 300) st.trades.length = 300;
    b.pnlToday += pnl; b.pnlTotal += pnl; b.lastExitT = this.getClient().now();
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

  applyPlan(plan) {
    if (this.running) throw new Error('Detén los bots antes de aplicar el plan');
    if (this.openCount) throw new Error('Cierra primero las posiciones abiertas de los bots');
    this.state.bots = [];
    for (const cfg of plan.bots) this.addBot(cfg);
    Object.assign(this.state.global, plan.global);
    this.save();
    this.log(`🧠 Plan de Claude aplicado: ${plan.bots.length} bots, riesgo ${plan.bots[0].riskPct} % por operación, máx. ${plan.global.maxOpen} posiciones, pérdida máx. diaria ${plan.global.maxDailyLoss} USDT`, 'ok');
    this.emit('update');
  }

  setGlobal(g) { Object.assign(this.state.global, g); this.save(); this.emit('update'); }

  resetStats() {
    Object.assign(this.state, { trades: [], log: [], pnlToday: 0, pnlTotal: 0 });
    for (const b of this.state.bots) Object.assign(b, { pnlToday: 0, pnlTotal: 0, tradesToday: 0 });
    this.save(); this.emit('update');
  }
}
