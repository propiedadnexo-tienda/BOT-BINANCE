import { Binance, floorStep, roundTick, freeBalance } from './binance.js';
import { computeIndicators, backtest } from './indicators.js';
import { Bot, fmt } from './bot.js';
import { drawChart } from './chart.js';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const hhmm = t => new Date(t).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const dmy = t => new Date(t).toLocaleString('es-PE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

// ---------------- Ajustes / cliente ----------------
const SETTINGS_KEY = 'settings_v1', CFG_KEY = 'bot_cfg_v1';
const load = (k, d) => { try { return { ...d, ...JSON.parse(localStorage.getItem(k) || '{}') }; } catch { return d; } };
const settings = load(SETTINGS_KEY, { env: 'testnet', keys: { testnet: { k: '', s: '' }, real: { k: '', s: '' } } });
const saveSettings = () => localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));

const DEFAULT_CFG = {
  symbol: 'BTCUSDT', interval: '15m', emaFast: 9, emaSlow: 21, rsiPeriod: 14, rsiMax: 70,
  amount: 20, slPct: 1.5, tpPct: 3, useOco: true, maxTrades: 10, maxDailyLoss: 10, tickSec: 15,
  feePct: 0.1, stopLimitGapPct: 0.3,
};
let cfg = load(CFG_KEY, DEFAULT_CFG);

let client = null;
function getClient() {
  if (!client) {
    const k = settings.keys[settings.env];
    client = new Binance({ apiKey: k.k, apiSecret: k.s, testnet: settings.env === 'testnet' });
  }
  return client;
}
const resetClient = () => { client = null; };

