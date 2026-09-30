import { Binance, floorStep, roundTick, freeBalance } from './binance.js';
import { BinanceFutures } from './futures.js';
import { computeIndicators, backtest, backtestFutures } from './indicators.js';
import { Bot, fmt } from './bot.js';
import { FuturesBot } from './futuresBot.js';
import { drawChart } from './chart.js';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const hhmm = t => new Date(t).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const dmy = t => new Date(t).toLocaleString('es-PE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const pnlCls = v => v > 0 ? 'up' : v < 0 ? 'down' : '';
const signed = (v, d = 2) => `${v >= 0 ? '+' : ''}${fmt(v, d)}`;

// ---------------- Ajustes / cliente ----------------
const SETTINGS_KEY = 'settings_v2';
const emptyKeys = () => ({ testnet: { k: '', s: '' }, real: { k: '', s: '' } });
function loadSettings() {
  try {
    const v2 = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
    if (v2) return v2;
    const v1 = JSON.parse(localStorage.getItem('settings_v1') || 'null'); // migra la versión anterior
    if (v1) return { env: v1.env || 'testnet', market: 'spot', keys: { spot: v1.keys || emptyKeys(), futures: emptyKeys() } };
  } catch {}
  return { env: 'testnet', market: 'spot', keys: { spot: emptyKeys(), futures: emptyKeys() } };
}
const settings = loadSettings();
const saveSettings = () => localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
const isFut = () => settings.market === 'futures';

const BASE_CFG = {
  symbol: 'BTCUSDT', interval: '15m', emaFast: 9, emaSlow: 21, rsiPeriod: 14, rsiMax: 70,
  slPct: 1.5, tpPct: 3, maxTrades: 10, tickSec: 15,
};
const DEFAULTS = {
  spot: { ...BASE_CFG, amount: 20, useOco: true, maxDailyLoss: 10, feePct: 0.1, stopLimitGapPct: 0.3 },
  futures: { ...BASE_CFG, amount: 100, leverage: 2, rsiMin: 30, maxDailyLoss: 15, feePct: 0.05 },
};
const CFG_KEYS = { spot: 'bot_cfg_v1', futures: 'fbot_cfg_v1' };
const loadCfg = m => { try { return { ...DEFAULTS[m], ...JSON.parse(localStorage.getItem(CFG_KEYS[m]) || '{}') }; } catch { return { ...DEFAULTS[m] }; } };
let cfg = loadCfg(settings.market);
const saveCfg = () => localStorage.setItem(CFG_KEYS[settings.market], JSON.stringify(cfg));

let client = null;
function getClient() {
  if (!client) {
    const k = settings.keys[settings.market][settings.env];
    const Cls = isFut() ? BinanceFutures : Binance;
    client = new Cls({ apiKey: k.k, apiSecret: k.s, testnet: settings.env === 'testnet' });
  }
  return client;
}
const resetClient = () => { client = null; };

// ---------------- Utilidades UI ----------------
let toastTimer;
function toast(msg, kind = '') {
  const t = $('#toast');
  t.textContent = msg; t.className = `toast ${kind}`; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 4500);
}
async function guard(btn, fn) {
  if (btn) btn.disabled = true;
  try { return await fn(); }
  catch (e) { toast(e.message, 'error'); }
  finally { if (btn) btn.disabled = false; }
}
const segValue = id => $(`#${id} button.on`).dataset.v;
function setSeg(id, v) { $$(`#${id} button`).forEach(x => x.classList.toggle('on', x.dataset.v === v)); }
function bindSeg(id, onChange) {
  $(`#${id}`).addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const prev = segValue(id);
    setSeg(id, b.dataset.v);
    if (onChange && onChange(b.dataset.v) === false) setSeg(id, prev);
  });
}

// ---------------- Bots ----------------
const onBotEvent = src => type => {
  if (src !== bot) return;
  if (type === 'update' || type === 'trade') { renderBot(); updateBadges(); keepAwake(bot.running); if (type === 'trade') drawMarket(); }
  if (type === 'log') renderLog();
};
let bot;
const spotBot = new Bot(getClient, t => onBotEvent(spotBot)(t));
const futBot = new FuturesBot(getClient, t => onBotEvent(futBot)(t));
bot = isFut() ? futBot : spotBot;

