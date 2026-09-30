// Bot de Futuros USDⓈ-M: opera en ambas direcciones.
//  - Cruce alcista (EMA rápida sobre la lenta): cierra un short abierto y abre LONG (si el RSI < máx.)
//  - Cruce bajista: cierra un long abierto y abre SHORT (si el RSI > mín.)
//  - Cada posición lleva stop-loss y take-profit como Algo Orders en Binance (closePosition),
//    que siguen activos aunque la app se cierre.
//  - Margen aislado, modo una dirección, apalancamiento configurable.
// Límites: operaciones por día y pérdida diaria máxima (detiene el bot).

import { computeIndicators, crossAt, rsiAllows, slTpPrices } from './indicators.js';
import { floorStep, ceilStep, roundTick } from './binance.js';
import { fmt } from './bot.js';

const STATE_KEY = 'fbot_state_v1';
const today = () => new Date().toLocaleDateString('sv-SE');
const sleep = ms => new Promise(r => setTimeout(r, ms));

function defaultState() {
  return {
    running: false, cfg: null, position: null, lastActedCandle: null,
    day: today(), tradesToday: 0, pnlToday: 0, pnlTotal: 0,
    trades: [], log: [],
  };
}

export class FuturesBot {
  constructor(getClient, emit) {
    this.market = 'futures';
    this.getClient = getClient;
    this.emit = emit || (() => {});
    this.timer = null;
    this.busy = false;
    this.errors = 0;
    this.snapshot = null;
    this.info = null;
    this.state = this._load();
    this.cfg = this.state.cfg;
  }

  _load() {
    try { return { ...defaultState(), ...JSON.parse(localStorage.getItem(STATE_KEY) || '{}') }; }
    catch { return defaultState(); }
  }
  save() { try { localStorage.setItem(STATE_KEY, JSON.stringify(this.state)); } catch {} }

  log(msg, level = 'info') {
    const e = { t: Date.now(), msg, level };
    this.state.log.unshift(e);
    if (this.state.log.length > 200) this.state.log.length = 200;
    this.save();
    this.emit('log', e);
  }

  get running() { return this.state.running; }

  // Margen mínimo (USDT) para que la cantidad redondeada supere el mínimo del par, con 3 % de holgura
  static minMargin(info, price, leverage) {
    const q = Math.max(+ceilStep(info.minNotional * 1.03 / price, info.marketStep), info.minQty);
    return Math.ceil(q * price * 1.03 / leverage);
  }

  async start(cfg) {
    if (this.state.running) return;
    if (cfg.emaFast >= cfg.emaSlow) throw new Error('La EMA rápida debe ser menor que la lenta');
    if (!(cfg.amount > 0)) throw new Error('Margen por operación inválido');
    if (!(cfg.leverage >= 1 && cfg.leverage <= 20)) throw new Error('El apalancamiento debe estar entre 1x y 20x');
    if (cfg.slPct * cfg.leverage >= 80) throw new Error(`Con ${cfg.leverage}x, un stop-loss de ${cfg.slPct}% está demasiado cerca de la liquidación. Baja el apalancamiento o el stop-loss.`);
    const pos = this.state.position;
    if (pos && pos.symbol !== cfg.symbol) throw new Error(`Hay una posición abierta en ${pos.symbol}. Ciérrala o cambia el par a ${pos.symbol}.`);

    const c = this.getClient();
    await c.syncTime();
    await c.usdt(); // valida claves
    this.info = await c.symbolInfo(cfg.symbol);
    if (this.info.status !== 'TRADING') throw new Error(`${cfg.symbol} no está operando (${this.info.status})`);
    if (this.info.contractType && this.info.contractType !== 'PERPETUAL') throw new Error(`${cfg.symbol} no es un contrato perpetuo`);
    const price = await c.price(cfg.symbol);
    const need = FuturesBot.minMargin(this.info, price, cfg.leverage);
    if (cfg.amount < need) {
      throw new Error(`En ${cfg.symbol} la posición mínima es ${this.info.minNotional} USDT (y la cantidad se redondea a ${this.info.marketStep} ${this.info.base}). Con ${cfg.leverage}x necesitas al menos ${need} USDT de margen.`);
    }
    await c.ensureOneWay();
    if (!pos) {
      await c.setMarginType(cfg.symbol, 'ISOLATED');
      await c.setLeverage(cfg.symbol, cfg.leverage);
    }

    this.cfg = { ...cfg };
    this.state.cfg = this.cfg;
    this.state.running = true;
    this.errors = 0;
    this.save();
    this.log(`▶️ Bot de Futuros iniciado en ${cfg.symbol} ${cfg.interval} · ${cfg.leverage}x aislado · ${c.testnet ? 'DEMO' : 'CUENTA REAL'}`, 'ok');
    this._schedule(0);
    this.emit('update');
  }

