import { Binance, floorStep, roundTick, freeBalance } from './binance.js';
import { BinanceFutures } from './futures.js';
import { computeIndicators, backtest, backtestFutures } from './indicators.js';
import { Bot, fmt } from './bot.js';
import { MultiBot, BOT_DEFAULTS, MAX_BOTS, minMargin, botLabel } from './multibot.js';
import { drawChart } from './chart.js';
import { NAMES, FEATURED, CATEGORY_LABEL, nameOf } from './names.js';

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
    const v1 = JSON.parse(localStorage.getItem('settings_v1') || 'null');
    if (v1) return { env: v1.env || 'testnet', market: 'spot', keys: { spot: v1.keys || emptyKeys(), futures: emptyKeys() } };
  } catch {}
  return { env: 'testnet', market: 'spot', keys: { spot: emptyKeys(), futures: emptyKeys() } };
}
const settings = loadSettings();
const saveSettings = () => localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
const isFut = () => settings.market === 'futures';

const SPOT_DEFAULTS = {
  symbol: 'BTCUSDT', interval: '15m', emaFast: 9, emaSlow: 21, rsiPeriod: 14, rsiMax: 70,
  slPct: 1.5, tpPct: 3, maxTrades: 10, tickSec: 15, amount: 20, useOco: true, maxDailyLoss: 10, feePct: 0.1, stopLimitGapPct: 0.3,
};
const CFG_KEY = 'bot_cfg_v1';
let cfg = (() => { try { return { ...SPOT_DEFAULTS, ...JSON.parse(localStorage.getItem(CFG_KEY) || '{}') }; } catch { return { ...SPOT_DEFAULTS }; } })();
const saveCfg = () => localStorage.setItem(CFG_KEY, JSON.stringify(cfg));

let client = null;
function getClient() {
  if (!client) {
    const k = settings.keys[settings.market][settings.env];
    const Cls = isFut() ? BinanceFutures : Binance;
    client = new Cls({ apiKey: k.k, apiSecret: k.s, testnet: settings.env === 'testnet' });
  }
  return client;
}
const resetClient = () => { client = null; marketsCache = null; };

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
const spotBot = new Bot(getClient, t => { if (!isFut()) onBotEvent(t); });
const mb = new MultiBot(getClient, t => { if (isFut()) onBotEvent(t); });
const engine = () => (isFut() ? mb : spotBot);
function onBotEvent(type) {
  if (type === 'update' || type === 'trade') { renderBot(); updateBadges(); keepAwake(engine().running); if (type === 'trade') drawMarket(); }
  if (type === 'log') renderLog();
}