// ---------------- Pestañas ----------------
let activeTab = 'market';
$('.tabbar').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  activeTab = b.dataset.tab;
  $$('.tabbar button').forEach(x => x.classList.toggle('on', x === b));
  $$('.tab').forEach(s => s.classList.toggle('active', s.id === `tab-${activeTab}`));
  if (activeTab === 'market') refreshMarket();
  if (activeTab === 'trade') refreshTrade();
  if (activeTab === 'bot') renderBot();
});

// ---------------- Mercado ----------------
let mkCandles = [];
const mkSymbol = () => $('#mkSymbol').value.trim().toUpperCase();
async function refreshMarket() {
  const sym = mkSymbol(), itv = $('#mkInterval').value;
  try {
    const c = getClient();
    const [k, t] = await Promise.all([c.klines(sym, itv, 200), c.ticker24h(sym)]);
    mkCandles = k;
    $('#mkPrice').textContent = fmt(k[k.length - 1].c);
    const ch = +t.priceChangePercent;
    $('#mkChange').textContent = `${signed(ch)}% 24h`;
    $('#mkChange').className = `chg ${pnlCls(ch)}`;
    $('#mkStats').innerHTML = [
      ['Máx. 24h', fmt(+t.highPrice)], ['Mín. 24h', fmt(+t.lowPrice)],
      ['Volumen 24h', fmt(+t.volume, 2)], ['Volumen en cotización', fmt(+t.quoteVolume, 0)],
    ].map(([a, b]) => `<div class="stat"><span>${a}</span><b>${b}</b></div>`).join('');
    drawMarket();
  } catch (e) {
    $('#mkPrice').textContent = '—';
    $('#mkChange').textContent = e.message;
    $('#mkChange').className = 'chg down';
  }
}
function drawMarket() {
  if (!mkCandles.length || !bot) return;
  const sym = mkSymbol();
  const ind = computeIndicators(mkCandles, cfg);
  const r = ind.rsi[ind.rsi.length - 1];
  $('#mkRsi').textContent = `RSI ${r == null ? '—' : r.toFixed(1)}`;
  const markers = [], levels = [];
  for (const t of bot.state.trades) if (t.symbol === sym) {
    const short = t.side === 'SHORT';
    markers.push({ time: t.entryTime, side: short ? 'SELL' : 'BUY' }, { time: t.exitTime, side: short ? 'BUY' : 'SELL' });
  }
  const p = bot.state.position;
  if (p && p.symbol === sym) {
    markers.push({ time: p.time, side: p.side === 'SHORT' ? 'SELL' : 'BUY' });
    levels.push({ price: p.entry, label: `Entrada ${p.side || ''}`, color: '#8a93a0' },
      { price: p.sl, label: 'SL', color: '#f6465d' }, { price: p.tp, label: 'TP', color: '#0ecb81' });
    if (p.liq > 0) levels.push({ price: p.liq, label: 'Liquidación', color: '#ff8a00' });
  }
  drawChart($('#mkChart'), mkCandles, ind, markers, { levels });
}
$('#mkSymbol').addEventListener('change', () => { $('#mkSymbol').value = mkSymbol(); refreshMarket(); refreshTrade(); });
$('#mkInterval').addEventListener('change', refreshMarket);
window.addEventListener('resize', drawMarket);

// ---------------- Operar: Spot ----------------
let trInfo = null, trAccount = null;
function updateTradeForm() {
  const side = segValue('trSide'), type = segValue('trType');
  const marketBuy = side === 'BUY' && type === 'MARKET';
  $('#trAmountWrap').hidden = !marketBuy;
  $('#trQtyWrap').hidden = marketBuy;
  $('#trPriceWrap').hidden = type !== 'LIMIT';
  $('#trMax').hidden = side !== 'SELL';
  const s = $('#trSubmit');
  s.textContent = `${side === 'BUY' ? 'Comprar' : 'Vender'}${type === 'LIMIT' ? ' (límite)' : ''}`;
  s.className = `primary ${side === 'BUY' ? 'buy' : 'sell'}`;
  if (type === 'LIMIT' && !$('#trPrice').value && mkCandles.length) $('#trPrice').value = mkCandles[mkCandles.length - 1].c;
}
bindSeg('trSide', updateTradeForm);
bindSeg('trType', updateTradeForm);