  async resume() {
    if (!this.state.running || !this.state.cfg) return;
    this.state.running = false;
    try { await this.start(this.state.cfg); this.log('Bot reanudado al abrir la app'); }
    catch (e) { this.log(`No se pudo reanudar: ${e.message}`, 'error'); this.emit('update'); }
  }

  stop(reason = '') {
    clearTimeout(this.timer);
    this.timer = null;
    if (!this.state.running) return;
    this.state.running = false;
    this.save();
    this.log(`⏹️ Bot detenido${reason ? `: ${reason}` : ''}`, reason ? 'warn' : 'info');
    this.emit('update');
  }

  _schedule(ms) { clearTimeout(this.timer); this.timer = setTimeout(() => this._tick(), ms); }

  async _tick() {
    if (!this.state.running) return;
    if (this.busy) { this._schedule(1000); return; }
    this.busy = true;
    try {
      await this._step();
      this.errors = 0;
    } catch (e) {
      this.errors++;
      this.log(`Error: ${e.message}`, 'error');
      if ([-2014, -2015, -1022].includes(e.code)) this.stop('la API Key no es válida o no tiene permiso de Futuros');
    } finally {
      this.busy = false;
      if (this.state.running) {
        const base = this.cfg.tickSec * 1000;
        this._schedule(this.errors ? Math.min(base * 2 ** this.errors, 120000) : base);
      }
      this.emit('update');
    }
  }

  _rollDay() {
    const d = today();
    if (this.state.day !== d) { Object.assign(this.state, { day: d, tradesToday: 0, pnlToday: 0 }); this.save(); }
  }

  async _step() {
    const c = this.getClient(), cfg = this.cfg, st = this.state;
    if (!this.info) this.info = await c.symbolInfo(cfg.symbol);
    this._rollDay();

    const limit = Math.min(1000, Math.max(cfg.emaSlow * 4, cfg.rsiPeriod * 4, 150));
    const all = await c.klines(cfg.symbol, cfg.interval, limit);
    const closed = all.filter(k => k.ct < c.now());
    if (closed.length < cfg.emaSlow + 2) throw new Error('No hay suficientes velas para calcular');

    const price = all[all.length - 1].c;
    const ind = computeIndicators(closed, cfg);
    const i = closed.length - 1;
    const cross = crossAt(ind, i);
    const r = ind.rsi[i];
    const candleT = closed[i].t;
    this.snapshot = {
      price, fast: ind.fast[i], slow: ind.slow[i], rsi: r, candleT, at: Date.now(),
      signal: cross === 'UP' ? 'LONG' : cross === 'DOWN' ? 'SHORT' : null,
    };

    // 1) Sincronizar con la posición real en Binance
    if (st.position) {
      const ex = await c.position(cfg.symbol);
      if (!ex) {
        await this._onClosedOnExchange();
      } else {
        Object.assign(this.snapshot, { mark: ex.mark, upnl: ex.upnl });
        const p = st.position;
        p.liq = ex.liq; p.qty = ex.qty;
        if (!p.slAlgoId && !p.tpAlgoId) { // sin protección en Binance: la vigila la app
          const hitSl = p.side === 'LONG' ? ex.mark <= p.sl : ex.mark >= p.sl;
          const hitTp = p.side === 'LONG' ? ex.mark >= p.tp : ex.mark <= p.tp;
          if (hitSl) { await this._close('Stop-loss'); return; }
          if (hitTp) { await this._close('Take-profit'); return; }
        }
      }
    }

    // 2) Actuar sobre el cruce (una sola vez por vela)
    if (!cross || st.lastActedCandle === candleT) return;
    const want = cross === 'UP' ? 'LONG' : 'SHORT';

    if (st.position && st.position.side !== want) {
      await this._close(`Cruce ${want === 'LONG' ? 'alcista' : 'bajista'}`);
      if (!this.state.running) { st.lastActedCandle = candleT; this.save(); return; } // se detuvo por pérdida diaria
    }
    if (!st.position) {
      if (!rsiAllows(want, r, cfg)) {
        this.log(`Cruce ${want === 'LONG' ? 'alcista' : 'bajista'}, pero el RSI (${fmt(r, 1)}) no permite abrir ${want}`, 'warn');
      } else if (st.tradesToday >= cfg.maxTrades) {
        this.log('Señal ignorada: se alcanzó el límite de operaciones del día', 'warn');
      } else {
        await this._open(want, price);
      }
    }
    st.lastActedCandle = candleT;
    this.save();
  }

