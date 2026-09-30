// Cliente de Binance Futuros USDⓈ-M (perpetuos). Reutiliza la firma y el manejo de errores del cliente Spot.
// Testnet = Demo Trading de Binance (demo-fapi.binance.com).
// Stop-loss / take-profit usan el servicio de Algo Orders (/fapi/v1/algoOrder), obligatorio desde fines de 2025.

import { Binance } from './binance.js';

export const FUTURES_URLS = {
  real: 'https://fapi.binance.com',
  testnet: 'https://demo-fapi.binance.com',
};

export class BinanceFutures extends Binance {
  constructor(opts) {
    super(opts);
    this.market = 'futures';
    this.paths = { time: '/fapi/v1/time', klines: '/fapi/v1/klines', t24: '/fapi/v1/ticker/24hr' };
    this._allInfo = null;
  }

  get base() { return this.testnet ? FUTURES_URLS.testnet : FUTURES_URLS.real; }

  async price(symbol) {
    const d = await this._req('GET', '/fapi/v1/ticker/price', { symbol });
    return +d.price;
  }

  async symbolInfo(symbol) {
    if (this._info.has(symbol)) return this._info.get(symbol);
    if (!this._allInfo) this._allInfo = await this._req('GET', '/fapi/v1/exchangeInfo');
    const s = (this._allInfo.symbols || []).find(x => x.symbol === symbol);
    if (!s) throw new Error(`Par ${symbol} no encontrado en Futuros`);
    const f = t => s.filters.find(x => x.filterType === t) || {};
    const lot = f('LOT_SIZE'), mlot = f('MARKET_LOT_SIZE');
    const info = {
      symbol: s.symbol,
      status: s.status,
      contractType: s.contractType,
      base: s.baseAsset,
      quote: s.marginAsset || s.quoteAsset,
      stepSize: lot.stepSize || '0.001',
      marketStep: mlot.stepSize || lot.stepSize || '0.001',
      minQty: Math.max(+(lot.minQty || 0), +(mlot.minQty || 0)),
      maxMarketQty: +(mlot.maxQty || Infinity),
      tickSize: f('PRICE_FILTER').tickSize || '0.1',
      minNotional: +(f('MIN_NOTIONAL').notional || 5),
    };
    this._info.set(symbol, info);
    return info;
  }

  // ---------- Cuenta ----------
  account() { return this._req('GET', '/fapi/v3/account', {}, true); }
  balances() { return this._req('GET', '/fapi/v3/balance', {}, true); }
  async usdt(asset = 'USDT') {
    const b = (await this.balances()).find(x => x.asset === asset) || {};
    return { balance: +(b.balance || 0), available: +(b.availableBalance || 0), upnl: +(b.crossUnPnl || 0) };
  }

  // Posiciones con cantidad distinta de cero
  async positions(symbol) {
    const rows = await this._req('GET', '/fapi/v3/positionRisk', symbol ? { symbol } : {}, true);
    return rows.filter(r => +r.positionAmt !== 0).map(r => ({
      symbol: r.symbol,
      side: +r.positionAmt > 0 ? 'LONG' : 'SHORT',
      amt: +r.positionAmt,
      qty: String(r.positionAmt).replace('-', ''),
      entry: +r.entryPrice,
      mark: +r.markPrice,
      upnl: +r.unRealizedProfit,
      liq: +r.liquidationPrice,
      margin: +(r.isolatedWallet || r.initialMargin || 0),
      notional: Math.abs(+r.notional || 0),
    }));
  }
  async position(symbol) { return (await this.positions(symbol)).find(p => p.symbol === symbol) || null; }

  // Modo de posición "una dirección" (one-way): requerido por el bot
  async ensureOneWay() {
    const d = await this._req('GET', '/fapi/v1/positionSide/dual', {}, true);
    if (d.dualSidePosition) {
      try { await this._req('POST', '/fapi/v1/positionSide/dual', { dualSidePosition: 'false' }, true); }
      catch (e) {
        if (e.code !== -4059) throw new Error(`Cambia tu cuenta de Futuros a modo "Una dirección" (One-way): ${e.message}`);
      }
    }
  }
  async setMarginType(symbol, marginType = 'ISOLATED') {
    try { await this._req('POST', '/fapi/v1/marginType', { symbol, marginType }, true); }
    catch (e) { if (![-4046, -4048].includes(e.code)) throw e; } // ya estaba así / hay posición abierta
  }
  setLeverage(symbol, leverage) {
    return this._req('POST', '/fapi/v1/leverage', { symbol, leverage: Math.round(leverage) }, true);
  }

  // ---------- Órdenes ----------
  order(params) { return this._req('POST', '/fapi/v1/order', { newOrderRespType: 'RESULT', ...params }, true); }
  marketOpen(symbol, side, quantity) { return this.order({ symbol, side, type: 'MARKET', quantity }); }
  marketClose(symbol, side, quantity) { return this.order({ symbol, side, type: 'MARKET', quantity, reduceOnly: 'true' }); }
  userTrades(symbol, startTime) { return this._req('GET', '/fapi/v1/userTrades', { symbol, startTime, limit: 100 }, true); }
  openOrders(symbol) { return this._req('GET', '/fapi/v1/openOrders', { symbol }, true); }

  // Stop-loss / take-profit que cierran TODA la posición al tocarse (se ejecutan en Binance aunque la app esté cerrada)
  algoClose({ symbol, side, type, triggerPrice }) {
    return this._req('POST', '/fapi/v1/algoOrder', {
      algoType: 'CONDITIONAL', symbol, side, type, triggerPrice,
      closePosition: 'true', workingType: 'MARK_PRICE', priceProtect: 'true',
    }, true);
  }
  getAlgo(algoId) { return this._req('GET', '/fapi/v1/algoOrder', { algoId }, true); }
  openAlgos(symbol) { return this._req('GET', '/fapi/v1/openAlgoOrders', { symbol }, true); }
  cancelAllAlgos(symbol) { return this._req('DELETE', '/fapi/v1/algoOpenOrders', { symbol }, true); }
}
