// Cliente mínimo de la API REST de Binance Spot (firma HMAC-SHA256 con Web Crypto).
// En el APK, Capacitor enruta fetch por HTTP nativo (CapacitorHttp), así que no hay problemas de CORS.

export const BASE_URLS = {
  real: 'https://api.binance.com',
  testnet: 'https://testnet.binance.vision',
};

export async function hmacHex(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function toQuery(params) {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

function decimalsOf(step) {
  const s = String(step);
  if (!s.includes('.')) return 0;
  const frac = s.split('.')[1].replace(/0+$/, '');
  return frac.length;
}

// Redondea hacia abajo al múltiplo de step (cantidades: nunca vender más de lo que tienes)
export function floorStep(value, step) {
  const st = +step;
  if (!(st > 0)) return String(value);
  const n = Math.floor(value / st + 1e-9) * st;
  return n.toFixed(decimalsOf(step));
}

// Redondea hacia arriba al múltiplo de step
export function ceilStep(value, step) {
  const st = +step;
  if (!(st > 0)) return String(value);
  const n = Math.ceil(value / st - 1e-9) * st;
  return n.toFixed(decimalsOf(step));
}

// Redondea al tick de precio más cercano
export function roundTick(value, tick) {
  const t = +tick;
  if (!(t > 0)) return String(value);
  return (Math.round(value / t) * t).toFixed(decimalsOf(tick));
}

export function freeBalance(account, asset) {
  const b = (account.balances || []).find(x => x.asset === asset);
  return b ? +b.free : 0;
}

export class Binance {
  constructor({ apiKey = '', apiSecret = '', testnet = true } = {}) {
    this.apiKey = apiKey.trim();
    this.apiSecret = apiSecret.trim();
    this.testnet = testnet;
    this.offset = 0; // diferencia reloj local vs servidor
    this._info = new Map();
    this.market = 'spot';
    this.paths = { time: '/api/v3/time', klines: '/api/v3/klines', t24: '/api/v3/ticker/24hr' };
  }

  get base() { return this.testnet ? BASE_URLS.testnet : BASE_URLS.real; }

  async _req(method, path, params = {}, signed = false) {
    const headers = {};
    let qs;
    if (signed) {
      if (!this.apiKey || !this.apiSecret) throw new Error('Faltan la API Key y el Secret (pestaña Ajustes)');
      qs = toQuery({ ...params, recvWindow: 10000, timestamp: Date.now() + this.offset });
      qs += `&signature=${await hmacHex(this.apiSecret, qs)}`;
      headers['X-MBX-APIKEY'] = this.apiKey;
    } else {
      qs = toQuery(params);
    }
    const url = `${this.base}${path}${qs ? `?${qs}` : ''}`;
    let res;
    try {
      res = await fetch(url, { method, headers });
    } catch (e) {
      throw new Error(`Sin conexión con Binance (${e.message})`);
    }
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    if (!res.ok) {
      const msg = data && data.msg ? data.msg : `HTTP ${res.status}`;
      const err = new Error(data && data.code ? `${msg} (código ${data.code})` : msg);
      err.code = data && data.code;
      err.status = res.status;
      throw err;
    }
    return data;
  }

  async syncTime() {
    const t0 = Date.now();
    const { serverTime } = await this._req('GET', this.paths.time);
    const t1 = Date.now();
    this.offset = serverTime - Math.round((t0 + t1) / 2);
    return this.offset;
  }

  now() { return Date.now() + this.offset; }

  // ---------- Datos públicos ----------
  async klines(symbol, interval, limit = 200) {
    const rows = await this._req('GET', this.paths.klines, { symbol, interval, limit });
    return rows.map(r => ({ t: r[0], o: +r[1], h: +r[2], l: +r[3], c: +r[4], v: +r[5], ct: r[6] }));
  }

  // Pares en USDT operables en Spot, ordenados por volumen
  async markets() {
    const t24 = await this._req('GET', '/api/v3/ticker/24hr');
    return t24.filter(t => /USDT$/.test(t.symbol) && +t.lastPrice > 0)
      .map(t => ({ symbol: t.symbol, base: t.symbol.replace(/USDT$/, ''), category: 'crypto', price: +t.lastPrice, change: +t.priceChangePercent, volume: +t.quoteVolume }))
      .sort((a, b) => b.volume - a.volume);
  }

  async price(symbol) {
    const d = await this._req('GET', '/api/v3/ticker/price', { symbol });
    return +d.price;
  }

  ticker24h(symbol) { return this._req('GET', this.paths.t24, { symbol }); }

  async symbolInfo(symbol) {
    if (this._info.has(symbol)) return this._info.get(symbol);
    const d = await this._req('GET', '/api/v3/exchangeInfo', { symbol });
    const s = d.symbols && d.symbols[0];
    if (!s) throw new Error(`Par ${symbol} no encontrado`);
    const f = t => s.filters.find(x => x.filterType === t) || {};
    const info = {
      symbol: s.symbol,
      status: s.status,
      base: s.baseAsset,
      quote: s.quoteAsset,
      quotePrecision: s.quoteAssetPrecision ?? s.quotePrecision ?? 8,
      stepSize: f('LOT_SIZE').stepSize || '0.00000001',
      minQty: +(f('LOT_SIZE').minQty || 0),
      tickSize: f('PRICE_FILTER').tickSize || '0.01',
      minNotional: +(f('NOTIONAL').minNotional || f('MIN_NOTIONAL').minNotional || 0),
      ocoAllowed: s.ocoAllowed !== false,
    };
    this._info.set(symbol, info);
    return info;
  }

  // ---------- Cuenta (firmado) ----------
  account() { return this._req('GET', '/api/v3/account', { omitZeroBalances: true }, true); }
  openOrders(symbol) { return this._req('GET', '/api/v3/openOrders', { symbol }, true); }
  getOrder(symbol, orderId) { return this._req('GET', '/api/v3/order', { symbol, orderId }, true); }
  cancelOrder(symbol, orderId) { return this._req('DELETE', '/api/v3/order', { symbol, orderId }, true); }

  order(params) { return this._req('POST', '/api/v3/order', { newOrderRespType: 'FULL', ...params }, true); }

  marketBuyQuote(symbol, quoteAmount, quotePrecision = 8) {
    const q = floorStep(quoteAmount, (10 ** -Math.min(quotePrecision, 8)).toFixed(Math.min(quotePrecision, 8)));
    return this.order({ symbol, side: 'BUY', type: 'MARKET', quoteOrderQty: q });
  }

  marketSell(symbol, quantity) {
    return this.order({ symbol, side: 'SELL', type: 'MARKET', quantity });
  }

  limitOrder(symbol, side, quantity, price) {
    return this.order({ symbol, side, type: 'LIMIT', timeInForce: 'GTC', quantity, price });
  }

  // OCO de venta: take-profit (LIMIT_MAKER arriba) + stop-loss (STOP_LOSS_LIMIT abajo).
  // Queda en el exchange: protege la posición aunque la app esté cerrada.
  ocoSell({ symbol, quantity, abovePrice, belowStopPrice, belowPrice }) {
    return this._req('POST', '/api/v3/orderList/oco', {
      symbol, side: 'SELL', quantity,
      aboveType: 'LIMIT_MAKER', abovePrice,
      belowType: 'STOP_LOSS_LIMIT', belowStopPrice, belowPrice, belowTimeInForce: 'GTC',
    }, true);
  }

  getOrderList(orderListId) { return this._req('GET', '/api/v3/orderList', { orderListId }, true); }
  cancelOrderList(symbol, orderListId) { return this._req('DELETE', '/api/v3/orderList', { symbol, orderListId }, true); }
}
