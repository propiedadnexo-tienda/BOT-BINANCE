// Investigación con datos REALES de Binance Futuros (data.binance.vision, datos públicos).
// Prueba varias variantes de estrategia en varios activos y temporalidades, separando
// meses de "entrenamiento" (para elegir) y meses de "validación" (para confirmar sin trampa).
// Uso: node tools/research.mjs  → escribe research/results.md y research/results.json

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { backtestBot, combine } from '../www/js/strategy.js';

const ASSETS = (process.env.ASSETS || 'BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,XRPUSDT,DOGEUSDT,NVDAUSDT,TSLAUSDT').split(',');
const INTERVALS = (process.env.INTERVALS || '15m,1h,4h').split(',');
const MONTHS = +(process.env.MONTHS || 8);
const OOS_MONTHS = +(process.env.OOS_MONTHS || 3);
const BAL = 5000;
const FEE = 0.06; // 0.05 % comisión taker + 0.01 % deslizamiento, por lado
const CACHE = '/tmp/bvdata';

function monthsBack(n) {
  const out = []; const d = new Date(); d.setUTCDate(1);
  for (let k = n; k >= 1; k--) {
    const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - k, 1));
    out.push(`${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}
function daysThisMonth() {
  const out = []; const now = new Date();
  for (let day = 1; day < now.getUTCDate(); day++) {
    out.push(`${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
  }
  return out;
}
function fetchZip(url, file) {
  if (fs.existsSync(file)) return true;
  try {
    execSync(`curl -sfL --retry 3 -o "${file}.zip" "${url}" && unzip -o -q "${file}.zip" -d "${path.dirname(file)}" && rm "${file}.zip"`, { stdio: 'pipe' });
    const csv = fs.readdirSync(path.dirname(file)).find(f => f.endsWith('.csv') && url.includes(f.replace('.csv', '')));
    if (csv && path.join(path.dirname(file), csv) !== file) fs.renameSync(path.join(path.dirname(file), csv), file);
    return fs.existsSync(file);
  } catch { return false; }
}
function parse(file) {
  return fs.readFileSync(file, 'utf8').trim().split('\n')
    .filter(l => /^\d/.test(l))
    .map(l => { const r = l.split(','); return { t: +r[0], o: +r[1], h: +r[2], l: +r[3], c: +r[4], v: +r[5], ct: +r[6] }; });
}
function load(sym, itv) {
  const dir = path.join(CACHE, sym, itv); fs.mkdirSync(dir, { recursive: true });
  let rows = [];
  for (const m of monthsBack(MONTHS)) {
    const f = path.join(dir, `${sym}-${itv}-${m}.csv`);
    if (fetchZip(`https://data.binance.vision/data/futures/um/monthly/klines/${sym}/${itv}/${sym}-${itv}-${m}.zip`, f)) rows = rows.concat(parse(f));
  }
  for (const d of daysThisMonth()) {
    const f = path.join(dir, `${sym}-${itv}-${d}.csv`);
    if (fetchZip(`https://data.binance.vision/data/futures/um/daily/klines/${sym}/${itv}/${sym}-${itv}-${d}.zip`, f)) rows = rows.concat(parse(f));
  }
  const seen = new Set();
  return rows.filter(r => !seen.has(r.t) && seen.add(r.t)).sort((a, b) => a.t - b.t);
}

// Variantes a comparar (todas con gestión de riesgo del 1 % por operación, tope 5x)
const RISK = { sizeMode: 'risk', riskPct: 1, amount: 500, leverage: 5, rsiPeriod: 14 };
const VARIANTS = {
  A_cruce_basico:        { ...RISK, entryMode: 'cross', emaFast: 9, emaSlow: 21, trendEma: 0, stopMode: 'pct', slPct: 1.5, tpPct: 3, rsiL: 70 },
  B_cruce_filtro200_atr: { ...RISK, entryMode: 'cross', emaFast: 9, emaSlow: 21, trendEma: 200, stopMode: 'atr', slAtr: 1.5, tpAtr: 3, rsiL: 70 },
  C_tendencia_200_atr15: { ...RISK, entryMode: 'trend', emaFast: 9, emaSlow: 21, trendEma: 200, stopMode: 'atr', slAtr: 1.5, tpAtr: 3, cooldown: 3, maxExtAtr: 1.5, rsiL: 70 },
  D_tendencia_200_atr2:  { ...RISK, entryMode: 'trend', emaFast: 9, emaSlow: 21, trendEma: 200, stopMode: 'atr', slAtr: 2, tpAtr: 4, cooldown: 3, maxExtAtr: 1.5, rsiL: 70 },
  E_tend_20_50_200_atr2: { ...RISK, entryMode: 'trend', emaFast: 20, emaSlow: 50, trendEma: 200, stopMode: 'atr', slAtr: 2, tpAtr: 4, cooldown: 5, maxExtAtr: 2, rsiL: 75 },
  F_cruce_20_50_200_atr2:{ ...RISK, entryMode: 'cross', emaFast: 20, emaSlow: 50, trendEma: 200, stopMode: 'atr', slAtr: 2, tpAtr: 4, rsiL: 75 },
};
const botCfg = (v, dir) => ({ ...v, direction: dir, rsiLimit: dir === 'LONG' ? v.rsiL : 100 - v.rsiL });