async function refreshSpotTrade() {
  const sym = mkSymbol();
  $('#trSymbolLbl').textContent = sym;
  const c = getClient();
  trInfo = await c.symbolInfo(sym);
  $$('#tab-trade .q').forEach(e => { e.textContent = trInfo.quote; });
  $$('#tab-trade .b').forEach(e => { e.textContent = trInfo.base; });
  if (!c.apiKey) { $('#trBalances').textContent = 'Agrega tus claves API en Ajustes para ver saldos.'; $('#trOrders').textContent = '—'; return; }
  await c.syncTime();
  const [acct, orders] = await Promise.all([c.account(), c.openOrders(sym)]);
  trAccount = acct;
  const bals = (acct.balances || []).map(b => ({ a: b.asset, f: +b.free, l: +b.locked })).filter(b => b.f + b.l > 0)
    .sort((x, y) => (y.a === trInfo.quote) - (x.a === trInfo.quote) || (y.a === trInfo.base) - (x.a === trInfo.base) || x.a.localeCompare(y.a));
  $('#trBalances').innerHTML = bals.length
    ? bals.slice(0, 40).map(b => `<div class="item"><b>${esc(b.a)}</b><div style="text-align:right">${fmt(b.f)}${b.l ? `<div class="sub">en órdenes: ${fmt(b.l)}</div>` : ''}</div></div>`).join('')
    : 'Sin saldos';
  $('#trOrders').innerHTML = orders.length
    ? orders.map(o => `<div class="item"><div><b class="${o.side === 'BUY' ? 'up' : 'down'}">${o.side === 'BUY' ? 'Compra' : 'Venta'}</b> ${esc(o.type)}<div class="sub">${fmt(+o.origQty)} @ ${fmt(+o.price || +o.stopPrice)} · ${dmy(o.time)}</div></div><button class="ghost small" data-cancel="${o.orderId}">Cancelar</button></div>`).join('')
    : 'No hay órdenes abiertas';
}
$('#trRefresh').addEventListener('click', refreshTrade);
$('#trOrders').addEventListener('click', e => {
  const b = e.target.closest('[data-cancel]'); if (!b) return;
  guard(b, async () => { await getClient().cancelOrder(mkSymbol(), b.dataset.cancel); toast('Orden cancelada', 'ok'); refreshTrade(); });
});
$('#trMax').addEventListener('click', () => {
  if (trInfo && trAccount) $('#trQty').value = floorStep(freeBalance(trAccount, trInfo.base), trInfo.stepSize);
});
$('#trSubmit').addEventListener('click', e => guard(e.currentTarget, async () => {
  const c = getClient(), sym = mkSymbol();
  const info = trInfo && trInfo.symbol === sym ? trInfo : await c.symbolInfo(sym);
  const side = segValue('trSide'), type = segValue('trType');
  await c.syncTime();
  let desc, run;
  if (side === 'BUY' && type === 'MARKET') {
    const amt = +$('#trAmount').value;
    if (!(amt >= info.minNotional)) throw new Error(`El mínimo es ${info.minNotional} ${info.quote}`);
    desc = `Comprar ${info.base} por ${amt} ${info.quote} a mercado`;
    run = () => c.marketBuyQuote(sym, amt, info.quotePrecision);
  } else {
    const qty = floorStep(+$('#trQty').value, info.stepSize);
    if (!(+qty >= info.minQty) || +qty === 0) throw new Error(`Cantidad mínima: ${info.minQty} ${info.base}`);
    if (type === 'MARKET') {
      desc = `Vender ${qty} ${info.base} a mercado`;
      run = () => c.marketSell(sym, qty);
    } else {
      const price = roundTick(+$('#trPrice').value, info.tickSize);
      if (+qty * +price < info.minNotional) throw new Error(`El total mínimo es ${info.minNotional} ${info.quote}`);
      desc = `${side === 'BUY' ? 'Comprar' : 'Vender'} ${qty} ${info.base} a ${price} (límite)`;
      run = () => c.limitOrder(sym, side, qty, price);
    }
  }
  if (!confirm(`${settings.env === 'real' ? '⚠️ CUENTA REAL\n' : 'Prueba\n'}${desc}\n\n¿Confirmar?`)) return;
  const r = await run();
  toast(`Orden ${r.status === 'FILLED' ? 'ejecutada' : 'enviada'}: ${r.side} ${fmt(+r.executedQty || +r.origQty)} ${info.base}`, 'ok');
  refreshTrade();
}));

