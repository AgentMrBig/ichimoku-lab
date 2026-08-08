/* ichimoku-test.js — STANDALONE Ichimoku Kinko Hyo backtester. SIDE PROJECT, fully separate from the
 * edgeflow/detect.js system — shares nothing. Same 3 pairs. Builds all 5 Ichimoku lines with correct
 * displacement and tests 3 classic strategies, honest sim (one position at a time, spread charged).
 *
 * Lines (standard 9/26/52, displacement 26):
 *   Tenkan  = (max(H,9)  + min(L,9))  / 2
 *   Kijun   = (max(H,26) + min(L,26)) / 2
 *   SenkouA = (Tenkan + Kijun)/2      plotted 26 ahead   -> the cloud at bar i = SenkouA/B computed at i-26
 *   SenkouB = (max(H,52) + min(L,52))/2 plotted 26 ahead
 *   Chikou  = close plotted 26 behind -> "Chikou clear" = close[i] vs price 26 bars ago
 *
 * Strategies:
 *   A  TK-cross + cloud filter : long when Tenkan crosses>Kijun AND price above cloud (short = mirror)
 *   B  Kumo breakout           : price closes out of the cloud (below->above = long)
 *   C  Full confirmation       : price>cloud + Tenkan>Kijun + Chikou clear + future cloud bullish (mirror short)
 *
 * Usage: node ichimoku-test.js [TF_minutes]   default 60 (H1).   env: TGTR(2) SW(4)
 */
const fs = require('fs');
const TF = +(process.argv[2] || 60);
const TGTR = +(process.env.TGTR || 2), SW = +(process.env.SW || 4);
const T = 9, K = 26, B = 52, DISP = 26;
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
  for (let i = 0; i < n; i++) {
    A[i].tenkan = i >= T - 1 ? (hh(A, i, T) + ll(A, i, T)) / 2 : null;
    A[i].kijun = i >= K - 1 ? (hh(A, i, K) + ll(A, i, K)) / 2 : null;
    A[i].ssaRaw = (A[i].tenkan != null && A[i].kijun != null) ? (A[i].tenkan + A[i].kijun) / 2 : null;   // plotted at i+DISP
    A[i].ssbRaw = i >= B - 1 ? (hh(A, i, B) + ll(A, i, B)) / 2 : null;                                    // plotted at i+DISP
  }
  // the cloud sitting AT bar i = spans computed DISP bars ago
  for (let i = 0; i < n; i++) { const j = i - DISP;
    A[i].ssa = j >= 0 ? A[j].ssaRaw : null; A[i].ssb = j >= 0 ? A[j].ssbRaw : null;
    A[i].cloudTop = (A[i].ssa != null && A[i].ssb != null) ? Math.max(A[i].ssa, A[i].ssb) : null;
    A[i].cloudBot = (A[i].ssa != null && A[i].ssb != null) ? Math.min(A[i].ssa, A[i].ssb) : null;
  }
  return A;
}

function simulate(A, entries, P, mode) { // mode: 'fixed2R' | 'kijunFlip' | 'trailKijun'. one position at a time, spread charged.
  const n = A.length, trades = []; let busyUntil = -1;
  for (const e of entries) { const i = e.i; if (i <= busyUntil || i < 1 || i > n - 3) continue; const dir = e.dir;
    const entry = A[i].c;
    let sw = dir > 0 ? -Infinity : Infinity; for (let j = i - SW; j < i; j++) if (j >= 0) sw = dir > 0 ? Math.max(sw, A[j].h) : Math.min(sw, A[j].l);
    let stop = dir > 0 ? Math.min(sw, A[i].l) - 2 * P.pip : Math.max(sw, A[i].h) + 2 * P.pip;
    const risk = Math.abs(entry - stop), stopP = risk / P.pip; if (stopP < 2 || stopP > 120) continue;
    const target = dir > 0 ? entry + TGTR * risk : entry - TGTR * risk;
    let exitPx = null, exitJ = null;
    for (let j = i + 1; j < n; j++) { const b = A[j];
      if (dir > 0 ? b.l <= stop : b.h >= stop) { exitPx = stop; exitJ = j; break; }              // hard/trailing stop hit
      if (mode === 'fixed2R') { if (dir > 0 ? b.h >= target : b.l <= target) { exitPx = target; exitJ = j; break; } }
      else if (mode === 'kijunFlip') { if (b.kijun != null && (dir > 0 ? b.c < b.kijun : b.c > b.kijun)) { exitPx = b.c; exitJ = j; break; } } // close flips past Kijun = trend over
      else if (mode === 'trailKijun') { if (b.kijun != null) stop = dir > 0 ? Math.max(stop, b.kijun) : Math.min(stop, b.kijun); }             // trail the stop up to the Kijun
    }
    if (exitPx == null) { exitPx = A[n - 1].c; exitJ = n - 1; }
    const R = (dir > 0 ? exitPx - entry : entry - exitPx) / risk - (P.spread / stopP);
    trades.push({ i, dir, R }); busyUntil = exitJ;
  }
  return trades;
}

