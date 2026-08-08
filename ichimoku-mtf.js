/* ichimoku-mtf.js — MULTI-TIMEFRAME Ichimoku. Higher TF sets the trend bias; lower TF times the entry
 * (pullback to Kijun/Tenkan, or aligned TK cross). Goal: higher win rate riding established long trends.
 * Standalone side project — shares nothing with the live system.
 *
 * HTF bias (strong sustained trend): close>cloud AND Tenkan>Kijun AND future cloud bullish (SSA>SSB). Mirror short.
 * LTF entry (only in bias direction): pullback-to-Kijun bounce, pullback-to-Tenkan, or LTF TK cross.
 * Exits compared: trailKijun (LTF), htfFlip (hold until HTF bias flips = swing/position), fixed3R.
 * No look-ahead: each LTF bar sees only the most recently COMPLETED HTF bar.
 *
 * Usage: node ichimoku-mtf.js [HTF_min] [LTF_min]   default 240 60  (H4 bias / H1 entry).  env: STOPR
 */
const fs = require('fs');
const HTF = +(process.argv[2] || 240), LTF = +(process.argv[3] || 60);
const T = 9, K = 26, B = 52, DISP = 26, SW = 4;
const PAIRS = [
  { sym: 'USD/JPY', file: 'Z:/code/bot1/data/USDJPY_1M_BID_25.06.2023-26.06.2024.csv', fmt: 'dot', pip: 0.01, spread: 1.3 },
  { sym: 'EUR/USD', file: 'Z:/code/bot1/data/duka/eurusd-m1-bid-2023-06-26-2025-06-26.csv', fmt: 'ms', pip: 0.0001, spread: 0.8 },
  { sym: 'XAU/USD', file: 'Z:/code/bot1/data/duka/xauusd-m1-bid-2023-06-26-2025-06-26.csv', fmt: 'ms', pip: 0.1, spread: 4.6 },
];
function parse(file, fmt) { const raw = fs.readFileSync(file, 'utf8').split('\n'); const A = [];
  for (let i = 1; i < raw.length; i++) { const p = raw[i].split(','); if (p.length < 5) continue; let t, o, h, l, c;
    if (fmt === 'ms') { t = +p[0] / 1000; o = +p[1]; h = +p[2]; l = +p[3]; c = +p[4]; }
    else { const m = p[0].match(/^(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2})/); if (!m) continue; t = Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4], +m[5]) / 1000; o = +p[1]; h = +p[2]; l = +p[3]; c = +p[4]; }
    if (!o || isNaN(t)) continue; A.push({ time: t, o, h, l, c }); }
  return A; }
function rs(A, m) { const s = m * 60, mp = new Map(); for (const b of A) { const bt = Math.floor(b.time / s) * s; const g = mp.get(bt); if (!g) mp.set(bt, { time: bt, o: b.o, h: b.h, l: b.l, c: b.c }); else { g.c = b.c; if (b.h > g.h) g.h = b.h; if (b.l < g.l) g.l = b.l; } } return [...mp.values()].sort((a, b) => a.time - b.time); }
const hh = (A, i, n) => { let m = -Infinity; for (let j = i - n + 1; j <= i; j++) if (A[j].h > m) m = A[j].h; return m; };
const ll = (A, i, n) => { let m = Infinity; for (let j = i - n + 1; j <= i; j++) if (A[j].l < m) m = A[j].l; return m; };
function ichimoku(A) { const n = A.length;
  for (let i = 0; i < n; i++) { A[i].tenkan = i >= T - 1 ? (hh(A, i, T) + ll(A, i, T)) / 2 : null; A[i].kijun = i >= K - 1 ? (hh(A, i, K) + ll(A, i, K)) / 2 : null;
    A[i].ssaRaw = (A[i].tenkan != null && A[i].kijun != null) ? (A[i].tenkan + A[i].kijun) / 2 : null; A[i].ssbRaw = i >= B - 1 ? (hh(A, i, B) + ll(A, i, B)) / 2 : null; }
  for (let i = 0; i < n; i++) { const j = i - DISP; A[i].ssa = j >= 0 ? A[j].ssaRaw : null; A[i].ssb = j >= 0 ? A[j].ssbRaw : null;
    A[i].cloudTop = (A[i].ssa != null && A[i].ssb != null) ? Math.max(A[i].ssa, A[i].ssb) : null; A[i].cloudBot = (A[i].ssa != null && A[i].ssb != null) ? Math.min(A[i].ssa, A[i].ssb) : null; }
  return A; }