// ---------------- Utilidades UI ----------------
let toastTimer;
function toast(msg, kind = '') {
  const t = $('#toast');
  t.textContent = msg; t.className = `toast ${kind}`; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 4000);
}
async function guard(btn, fn) {
  if (btn) btn.disabled = true;
  try { return await fn(); }
  catch (e) { toast(e.message, 'error'); }
  finally { if (btn) btn.disabled = false; }
}
function segValue(id) { return $(`#${id} button.on`).dataset.v; }
function bindSeg(id, onChange) {
  $(`#${id}`).addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    $$(`#${id} button`).forEach(x => x.classList.toggle('on', x === b));
    onChange && onChange(b.dataset.v);
  });
}

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
async function refreshMarket() {
  const sym = $('#mkSymbol').value.trim().toUpperCase();
  const itv = $('#mkInterval').value;
  try {
    const c = getClient();
    const [k, t] = await Promise.all([c.klines(sym, itv, 200), c.ticker24h(sym)]);
    mkCandles = k;
    const last = k[k.length - 1].c;
    $('#mkPrice').textContent = fmt(last);
    const ch = +t.priceChangePercent;
    $('#mkChange').textContent = `${ch >= 0 ? '+' : ''}${ch.toFixed(2)}% 24h`;
    $('#mkChange').className = `chg ${ch >= 0 ? 'up' : 'down'}`;
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
  const sym = $('#mkSymbol').value.trim().toUpperCase();
  const ind = computeIndicators(mkCandles, cfg);
  const r = ind.rsi[ind.rsi.length - 1];
  $('#mkRsi').textContent = `RSI ${r == null ? '—' : r.toFixed(1)}`;
  const markers = [];
  for (const t of bot.state.trades) if (t.symbol === sym) {
    markers.push({ time: t.entryTime, side: 'BUY' }, { time: t.exitTime, side: 'SELL' });
  }
  const levels = [];
  const p = bot.state.position;
  if (p && p.symbol === sym) {
    markers.push({ time: p.time, side: 'BUY' });
    levels.push({ price: p.entry, label: 'Entrada', color: '#8a93a0' },
      { price: p.sl, label: 'SL', color: '#f6465d' }, { price: p.tp, label: 'TP', color: '#0ecb81' });
  }
  drawChart($('#mkChart'), mkCandles, ind, markers, { levels });
}
$('#mkSymbol').addEventListener('change', () => { $('#mkSymbol').value = $('#mkSymbol').value.trim().toUpperCase(); refreshMarket(); refreshTrade(); });
$('#mkInterval').addEventListener('change', refreshMarket);
window.addEventListener('resize', drawMarket);

// ---------------- Operar (manual) ----------------
let trInfo = null, trAccount = null;
const trSymbol = () => $('#mkSymbol').value.trim().toUpperCase();

function updateTradeForm() {
  const side = segValue('trSide'), type = segValue('trType');
  const marketBuy = side === 'BUY' && type === 'MARKET';
  $('#trAmountWrap').hidden = !marketBuy;
  $('#trQtyWrap').hidden = marketBuy;
  $('#trPriceWrap').hidden = type !== 'LIMIT';
  $('#trMax').hidden = side !== 'SELL';
  $$('#trSide button').forEach(b => b.classList.toggle(b.dataset.v === 'BUY' ? 'buy' : 'sell', true));
  const s = $('#trSubmit');
  s.textContent = `${side === 'BUY' ? 'Comprar' : 'Vender'}${type === 'LIMIT' ? ' (límite)' : ''}`;
  s.className = `primary ${side === 'BUY' ? 'buy' : 'sell'}`;
  if (type === 'LIMIT' && !$('#trPrice').value && mkCandles.length) $('#trPrice').value = mkCandles[mkCandles.length - 1].c;
}
bindSeg('trSide', updateTradeForm);
bindSeg('trType', updateTradeForm);

async function refreshTrade() {
  const sym = trSymbol();
  $('#trSymbolLbl').textContent = sym;
  try {
    const c = getClient();
    trInfo = await c.symbolInfo(sym);
    $$('#tab-trade .q').forEach(e => { e.textContent = trInfo.quote; });
    $$('#tab-trade .b').forEach(e => { e.textContent = trInfo.base; });
    if (!c.apiKey) {
      $('#trBalances').textContent = 'Agrega tus claves API en Ajustes para ver saldos.';
      $('#trOrders').textContent = '—';
      return;
    }
    await c.syncTime();
    const [acct, orders] = await Promise.all([c.account(), c.openOrders(sym)]);
    trAccount = acct;
    const bals = (acct.balances || [])
      .map(b => ({ a: b.asset, f: +b.free, l: +b.locked }))
      .filter(b => b.f + b.l > 0)
      .sort((x, y) => (y.a === trInfo.quote) - (x.a === trInfo.quote) || (y.a === trInfo.base) - (x.a === trInfo.base) || x.a.localeCompare(y.a));
    $('#trBalances').innerHTML = bals.length
      ? bals.slice(0, 40).map(b => `<div class="item"><b>${esc(b.a)}</b><div style="text-align:right">${fmt(b.f)}${b.l ? `<div class="sub">en órdenes: ${fmt(b.l)}</div>` : ''}</div></div>`).join('')
      : 'Sin saldos';
    $('#trOrders').innerHTML = orders.length
      ? orders.map(o => `<div class="item"><div><b class="${o.side === 'BUY' ? 'up' : 'down'}">${o.side === 'BUY' ? 'Compra' : 'Venta'}</b> ${esc(o.type)}<div class="sub">${fmt(+o.origQty)} @ ${fmt(+o.price || +o.stopPrice)} · ${dmy(o.time)}</div></div><button class="ghost small" data-cancel="${o.orderId}">Cancelar</button></div>`).join('')
      : 'No hay órdenes abiertas';
  } catch (e) {
    $('#trBalances').textContent = e.message;
  }
}
$('#trRefresh').addEventListener('click', refreshTrade);
$('#trOrders').addEventListener('click', e => {
  const b = e.target.closest('[data-cancel]'); if (!b) return;
  guard(b, async () => {
    await getClient().cancelOrder(trSymbol(), b.dataset.cancel);
    toast('Orden cancelada', 'ok'); refreshTrade();
  });
});
$('#trMax').addEventListener('click', () => {
  if (trInfo && trAccount) $('#trQty').value = floorStep(freeBalance(trAccount, trInfo.base), trInfo.stepSize);
});
$('#trSubmit').addEventListener('click', e => guard(e.currentTarget, async () => {
  const c = getClient(), sym = trSymbol();
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
  const envTxt = settings.env === 'real' ? '⚠️ CUENTA REAL\n' : 'Testnet\n';
  if (!confirm(`${envTxt}${desc}\n\n¿Confirmar?`)) return;
  const r = await run();
  toast(`Orden ${r.status === 'FILLED' ? 'ejecutada' : 'enviada'}: ${r.side} ${fmt(+r.executedQty || +r.origQty)} ${info.base}`, 'ok');
  refreshTrade();
}));

// ---------------- Bot ----------------
const bot = new Bot(getClient, (type) => {
  if (type === 'update' || type === 'trade') { renderBot(); updateBadges(); keepAwake(bot.running); if (type === 'trade') drawMarket(); }
  if (type === 'log') renderLog();
});

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
$('#cfgForm').addEventListener('change', () => {
  cfg = readCfgForm();
  localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
  drawMarket();
});

function renderBot() {
  const st = bot.state, snap = bot.snapshot, running = bot.running;
  const quote = bot.info?.quote || 'USDT';
  const b = $('#bsStart');
  b.textContent = running ? '⏹ Detener bot' : '▶ Iniciar bot';
  b.classList.toggle('stop', running);
  $$('#cfgForm input, #cfgForm select').forEach(el => { el.disabled = running; });

  const sig = snap?.signal;
  const pill = $('#bsSignal');
  pill.textContent = !running ? 'Apagado' : sig === 'BUY' ? 'Señal: COMPRA' : sig === 'SELL' ? 'Señal: VENTA' : 'Esperando señal';
  pill.className = `pill ${sig === 'BUY' ? 'buy' : sig === 'SELL' ? 'sell' : ''}`;

  const kv = (k, v, cls = '') => `<div class="kv"><span>${k}</span><b class="${cls}">${v}</b></div>`;
  const pnlCls = v => v > 0 ? 'up' : v < 0 ? 'down' : '';
  $('#bsGrid').innerHTML = [
    kv('Par', esc(st.cfg?.symbol || cfg.symbol)),
    kv('Precio', snap ? fmt(snap.price) : '—'),
    kv(`EMA ${cfg.emaFast} / ${cfg.emaSlow}`, snap ? `${fmt(snap.fast)} / ${fmt(snap.slow)}` : '—', snap ? (snap.fast > snap.slow ? 'up' : 'down') : ''),
    kv('RSI', snap?.rsi != null ? snap.rsi.toFixed(1) : '—'),
    kv('Resultado hoy', `${fmt(st.pnlToday, 2)} ${quote}`, pnlCls(st.pnlToday)),
    kv('Operaciones hoy', `${st.tradesToday} / ${cfg.maxTrades}`),
    kv('Resultado total', `${fmt(st.pnlTotal, 2)} ${quote}`, pnlCls(st.pnlTotal)),
    kv('Última revisión', snap ? hhmm(snap.at) : '—'),
  ].join('');

  const p = st.position;
  $('#bsClose').hidden = !p;
  if (p) {
    const price = snap?.price;
    const upnl = price ? p.qty * price - p.cost : null;
    $('#bsPosition').innerHTML = `<div class="pos">
      <div class="row"><b>Posición abierta · ${esc(p.symbol)}</b><span class="${pnlCls(upnl)}">${upnl == null ? '' : `${upnl >= 0 ? '+' : ''}${fmt(upnl, 2)} ${esc(p.quote)} (${fmt(upnl / p.cost * 100, 2)}%)`}</span></div>
      <div class="row"><span class="muted">Cantidad</span><span>${fmt(p.qty)} ${esc(p.base)}</span></div>
      <div class="row"><span class="muted">Entrada</span><span>${fmt(p.entry)}</span></div>
      <div class="row"><span class="muted">Stop-loss / Take-profit</span><span><span class="down">${fmt(p.sl)}</span> / <span class="up">${fmt(p.tp)}</span></span></div>
      <div class="row"><span class="muted">Protección</span><span>${p.ocoId != null ? '🛡️ OCO en Binance' : 'Vigilada por la app'}</span></div>
      <div class="row"><span class="muted">Abierta</span><span>${dmy(p.time)}</span></div>
      ${running ? '' : '<button id="bsForget" class="ghost small" style="margin-top:8px">Olvidar posición (sin vender)</button>'}
    </div>`;
  } else $('#bsPosition').innerHTML = '';

  $('#bsTrades').innerHTML = st.trades.length
    ? st.trades.slice(0, 50).map(t => `<div class="item"><div><b>${esc(t.symbol)}</b> <span class="muted">${esc(t.reason)}</span><div class="sub">${dmy(t.entryTime)} → ${dmy(t.exitTime)} · ${fmt(t.entry)} → ${fmt(t.exit)}</div></div><b class="${pnlCls(t.pnl)}">${t.pnl >= 0 ? '+' : ''}${fmt(t.pnl, 2)}<div class="sub" style="text-align:right">${fmt(t.pnlPct, 2)}%</div></b></div>`).join('')
    : 'Aún no hay operaciones';
  renderLog();
}
function renderLog() {
  $('#bsLog').innerHTML = bot.state.log.slice(0, 120)
    .map(l => `<div class="${l.level}"><span class="t">${hhmm(l.t)}</span>${esc(l.msg)}</div>`).join('') || '<div class="muted">Sin actividad</div>';
}

$('#bsStart').addEventListener('click', e => guard(e.currentTarget, async () => {
  if (bot.running) { bot.stop(); return; }
  cfg = readCfgForm();
  localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
  if (settings.env === 'real') {
    const ok = prompt(`⚠️ CUENTA REAL\nEl bot comprará y venderá ${cfg.symbol} con tu dinero, ${cfg.amount} por operación.\n\nEscribe OPERAR para confirmar:`);
    if ((ok || '').trim().toUpperCase() !== 'OPERAR') return;
  }
  await bot.start(cfg);
  toast('Bot iniciado. Mantén la app abierta.', 'ok');
}));
$('#bsClose').addEventListener('click', e => guard(e.currentTarget, async () => {
  const p = bot.state.position;
  if (!confirm(`Vender ahora ${fmt(p.qty)} ${p.base} a mercado${p.ocoId != null ? ' (se cancelará la OCO)' : ''}?`)) return;
  await bot.closeNow();
  toast('Posición cerrada', 'ok');
}));
$('#bsPosition').addEventListener('click', e => {
  if (e.target.id === 'bsForget' && confirm('La app dejará de seguir esta posición, pero NO venderá ni cancelará órdenes en Binance. ¿Continuar?')) bot.forgetPosition();
});
$('#bsReset').addEventListener('click', () => {
  if (confirm('¿Borrar historial de operaciones y registro del bot?')) bot.resetStats();
});

$('#btRun').addEventListener('click', e => guard(e.currentTarget, async () => {
  const c2 = readCfgForm();
  $('#btOut').innerHTML = '<p class="hint">Descargando historial…</p>';
  const candles = await getClient().klines(c2.symbol, c2.interval, 1000);
  const r = backtest(candles, c2);
  const cls = v => v > 0 ? 'up' : v < 0 ? 'down' : '';
  const st = (a, b, k = '') => `<div class="stat"><span>${a}</span><b class="${k}">${b}</b></div>`;
  $('#btOut').innerHTML = `<div class="bt">
    <p class="hint">${esc(c2.symbol)} ${esc(c2.interval)} · ${dmy(r.from)} → ${dmy(r.to)} (1000 velas), comisión ${c2.feePct}% por lado</p>
    <div class="stats">
      ${st('Resultado', `${r.totalPnl >= 0 ? '+' : ''}${fmt(r.totalPnl, 2)} (${fmt(r.totalPct, 1)}%)`, cls(r.totalPnl))}
      ${st('Solo mantener', `${fmt(r.holdPct, 1)}%`, cls(r.holdPct))}
      ${st('Operaciones', r.count)}
      ${st('Aciertos', `${r.wins} (${fmt(r.winRate, 0)}%)`)}
      ${st('Peor caída', r.maxDD ? `-${fmt(r.maxDD, 2)}` : '0', r.maxDD ? 'down' : '')}
      ${st('Posición abierta al final', r.openPosition ? 'Sí' : 'No')}
    </div>
    <p class="hint">El resultado es sobre ${c2.amount} por operación. Un buen backtest no garantiza el futuro; úsalo para comparar configuraciones.</p>
  </div>`;
}));

// ---------------- Ajustes ----------------
function renderSettings() {
  $$('#envSeg button').forEach(b => b.classList.toggle('on', b.dataset.v === settings.env));
  const k = settings.keys[settings.env];
  $('#apiKey').value = k.k; $('#apiSecret').value = k.s;
  $('#keysEnvLbl').textContent = settings.env === 'testnet' ? 'Testnet' : 'Cuenta real';
  $('#envHint').innerHTML = settings.env === 'testnet'
    ? 'Dinero ficticio. Crea tus claves en <b>testnet.binance.vision</b> (inicia sesión con GitHub → Generate HMAC-SHA-256 Key).'
    : '⚠️ Las órdenes usan tu dinero real. Crea la clave en Binance → Gestión de API, solo con permiso de trading Spot.';
}
function updateBadges() {
  const e = $('#envBadge');
  e.textContent = settings.env === 'testnet' ? 'TESTNET' : 'REAL';
  e.className = `badge ${settings.env === 'testnet' ? 'testnet' : 'real'}`;
  const b = $('#botBadge');
  b.textContent = bot.running ? (bot.state.position ? 'Bot · en posición' : 'Bot activo') : 'Bot apagado';
  b.className = `badge ${bot.running ? 'on' : 'off'}`;
}
bindSeg('envSeg', v => {
  if (bot.running) { toast('Detén el bot antes de cambiar de entorno', 'error'); renderSettings(); return; }
  if (bot.state.position) { toast('Hay una posición abierta del bot; ciérrala antes de cambiar de entorno', 'error'); renderSettings(); return; }
  if (v === 'real' && !confirm('Vas a cambiar a la CUENTA REAL. Las órdenes usarán tu dinero. ¿Continuar?')) { renderSettings(); return; }
  settings.env = v; saveSettings(); resetClient(); renderSettings(); updateBadges(); refreshMarket();
});
$('#keysSave').addEventListener('click', e => guard(e.currentTarget, async () => {
  settings.keys[settings.env] = { k: $('#apiKey').value.trim(), s: $('#apiSecret').value.trim() };
  saveSettings(); resetClient();
  const c = getClient();
  await c.syncTime();
  const acct = await c.account();
  if (acct.canTrade === false) throw new Error('La clave funciona, pero no tiene permiso de trading');
  $('#keysOut').innerHTML = `<span class="up">✔ Conectado.</span> Reloj ajustado ${c.offset} ms. Permiso de trading: sí.`;
  toast('Claves guardadas', 'ok');
}));
$('#keysClear').addEventListener('click', () => {
  if (!confirm('¿Borrar las claves de este entorno?')) return;
  settings.keys[settings.env] = { k: '', s: '' }; saveSettings(); resetClient(); renderSettings();
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
  } catch { /* sin soporte: el usuario debe mantener la pantalla encendida */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    keepAwake(bot.running);
    if (activeTab === 'market') refreshMarket();
  }
});

// ---------------- Arranque ----------------
fillCfgForm();
renderSettings();
updateBadges();
updateTradeForm();
renderBot();
refreshMarket();
bot.resume();
setInterval(() => {
  if (document.visibilityState !== 'visible') return;
  if (activeTab === 'market') refreshMarket();
  if (activeTab === 'bot') renderBot();
}, 5000);