// ---------------- Operar: Futuros ----------------
function updateFutForm() {
  const side = segValue('ftSide');
  const m = +$('#ftMargin').value || 0, lev = +$('#ftLev').value || 1;
  const b = $('#ftSubmit');
  b.textContent = `Abrir ${side === 'LONG' ? 'Long' : 'Short'} a mercado`;
  b.className = `primary wide ${side === 'LONG' ? 'buy' : 'sell'}`;
  $('#ftInfo').textContent = `Tamaño de la posición ≈ ${fmt(m * lev, 2)} USDT. ${side === 'LONG' ? 'Ganas si el precio sube.' : 'Ganas si el precio baja.'} Cada 1% de movimiento en contra = −${fmt(lev, 1)}% de tu margen.`;
}
bindSeg('ftSide', updateFutForm);
$('#ftMargin').addEventListener('input', updateFutForm);
$('#ftLev').addEventListener('input', updateFutForm);

async function refreshFutTrade() {
  const sym = mkSymbol();
  $('#ftSymbolLbl').textContent = sym;
  const c = getClient();
  if (!c.apiKey) {
    $('#ftBalance').innerHTML = '<p class="hint">Agrega tus claves de Futuros en Ajustes.</p>';
    $('#ftPositions').textContent = '—';
    return;
  }
  await c.syncTime();
  const [bal, pos] = await Promise.all([c.usdt(), c.positions()]);
  $('#ftBalance').innerHTML = [
    ['Saldo USDT', fmt(bal.balance, 2)], ['Disponible', fmt(bal.available, 2)],
    ['PnL no realizado', signed(pos.reduce((a, p) => a + p.upnl, 0)), pnlCls(pos.reduce((a, p) => a + p.upnl, 0))],
    ['Posiciones', pos.length],
  ].map(([a, b, k = '']) => `<div class="stat"><span>${a}</span><b class="${k}">${b}</b></div>`).join('');
  $('#ftPositions').innerHTML = pos.length
    ? pos.map(p => `<div class="item"><div><span class="side ${p.side}">${p.side}</span><b>${esc(p.symbol)}</b>
        <div class="sub">${p.qty} @ ${fmt(p.entry)} · marca ${fmt(p.mark)} · liq. ${p.liq ? fmt(p.liq) : '—'}</div></div>
        <div style="text-align:right"><b class="${pnlCls(p.upnl)}">${signed(p.upnl)}</b><br>
        <button class="ghost small" data-fclose="${esc(p.symbol)}" data-side="${p.side}" data-qty="${p.qty}">Cerrar</button></div></div>`).join('')
    : 'No hay posiciones abiertas';
}
$('#ftRefresh').addEventListener('click', refreshTrade);
$('#ftPositions').addEventListener('click', e => {
  const b = e.target.closest('[data-fclose]'); if (!b) return;
  guard(b, async () => {
    const { fclose: sym, side, qty } = b.dataset;
    if (!confirm(`¿Cerrar ${side} de ${qty} en ${sym} a mercado?`)) return;
    const bp = futBot.state.position;
    if (bp && bp.symbol === sym) { await futBot.closeNow(); }
    else {
      const c = getClient();
      try { await c.cancelAllAlgos(sym); } catch {}
      await c.marketClose(sym, side === 'LONG' ? 'SELL' : 'BUY', qty);
    }
    toast('Posición cerrada', 'ok');
    refreshTrade();
  });
});
$('#ftSubmit').addEventListener('click', e => guard(e.currentTarget, async () => {
  const c = getClient(), sym = mkSymbol(), side = segValue('ftSide');
  const margin = +$('#ftMargin').value, lev = Math.round(+$('#ftLev').value);
  if (!(lev >= 1 && lev <= 20)) throw new Error('Apalancamiento entre 1x y 20x');
  if (futBot.running && futBot.cfg?.symbol === sym) throw new Error('El bot está operando este par. Detén el bot o usa otro par.');
  const info = await c.symbolInfo(sym);
  await c.syncTime();
  const price = await c.price(sym);
  const need = FuturesBot.minMargin(info, price, lev);
  if (margin < need) throw new Error(`Con ${lev}x necesitas al menos ${need} USDT de margen en ${sym}`);
  const qty = floorStep(margin * lev / price, info.marketStep);
  if (!confirm(`${settings.env === 'real' ? '⚠️ CUENTA REAL\n' : 'Prueba (Demo)\n'}Abrir ${side} de ${qty} ${info.base} (${margin} USDT × ${lev}x) en ${sym}\nSin stop-loss automático: vigílalo tú.\n\n¿Confirmar?`)) return;
  await c.ensureOneWay();
  if (!(await c.position(sym))) { await c.setMarginType(sym, 'ISOLATED'); await c.setLeverage(sym, lev); }
  await c.marketOpen(sym, side === 'LONG' ? 'BUY' : 'SELL', qty);
  toast(`${side} abierto: ${qty} ${info.base}`, 'ok');
  refreshTrade();
}));

