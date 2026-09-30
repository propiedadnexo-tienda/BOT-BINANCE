// Motor del bot automático.
// Cada N segundos: descarga velas, calcula EMA/RSI sobre velas CERRADAS y actúa:
//  - Sin posición + cruce alcista  -> compra a mercado por un monto fijo y coloca OCO (TP + SL) en Binance
//  - Con posición + cruce bajista  -> cancela la OCO y vende a mercado
//  - Si la OCO se ejecuta en Binance -> registra el cierre
// Límites: operaciones por día y pérdida diaria máxima (detiene el bot).

import { computeIndicators, signalAt } from './indicators.js';
import { floorStep, roundTick, freeBalance } from './binance.js';

const STATE_KEY = 'bot_state_v1';
const today = () => new Date().toLocaleDateString('sv-SE'); // AAAA-MM-DD en hora local

function defaultState() {
  return {
    running: false, cfg: null, position: null, lastActedCandle: null,
    day: today(), tradesToday: 0, pnlToday: 0, pnlTotal: 0,
    trades: [], log: [],
  };
}

export const fmt = (n, d) => {
  if (n == null || !isFinite(n)) return '—';
  if (d == null) d = Math.abs(n) >= 1000 ? 2 : Math.abs(n) >= 1 ? 4 : 8;
  return (+n).toFixed(d).replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1');
};

