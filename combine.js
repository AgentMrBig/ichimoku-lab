/* combine.js — run the Ichimoku TREND system alongside the current FADE (reversal) system on ONE account.
 * Thesis: they're opposites (fade profits on ranges, trend profits on trends), so together the equity should be
 * SMOOTHER than either alone (diversification = lower drawdown per unit return). Side project — illustrative.
 * Both systems compound at the same fixed risk/trade on a shared $1000 account, merged by close time.
 */
const fs = require('fs');
const RISK = +(process.env.RISK || 0.01);
const ichi = require('./chart-data.json').pooled.trades.map(x => ({ t: x.t, R: x.R, sys: 'trend' }));
const fadeAll = require('./fade-trades.json');
const fade = fadeAll.baseline.map(x => ({ t: x.t, R: x.R, sys: 'fade' }));   // "current system" as-is (live baseline)

function curve(trades) { trades = trades.slice().sort((a, b) => a.t - b.t); let bal = 1000, peak = 1000, dd = 0; const eq = [{ t: trades[0].t, b: 1000 }];
  const monthly = {};
  for (const x of trades) { bal *= (1 + RISK * x.R); eq.push({ t: x.t, b: +bal.toFixed(1) }); if (bal > peak) peak = bal; const d = (peak - bal) / peak * 100; if (d > dd) dd = d;
    const mo = new Date(x.t * 1000).toISOString().slice(0, 7); monthly[mo] = (monthly[mo] || 0) + x.R; }
  const w = trades.filter(t => t.R > 0).length, gm = Object.values(monthly).filter(v => v > 0).length, tm = Object.keys(monthly).length;
  return { eq, final: Math.round(bal), ret: +((bal / 1000 - 1) * 100).toFixed(0), maxDD: +dd.toFixed(1), n: trades.length, win: +(100 * w / trades.length).toFixed(0), greenMonths: gm, totMonths: tm, mar: +(((bal / 1000 - 1) * 100) / dd).toFixed(2) }; }

const F = curve(fade), I = curve(ichi), C = curve(fade.concat(ichi));
const out = { risk: RISK, fade: F, trend: I, combined: C };
// strip eq from console
const short = o => ({ n: o.n, win: o.win + '%', final: '$' + o.final.toLocaleString(), ret: '+' + o.ret + '%', maxDD: o.maxDD + '%', 'ret/DD': o.mar, greenMo: o.greenMonths + '/' + o.totMonths });
console.log('FADE  (current):', JSON.stringify(short(F)));
console.log('TREND (ichimoku):', JSON.stringify(short(I)));
console.log('COMBINED       :', JSON.stringify(short(C)));
console.log(`\nDiversification check: combined maxDD ${C.maxDD}%  vs  fade ${F.maxDD}% + trend ${I.maxDD}% (sum ${(F.maxDD + I.maxDD).toFixed(1)}%).  ret/DD: fade ${F.mar}, trend ${I.mar}, COMBINED ${C.mar}`);
fs.writeFileSync('combined-data.json', JSON.stringify(out));
console.log('wrote combined-data.json');