async function refreshTrade() {
  try { await (isFut() ? refreshFutTrade() : refreshSpotTrade()); }
  catch (e) { (isFut() ? $('#ftPositions') : $('#trBalances')).textContent = e.message; }
}

// ---------------- Bot ----------------
const NUM_FIELDS = ['emaFast', 'emaSlow', 'rsiPeriod', 'rsiMax', 'rsiMin', 'amount', 'leverage', 'slPct', 'tpPct', 'maxTrades', 'maxDailyLoss', 'tickSec'];
function fillCfgForm() {
  const f = $('#cfgForm');
  for (const [k, v] of Object.entries(cfg)) {
    const el = f.elements[k]; if (!el) continue;
    if (el.type === 'checkbox') el.checked = !!v; else el.value = v;
  }
  updateCfgInfo();
}
function readCfgForm() {
  const f = $('#cfgForm');
  const out = { ...cfg, symbol: f.elements.symbol.value.trim().toUpperCase(), interval: f.elements.interval.value };
  if (!isFut()) out.useOco = f.elements.useOco.checked;
  for (const k of NUM_FIELDS) if (k in DEFAULTS[settings.market]) out[k] = +f.elements[k].value;
  out.tickSec = Math.max(5, out.tickSec || 15);
  return out;
}
function updateCfgInfo() {
  if (!isFut()) return;
  const c = readCfgForm();
  const risky = c.leverage > 5 ? ' ⚠️ Apalancamiento alto: una racha mala puede costarte mucho.' : '';
  $('#cfgInfo').textContent = `Cada posición ≈ ${fmt(c.amount * c.leverage, 2)} USDT. Stop-loss = −${fmt(c.slPct * c.leverage, 1)}% del margen (≈ −${fmt(c.amount * c.slPct * c.leverage / 100, 2)} USDT); take-profit = +${fmt(c.tpPct * c.leverage, 1)}% (≈ +${fmt(c.amount * c.tpPct * c.leverage / 100, 2)} USDT).${risky}`;
}
$('#cfgForm').addEventListener('input', updateCfgInfo);
$('#cfgForm').addEventListener('change', () => { cfg = readCfgForm(); saveCfg(); drawMarket(); });