// --- strategy entry generators ---
function stratA(A) { const e = []; // TK cross + cloud filter
  for (let i = K + DISP; i < A.length - 1; i++) { const p = A[i - 1], c = A[i]; if (c.tenkan == null || c.kijun == null || c.cloudTop == null) continue;
    const crossUp = p.tenkan <= p.kijun && c.tenkan > c.kijun, crossDn = p.tenkan >= p.kijun && c.tenkan < c.kijun;
    if (crossUp && c.c > c.cloudTop) e.push({ i, dir: 1 });
    else if (crossDn && c.c < c.cloudBot) e.push({ i, dir: -1 });
  } return e; }
function stratB(A) { const e = []; // Kumo breakout
  for (let i = K + DISP; i < A.length - 1; i++) { const p = A[i - 1], c = A[i]; if (c.cloudTop == null || p.cloudTop == null) continue;
    if (p.c <= p.cloudTop && c.c > c.cloudTop) e.push({ i, dir: 1 });
    else if (p.c >= p.cloudBot && c.c < c.cloudBot) e.push({ i, dir: -1 });
  } return e; }
function stratC(A) { const e = []; // full confirmation on the TK cross
  for (let i = K + DISP; i < A.length - 1; i++) { const p = A[i - 1], c = A[i]; if (c.tenkan == null || c.cloudTop == null || i < DISP + 1) continue;
    const crossUp = p.tenkan <= p.kijun && c.tenkan > c.kijun, crossDn = p.tenkan >= p.kijun && c.tenkan < c.kijun;
    const futureBull = c.ssaRaw != null && c.ssbRaw != null && c.ssaRaw > c.ssbRaw;
    const chikouUp = c.c > A[i - DISP].c, chikouDn = c.c < A[i - DISP].c;
    if (crossUp && c.c > c.cloudTop && chikouUp && futureBull) e.push({ i, dir: 1 });
    else if (crossDn && c.c < c.cloudBot && chikouDn && !futureBull) e.push({ i, dir: -1 });
  } return e; }

function stat(trades) { const n = trades.length; if (!n) return 'n=0'; const w = trades.filter(t => t.R > 0).length;
  const gw = trades.filter(t => t.R > 0).reduce((a, t) => a + t.R, 0), gl = -trades.filter(t => t.R <= 0).reduce((a, t) => a + t.R, 0);
  const net = trades.reduce((a, t) => a + t.R, 0);
  return `n=${String(n).padStart(4)}  win ${(100 * w / n).toFixed(0).padStart(3)}%  PF ${(gw / (gl || 1e-9)).toFixed(2).padStart(5)}  net ${(net >= 0 ? '+' : '') + net.toFixed(0)}R  avg ${(net / n).toFixed(2)}R`; }

const strats = { A: stratA, B: stratB, C: stratC };
const names = { A: 'TK-cross+cloud', B: 'Kumo breakout', C: 'Full confirm' };
const MODES = ['fixed2R', 'kijunFlip', 'trailKijun'];
const pool = {}; for (const s of ['A', 'B', 'C']) for (const m of MODES) pool[s + m] = [];
console.log(`\n===== ICHIMOKU BACKTEST · TF M${TF} (H${TF / 60}) · exit modes compared · standard 9/26/52 =====`);
const perPair = {};
for (const P of PAIRS) {
  const A = ichimoku(rs(parse(P.file, P.fmt), TF)); perPair[P.sym] = {};
  const ent = { A: stratA(A), B: stratB(A), C: stratC(A) };
  console.log(`\n${P.sym}  (${A.length} H${TF / 60} bars)`);
  for (const s of ['A', 'B', 'C']) { const line = [];
    for (const m of MODES) { const tr = simulate(A, ent[s], P, m); pool[s + m].push(...tr); perPair[P.sym][s + m] = tr;
      line.push(`${m}: ${stat(tr).replace(/\s+/g, ' ')}`); }
    console.log(`  ${s} ${names[s].padEnd(15)}`); for (let k = 0; k < MODES.length; k++) console.log(`       ${line[k]}`);
  }
}
console.log(`\n################# POOLED (all 3 pairs) #################`);
for (const s of ['A', 'B', 'C']) { console.log(`  ${s} ${names[s]}`); for (const m of MODES) console.log(`       ${m.padEnd(11)}: ${stat(pool[s + m])}`); }