// ---------------- Selector de activos ----------------
let marketsCache = null, pickerCb = null;
async function loadMarkets() {
  if (!marketsCache) marketsCache = await getClient().markets();
  return marketsCache;
}
const categoryOf = sym => marketsCache?.find(m => m.symbol === sym)?.category;
function openPicker(cb) {
  pickerCb = cb;
  $('#picker').hidden = false;
  $('#pkSearch').value = '';
  setSeg('pkTabs', 'featured');
  renderPicker();
  loadMarkets().then(renderPicker).catch(e => { $('#pkList').innerHTML = `<p class="hint">${esc(e.message)}</p>`; });
}
const tagHtml = cat => cat && cat !== 'crypto' ? `<span class="tag">${CATEGORY_LABEL[cat]}</span>` : '';
function tileHtml(m) {
  return `<button class="tile" data-sym="${esc(m.symbol)}"><b>${esc(nameOf(m.base))}</b><span class="sub">${esc(m.base)}</span>
    <div class="px"><span>${fmt(m.price)}</span><span class="${pnlCls(m.change)}">${signed(m.change)}%</span></div></button>`;
}
function rowHtml(m) {
  return `<div class="pk-item" data-sym="${esc(m.symbol)}">
    <div><span class="nm">${esc(nameOf(m.base))}</span>${tagHtml(m.category)}<div class="sub">${esc(m.base)}/USDT</div></div>
    <div style="text-align:right"><b>${fmt(m.price)}</b><div class="sub ${pnlCls(m.change)}">${signed(m.change)}%</div></div></div>`;
}
function renderPicker() {
  if (!marketsCache) { $('#pkList').innerHTML = '<p class="hint">Cargando activos…</p>'; return; }
  const q = $('#pkSearch').value.trim().toUpperCase(), tab = segValue('pkTabs');
  const bySym = new Map(marketsCache.map(m => [m.base, m]));
  if (tab === 'featured' && !q) {
    const sec = (title, cat) => {
      const items = FEATURED[cat].map(b => bySym.get(b)).filter(Boolean);
      return items.length ? `<div class="pk-sec">${title}</div><div class="tiles">${items.map(tileHtml).join('')}</div>` : '';
    };
    const html = isFut()
      ? sec('🏢 Acciones más grandes y conocidas', 'stock') + sec('🪙 Criptomonedas principales', 'crypto') + sec('🥇 Materias primas', 'commodity')
      : sec('🪙 Criptomonedas principales', 'crypto');
    const noStocks = isFut() && !FEATURED.stock.some(b => bySym.has(b));
    $('#pkList').innerHTML = (noStocks ? '<p class="hint">Tu entorno actual todavía no tiene acciones disponibles; aparecerán aquí cuando Binance las active en tu cuenta.</p>' : '') + (html || '<p class="hint">Sin activos destacados.</p>');
    return;
  }
  const list = marketsCache.filter(m => (q || tab === 'all' || tab === 'featured' || m.category === tab)
    && (!q || m.symbol.includes(q) || nameOf(m.base).toUpperCase().includes(q))).slice(0, 150);
  $('#pkList').innerHTML = list.length ? list.map(rowHtml).join('')
    : `<p class="hint">Sin resultados${tab !== 'crypto' && tab !== 'all' ? '. Puede que tu entorno (Demo o región) aún no tenga estos activos.' : ''}</p>`;
}
$('#pkSearch').addEventListener('input', renderPicker);
bindSeg('pkTabs', renderPicker);
$('#pkClose').addEventListener('click', () => { $('#picker').hidden = true; });
$('#picker').addEventListener('click', e => {
  if (e.target.id === 'picker') { $('#picker').hidden = true; return; }
  const it = e.target.closest('[data-sym]'); if (!it) return;
  $('#picker').hidden = true;
  pickerCb && pickerCb(it.dataset.sym);
});

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
  if (!mkCandles.length) return;
  const sym = mkSymbol();
  const refBot = isFut() ? (mb.bots.find(b => b.symbol === sym) || BOT_DEFAULTS) : cfg;
  const ind = computeIndicators(mkCandles, refBot);
  const r = ind.rsi[ind.rsi.length - 1];
  $('#mkRsi').textContent = `RSI ${r == null ? '—' : r.toFixed(1)}`;
  const markers = [], levels = [];
  for (const t of engine().state.trades) if (t.symbol === sym) {
    const short = t.side === 'SHORT';
    markers.push({ time: t.entryTime, side: short ? 'SELL' : 'BUY' }, { time: t.exitTime, side: short ? 'BUY' : 'SELL' });
  }
  const positions = isFut() ? mb.bots.map(b => b.position).filter(Boolean) : [spotBot.state.position].filter(Boolean);
  for (const p of positions) if (p.symbol === sym) {
    markers.push({ time: p.time, side: p.side === 'SHORT' ? 'SELL' : 'BUY' });
    const tag = p.side ? ` ${p.side}` : '';
    levels.push({ price: p.entry, label: `Entrada${tag}`, color: '#8a93a0' },
      { price: p.sl, label: `SL${tag}`, color: '#f6465d' }, { price: p.tp, label: `TP${tag}`, color: '#0ecb81' });
    if (p.liq > 0) levels.push({ price: p.liq, label: `Liq.${tag}`, color: '#ff8a00' });
  }
  drawChart($('#mkChart'), mkCandles, ind, markers, { levels });
}
$('#mkSymbol').addEventListener('change', () => { $('#mkSymbol').value = mkSymbol(); refreshMarket(); refreshTrade(); });
$('#mkPick').addEventListener('click', () => openPicker(sym => { $('#mkSymbol').value = sym; refreshMarket(); refreshTrade(); }));
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
  const upnl = pos.reduce((a, p) => a + p.upnl, 0);
  $('#ftBalance').innerHTML = [
    ['Saldo USDT', fmt(bal.balance, 2)], ['Disponible', fmt(bal.available, 2)],
    ['PnL no realizado', signed(upnl), pnlCls(upnl)], ['Posiciones', pos.length],
  ].map(([a, b, k = '']) => `<div class="stat"><span>${a}</span><b class="${k}">${b}</b></div>`).join('');
  $('#ftPositions').innerHTML = pos.length
    ? pos.map(p => {
      const owner = mb.bots.find(b => b.position && b.symbol === p.symbol && b.direction === p.side);
      return `<div class="item"><div><span class="side ${p.side}">${p.side}</span><b>${esc(p.symbol)}</b>${owner ? ' <span class="tag">BOT</span>' : ''}
        <div class="sub">${p.qty} @ ${fmt(p.entry)} · marca ${fmt(p.mark)} · liq. ${p.liq ? fmt(p.liq) : '—'}</div></div>
        <div style="text-align:right"><b class="${pnlCls(p.upnl)}">${signed(p.upnl)}</b><br>
        <button class="ghost small" data-fclose="${esc(p.symbol)}" data-side="${p.side}" data-qty="${p.qty}" data-ps="${p.positionSide}">Cerrar</button></div></div>`;
    }).join('')
    : 'No hay posiciones abiertas';
}
$('#ftRefresh').addEventListener('click', refreshTrade);
$('#ftPositions').addEventListener('click', e => {
  const b = e.target.closest('[data-fclose]'); if (!b) return;
  guard(b, async () => {
    const { fclose: sym, side, qty, ps } = b.dataset;
    if (!confirm(`¿Cerrar ${side} de ${qty} en ${sym} a mercado?`)) return;
    const owner = mb.bots.find(x => x.position && x.symbol === sym && x.direction === side);
    if (owner) await mb.closeBot(owner.id);
    else await getClient().marketClose(sym, side, qty, ps !== 'BOTH');
    toast('Posición cerrada', 'ok');
    refreshTrade();
  });
});
$('#ftSubmit').addEventListener('click', e => guard(e.currentTarget, async () => {
  const c = getClient(), sym = mkSymbol(), side = segValue('ftSide');
  const margin = +$('#ftMargin').value, lev = Math.round(+$('#ftLev').value);
  if (!(lev >= 1 && lev <= 20)) throw new Error('Apalancamiento entre 1x y 20x');
  if (mb.bots.some(b => b.symbol === sym && b.direction === side)) throw new Error(`Hay un bot ${side} para ${sym}. Ábrelo desde otro activo o elimina ese bot.`);
  const info = await c.symbolInfo(sym);
  await c.syncTime();
  const price = await c.price(sym);
  const need = minMargin(info, price, lev);
  if (margin < need) throw new Error(`Con ${lev}x necesitas al menos ${need} USDT de margen en ${sym}`);
  const qty = floorStep(margin * lev / price, info.marketStep);
  if (!confirm(`${settings.env === 'real' ? '⚠️ CUENTA REAL\n' : 'Prueba (Demo)\n'}Abrir ${side} de ${qty} ${info.base} (${margin} USDT × ${lev}x) en ${sym}\nSin stop-loss automático: vigílalo tú.\n\n¿Confirmar?`)) return;
  let hedge;
  try { await c.ensureHedge(); hedge = true; } catch { hedge = await c.isHedge(); }
  const busySym = (await c.positions(sym)).length > 0;
  if (!busySym) { await c.setMarginType(sym, 'ISOLATED'); await c.setLeverage(sym, lev); }
  await c.marketOpen(sym, side === 'LONG' ? 'BUY' : 'SELL', qty, hedge ? side : undefined);
  toast(`${side} abierto: ${qty} ${info.base}`, 'ok');
  refreshTrade();
}));