function renderBot() {
  const st = bot.state, snap = bot.snapshot, running = bot.running, fut = bot === futBot;
  const quote = bot.info?.quote || 'USDT';
  const b = $('#bsStart');
  b.textContent = running ? '⏹ Detener bot' : '▶ Iniciar bot';
  b.classList.toggle('stop', running);
  $$('#cfgForm input, #cfgForm select').forEach(el => { el.disabled = running; });

  const sig = snap?.signal;
  const pill = $('#bsSignal');
  const up = sig === 'BUY' || sig === 'LONG', down = sig === 'SELL' || sig === 'SHORT';
  pill.textContent = !running ? 'Apagado' : up ? (fut ? 'Señal: LONG' : 'Señal: COMPRA') : down ? (fut ? 'Señal: SHORT' : 'Señal: VENTA') : 'Esperando señal';
  pill.className = `pill ${up ? 'buy' : down ? 'sell' : ''}`;

  const kv = (k, v, cls = '') => `<div class="kv"><span>${k}</span><b class="${cls}">${v}</b></div>`;
  const c = st.cfg || cfg;
  $('#bsGrid').innerHTML = [
    kv('Par', `${esc(c.symbol)}${fut ? ` · ${c.leverage}x` : ''}`),
    kv('Precio', snap ? fmt(snap.price) : '—'),
    kv(`EMA ${c.emaFast} / ${c.emaSlow}`, snap ? `${fmt(snap.fast)} / ${fmt(snap.slow)}` : '—', snap ? (snap.fast > snap.slow ? 'up' : 'down') : ''),
    kv('RSI', snap?.rsi != null ? snap.rsi.toFixed(1) : '—'),
    kv('Resultado hoy', `${fmt(st.pnlToday, 2)} ${quote}`, pnlCls(st.pnlToday)),
    kv('Operaciones hoy', `${st.tradesToday} / ${c.maxTrades}`),
    kv('Resultado total', `${fmt(st.pnlTotal, 2)} ${quote}`, pnlCls(st.pnlTotal)),
    kv('Última revisión', snap ? hhmm(snap.at) : '—'),
  ].join('');

  const p = st.position;
  $('#bsClose').hidden = !p;
  if (p) {
    const side = p.side || 'LONG';
    let upnl = null;
    if (fut) upnl = snap?.upnl ?? null;
    else if (snap?.price) upnl = p.qty * snap.price - p.cost;
    const base = fut ? p.margin : p.cost;
    const prot = fut
      ? (p.slAlgoId && p.tpAlgoId ? '🛡️ SL y TP en Binance' : p.slAlgoId || p.tpAlgoId ? '🛡️ Parcial en Binance' : 'Vigilada por la app')
      : (p.ocoId != null ? '🛡️ OCO en Binance' : 'Vigilada por la app');
    const row = (a, b2) => `<div class="row"><span class="muted">${a}</span><span>${b2}</span></div>`;
    $('#bsPosition').innerHTML = `<div class="pos">
      <div class="row"><b>${fut ? `<span class="side ${side}">${side}</span>` : 'Posición abierta · '}${esc(p.symbol)}</b><span class="${pnlCls(upnl)}">${upnl == null ? '' : `${signed(upnl)} ${esc(p.quote || quote)} (${fmt(upnl / base * 100, 2)}%)`}</span></div>
      ${row('Cantidad', `${fmt(+p.qty)} ${esc(p.base)}`)}
      ${row('Entrada', fmt(p.entry))}
      ${fut ? row('Margen', `${fmt(p.margin, 2)} USDT × ${p.leverage}x`) : ''}
      ${row('Stop-loss / Take-profit', `<span class="down">${fmt(p.sl)}</span> / <span class="up">${fmt(p.tp)}</span>`)}
      ${fut && p.liq ? row('Liquidación', `<span style="color:#ff8a00">${fmt(p.liq)}</span>`) : ''}
      ${row('Protección', prot)}
      ${row('Abierta', dmy(p.time))}
      ${running ? '' : '<button id="bsForget" class="ghost small" style="margin-top:8px">Olvidar posición (sin cerrar)</button>'}
    </div>`;
  } else $('#bsPosition').innerHTML = '';

  $('#bsTrades').innerHTML = st.trades.length
    ? st.trades.slice(0, 50).map(t => `<div class="item"><div>${t.side ? `<span class="side ${t.side}">${t.side}</span>` : ''}<b>${esc(t.symbol)}</b> <span class="muted">${esc(t.reason)}</span><div class="sub">${dmy(t.entryTime)} → ${dmy(t.exitTime)} · ${fmt(t.entry)} → ${fmt(t.exit)}</div></div><b class="${pnlCls(t.pnl)}">${signed(t.pnl)}<div class="sub" style="text-align:right">${fmt(t.pnlPct, 2)}%</div></b></div>`).join('')
    : 'Aún no hay operaciones';
  renderLog();
}
function renderLog() {
  $('#bsLog').innerHTML = bot.state.log.slice(0, 120)
    .map(l => `<div class="${l.level}"><span class="t">${hhmm(l.t)}</span>${esc(l.msg)}</div>`).join('') || '<div class="muted">Sin actividad</div>';
}

$('#bsStart').addEventListener('click', e => guard(e.currentTarget, async () => {
  if (bot.running) { bot.stop(); return; }
  cfg = readCfgForm(); saveCfg();
  if (settings.env === 'real') {
    const extra = isFut() ? `con ${cfg.amount} USDT de margen × ${cfg.leverage}x por operación (long y short)` : `${cfg.amount} por operación`;
    const ok = prompt(`⚠️ CUENTA REAL\nEl bot operará ${cfg.symbol} con tu dinero, ${extra}.\n\nEscribe OPERAR para confirmar:`);
    if ((ok || '').trim().toUpperCase() !== 'OPERAR') return;
  }
  await bot.start(cfg);
  toast('Bot iniciado. Mantén la app abierta.', 'ok');
}));
$('#bsClose').addEventListener('click', e => guard(e.currentTarget, async () => {
  const p = bot.state.position;
  const what = p.side ? `${p.side} de ${fmt(+p.qty)} ${p.base}` : `${fmt(p.qty)} ${p.base}`;
  if (!confirm(`¿Cerrar ahora ${what} a mercado? (se cancelan sus órdenes de protección)`)) return;
  await bot.closeNow();
  toast('Posición cerrada', 'ok');
}));
$('#bsPosition').addEventListener('click', e => {
  if (e.target.id === 'bsForget' && confirm('La app dejará de seguir esta posición, pero NO la cerrará ni cancelará órdenes en Binance. ¿Continuar?')) bot.forgetPosition();
});
$('#bsReset').addEventListener('click', () => { if (confirm('¿Borrar historial de operaciones y registro del bot?')) bot.resetStats(); });