  async _open(side, price) {
    const c = this.getClient(), cfg = this.cfg, info = this.info;
    const bal = await c.usdt(info.quote);
    if (bal.available < cfg.amount) {
      this.log(`Señal ${side}, pero el saldo disponible (${fmt(bal.available, 2)} ${info.quote}) es menor al margen (${cfg.amount})`, 'warn');
      return;
    }
    const qty = floorStep(Math.min(cfg.amount * cfg.leverage / price, info.maxMarketQty), info.marketStep);
    if (+qty < info.minQty || +qty * price < info.minNotional) {
      this.log(`Margen insuficiente para la posición mínima de ${cfg.symbol} (${info.minNotional} USDT)`, 'warn');
      return;
    }
    this.log(`${side === 'LONG' ? '📈' : '📉'} Abriendo ${side} de ${qty} ${info.base} (${fmt(cfg.amount, 2)} USDT × ${cfg.leverage}x)…`);
    const ord = await c.marketOpen(cfg.symbol, side === 'LONG' ? 'BUY' : 'SELL', qty);

    let ex = null;
    for (let k = 0; k < 5 && !ex; k++) { if (k) await sleep(600); ex = await c.position(cfg.symbol); }
    if (!ex) throw new Error('La orden se envió pero no aparece la posición en Binance');

    const { sl, tp } = slTpPrices(side, ex.entry, cfg);
    const p = {
      symbol: cfg.symbol, base: info.base, quote: info.quote, side,
      entry: ex.entry, qty: ex.qty, margin: cfg.amount, leverage: cfg.leverage,
      sl, tp, liq: ex.liq, time: Date.now(), openTime: c.now() - 5000,
      slAlgoId: null, tpAlgoId: null, openOrderId: ord && ord.orderId,
    };
    this.state.position = p;
    this.state.tradesToday++;
    this.save();
    this.log(`✅ ${side} abierto: ${p.qty} ${info.base} a ${fmt(p.entry)} · SL ${fmt(sl)} · TP ${fmt(tp)} · Liq. ${fmt(p.liq)}`, 'ok');
    this.emit('trade');
    await this._protect();
  }

  // Coloca SL y TP en Binance (Algo Orders, cierran toda la posición)
  async _protect() {
    const c = this.getClient(), info = this.info, p = this.state.position;
    const closeSide = p.side === 'LONG' ? 'SELL' : 'BUY';
    const place = async (type, price) => {
      const r = await c.algoClose({ symbol: p.symbol, side: closeSide, type, triggerPrice: roundTick(price, info.tickSize) });
      return r.algoId;
    };
    try { p.slAlgoId = await place('STOP_MARKET', p.sl); }
    catch (e) { this.log(`No se pudo colocar el stop-loss en Binance (${e.message})`, 'warn'); }
    try { p.tpAlgoId = await place('TAKE_PROFIT_MARKET', p.tp); }
    catch (e) { this.log(`No se pudo colocar el take-profit en Binance (${e.message})`, 'warn'); }
    this.save();
    if (p.slAlgoId && p.tpAlgoId) this.log('🛡️ Stop-loss y take-profit colocados en Binance', 'ok');
    else if (!p.slAlgoId && !p.tpAlgoId) this.log('La app vigilará SL/TP mientras esté abierta', 'warn');
  }