async function refreshTrade() {
  try { await (isFut() ? refreshFutTrade() : refreshSpotTrade()); }
  catch (e) { (isFut() ? $('#ftPositions') : $('#trBalances')).textContent = e.message; }
}

// ---------------- Bot Spot (uno) ----------------
const NUM_FIELDS = ['emaFast', 'emaSlow', 'rsiPeriod', 'rsiMax', 'amount', 'slPct', 'tpPct', 'maxTrades', 'maxDailyLoss', 'tickSec'];
function fillCfgForm() {
  const f = $('#cfgForm');
  for (const [k, v] of Object.entries(cfg)) {
    const el = f.elements[k]; if (!el) continue;
    if (el.type === 'checkbox') el.checked = !!v; else el.value = v;
  }
}
function readCfgForm() {
  const f = $('#cfgForm');
  const out = { ...cfg, symbol: f.elements.symbol.value.trim().toUpperCase(), interval: f.elements.interval.value, useOco: f.elements.useOco.checked };
  for (const k of NUM_FIELDS) out[k] = +f.elements[k].value;
  out.tickSec = Math.max(5, out.tickSec || 15);
  return out;
}
$('#cfgForm').addEventListener('change', () => { cfg = readCfgForm(); saveCfg(); drawMarket(); });

function renderSpotBot() {
  const st = spotBot.state, snap = spotBot.snapshot, running = spotBot.running;
  const quote = spotBot.info?.quote || 'USDT';
  const b = $('#bsStart');
  b.textContent = running ? '⏹ Detener bot' : '▶ Iniciar bot';
  b.classList.toggle('stop', running);
  $$('#cfgForm input, #cfgForm select').forEach(el => { el.disabled = running; });
  const sig = snap?.signal;
  const pill = $('#bsSignal');
  pill.textContent = !running ? 'Apagado' : sig === 'BUY' ? 'Señal: COMPRA' : sig === 'SELL' ? 'Señal: VENTA' : 'Esperando señal';
  pill.className = `pill ${sig === 'BUY' ? 'buy' : sig === 'SELL' ? 'sell' : ''}`;
  const kv = (k, v, cls = '') => `<div class="kv"><span>${k}</span><b class="${cls}">${v}</b></div>`;
  const c = st.cfg || cfg;
  $('#bsGrid').innerHTML = [
    kv('Par', esc(c.symbol)), kv('Precio', snap ? fmt(snap.price) : '—'),
    kv(`EMA ${c.emaFast} / ${c.emaSlow}`, snap ? `${fmt(snap.fast)} / ${fmt(snap.slow)}` : '—', snap ? (snap.fast > snap.slow ? 'up' : 'down') : ''),
    kv('RSI', snap?.rsi != null ? snap.rsi.toFixed(1) : '—'),
    kv('Resultado hoy', `${fmt(st.pnlToday, 2)} ${quote}`, pnlCls(st.pnlToday)), kv('Operaciones hoy', `${st.tradesToday} / ${c.maxTrades}`),
    kv('Resultado total', `${fmt(st.pnlTotal, 2)} ${quote}`, pnlCls(st.pnlTotal)), kv('Última revisión', snap ? hhmm(snap.at) : '—'),
  ].join('');
  const p = st.position;
  $('#bsClose').hidden = !p;
  if (p) {
    const upnl = snap?.price ? p.qty * snap.price - p.cost : null;
    const row = (a, b2) => `<div class="row"><span class="muted">${a}</span><span>${b2}</span></div>`;
    $('#bsPosition').innerHTML = `<div class="pos">
      <div class="row"><b>Posición abierta · ${esc(p.symbol)}</b><span class="${pnlCls(upnl)}">${upnl == null ? '' : `${signed(upnl)} ${esc(p.quote || quote)} (${fmt(upnl / p.cost * 100, 2)}%)`}</span></div>
      ${row('Cantidad', `${fmt(p.qty)} ${esc(p.base)}`)}${row('Entrada', fmt(p.entry))}
      ${row('Stop-loss / Take-profit', `<span class="down">${fmt(p.sl)}</span> / <span class="up">${fmt(p.tp)}</span>`)}
      ${row('Protección', p.ocoId != null ? '🛡️ OCO en Binance' : 'Vigilada por la app')}${row('Abierta', dmy(p.time))}
      ${running ? '' : '<button id="bsForget" class="ghost small" style="margin-top:8px">Olvidar posición (sin vender)</button>'}
    </div>`;
  } else $('#bsPosition').innerHTML = '';
  $('#bsTrades').innerHTML = tradesHtml(st.trades);
}
function tradesHtml(trades) {
  return trades.length
    ? trades.slice(0, 60).map(t => `<div class="item"><div>${t.side ? `<span class="side ${t.side}">${t.side}</span>` : ''}<b>${esc(t.symbol)}</b> <span class="muted">${esc(t.reason)}</span><div class="sub">${dmy(t.entryTime)} → ${dmy(t.exitTime)} · ${fmt(t.entry)} → ${fmt(t.exit)}</div></div><b class="${pnlCls(t.pnl)}">${signed(t.pnl)}<div class="sub" style="text-align:right">${fmt(t.pnlPct, 2)}%</div></b></div>`).join('')
    : 'Aún no hay operaciones';
}
$('#bsStart').addEventListener('click', e => guard(e.currentTarget, async () => {
  if (spotBot.running) { spotBot.stop(); return; }
  cfg = readCfgForm(); saveCfg();
  if (settings.env === 'real') {
    const ok = prompt(`⚠️ CUENTA REAL\nEl bot operará ${cfg.symbol} con tu dinero, ${cfg.amount} por operación.\n\nEscribe OPERAR para confirmar:`);
    if ((ok || '').trim().toUpperCase() !== 'OPERAR') return;
  }
  await spotBot.start(cfg);
  toast('Bot iniciado. Mantén la app abierta.', 'ok');
}));
$('#bsClose').addEventListener('click', e => guard(e.currentTarget, async () => {
  const p = spotBot.state.position;
  if (!confirm(`¿Vender ahora ${fmt(p.qty)} ${p.base} a mercado?`)) return;
  await spotBot.closeNow();
  toast('Posición cerrada', 'ok');
}));
$('#bsPosition').addEventListener('click', e => {
  if (e.target.id === 'bsForget' && confirm('La app dejará de seguir esta posición, pero NO la venderá. ¿Continuar?')) spotBot.forgetPosition();
});
$('#bsReset').addEventListener('click', () => { if (confirm('¿Borrar historial y registro del bot?')) spotBot.resetStats(); });
$('#btRun').addEventListener('click', e => guard(e.currentTarget, async () => {
  const c2 = readCfgForm();
  $('#btOut').innerHTML = '<p class="hint">Descargando historial…</p>';
  const candles = await getClient().klines(c2.symbol, c2.interval, 1000);
  $('#btOut').innerHTML = btHtml(backtest(candles, c2), c2, false);
}));
function btHtml(r, c2, fut) {
  const st = (a, b, k = '') => `<div class="stat"><span>${a}</span><b class="${k}">${b}</b></div>`;
  return `<div class="bt">
    <p class="hint">${esc(c2.symbol)} ${esc(c2.interval)} · ${dmy(r.from)} → ${dmy(r.to)} (1000 velas), comisión ${c2.feePct}% por lado${fut ? `, ${c2.leverage}x` : ''}</p>
    <div class="stats">
      ${st('Resultado', `${signed(r.totalPnl)} (${fmt(r.totalPct, 1)}%)`, pnlCls(r.totalPnl))}
      ${st('Solo mantener', `${fmt(r.holdPct, 1)}%`, pnlCls(r.holdPct))}
      ${st('Operaciones', r.count)}
      ${st('Aciertos', `${r.wins} (${fmt(r.winRate, 0)}%)`)}
      ${st('Peor caída', r.maxDD ? `-${fmt(r.maxDD, 2)}` : '0', r.maxDD ? 'down' : '')}
      ${st('Posición abierta al final', r.openPosition ? (r.openPosition.side || 'Sí') : 'No')}
    </div>
    <p class="hint">Resultado sobre ${c2.amount} USDT ${fut ? 'de margen ' : ''}por operación. Un buen backtest no garantiza el futuro.</p>
  </div>`;
}