$('#btRun').addEventListener('click', e => guard(e.currentTarget, async () => {
  const c2 = readCfgForm();
  $('#btOut').innerHTML = '<p class="hint">Descargando historial…</p>';
  const candles = await getClient().klines(c2.symbol, c2.interval, 1000);
  const fut = isFut();
  const r = fut ? backtestFutures(candles, c2) : backtest(candles, c2);
  const st = (a, b, k = '') => `<div class="stat"><span>${a}</span><b class="${k}">${b}</b></div>`;
  $('#btOut').innerHTML = `<div class="bt">
    <p class="hint">${esc(c2.symbol)} ${esc(c2.interval)} · ${dmy(r.from)} → ${dmy(r.to)} (1000 velas), comisión ${c2.feePct}% por lado${fut ? `, ${c2.leverage}x` : ''}</p>
    <div class="stats">
      ${st('Resultado', `${signed(r.totalPnl)} (${fmt(r.totalPct, 1)}%)`, pnlCls(r.totalPnl))}
      ${st('Solo mantener', `${fmt(r.holdPct, 1)}%`, pnlCls(r.holdPct))}
      ${st('Operaciones', fut ? `${r.count} (${r.longs} L / ${r.shorts} S)` : r.count)}
      ${st('Aciertos', `${r.wins} (${fmt(r.winRate, 0)}%)`)}
      ${st('Peor caída', r.maxDD ? `-${fmt(r.maxDD, 2)}` : '0', r.maxDD ? 'down' : '')}
      ${st('Posición abierta al final', r.openPosition ? (r.openPosition.side || 'Sí') : 'No')}
    </div>
    <p class="hint">Resultado sobre ${c2.amount} USDT ${fut ? 'de margen ' : ''}por operación. Un buen backtest no garantiza el futuro; úsalo para comparar configuraciones.</p>
  </div>`;
}));