const fmt = (n, d = 1) => (n == null || !isFinite(n) ? (n === Infinity ? '∞' : '—') : (+n).toFixed(d));
const results = { generated: new Date().toISOString(), months: MONTHS, oosMonths: OOS_MONTHS, balance: BAL, fee: FEE, data: {}, grid: [] };

const data = {};
for (const sym of ASSETS) for (const itv of INTERVALS) {
  const rows = load(sym, itv);
  if (rows.length > 300) { data[`${sym}|${itv}`] = rows; results.data[`${sym}|${itv}`] = { candles: rows.length, from: new Date(rows[0].t).toISOString().slice(0, 10), to: new Date(rows.at(-1).t).toISOString().slice(0, 10) }; }
  console.log(sym, itv, rows.length, 'velas');
}
const split = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - OOS_MONTHS + 1, 1) - (new Date().getUTCDate() > 1 ? 0 : 0);

for (const [vname, v] of Object.entries(VARIANTS)) for (const itv of INTERVALS) {
  const per = [];
  for (const sym of ASSETS) {
    const rows = data[`${sym}|${itv}`]; if (!rows) continue;
    const warm = 600; // velas de calentamiento para EMA 200 antes de cada tramo
    const isIdx = rows.findIndex(r => r.t >= split);
    const IS = rows.slice(0, isIdx > 0 ? isIdx : rows.length);
    const OOS = isIdx > 0 ? rows.slice(Math.max(0, isIdx - warm)) : [];
    for (const dir of ['LONG', 'SHORT']) {
      const b = botCfg(v, dir);
      const ris = backtestBot(IS, b, { balance: BAL, feePct: FEE });
      const roos = OOS.length ? backtestBot(OOS, b, { balance: BAL, feePct: FEE }) : null;
      if (roos) roos.trades = roos.trades.filter(t => t.entryTime >= split);
      per.push({ sym, dir, is: ris, oos: roos });
    }
  }
  if (!per.length) continue;
  const cis = combine(per.map(p => p.is)), coos = combine(per.map(p => p.oos).filter(Boolean));
  results.grid.push({
    variant: vname, interval: itv,
    is: { n: cis.count, win: cis.winRate, pf: cis.profitFactor, pnl: cis.totalPnl, dd: cis.maxDD },
    oos: { n: coos.count, win: coos.winRate, pf: coos.profitFactor, pnl: coos.totalPnl, dd: coos.maxDD },
    perBot: per.map(p => {
      const o = p.oos ? combine([p.oos]) : null;
      return { sym: p.sym, dir: p.dir, isPnl: p.is.totalPnl, isPf: p.is.profitFactor, isN: p.is.count, oosPnl: o?.totalPnl, oosPf: o?.profitFactor, oosN: o?.count };
    }),
  });
}

// Informe
results.grid.sort((a, b) => b.is.pnl - a.is.pnl);
let md = `# Investigación de estrategias con datos reales de Binance Futuros\n\nGenerado: ${results.generated}\n\n`;
md += `Saldo de referencia ${BAL} USDT · riesgo 1 % por operación · tope 5x · comisión+deslizamiento ${FEE}% por lado.\n`;
md += `Entrenamiento: meses anteriores a ${new Date(split).toISOString().slice(0, 10)} · Validación: desde esa fecha (${OOS_MONTHS} meses).\n\n`;
md += `Datos: ${Object.entries(results.data).map(([k, v]) => `${k} (${v.candles} velas, ${v.from}→${v.to})`).join(', ')}\n\n`;
md += '## Todas las variantes (suma de todos los activos, Long y Short)\n\n| Variante | Velas | Ops entr. | PF entr. | PnL entr. | Máx. caída entr. | Ops valid. | Win % valid. | PF valid. | PnL valid. | Máx. caída valid. |\n|---|---|---|---|---|---|---|---|---|---|---|\n';
for (const g of results.grid) md += `| ${g.variant} | ${g.interval} | ${g.is.n} | ${fmt(g.is.pf, 2)} | ${fmt(g.is.pnl, 0)} | ${fmt(g.is.dd, 0)} | ${g.oos.n} | ${fmt(g.oos.win, 0)} | ${fmt(g.oos.pf, 2)} | ${fmt(g.oos.pnl, 0)} | ${fmt(g.oos.dd, 0)} |\n`;
for (const g of results.grid.slice(0, 3)) {
  md += `\n## Detalle por bot: ${g.variant} ${g.interval}\n\n| Activo | Dir. | Ops entr. | PF entr. | PnL entr. | Ops valid. | PF valid. | PnL valid. |\n|---|---|---|---|---|---|---|---|\n`;
  for (const p of g.perBot) md += `| ${p.sym} | ${p.dir} | ${p.isN} | ${fmt(p.isPf, 2)} | ${fmt(p.isPnl, 0)} | ${p.oosN ?? '—'} | ${fmt(p.oosPf, 2)} | ${fmt(p.oosPnl, 0)} |\n`;
}
fs.mkdirSync('research', { recursive: true });
fs.writeFileSync('research/results.md', md);
fs.writeFileSync('research/results.json', JSON.stringify(results, null, 1));
console.log(md);