// ---------------- Bots de Futuros (varios) ----------------
function renderMulti() {
  const st = mb.state, running = mb.running;
  const pill = $('#mbPill');
  pill.textContent = running ? 'Activos' : 'Apagados';
  pill.className = `pill ${running ? 'buy' : ''}`;
  const active = mb.bots.filter(b => b.enabled).length;
  const upnl = mb.bots.reduce((a, b) => a + (b.position ? (mb.snap[b.id]?.upnl || 0) : 0), 0);
  const kv = (k, v, cls = '') => `<div class="kv"><span>${k}</span><b class="${cls}">${v}</b></div>`;
  $('#mbGrid').innerHTML = [
    kv('Bots activos', `${active} / ${mb.bots.length} (máx. ${MAX_BOTS})`),
    kv('En posición', `${mb.openCount}`),
    kv('Resultado hoy', `${signed(st.pnlToday)} USDT`, pnlCls(st.pnlToday)),
    kv('No realizado', `${signed(upnl)} USDT`, pnlCls(upnl)),
    kv('Resultado total', `${signed(st.pnlTotal)} USDT`, pnlCls(st.pnlTotal)),
    kv('Última revisión', Object.values(mb.snap).length ? hhmm(Math.max(...Object.values(mb.snap).map(s => s.at))) : '—'),
  ].join('');
  if (document.activeElement !== $('#mbMaxLoss')) $('#mbMaxLoss').value = st.global.maxDailyLoss;
  if (document.activeElement !== $('#mbTick')) $('#mbTick').value = st.global.tickSec;
  const b = $('#mbStart');
  b.textContent = running ? '⏹ Detener todos' : '▶ Iniciar todos';
  b.classList.toggle('stop', running);
  $('#mbAdd').disabled = $('#mbPair').disabled = mb.bots.length >= MAX_BOTS;

  $('#mbList').innerHTML = mb.bots.length ? mb.bots.map(bt => {
    const s = mb.snap[bt.id], p = bt.position;
    let status;
    if (p) {
      const u = s?.upnl;
      status = `<b>En posición</b> · ${fmt(+p.qty)} @ ${fmt(p.entry)} · <span class="${pnlCls(u)}">${u == null ? '' : `${signed(u)} USDT (${fmt(u / p.margin * 100, 1)}%)`}</span>
        <div class="meta">SL <span class="down">${fmt(p.sl)}</span> · TP <span class="up">${fmt(p.tp)}</span>${p.liq ? ` · Liq. ${fmt(p.liq)}` : ''} · ${p.slAlgoId && p.tpAlgoId ? '🛡️ en Binance' : 'vigilada por la app'}</div>`;
    } else if (!bt.enabled) status = '<span class="muted">Pausado</span>';
    else if (!running) status = '<span class="muted">Listo — pulsa “Iniciar todos”</span>';
    else status = `Esperando cruce${s ? ` · precio ${fmt(s.price)} · RSI ${s.rsi != null ? s.rsi.toFixed(1) : '—'} · EMA ${s.fast > s.slow ? '<span class="up">al alza</span>' : '<span class="down">a la baja</span>'}` : ''}`;
    return `<div class="card botcard ${bt.enabled ? '' : 'paused'}" data-id="${bt.id}">
      <div class="top"><div><span class="side ${bt.direction}">${bt.direction}</span><b>${esc(nameOf(bt.symbol.replace(/USDT$/, '')))}</b>${tagHtml(categoryOf(bt.symbol))}
        <div class="meta">${esc(bt.interval)} · ${bt.amount} USDT × ${bt.leverage}x · SL ${bt.slPct}% · TP ${bt.tpPct}%</div></div>
        <label class="switch" title="Activar/pausar"><input type="checkbox" data-act="toggle" ${bt.enabled ? 'checked' : ''}><span></span></label></div>
      <div class="st">${status}</div>
      <div class="meta">Hoy: ${bt.tradesToday}/${bt.maxTrades} ops · <span class="${pnlCls(bt.pnlToday)}">${signed(bt.pnlToday)}</span> · Total <span class="${pnlCls(bt.pnlTotal)}">${signed(bt.pnlTotal)}</span> USDT</div>
      <div class="acts">
        <button class="ghost" data-act="edit">Editar</button>
        ${p ? '<button class="danger" data-act="close">Cerrar posición</button>' : '<button class="ghost" data-act="del">Eliminar</button>'}
        ${p && !running ? '<button class="ghost" data-act="forget">Olvidar posición</button>' : ''}
      </div></div>`;
  }).join('') : '<div class="card hint">Aún no tienes bots. Toca <b>⚡ Crear Long + Short</b> para crear dos bots de un activo (uno gana en subidas y otro en bajadas), o <b>＋ Agregar bot</b> para crear uno a medida.</div>';

  $('#mbTrades').innerHTML = st.trades.length
    ? st.trades.slice(0, 80).map(t => `<div class="item"><div><span class="side ${t.side}">${t.side}</span><b>${esc(nameOf(t.symbol.replace(/USDT$/, '')))}</b> <span class="muted">${esc(t.reason)}</span><div class="sub">${dmy(t.entryTime)} → ${dmy(t.exitTime)} · ${fmt(t.entry)} → ${fmt(t.exit)} · ${t.leverage}x</div></div><b class="${pnlCls(t.pnl)}">${signed(t.pnl)}<div class="sub" style="text-align:right">${fmt(t.pnlPct, 1)}%</div></b></div>`).join('')
    : 'Aún no hay operaciones';
}
$('#mbList').addEventListener('click', e => {
  const card = e.target.closest('[data-id]'); const act = e.target.closest('[data-act]')?.dataset.act;
  if (!card || !act || act === 'toggle') return;
  const id = card.dataset.id, bt = mb.bot(id);
  if (act === 'edit') openEditor(bt);
  if (act === 'del' && confirm(`¿Eliminar el bot ${botLabel(bt)}?`)) guard(null, async () => mb.removeBot(id));
  if (act === 'close') guard(e.target, async () => {
    if (!confirm(`¿Cerrar ahora la posición ${bt.direction} de ${bt.symbol} a mercado?`)) return;
    await mb.closeBot(id); toast('Posición cerrada', 'ok');
  });
  if (act === 'forget' && confirm('La app dejará de seguir esta posición pero NO la cerrará en Binance. ¿Continuar?')) mb.forgetPosition(id);
});
$('#mbList').addEventListener('change', e => {
  if (e.target.dataset.act !== 'toggle') return;
  mb.setEnabled(e.target.closest('[data-id]').dataset.id, e.target.checked);
});
$('#mbStart').addEventListener('click', e => guard(e.currentTarget, async () => {
  if (mb.running) { mb.stop(); return; }
  if (settings.env === 'real') {
    const tot = mb.bots.filter(b => b.enabled).reduce((a, b) => a + b.amount, 0);
    const ok = prompt(`⚠️ CUENTA REAL\n${mb.bots.filter(b => b.enabled).length} bots operarán con tu dinero (hasta ${tot} USDT de margen en total, con apalancamiento).\n\nEscribe OPERAR para confirmar:`);
    if ((ok || '').trim().toUpperCase() !== 'OPERAR') return;
  }
  await mb.start();
  toast('Bots iniciados. Mantén la app abierta.', 'ok');
}));
$('#mbMaxLoss').addEventListener('change', e => mb.setGlobal({ maxDailyLoss: Math.max(0, +e.target.value || 0) }));
$('#mbTick').addEventListener('change', e => mb.setGlobal({ tickSec: Math.max(10, +e.target.value || 20) }));
$('#mbReset').addEventListener('click', () => { if (confirm('¿Borrar el historial y el registro de todos los bots?')) mb.resetStats(); });
$('#mbAdd').addEventListener('click', () => openEditor(null));
$('#mbPair').addEventListener('click', () => openPicker(sym => guard(null, async () => {
  const twin = mb.bots.find(b => b.symbol === sym);
  const lev = twin ? twin.leverage : BOT_DEFAULTS.leverage;
  let made = 0;
  for (const dir of ['LONG', 'SHORT']) {
    if (mb.bots.some(b => b.symbol === sym && b.direction === dir)) continue;
    if (mb.bots.length >= MAX_BOTS) { toast(`Máximo ${MAX_BOTS} bots`, 'error'); break; }
    mb.addBot({ symbol: sym, direction: dir, leverage: lev, rsiLimit: dir === 'LONG' ? 70 : 30 });
    made++;
  }
  toast(made ? `Creados ${made} bot(s) para ${sym}. Puedes editarlos antes de iniciar.` : `${sym} ya tiene sus bots Long y Short`, made ? 'ok' : '');
})));