function biasOf(b) { if (b.cloudTop == null || b.ssaRaw == null) return 0;
  if (b.c > b.cloudTop && b.tenkan > b.kijun && b.ssaRaw > b.ssbRaw) return 1;
  if (b.c < b.cloudBot && b.tenkan < b.kijun && b.ssaRaw < b.ssbRaw) return -1; return 0; }

const PREP = {};  // cache parse+resample+ichimoku per pair (expensive) so strategy cells are cheap
function prep(P) { if (PREP[P.sym]) return PREP[P.sym]; const one = parse(P.file, P.fmt);
  return PREP[P.sym] = { H: ichimoku(rs(one, HTF)), L: ichimoku(rs(one, LTF)) }; }
function run(P, entryMode, exitMode) {
  const { H, L } = prep(P);
  const HTFsec = HTF * 60; // map each LTF bar to latest COMPLETED HTF bar
  let hp = 0; const trades = []; let busyUntil = -1; const n = L.length;
  for (let i = K + DISP; i < n - 2; i++) { const b = L[i], pb = L[i - 1]; if (b.kijun == null || b.cloudTop == null) continue;
    while (hp + 1 < H.length && H[hp + 1].time + HTFsec <= b.time) hp++;               // advance to latest completed HTF bar
    if (H[hp].time + HTFsec > b.time) continue; const bias = biasOf(H[hp]); if (bias === 0) continue;
    if (i <= busyUntil) continue;
    let trig = false; const dir = bias;
    if (entryMode === 'kijunPB') trig = (dir > 0 ? (b.l <= b.kijun && b.c > b.kijun && pb.c > pb.kijun) : (b.h >= b.kijun && b.c < b.kijun && pb.c < pb.kijun));
    else if (entryMode === 'tenkanPB') trig = (dir > 0 ? (b.l <= b.tenkan && b.c > b.tenkan) : (b.h >= b.tenkan && b.c < b.tenkan));
    else if (entryMode === 'tkCross') trig = (dir > 0 ? (pb.tenkan <= pb.kijun && b.tenkan > b.kijun) : (pb.tenkan >= pb.kijun && b.tenkan < b.kijun));
    if (!trig) continue;
    const entry = b.c; let sw = dir > 0 ? -Infinity : Infinity; for (let j = i - SW; j < i; j++) if (j >= 0) sw = dir > 0 ? Math.max(sw, L[j].h) : Math.min(sw, L[j].l);
    let stop = dir > 0 ? Math.min(sw, b.l) - 2 * P.pip : Math.max(sw, b.h) + 2 * P.pip; const risk = Math.abs(entry - stop), stopP = risk / P.pip; if (stopP < 2 || stopP > 150) continue;
    const target = dir > 0 ? entry + (+(process.env.STOPR || 3)) * risk : entry - (+(process.env.STOPR || 3)) * risk;
    let exitPx = null, exitJ = null, hp2 = hp, maxFav = 0;
    for (let j = i + 1; j < n; j++) { const x = L[j];
      const fav = dir > 0 ? x.h - entry : entry - x.l; if (fav > maxFav) maxFav = fav;   // best favorable excursion (for scale-out bank check)
      if (dir > 0 ? x.l <= stop : x.h >= stop) { exitPx = stop; exitJ = j; break; }
      if (exitMode === 'fixed3R') { if (dir > 0 ? x.h >= target : x.l <= target) { exitPx = target; exitJ = j; break; } }
      else if (exitMode === 'trailKijun') { if (x.kijun != null) stop = dir > 0 ? Math.max(stop, x.kijun) : Math.min(stop, x.kijun); }
      else if (exitMode === 'htfFlip') { while (hp2 + 1 < H.length && H[hp2 + 1].time + HTFsec <= x.time) hp2++; if (biasOf(H[hp2]) !== dir) { exitPx = x.c; exitJ = j; break; } }
    }
    if (exitPx == null) { exitPx = L[n - 1].c; exitJ = n - 1; }
    const R = (dir > 0 ? exitPx - entry : entry - exitPx) / risk - (P.spread / stopP);
    trades.push({ R, t: b.time, hit2R: (maxFav / risk) >= 2 }); busyUntil = exitJ;
  }
  return trades;
}
function statObj(t) { const n = t.length; const w = t.filter(x => x.R > 0).length; const gw = t.filter(x => x.R > 0).reduce((a, x) => a + x.R, 0), gl = -t.filter(x => x.R <= 0).reduce((a, x) => a + x.R, 0), net = t.reduce((a, x) => a + x.R, 0);
  let cum = 0, peak = 0, dd = 0; for (const x of t) { cum += x.R; if (cum > peak) peak = cum; if (peak - cum > dd) dd = peak - cum; }
  return { n, win: +(100 * w / n).toFixed(1), pf: +(gw / (gl || 1e-9)).toFixed(2), net: +net.toFixed(1), avg: +(net / n).toFixed(3), maxDD: +dd.toFixed(1) }; }