// ---------------- Ajustes ----------------
const HINTS = {
  'spot.testnet': 'Dinero ficticio. Crea tus claves en <b>testnet.binance.vision</b> (inicia sesión con GitHub → Generate HMAC-SHA-256 Key).',
  'spot.real': '⚠️ Las órdenes usan tu dinero real. Crea la clave en Binance → Gestión de API, solo con permiso de trading Spot.',
  'futures.testnet': 'Dinero ficticio (Demo Trading de Binance). Entra a <b>demo.binance.com</b> con tu cuenta de Binance, ve a Futuros y crea una clave en <b>Gestión de API</b>. Es distinta de la clave de Spot Testnet.',
  'futures.real': '⚠️ Dinero real con apalancamiento. Crea la clave en Binance → Gestión de API con <b>Habilitar Futuros</b> activado. Nunca actives retiros.',
};
function applyMarketUI() {
  document.body.classList.toggle('futures', isFut());
  $('#botNote').textContent = isFut()
    ? 'Futuros: el bot abre LONG cuando la EMA rápida cruza hacia arriba y SHORT cuando cruza hacia abajo. Opera mientras la app esté abierta; el stop-loss y el take-profit quedan en Binance aunque la cierres.'
    : 'El bot opera mientras la app esté abierta (la pantalla se mantiene encendida). Si cierras la app, la orden OCO sigue protegiendo tu posición en Binance.';
  $('#stratHint').textContent = isFut()
    ? 'Cruce alcista → cierra el short (si hay) y abre LONG (si el RSI está bajo el máximo). Cruce bajista → cierra el long y abre SHORT (si el RSI está sobre el mínimo). Cada posición lleva stop-loss y take-profit en Binance.'
    : 'Compra cuando la EMA rápida cruza por encima de la lenta (si el RSI no está sobrecomprado). Vende en el cruce contrario, o antes si toca el stop-loss o el take-profit.';
  $('#mktHint').textContent = isFut()
    ? 'Futuros perpetuos USDⓈ-M: ganas en subidas (long) y en bajadas (short). Margen aislado y apalancamiento configurable.'
    : 'Spot: compras la moneda real. Solo ganas cuando el precio sube.';
}
function renderSettings() {
  setSeg('mktSeg', settings.market);
  setSeg('envSeg', settings.env);
  const k = settings.keys[settings.market][settings.env];
  $('#apiKey').value = k.k; $('#apiSecret').value = k.s;
  $('#keysEnvLbl').textContent = `${isFut() ? 'Futuros' : 'Spot'} · ${settings.env === 'testnet' ? 'Prueba' : 'Real'}`;
  $('#envHint').innerHTML = HINTS[`${settings.market}.${settings.env}`];
  $('#keysOut').textContent = '';
}
function updateBadges() {
  const m = $('#mktBadge');
  m.textContent = isFut() ? 'FUTUROS' : 'SPOT';
  m.className = `badge ${isFut() ? 'fut' : ''}`;
  const e = $('#envBadge');
  e.textContent = settings.env === 'testnet' ? 'PRUEBA' : 'REAL';
  e.className = `badge ${settings.env === 'testnet' ? 'testnet' : 'real'}`;
  const b = $('#botBadge');
  const p = bot.state.position;
  b.textContent = bot.running ? (p ? `Bot · ${p.side || 'en posición'}` : 'Bot activo') : 'Bot apagado';
  b.className = `badge ${bot.running ? 'on' : 'off'}`;
}
function canSwitch() {
  if (bot.running) { toast('Detén el bot antes de cambiar esto', 'error'); return false; }
  return true;
}
bindSeg('mktSeg', v => {
  if (!canSwitch()) return false;
  if (v === 'futures' && !confirm('Futuros usa apalancamiento: puedes ganar en subidas y bajadas, pero las pérdidas también se multiplican. Empieza en modo Prueba. ¿Continuar?')) return false;
  settings.market = v; saveSettings(); resetClient();
  bot = isFut() ? futBot : spotBot;
  cfg = loadCfg(v);
  fillCfgForm(); applyMarketUI(); renderSettings(); updateBadges(); renderBot();
  $('#btOut').innerHTML = '';
  refreshMarket();
});
bindSeg('envSeg', v => {
  if (!canSwitch()) return false;
  if (bot.state.position) { toast('Hay una posición abierta del bot; ciérrala antes de cambiar de entorno', 'error'); return false; }
  if (v === 'real' && !confirm('Vas a cambiar a la CUENTA REAL. Las órdenes usarán tu dinero. ¿Continuar?')) return false;
  settings.env = v; saveSettings(); resetClient(); renderSettings(); updateBadges(); refreshMarket();
});
$('#keysSave').addEventListener('click', e => guard(e.currentTarget, async () => {
  settings.keys[settings.market][settings.env] = { k: $('#apiKey').value.trim(), s: $('#apiSecret').value.trim() };
  saveSettings(); resetClient();
  const c = getClient();
  await c.syncTime();
  if (isFut()) {
    const bal = await c.usdt();
    $('#keysOut').innerHTML = `<span class="up">✔ Conectado a Futuros.</span> Saldo: ${fmt(bal.balance, 2)} USDT (disponible ${fmt(bal.available, 2)}).`;
  } else {
    const acct = await c.account();
    if (acct.canTrade === false) throw new Error('La clave funciona, pero no tiene permiso de trading');
    $('#keysOut').innerHTML = `<span class="up">✔ Conectado.</span> Reloj ajustado ${c.offset} ms. Permiso de trading: sí.`;
  }
  toast('Claves guardadas', 'ok');
}));
$('#keysClear').addEventListener('click', () => {
  if (!confirm('¿Borrar las claves de este mercado y entorno?')) return;
  settings.keys[settings.market][settings.env] = { k: '', s: '' }; saveSettings(); resetClient(); renderSettings();
  $('#keysOut').textContent = 'Claves borradas';
});

// ---------------- Pantalla encendida mientras el bot corre ----------------
let wakeLock = null;
async function keepAwake(on) {
  const plug = window.Capacitor?.Plugins?.KeepAwake;
  try {
    if (plug) { on ? await plug.keepAwake() : await plug.allowSleep(); return; }
    if (on && !wakeLock && 'wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch { /* sin soporte */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    keepAwake(bot.running);
    if (activeTab === 'market') refreshMarket();
  }
});

// ---------------- Arranque ----------------
applyMarketUI();
fillCfgForm();
renderSettings();
updateBadges();
updateTradeForm();
updateFutForm();
renderBot();
refreshMarket();
bot.resume();
setInterval(() => {
  if (document.visibilityState !== 'visible') return;
  if (activeTab === 'market') refreshMarket();
  if (activeTab === 'bot') renderBot();
}, 5000);