// Editor de bot
let editing = null, edSymbol = 'BTCUSDT';
const ED_NUM = ['amount', 'leverage', 'maxTrades', 'slPct', 'tpPct', 'emaFast', 'emaSlow', 'rsiPeriod', 'rsiLimit'];
function openEditor(bt) {
  editing = bt;
  const base = bt || { ...BOT_DEFAULTS, symbol: mkSymbol() || 'BTCUSDT' };
  edSymbol = base.symbol;
  $('#edTitle').textContent = bt ? `Editar ${botLabel(bt)}` : 'Nuevo bot';
  $('#edSymbol').textContent = `${nameOf(edSymbol.replace(/USDT$/, ''))} · ${edSymbol}  ▾`;
  setSeg('edDir', base.direction);
  const f = $('#edForm');
  f.elements.interval.value = base.interval;
  for (const k of ED_NUM) f.elements[k].value = base[k];
  const locked = !!bt?.position;
  $('#edSymbol').disabled = locked;
  $$('#edDir button').forEach(x => { x.disabled = locked; });
  $('#edBt').innerHTML = '';
  edUpdate();
  $('#editor').hidden = false;
}
function edRead() {
  const f = $('#edForm');
  const out = { symbol: edSymbol, direction: segValue('edDir'), interval: f.elements.interval.value };
  for (const k of ED_NUM) out[k] = +f.elements[k].value;
  return out;
}
function edUpdate() {
  const c = edRead(), long = c.direction === 'LONG';
  $('#edRsiLbl').textContent = long ? 'RSI máx. para abrir' : 'RSI mín. para abrir';
  $('#edInfo').textContent = `${long ? 'Abre LONG cuando la EMA rápida cruza hacia arriba y cierra en el cruce hacia abajo.' : 'Abre SHORT cuando la EMA rápida cruza hacia abajo y cierra en el cruce hacia arriba.'} Posición ≈ ${fmt(c.amount * c.leverage, 2)} USDT · stop-loss ≈ −${fmt(c.amount * c.slPct * c.leverage / 100, 2)} USDT · take-profit ≈ +${fmt(c.amount * c.tpPct * c.leverage / 100, 2)} USDT.`;
}
bindSeg('edDir', v => {
  const f = $('#edForm');
  if (+f.elements.rsiLimit.value === (v === 'LONG' ? 30 : 70)) f.elements.rsiLimit.value = v === 'LONG' ? 70 : 30;
  edUpdate();
});
$('#edForm').addEventListener('input', edUpdate);
$('#edSymbol').addEventListener('click', () => openPicker(sym => { edSymbol = sym; $('#edSymbol').textContent = `${nameOf(sym.replace(/USDT$/, ''))} · ${sym}  ▾`; edUpdate(); }));
$('#edClose').addEventListener('click', () => { $('#editor').hidden = true; });
$('#editor').addEventListener('click', e => { if (e.target.id === 'editor') $('#editor').hidden = true; });
$('#edSave').addEventListener('click', e => guard(e.currentTarget, async () => {
  const c2 = edRead();
  const c = getClient();
  const info = await c.symbolInfo(c2.symbol);
  const need = minMargin(info, await c.price(c2.symbol), c2.leverage);
  if (c2.amount < need) throw new Error(`Con ${c2.leverage}x, ${c2.symbol} necesita al menos ${need} USDT de margen`);
  if (editing) mb.updateBot(editing.id, c2); else mb.addBot(c2);
  $('#editor').hidden = true;
  toast(editing ? 'Bot actualizado' : `Bot ${c2.direction} de ${c2.symbol} creado`, 'ok');
}));
$('#edTest').addEventListener('click', e => guard(e.currentTarget, async () => {
  const c2 = { ...BOT_DEFAULTS, ...edRead() };
  c2.rsiMax = c2.direction === 'LONG' ? c2.rsiLimit : 101;
  c2.rsiMin = c2.direction === 'SHORT' ? c2.rsiLimit : -1;
  $('#edBt').innerHTML = '<p class="hint">Descargando historial…</p>';
  const candles = await getClient().klines(c2.symbol, c2.interval, 1000);
  $('#edBt').innerHTML = btHtml(backtestFutures(candles, c2), c2, true);
}));