export class Bot {
  constructor(getClient, emit) {
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

  async start(cfg) {
    if (this.state.running) return;
    if (cfg.emaFast >= cfg.emaSlow) throw new Error('La EMA rápida debe ser menor que la lenta');
    if (!(cfg.amount > 0)) throw new Error('Monto por operación inválido');
    const pos = this.state.position;
    if (pos && pos.symbol !== cfg.symbol) {
      throw new Error(`Hay una posición abierta en ${pos.symbol}. Ciérrala o cambia el par a ${pos.symbol}.`);
    }
    const c = this.getClient();
    await c.syncTime();
    await c.account(); // valida claves antes de arrancar
    this.info = await c.symbolInfo(cfg.symbol);
    if (this.info.status !== 'TRADING') throw new Error(`${cfg.symbol} no está operando (${this.info.status})`);
    if (cfg.amount < this.info.minNotional) throw new Error(`El monto mínimo para ${cfg.symbol} es ${this.info.minNotional} ${this.info.quote}`);

    this.cfg = { ...cfg };
    this.state.cfg = this.cfg;
    this.state.running = true;
    this.errors = 0;
    this.save();
    this.log(`▶️ Bot iniciado en ${cfg.symbol} ${cfg.interval} · ${c.testnet ? 'TESTNET' : 'CUENTA REAL'}`, 'ok');
    this._schedule(0);
    this.emit('update');
  }

  // Reanuda tras reabrir la app si quedó encendido
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

  _schedule(ms) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this._tick(), ms);
  }

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
      if ([-2014, -2015, -1022].includes(e.code)) this.stop('la API Key no es válida o no tiene permiso de trading');
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
    if (this.state.day !== d) {
      this.state.day = d; this.state.tradesToday = 0; this.state.pnlToday = 0;
      this.save();
    }
  }

  async _step() {
    const c = this.getClient(), cfg = this.cfg, st = this.state;
    if (!this.info) this.info = await c.symbolInfo(cfg.symbol);
    this._rollDay();

    const limit = Math.min(1000, Math.max(cfg.emaSlow * 4, cfg.rsiPeriod * 4, 150));
    const all = await c.klines(cfg.symbol, cfg.interval, limit);
    const now = c.now();
    const closed = all.filter(k => k.ct < now);
    if (closed.length < cfg.emaSlow + 2) throw new Error('No hay suficientes velas para calcular');

    const price = all[all.length - 1].c;
    const ind = computeIndicators(closed, cfg);
    const i = closed.length - 1;
    const sig = signalAt(ind, i, cfg);
    const candleT = closed[i].t;
    this.snapshot = { price, fast: ind.fast[i], slow: ind.slow[i], rsi: ind.rsi[i], signal: sig, candleT, at: Date.now() };

    if (st.position) {
      const p = st.position;
      if (p.ocoId != null && await this._checkOco()) return;
      if (sig === 'SELL' && st.lastActedCandle !== candleT) {
        await this._exit('Cruce bajista');
        st.lastActedCandle = candleT; this.save();
        return;
      }
      if (st.position && st.position.ocoId == null) {
        if (price <= p.sl) { await this._exit('Stop-loss'); return; }
        if (price >= p.tp) { await this._exit('Take-profit'); return; }
      }
    } else if (sig === 'BUY' && st.lastActedCandle !== candleT) {
      st.lastActedCandle = candleT; this.save();
      if (st.tradesToday >= cfg.maxTrades) {
        this.log('Señal de compra ignorada: se alcanzó el límite de operaciones del día', 'warn');
        return;
      }
      await this._enter();
    }
  }

  async _enter() {
    const c = this.getClient(), cfg = this.cfg, info = this.info;
    const acct = await c.account();
    const freeQ = freeBalance(acct, info.quote);
    if (freeQ < cfg.amount) {
      this.log(`Señal de compra, pero el saldo de ${info.quote} es insuficiente (${fmt(freeQ, 2)})`, 'warn');
      return;
    }
    this.log(`📈 Cruce alcista. Comprando ${cfg.amount} ${info.quote} de ${info.base}…`);
    const r = await c.marketBuyQuote(cfg.symbol, cfg.amount, info.quotePrecision);
    const qty = +r.executedQty, spent = +r.cummulativeQuoteQty;
    if (!(qty > 0)) throw new Error(`La compra no se ejecutó (estado ${r.status})`);

    let commBase = 0, commQuote = 0;
    for (const f of r.fills || []) {
      if (f.commissionAsset === info.base) commBase += +f.commission;
      else if (f.commissionAsset === info.quote) commQuote += +f.commission;
    }
    const entry = spent / qty;
    const p = {
      symbol: cfg.symbol, base: info.base, quote: info.quote,
      entry, qty: qty - commBase, cost: spent + commQuote, time: Date.now(),
      sl: entry * (1 - cfg.slPct / 100), tp: entry * (1 + cfg.tpPct / 100),
      ocoId: null, buyOrderId: r.orderId,
    };
    this.state.position = p;
    this.state.tradesToday++;
    this.save();
    this.log(`✅ Comprado ${fmt(p.qty)} ${info.base} a ${fmt(entry)} · SL ${fmt(p.sl)} · TP ${fmt(p.tp)}`, 'ok');
    this.emit('trade');
    if (cfg.useOco) await this._placeOco();
  }

  async _placeOco() {
    const c = this.getClient(), cfg = this.cfg, info = this.info, p = this.state.position;
    try {
      if (!info.ocoAllowed) throw new Error('el par no admite OCO');
      const acct = await c.account();
      const qty = floorStep(Math.min(p.qty, freeBalance(acct, info.base)), info.stepSize);
      if (+qty < info.minQty || +qty * p.sl < info.minNotional) throw new Error('la cantidad queda bajo el mínimo del par');
      const r = await c.ocoSell({
        symbol: p.symbol, quantity: qty,
        abovePrice: roundTick(p.tp, info.tickSize),
        belowStopPrice: roundTick(p.sl, info.tickSize),
        belowPrice: roundTick(p.sl * (1 - cfg.stopLimitGapPct / 100), info.tickSize),
      });
      p.ocoId = r.orderListId;
      this.save();
      this.log('🛡️ OCO colocada en Binance: el SL/TP queda activo aunque cierres la app', 'ok');
    } catch (e) {
      this.log(`No se pudo colocar la OCO (${e.message}). El bot vigilará SL/TP mientras la app esté abierta.`, 'warn');
    }
  }

  // Devuelve true si la OCO ya se ejecutó y la posición quedó cerrada
  async _checkOco() {
    const c = this.getClient(), p = this.state.position;
    const r = await c.getOrderList(p.ocoId);
    if (r.listOrderStatus !== 'ALL_DONE') return false;
    let got = 0, reason = 'OCO';
    for (const o of r.orders || []) {
      const od = await c.getOrder(p.symbol, o.orderId);
      if (+od.executedQty > 0) {
        got += +od.cummulativeQuoteQty;
        reason = od.type === 'LIMIT_MAKER' ? 'Take-profit (OCO)' : 'Stop-loss (OCO)';
      }
    }
    if (got === 0) {
      p.ocoId = null; this.save();
      this.log('La OCO fue cancelada fuera del bot; ahora vigilo SL/TP desde la app', 'warn');
      return false;
    }
    this._close(got * (1 - this.cfg.feePct / 100), reason);
    return true;
  }

  async _exit(reason) {
    const c = this.getClient(), info = this.info, p = this.state.position;
    if (!p) return;
    if (p.ocoId != null) {
      try { await c.cancelOrderList(p.symbol, p.ocoId); p.ocoId = null; this.save(); }
      catch (e) {
        if (await this._checkOco()) return; // ya se había ejecutado
        if (p.ocoId != null) throw e;
      }
    }
    const acct = await c.account();
    const free = freeBalance(acct, info.base);
    const qty = floorStep(Math.min(p.qty, free), info.stepSize);
    if (!(+qty > 0) || +qty < info.minQty) {
      this.log(`No hay ${info.base} suficiente para vender (libre: ${fmt(free)}). Posición descartada.`, 'warn');
      this.state.position = null; this.save(); this.emit('trade');
      return;
    }
    this.log(`📉 ${reason}. Vendiendo ${qty} ${info.base}…`);
    const r = await c.marketSell(p.symbol, qty);
    let commQ = 0;
    for (const f of r.fills || []) if (f.commissionAsset === info.quote) commQ += +f.commission;
    this._close(+r.cummulativeQuoteQty - commQ, reason);
  }

  _close(netQuote, reason) {
    const st = this.state, p = st.position;
    const pnl = netQuote - p.cost;
    st.trades.unshift({
      symbol: p.symbol, entry: p.entry, exit: netQuote / p.qty, qty: p.qty,
      entryTime: p.time, exitTime: Date.now(), reason, pnl, pnlPct: pnl / p.cost * 100,
    });
    if (st.trades.length > 200) st.trades.length = 200;
    st.pnlToday += pnl;
    st.pnlTotal += pnl;
    st.position = null;
    this.save();
    this.log(`${pnl >= 0 ? '🟢' : '🔴'} Cerrado (${reason}): ${pnl >= 0 ? '+' : ''}${fmt(pnl, 2)} ${p.quote} (${fmt(pnl / p.cost * 100, 2)}%)`, pnl >= 0 ? 'ok' : 'error');
    this.emit('trade');
    if (this.cfg.maxDailyLoss > 0 && st.pnlToday <= -this.cfg.maxDailyLoss) {
      this.stop(`se alcanzó la pérdida diaria máxima (${fmt(st.pnlToday, 2)} ${p.quote})`);
    }
  }

  // Cierre manual desde la interfaz
  async closeNow() {
    if (!this.state.position) return;
    while (this.busy) await new Promise(r => setTimeout(r, 200));
    this.busy = true;
    try {
      const c = this.getClient();
      if (!this.info || this.info.symbol !== this.state.position.symbol) this.info = await c.symbolInfo(this.state.position.symbol);
      if (!this.cfg) this.cfg = this.state.cfg;
      await c.syncTime();
      await this._exit('Cierre manual');
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