  async _cancelProtection() {
    try { await this.getClient().cancelAllAlgos(this.state.position.symbol); } catch { /* no había órdenes */ }
  }

  // Resultado real desde las operaciones de Binance (PnL realizado − comisiones).
  // Solo cuenta la orden de apertura de ESTA posición y las operaciones de cierre posteriores.
  async _result(p) {
    const c = this.getClient();
    const closeSide = p.side === 'LONG' ? 'SELL' : 'BUY';
    for (let k = 0; k < 3; k++) {
      if (k) await sleep(800);
      const trades = await c.userTrades(p.symbol, p.openTime - 60000);
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

  async _onClosedOnExchange() {
    const c = this.getClient(), p = this.state.position;
    let reason = 'Cerrada fuera del bot';
    const status = async id => { try { return id ? (await c.getAlgo(id)).algoStatus : null; } catch { return null; } };
    const [s1, s2] = await Promise.all([status(p.slAlgoId), status(p.tpAlgoId)]);
    const fired = s => s === 'TRIGGERED' || s === 'FINISHED';
    if (fired(s1)) reason = 'Stop-loss (Binance)';
    else if (fired(s2)) reason = 'Take-profit (Binance)';
    await this._cancelProtection();
    const res = await this._result(p);
    this._record(res, reason);
  }

  async _close(reason) {
    const c = this.getClient(), p = this.state.position;
    if (!p) return;
    await this._cancelProtection();
    const ex = await c.position(p.symbol);
    if (!ex) { await this._onClosedOnExchange(); return; }
    this.log(`Cerrando ${p.side} (${reason})…`);
    await c.marketClose(p.symbol, ex.side === 'LONG' ? 'SELL' : 'BUY', ex.qty);
    const res = await this._result(p);
    this._record(res, reason);
  }

  _record(res, reason) {
    const st = this.state, p = st.position;
    let pnl, exit;
    if (res) ({ pnl, exit } = res);
    else { // estimación si Binance aún no devuelve las operaciones
      exit = this.snapshot?.price ?? p.entry;
      const d = p.side === 'LONG' ? 1 : -1;
      pnl = +p.qty * (exit - p.entry) * d;
      reason += ' (resultado estimado)';
    }
    st.trades.unshift({
      symbol: p.symbol, side: p.side, entry: p.entry, exit, qty: +p.qty, leverage: p.leverage,
      entryTime: p.time, exitTime: Date.now(), reason, pnl, pnlPct: pnl / p.margin * 100,
    });
    if (st.trades.length > 200) st.trades.length = 200;
    st.pnlToday += pnl;
    st.pnlTotal += pnl;
    st.position = null;
    this.save();
    this.log(`${pnl >= 0 ? '🟢' : '🔴'} ${p.side} cerrado (${reason}): ${pnl >= 0 ? '+' : ''}${fmt(pnl, 2)} USDT (${fmt(pnl / p.margin * 100, 2)}% del margen)`, pnl >= 0 ? 'ok' : 'error');
    this.emit('trade');
    const cfg = this.cfg || st.cfg;
    if (cfg && cfg.maxDailyLoss > 0 && st.pnlToday <= -cfg.maxDailyLoss) {
      this.stop(`se alcanzó la pérdida diaria máxima (${fmt(st.pnlToday, 2)} USDT)`);
    }
  }

  async closeNow() {
    if (!this.state.position) return;
    while (this.busy) await sleep(200);
    this.busy = true;
    try {
      const c = this.getClient();
      if (!this.cfg) this.cfg = this.state.cfg;
      if (!this.info || this.info.symbol !== this.state.position.symbol) this.info = await c.symbolInfo(this.state.position.symbol);
      await c.syncTime();
      await this._close('Cierre manual');
    } finally { this.busy = false; this.emit('update'); }
  }

  forgetPosition() {
    this.state.position = null; this.save();
    this.log('Posición olvidada manualmente (no se envió ninguna orden)', 'warn');
    this.emit('update');
  }

  resetStats() {
    Object.assign(this.state, { trades: [], log: [], pnlToday: 0, pnlTotal: 0, tradesToday: 0 });
    this.save(); this.emit('update');
  }
}