// ---------------- Render general del bot ----------------
function renderBot() { isFut() ? renderMulti() : renderSpotBot(); renderLog(); }
function renderLog() {
  const el = isFut() ? $('#mbLog') : $('#bsLog');
  el.innerHTML = engine().state.log.slice(0, 150)
    .map(l => `<div class="${l.level}"><span class="t">${hhmm(l.t)}</span>${esc(l.msg)}</div>`).join('') || '<div class="muted">Sin actividad</div>';
}

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
    ? `Futuros: hasta ${MAX_BOTS} bots a la vez, cada uno en un activo y una dirección (Long o Short). Operan mientras la app esté abierta; el stop-loss y el take-profit de cada posición quedan en Binance aunque la cierres.`
    : 'El bot opera mientras la app esté abierta (la pantalla se mantiene encendida). Si cierras la app, la orden OCO sigue protegiendo tu posición en Binance.';
  $('#stratHint').textContent = 'Compra cuando la EMA rápida cruza por encima de la lenta (si el RSI no está sobrecomprado). Vende en el cruce contrario, o antes si toca el stop-loss o el take-profit.';
  $('#mktHint').textContent = isFut()
    ? 'Futuros perpetuos USDⓈ-M: cripto y acciones (Tesla, NVIDIA, Apple…). Bots Long ganan en subidas y bots Short en bajadas. Margen aislado.'
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
  const b = $('#botBadge'), en = engine();
  if (isFut()) b.textContent = en.running ? `${mb.bots.filter(x => x.enabled).length} bots · ${mb.openCount} en posición` : 'Bots apagados';
  else b.textContent = en.running ? (spotBot.state.position ? 'Bot · en posición' : 'Bot activo') : 'Bot apagado';
  b.className = `badge ${en.running ? 'on' : 'off'}`;
}
function canSwitch() {
  if (engine().running) { toast('Detén los bots antes de cambiar esto', 'error'); return false; }
  return true;
}
bindSeg('mktSeg', v => {
  if (!canSwitch()) return false;
  if (v === 'futures' && !confirm('Futuros usa apalancamiento: puedes ganar en subidas y bajadas, pero las pérdidas también se multiplican. Empieza en modo Prueba. ¿Continuar?')) return false;
  settings.market = v; saveSettings(); resetClient();
  applyMarketUI(); renderSettings(); updateBadges(); renderBot();
  $('#btOut').innerHTML = '';
  refreshMarket();
  if (v === 'futures') loadMarkets().then(renderBot).catch(() => {});
});
bindSeg('envSeg', v => {
  if (!canSwitch()) return false;
  const open = isFut() ? mb.openCount : spotBot.state.position ? 1 : 0;
  if (open) { toast('Hay posiciones abiertas de los bots; ciérralas antes de cambiar de entorno', 'error'); return false; }
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
    keepAwake(engine().running);
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
if (isFut()) loadMarkets().then(renderBot).catch(() => {});
engine().resume();
setInterval(() => {
  if (document.visibilityState !== 'visible') return;
  if (activeTab === 'market') refreshMarket();
  if (activeTab === 'bot') renderBot();
}, 5000);
