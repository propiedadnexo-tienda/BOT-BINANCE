// Cliente de Binance Futuros USDⓈ-M (perpetuos). Reutiliza la firma y el manejo de errores del cliente Spot.
// Testnet = Demo Trading de Binance (demo-fapi.binance.com).
// Stop-loss / take-profit usan el servicio de Algo Orders (/fapi/v1/algoOrder), obligatorio desde fines de 2025.

import { Binance } from './binance.js';
import { COMMODITIES } from './names.js';

export const FUTURES_URLS = {
  real: 'https://fapi.binance.com',
  testnet: 'https://demo-fapi.binance.com',
};

// Binance lista acciones, ETFs y materias primas como contratos TRADIFI_PERPETUAL (liquidados en USDT).
const STOCK_TICKERS = new Set(['TSLA', 'NVDA', 'AAPL', 'META', 'GOOGL', 'GOOG', 'MSFT', 'AMZN', 'NFLX', 'AMD', 'COIN', 'MSTR', 'HOOD', 'PLTR', 'INTC', 'ORCL', 'BABA', 'TSM', 'CRCL', 'PAYP', 'AVGO', 'SPY', 'QQQ', 'EWJ', 'EWY']);
export const PERP_TYPES = new Set(['PERPETUAL', 'TRADIFI_PERPETUAL']);
export function categoryOf(s) {
  if (COMMODITIES.has(s.baseAsset)) return 'commodity';
  const tradfi = s.contractType === 'TRADIFI_PERPETUAL';
  const type = String(s.underlyingType || '').toUpperCase();
  const sub = (s.underlyingSubType || []).join(' ');
  if (tradfi || STOCK_TICKERS.has(s.baseAsset) || /stock|equit|tradfi/i.test(sub) || (type && !['COIN', 'INDEX', 'PREMARKET'].includes(type))) return 'stock';
  return 'crypto';
}

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

  // Todos los perpetuos operables, con categoría Cripto / Acciones
  async markets() {
    if (!this._allInfo) this._allInfo = await this._req('GET', '/fapi/v1/exchangeInfo');
    const t24 = await this._req('GET', '/fapi/v1/ticker/24hr');
    const tick = new Map(t24.map(t => [t.symbol, t]));
    return (this._allInfo.symbols || [])
      .filter(s => s.status === 'TRADING' && PERP_TYPES.has(s.contractType) && (s.marginAsset || s.quoteAsset) === 'USDT')
      .map(s => {
        const t = tick.get(s.symbol) || {};
        return {
          symbol: s.symbol, base: s.baseAsset, category: categoryOf(s),
          price: +t.lastPrice || 0, change: +t.priceChangePercent || 0, volume: +t.quoteVolume || 0,
        };
      })
      .sort((a, b) => b.volume - a.volume);
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
      positionSide: r.positionSide || 'BOTH',
      side: r.positionSide && r.positionSide !== 'BOTH' ? r.positionSide : (+r.positionAmt > 0 ? 'LONG' : 'SHORT'),
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
  async position(symbol, side) {
    return (await this.positions(symbol)).find(p => p.symbol === symbol && (!side || p.side === side)) || null;
  }

  // Modo cobertura (hedge): permite tener LONG y SHORT del mismo activo a la vez (un bot para cada lado)
  async isHedge() { return !!(await this._req('GET', '/fapi/v1/positionSide/dual', {}, true)).dualSidePosition; }
  async ensureHedge() {
    if (await this.isHedge()) return;
    try { await this._req('POST', '/fapi/v1/positionSide/dual', { dualSidePosition: 'true' }, true); }
    catch (e) {
      if (e.code === -4059) return;
      if (e.code === -4067 || e.code === -4068) throw new Error('Para usar bots Long y Short a la vez, Binance necesita el "modo cobertura". Cierra primero tus posiciones y órdenes abiertas de Futuros (pestaña Operar) y vuelve a iniciar.');
      throw e;
    }
  }

  // Modo de posición "una dirección" (one-way)
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
  // posSide: 'LONG' | 'SHORT' en modo cobertura; omitido en modo una dirección
  marketOpen(symbol, side, quantity, posSide) {
    return this.order({ symbol, side, type: 'MARKET', quantity, ...(posSide ? { positionSide: posSide } : {}) });
  }
  // Cierra una posición: side = lado de la posición (LONG/SHORT)
  marketClose(symbol, side, quantity, hedge = false) {
    const orderSide = side === 'LONG' ? 'SELL' : 'BUY';
    return this.order(hedge
      ? { symbol, side: orderSide, type: 'MARKET', quantity, positionSide: side }
      : { symbol, side: orderSide, type: 'MARKET', quantity, reduceOnly: 'true' });
  }
  userTrades(symbol, startTime) { return this._req('GET', '/fapi/v1/userTrades', { symbol, startTime, limit: 100 }, true); }
  openOrders(symbol) { return this._req('GET', '/fapi/v1/openOrders', { symbol }, true); }

  // Stop-loss / take-profit que cierran TODA la posición al tocarse (se ejecutan en Binance aunque la app esté cerrada)
  algoClose({ symbol, side, type, triggerPrice, positionSide }) {
    return this._req('POST', '/fapi/v1/algoOrder', {
      algoType: 'CONDITIONAL', symbol, side, type, triggerPrice, ...(positionSide ? { positionSide } : {}),
      closePosition: 'true', workingType: 'MARK_PRICE', priceProtect: 'true',
    }, true);
  }
  cancelAlgo(algoId) { return this._req('DELETE', '/fapi/v1/algoOrder', { algoId }, true); }
  getAlgo(algoId) { return this._req('GET', '/fapi/v1/algoOrder', { algoId }, true); }
  openAlgos(symbol) { return this._req('GET', '/fapi/v1/openAlgoOrders', { symbol }, true); }
  cancelAllAlgos(symbol) { return this._req('DELETE', '/fapi/v1/algoOpenOrders', { symbol }, true); }
}