function stat(t) { const n = t.length; if (!n) return 'n=0'; const w = t.filter(x => x.R > 0).length; const gw = t.filter(x => x.R > 0).reduce((a, x) => a + x.R, 0), gl = -t.filter(x => x.R <= 0).reduce((a, x) => a + x.R, 0), net = t.reduce((a, x) => a + x.R, 0);
  return `n=${String(n).padStart(3)}  WIN ${(100 * w / n).toFixed(0).padStart(3)}%  PF ${(gw / (gl || 1e-9)).toFixed(2).padStart(5)}  net ${(net >= 0 ? '+' : '') + net.toFixed(0)}R  avg ${(net / n).toFixed(2)}R`; }

const ENTRIES = ['kijunPB', 'tenkanPB', 'tkCross'], EXITS = ['fixed3R', 'trailKijun', 'htfFlip'];
console.log(`\n===== MTF ICHIMOKU · bias H${HTF / 60} → entry ${LTF < 60 ? 'M' + LTF : 'H' + LTF / 60} · target ${process.env.STOPR || 3}R =====`);
for (const em of ENTRIES) { console.log(`\n  ENTRY = ${em}`);
  for (const xm of EXITS) { const pool = [];
    for (const P of PAIRS) pool.push(...run(P, em, xm));
    console.log(`     ${xm.padEnd(11)}: ${stat(pool)}`); }
}
console.log(`\n  --- per-pair robustness: tenkanPB + trailKijun (the winner) ---`);
for (const P of PAIRS) console.log(`     ${P.sym}: ${stat(run(P, 'tenkanPB', 'trailKijun'))}`);

if (process.env.CHART === '1') {   // dump equity-curve data for the winner (tenkanPB + trailKijun)
  const ltfLbl = LTF < 60 ? 'M' + LTF : 'H' + LTF / 60;
  const out = { config: `Daily bias → ${ltfLbl} entry · Tenkan pullback · trail Kijun`, htf: HTF, ltf: LTF, pairs: {}, };
  let all = [];
  for (const P of PAIRS) { const tr = run(P, 'tenkanPB', 'trailKijun'); let cum = 0;
    out.pairs[P.sym] = { stats: statObj(tr), equity: tr.map(x => ({ t: x.t, r: +(cum += x.R).toFixed(2) })) };
    all.push(...tr.map(x => ({ t: x.t, R: x.R, hit2R: x.hit2R }))); }
  all.sort((a, b) => a.t - b.t); let cum = 0;
  out.pooled = { stats: statObj(all), equity: all.map(x => ({ t: x.t, r: +(cum += x.R).toFixed(2) })), trades: all.map(x => ({ t: x.t, R: +x.R.toFixed(3), hit2R: x.hit2R })) };
  // --- position STRUCTURES (mirror the live system): bank 1 unit @ +2R, run the rest on the Kijun trail ---
  const START = 1000;
  const structs = [
    { name: '1% single', acct: x => 0.01 * x.R },
    { name: '9% single (all trail)', acct: x => 0.09 * x.R },
    { name: 'Triplet 3×3% (bank 1 @2R, run 2)', acct: x => { const bank = x.hit2R ? 2 : x.R; return 0.03 * bank + 0.06 * x.R; } },
    { name: '1x9  9×1% (bank 1 @2R, run 8)', acct: x => { const bank = x.hit2R ? 2 : x.R; return 0.01 * bank + 0.08 * x.R; } },
  ];
  out.sizing = structs.map(s => { let bal = START, peak = START, dd = 0; const eq = [{ t: all[0].t, b: START }];
    for (const x of all) { bal *= (1 + s.acct(x)); if (bal <= 0) bal = 1; eq.push({ t: x.t, b: bal }); if (bal > peak) peak = bal; const d = (peak - bal) / peak * 100; if (d > dd) dd = d; }
    return { name: s.name, final: Math.round(bal), ret: +((bal / START - 1) * 100).toFixed(0), maxDD: +dd.toFixed(1), equity: eq.map(p => ({ t: p.t, b: +p.b.toFixed(0) })) }; });
  fs.writeFileSync('chart-data.json', JSON.stringify(out));
  console.log(`\nwrote chart-data.json (${all.length} pooled trades)`);
}
