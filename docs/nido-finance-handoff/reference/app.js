/* =====================================================================
   CFO APP  —  rendering, charts, state, interactions  (browser only)
   Depends on window.CFO_ENGINE and window.__CSV__
   ===================================================================== */
(function () {
  'use strict';
  var E = window.CFO_ENGINE;

  /* ---------- persistence ---------- */
  var LS = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };

  /* ---------- state ---------- */
  var S = {
    view: 'overview',
    csv: window.__CSV__ || '',
    overrides: LS.get('cfo_overrides', {}),
    budgets: LS.get('cfo_budgets', null),
    settings: LS.get('cfo_settings', { projMethod: 'runrate', projAdjust: 0, lumpyOneTime: true, includeDeclined: false }),
    alertMonth: null, cfMode: 'segment', txnFilter: { q: '', month: 'all', cat: 'all', who: 'all' },
    catDetail: null, pnlDrill: null, excluded: LS.get('cfo_excluded', {}), lastUpdated: LS.get('cfo_updated', null),
    paychecks: null, recurringIncome: null, fixedExpenses: null,
    addPay: false, addRecur: false, addFixed: false
  };

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  var INC0 = (window.__INCOME__ || { paychecks: [], ytdOfficial: {}, meta: {} });

  var DATA = [], A = null, X = null; // X = computed extras

  /* ---------- format ---------- */
  function money(v, dec) {
    dec = dec == null ? 2 : dec;
    if (v == null || isNaN(v)) v = 0;
    return (v < 0 ? '−' : '') + '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  }
  function money0(v) { return money(v, 0); }
  function oneOffId(t) { return t.date + '|' + (+t.amount).toFixed(2) + '|' + t.merchant; }
  function fxPausedNote(f) {
    if (!f || !f.schedule) return '';
    var z = Object.keys(f.schedule).filter(function (m) { return +f.schedule[m] === 0; }).sort();
    if (!z.length) return '';
    return ' <span class="badge">paused ' + z.map(function (m) { return mShort(m); }).join(', ') + '</span>';
  }
  function signedPct(r) { return (r >= 0 ? '+' : '−') + Math.abs(r * 100).toFixed(1) + '%'; }
  function pct(r, d) { return (r * 100).toFixed(d == null ? 1 : d) + '%'; }
  var MON = { '01': 'Jan', '02': 'Feb', '03': 'Mar', '04': 'Apr', '05': 'May', '06': 'Jun', '07': 'Jul', '08': 'Aug', '09': 'Sep', '10': 'Oct', '11': 'Nov', '12': 'Dec' };
  function mShort(m) { return MON[m.slice(5, 7)] || m; }
  function mLong(m) { var n = { '01': 'January', '02': 'February', '03': 'March', '04': 'April', '05': 'May', '06': 'June', '07': 'July', '08': 'August', '09': 'September', '10': 'October', '11': 'November', '12': 'December' }; return (n[m.slice(5, 7)] || m) + ' ' + m.slice(0, 4); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function catColor(c) { return E.CAT_COLORS[c] || '#9A9384'; }
  function segColor(s) { return E.SEG_COLORS[s] || '#9A9384'; }

  /* ---------- compute (derived analytics) ---------- */
  function compute() {
    if (!S.paychecks) S.paychecks = clone(INC0.paychecks || []);
    if (!S.recurringIncome) S.recurringIncome = clone(INC0.recurringIncome || []);
    if (!S.fixedExpenses) S.fixedExpenses = clone(INC0.fixedExpenses || []);
    if (!S.oneOffIncome) S.oneOffIncome = clone(INC0.oneOffIncome || []);
    // pass 1: card transactions only, to learn the month structure
    var cardTxns = E.enrich(E.recordsFromCSV(S.csv), S.overrides);
    cardTxns = cardTxns.filter(function (t) { return t.month >= '2026-01'; }); // dashboard scoped to the current year
    // ---- one-off charge candidates (large single purchases) — toggleable in the P&L ----
    var ONEOFF_MIN = 500;
    var oneOffs = cardTxns.filter(function (t) {
      return t.type === 'Purchase' && !t.declined && t.amount >= ONEOFF_MIN;
    }).map(function (t) {
      return { id: oneOffId(t), date: t.date, merchant: t.merchant, amount: t.amount, category: t.category, month: t.month };
    }).sort(function (a, b) { return b.amount - a.amount; });
    // attach linked refunds (same merchant+date) so excluding a purchase also drops its reimbursements
    oneOffs.forEach(function (o) {
      o.linked = cardTxns.filter(function (t) { return t.type === 'Refund' && t.merchant === o.merchant && t.date === o.date; });
      o.linkedTotal = o.linked.reduce(function (s, t) { return s + t.amount; }, 0);
      o.net = o.amount + o.linkedTotal;
    });
    var exSet = S.excluded || {};
    var excludedIds = Object.keys(exSet).filter(function (k) { return exSet[k]; });
    var excludedTotal = 0;
    if (excludedIds.length) {
      var exMap = {};
      oneOffs.forEach(function (o) { if (exSet[o.id]) { exMap[o.id] = o; excludedTotal += o.net; } });
      cardTxns = cardTxns.filter(function (t) {
        if (t.type === 'Purchase' && exSet[oneOffId(t)]) return false;
        if (t.type === 'Refund') {
          for (var k in exMap) { var o = exMap[k]; if (o.merchant === t.merchant && o.date === t.date) return false; }
        }
        return true;
      });
    }
    var Acard = E.aggregate(cardTxns);
    var activeMonths = (Acard.completeMonths.length ? Acard.completeMonths : Acard.months).slice();
    var __payMs = (S.paychecks || []).map(function (p) { return String(p.payDate).slice(0, 7); }).filter(Boolean).sort();
    var incomeFloor = __payMs.length ? __payMs[0] : '2026-01';
    var fixedMonths = activeMonths.filter(function (m) { return m >= incomeFloor; });
    if (Acard.partialMonth && Acard.partialMonth >= incomeFloor && fixedMonths.indexOf(Acard.partialMonth) === -1) fixedMonths.push(Acard.partialMonth); // include current month's fixed bills + income
    // synthetic fixed-expense transactions, one per active (complete) month
    var fixedTxns = [];
    (S.fixedExpenses || []).forEach(function (fx) {
      fixedMonths.forEach(function (m) {
        var cat = fx.category || 'Uncategorized';
        var amt = (fx.schedule && fx.schedule[m] != null) ? +fx.schedule[m] : (+fx.amount || 0);
        if (!amt) return;
        fixedTxns.push({ date: m + '-01', month: m, time: '', cardholder: 'Fixed bill', amount: amt, points: 0,
          status: 'Recurring', type: 'Fixed', merchant: fx.name, description: 'Fixed monthly commitment' + (fx.schedule ? ' (actual)' : ''),
          category: cat, segment: E.SEGMENT[cat] || 'Essential', declined: false, isSpend: true, isFixed: true, fxId: fx.id });
      });
    });
    DATA = cardTxns.concat(fixedTxns);
    A = E.aggregate(DATA);
    var cats = E.activeCategories(A.catTotals);
    var cm = A.completeMonths.filter(function (m) { return m >= incomeFloor; }), n = cm.length || 1;
    var avgCat = {}, avgSeg = {};
    cats.forEach(function (c) {
      var s = 0; cm.forEach(function (m) { s += (A.catMonth[c] && A.catMonth[c][m]) || 0; });
      avgCat[c] = s / n;
    });
    E.SEGMENT_ORDER.forEach(function (sg) {
      var s = 0; cm.forEach(function (m) { s += (A.segMonth[sg] && A.segMonth[sg][m]) || 0; });
      avgSeg[sg] = s / n;
    });
    var completeTotals = cm.map(function (m) { return A.monthTotals[m] || 0; });
    var avgMonthly = completeTotals.reduce(function (a, b) { return a + b; }, 0) / n;
    // linear regression over complete months
    var reg = linreg(completeTotals);
    // seed budgets if missing
    if (!S.budgets) {
      S.budgets = {};
      cats.forEach(function (c) {
        if (c === 'Investments' || c === 'Uncategorized') { S.budgets[c] = Math.round(avgCat[c]); }
        else { S.budgets[c] = Math.max(5, Math.round(avgCat[c] / 5) * 5); }
      });
      LS.set('cfo_budgets', S.budgets);
    } else {
      // ensure any new category has a budget
      cats.forEach(function (c) { if (S.budgets[c] == null) S.budgets[c] = Math.max(5, Math.round(avgCat[c] / 5) * 5); });
    }
    if (!S.alertMonth) S.alertMonth = cm.length ? cm[cm.length - 1] : A.months[A.months.length - 1];

    /* ---- income ---- */
    var pays = S.paychecks;
    var recur = S.recurringIncome || [];
    var hasIncome = pays.length > 0 || recur.length > 0 || (S.oneOffIncome || []).length > 0;
    var incNetMonth = {}, incGrossMonth = {}, incTaxMonth = {}, incDedMonth = {};
    var incSalaryMonth = {}, incBonusMonth = {}, incOtherMonth = {}, incInterestMonth = {};
    pays.forEach(function (p) {
      var m = String(p.payDate || '').slice(0, 7); if (!m) return;
      var net = +p.net || 0;
      incNetMonth[m] = (incNetMonth[m] || 0) + net;
      incGrossMonth[m] = (incGrossMonth[m] || 0) + (+p.gross || 0);
      incTaxMonth[m] = (incTaxMonth[m] || 0) + (+p.taxes || 0);
      incDedMonth[m] = (incDedMonth[m] || 0) + (+p.deductions || 0);
      if (+p.bonus) incBonusMonth[m] = (incBonusMonth[m] || 0) + net; else incSalaryMonth[m] = (incSalaryMonth[m] || 0) + net;
    });
    var recurMonthly = recur.reduce(function (s, r) { return s + (+r.amount || 0); }, 0);
    fixedMonths.forEach(function (m) {
      recur.forEach(function (r) {
        var amt = +r.amount || 0; var ty = String(r.type || '').toLowerCase();
        incNetMonth[m] = (incNetMonth[m] || 0) + amt;
        if (ty.indexOf('bonus') !== -1) incBonusMonth[m] = (incBonusMonth[m] || 0) + amt;
        else if (ty.indexOf('interest') !== -1) incInterestMonth[m] = (incInterestMonth[m] || 0) + amt;
        else incOtherMonth[m] = (incOtherMonth[m] || 0) + amt;
      });
    });
    // ---- one-off income (specific month) ----
    var oneOffInc = S.oneOffIncome || [];
    oneOffInc.forEach(function (o) {
      var m = o.month, amt = +o.amount || 0; if (!m || !amt) return;
      var ty = String(o.type || '').toLowerCase();
      incNetMonth[m] = (incNetMonth[m] || 0) + amt;
      if (ty.indexOf('bonus') !== -1) incBonusMonth[m] = (incBonusMonth[m] || 0) + amt;
      else if (ty.indexOf('interest') !== -1) incInterestMonth[m] = (incInterestMonth[m] || 0) + amt;
      else incOtherMonth[m] = (incOtherMonth[m] || 0) + amt;
    });
    var oneOffIncTotal = oneOffInc.reduce(function (s2, o) { return s2 + (+o.amount || 0); }, 0);
    var incMonths = Object.keys(incNetMonth).sort();
    var incNetTotal = incMonths.reduce(function (s, m) { return s + incNetMonth[m]; }, 0);
    var salaryYTD = sumMap(incSalaryMonth), bonusYTD = sumMap(incBonusMonth), otherYTD = sumMap(incOtherMonth), interestYTD = sumMap(incInterestMonth);
    var bonusNetTotal = bonusYTD;
    var overlap = A.months.filter(function (m) { return incNetMonth[m] != null; });
    var spendOverlap = overlap.reduce(function (s, m) { return s + (A.monthTotals[m] || 0); }, 0);
    var ytdNetCash = incNetTotal - spendOverlap;
    var savingsRate = incNetTotal ? ytdNetCash / incNetTotal : 0;
    var meta = INC0.meta || {};
    var annualSalaryNet = (meta.perCheckNet && meta.checksPerYear) ? meta.perCheckNet * meta.checksPerYear : avgMonthlyOf(incSalaryMonth, overlap) * 12;
    var regMonthly = (annualSalaryNet / 12) + recurMonthly;
    var annualNetIncome = annualSalaryNet + recurMonthly * 12;
    var __fmLast = fixedMonths.length ? fixedMonths[fixedMonths.length - 1] : null;
    var fixedMonthly = (S.fixedExpenses || []).reduce(function (s, f) {
      var v = (__fmLast && f.schedule && f.schedule[__fmLast] != null) ? +f.schedule[__fmLast] : (+f.amount || 0);
      return s + v;
    }, 0);

    X = { oneOffs: oneOffs, excludedTotal: excludedTotal, excludedCount: oneOffs.filter(function (o) { return (S.excluded || {})[o.id]; }).length,
          cats: cats, avgCat: avgCat, avgSeg: avgSeg, avgMonthly: avgMonthly, reg: reg, completeTotals: completeTotals,
          latestComplete: cm[cm.length - 1], priorComplete: cm[cm.length - 2], activeMonths: activeMonths,
          cardMonthTotals: Acard.monthTotals, cardTotal: Acard.total,
          hasIncome: hasIncome, paychecks: pays, recurringIncome: recur, fixedExpenses: S.fixedExpenses || [],
          oneOffIncome: oneOffInc, oneOffIncTotal: oneOffIncTotal,
          incNetMonth: incNetMonth, incGrossMonth: incGrossMonth, incTaxMonth: incTaxMonth, incDedMonth: incDedMonth,
          incSalaryMonth: incSalaryMonth, incBonusMonth: incBonusMonth, incOtherMonth: incOtherMonth, incInterestMonth: incInterestMonth,
          incMonths: incMonths, incNetTotal: incNetTotal, salaryYTD: salaryYTD, bonusYTD: bonusYTD, otherYTD: otherYTD, interestYTD: interestYTD,
          bonusNetTotal: bonusNetTotal, recurMonthly: recurMonthly, fixedMonthly: fixedMonthly,
          overlap: overlap, spendOverlap: spendOverlap, ytdNetCash: ytdNetCash, savingsRate: savingsRate,
          regMonthly: regMonthly, annualNetIncome: annualNetIncome, ytdOfficial: INC0.ytdOfficial || {}, incMeta: meta };
  }
  function sumMap(m) { var s = 0; for (var k in m) s += m[k]; return s; }
  function avgMonthlyOf(map, keys) { if (!keys.length) return 0; var s = 0; keys.forEach(function (m) { s += map[m] || 0; }); return s / keys.length; }
  function linreg(y) {
    var n = y.length; if (n < 2) return { m: 0, b: n ? y[0] : 0, predict: function () { return n ? y[0] : 0; } };
    var sx = 0, sy = 0, sxy = 0, sxx = 0;
    for (var i = 0; i < n; i++) { sx += i; sy += y[i]; sxy += i * y[i]; sxx += i * i; }
    var m = (n * sxy - sx * sy) / (n * sxx - sx * sx);
    var b = (sy - m * sx) / n;
    return { m: m, b: b, predict: function (x) { return m * x + b; } };
  }

  /* =================================================================
     SVG CHART PRIMITIVES
     ================================================================= */
  function polar(cx, cy, r, deg) { var a = (deg - 90) * Math.PI / 180; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; }
  function arc(cx, cy, r, a0, a1) {
    var p0 = polar(cx, cy, r, a1), p1 = polar(cx, cy, r, a0);
    var big = (a1 - a0) <= 180 ? 0 : 1;
    return 'M ' + p0[0].toFixed(2) + ' ' + p0[1].toFixed(2) + ' A ' + r + ' ' + r + ' 0 ' + big + ' 0 ' + p1[0].toFixed(2) + ' ' + p1[1].toFixed(2);
  }
  function donut(items, opts) {
    opts = opts || {}; var size = opts.size || 200, sw = opts.stroke || 26, r = (size - sw) / 2, cx = size / 2, cy = size / 2;
    var tot = items.reduce(function (a, b) { return a + b.value; }, 0) || 1;
    var ang = 0, segs = '';
    items.forEach(function (it) {
      var sweep = it.value / tot * 360; if (sweep <= 0) return;
      var a1 = ang + sweep;
      // avoid full-circle path glitch
      var draw = Math.min(a1, ang + 359.999);
      segs += '<path d="' + arc(cx, cy, r, ang, draw) + '" fill="none" stroke="' + it.color + '" stroke-width="' + sw + '"><title>' + esc(it.label) + ' — ' + money(it.value) + ' (' + pct(it.value / tot) + ')</title></path>';
      ang = a1;
    });
    var center = opts.center ? '<text x="' + cx + '" y="' + (cy - 4) + '" text-anchor="middle" class="dn-c1">' + esc(opts.center) + '</text><text x="' + cx + '" y="' + (cy + 16) + '" text-anchor="middle" class="dn-c2">' + esc(opts.center2 || '') + '</text>' : '';
    return '<svg viewBox="0 0 ' + size + ' ' + size + '" class="donut" width="' + size + '" height="' + size + '">' + segs + center + '</svg>';
  }
  function areaLine(series, opts) {
    // series: [{m,value,partial}] ; single line area
    opts = opts || {}; var W = opts.w || 680, H = opts.h || 220, pl = 46, pr = 14, pt = 18, pb = 28;
    var iw = W - pl - pr, ih = H - pt - pb;
    var vals = series.map(function (d) { return d.value; });
    var max = Math.max.apply(null, vals.concat([1])); max = niceMax(max);
    var n = series.length;
    function X(i) { return pl + (n <= 1 ? iw / 2 : i / (n - 1) * iw); }
    function Y(v) { return pt + ih - (v / max) * ih; }
    var grid = '', ticks = 4;
    for (var g = 0; g <= ticks; g++) { var gv = max * g / ticks, gy = Y(gv); grid += '<line x1="' + pl + '" y1="' + gy.toFixed(1) + '" x2="' + (W - pr) + '" y2="' + gy.toFixed(1) + '" class="grid"/><text x="' + (pl - 8) + '" y="' + (gy + 4).toFixed(1) + '" text-anchor="end" class="axis">' + money0(gv) + '</text>'; }
    var dPath = '', aPath = '';
    series.forEach(function (d, i) { var x = X(i), y = Y(d.value); dPath += (i ? ' L ' : 'M ') + x.toFixed(1) + ' ' + y.toFixed(1); });
    aPath = dPath + ' L ' + X(n - 1).toFixed(1) + ' ' + Y(0).toFixed(1) + ' L ' + X(0).toFixed(1) + ' ' + Y(0).toFixed(1) + ' Z';
    var dots = '', labels = '', xl = '';
    series.forEach(function (d, i) {
      var x = X(i), y = Y(d.value);
      dots += '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + (d.partial ? 3.5 : 4) + '" class="' + (d.partial ? 'pt pt-partial' : 'pt') + '"><title>' + mLong(d.m) + ' — ' + money(d.value) + (d.partial ? ' (partial)' : '') + '</title></circle>';
      labels += '<text x="' + x.toFixed(1) + '" y="' + (y - 10).toFixed(1) + '" text-anchor="middle" class="vlab">' + money0(d.value) + '</text>';
      xl += '<text x="' + x.toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle" class="axis">' + mShort(d.m) + (d.partial ? '*' : '') + '</text>';
    });
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="chart" preserveAspectRatio="xMidYMid meet">' + grid +
      '<path d="' + aPath + '" class="area"/><path d="' + dPath + '" class="line"/>' + dots + labels + xl + '</svg>';
  }
  function niceMax(v) { if (v <= 0) return 1; var pow = Math.pow(10, Math.floor(Math.log10(v))); var f = v / pow; var nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10; return nf * pow; }

  function stackedBars(months, stackKeys, getVal, colorFn, opts) {
    opts = opts || {}; var W = opts.w || 680, H = opts.h || 260, pl = 46, pr = 12, pt = 16, pb = 28;
    var iw = W - pl - pr, ih = H - pt - pb, n = months.length;
    var totals = months.map(function (m) { return stackKeys.reduce(function (a, k) { return a + (getVal(k, m) || 0); }, 0); });
    var max = niceMax(Math.max.apply(null, totals.concat([1])));
    var bw = iw / n * 0.62, gap = iw / n;
    function Y(v) { return pt + ih - (v / max) * ih; }
    var grid = '';
    for (var g = 0; g <= 4; g++) { var gv = max * g / 4, gy = Y(gv); grid += '<line x1="' + pl + '" y1="' + gy.toFixed(1) + '" x2="' + (W - pr) + '" y2="' + gy.toFixed(1) + '" class="grid"/><text x="' + (pl - 8) + '" y="' + (gy + 4).toFixed(1) + '" text-anchor="end" class="axis">' + money0(gv) + '</text>'; }
    var bars = '', xl = '';
    months.forEach(function (m, i) {
      var x = pl + gap * i + (gap - bw) / 2, yAcc = pt + ih;
      stackKeys.forEach(function (k) {
        var v = getVal(k, m) || 0; if (v <= 0) return;
        var h = v / max * ih; yAcc -= h;
        bars += '<rect x="' + x.toFixed(1) + '" y="' + yAcc.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + h.toFixed(1) + '" fill="' + colorFn(k) + '" class="sbar"><title>' + esc(k) + ' · ' + mLong(m) + ' — ' + money(v) + '</title></rect>';
      });
      bars += '<text x="' + (x + bw / 2).toFixed(1) + '" y="' + (Y(totals[i]) - 6).toFixed(1) + '" text-anchor="middle" class="vlab">' + money0(totals[i]) + '</text>';
      xl += '<text x="' + (x + bw / 2).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle" class="axis">' + mShort(m) + (m === A.partialMonth ? '*' : '') + '</text>';
    });
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="chart" preserveAspectRatio="xMidYMid meet">' + grid + bars + xl + '</svg>';
  }

  // Grouped bars: months on X, two+ series side by side, optional net line overlay
  function groupedBars(months, series, opts) {
    opts = opts || {}; var W = opts.w || 700, H = opts.h || 270, pl = 48, pr = 14, pt = 16, pb = 28;
    var iw = W - pl - pr, ih = H - pt - pb, n = months.length;
    var allVals = [];
    months.forEach(function (m) { series.forEach(function (s) { allVals.push(s.get(m) || 0); }); });
    if (opts.net) months.forEach(function (m) { allVals.push(Math.abs(opts.net.get(m) || 0)); });
    var max = niceMax(Math.max.apply(null, allVals.concat([1])));
    var group = iw / n, bw = Math.min(34, (group * 0.7) / series.length), inner = bw * series.length + (series.length - 1) * 3;
    function Y(v) { return pt + ih - (Math.max(0, v) / max) * ih; }
    var grid = '';
    for (var g = 0; g <= 4; g++) { var gv = max * g / 4, gy = Y(gv); grid += '<line x1="' + pl + '" y1="' + gy.toFixed(1) + '" x2="' + (W - pr) + '" y2="' + gy.toFixed(1) + '" class="grid"/><text x="' + (pl - 8) + '" y="' + (gy + 4).toFixed(1) + '" text-anchor="end" class="axis">' + money0(gv) + '</text>'; }
    var bars = '', xl = '', netPts = [];
    months.forEach(function (m, i) {
      var cx = pl + group * i + group / 2, x0 = cx - inner / 2;
      series.forEach(function (s, si) {
        var v = s.get(m) || 0; var h = (v / max) * ih; var x = x0 + si * (bw + 3);
        bars += '<rect x="' + x.toFixed(1) + '" y="' + Y(v).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="1.5" fill="' + s.color + '" class="sbar"><title>' + esc(s.key) + ' · ' + mLong(m) + ' — ' + money(v) + '</title></rect>';
      });
      if (opts.net) { var nv = opts.net.get(m) || 0; netPts.push([cx, Y(nv), nv, m]); }
      xl += '<text x="' + cx.toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle" class="axis">' + mShort(m) + (m === A.partialMonth ? '*' : '') + '</text>';
    });
    var netLine = '';
    if (opts.net && netPts.length) {
      var d = netPts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ');
      netLine = '<path d="' + d + '" class="netline"/>' + netPts.map(function (p) { return '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="3.2" class="netpt"><title>Net ' + mLong(p[3]) + ' — ' + money(p[2]) + '</title></circle>'; }).join('');
    }
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="chart" preserveAspectRatio="xMidYMid meet">' + grid + bars + netLine + xl + '</svg>';
  }

  function hbars(items, opts) {
    opts = opts || {}; var max = Math.max.apply(null, items.map(function (i) { return i.value; }).concat([1]));
    var rows = items.map(function (it) {
      var w = Math.max(0, it.value / max * 100);
      return '<div class="hbar-row"><div class="hbar-label">' + (it.dot ? '<span class="cat-dot" style="background:' + it.dot + '"></span>' : '') + esc(it.label) + '</div>' +
        '<div class="hbar-track"><div class="hbar-fill" style="width:' + w.toFixed(1) + '%;background:' + (it.color || '#3B5BA5') + '"></div></div>' +
        '<div class="hbar-val num">' + money(it.value) + '</div></div>';
    }).join('');
    return '<div class="hbars">' + rows + '</div>';
  }

  function sparkline(vals, color, w, h) {
    w = w || 120; h = h || 30; var max = Math.max.apply(null, vals.concat([1])), n = vals.length;
    if (n < 2) return '<svg width="' + w + '" height="' + h + '"></svg>';
    var p = vals.map(function (v, i) { return (i / (n - 1) * w).toFixed(1) + ',' + (h - 2 - (v / max) * (h - 4)).toFixed(1); }).join(' ');
    var last = vals[n - 1] / max * (h - 4);
    return '<svg width="' + w + '" height="' + h + '" class="spark" viewBox="0 0 ' + w + ' ' + h + '"><polyline points="' + p + '" fill="none" stroke="' + color + '" stroke-width="1.6"/><circle cx="' + w + '" cy="' + (h - 2 - last).toFixed(1) + '" r="2.2" fill="' + color + '"/></svg>';
  }

  function heatColor(t) { // t 0..1 -> paper to ink-green
    t = Math.max(0, Math.min(1, t));
    var c0 = [246, 243, 236], c1 = [31, 92, 69];
    var c = c0.map(function (v, i) { return Math.round(v + (c1[i] - v) * t); });
    return 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')';
  }

  /* =================================================================
     SHARED UI BITS
     ================================================================= */
  function segPill(seg) { return '<span class="seg-pill" style="--sc:' + segColor(seg) + '">' + esc(seg) + '</span>'; }
  function eyebrow(t) { return '<div class="eyebrow">' + esc(t) + '</div>'; }
  function partialNote() { return A.partialMonth ? '<span class="muted partial-tag">* ' + mLong(A.partialMonth) + ' is in progress (' + (A.txnCountMonth[A.partialMonth] || 0) + ' txns so far)</span>' : ''; }

  function kpi(label, value, sub, accent) {
    return '<div class="kpi"><div class="label">' + esc(label) + '</div><div class="value num"' + (accent ? ' style="color:' + accent + '"' : '') + '>' + value + '</div>' + (sub ? '<div class="sub">' + sub + '</div>' : '') + '</div>';
  }

  /* =================================================================
     VIEW: OVERVIEW
     ================================================================= */
  function vOverview() {
    var lc = X.latestComplete, pc = X.priorComplete;
    var lcVal = A.monthTotals[lc] || 0, pcVal = pc ? (A.monthTotals[pc] || 0) : 0;
    var mom = pc ? (lcVal - pcVal) / (pcVal || 1) : 0;
    var topCat = X.cats.slice().sort(function (a, b) { return A.catTotals[b] - A.catTotals[a]; })[0];
    var totalPoints = DATA.reduce(function (s, t) { return s + (t.isSpend && !t.declined ? t.points : 0); }, 0);

    // KPIs
    var k;
    if (X.hasIncome) {
      var span = X.incMonths.length ? (mShort(X.incMonths[0]) + '–' + mShort(X.incMonths[X.incMonths.length - 1])) : '';
      k = '<div class="kpi-row">' +
        kpi('Net Income · YTD', money0(X.incNetTotal), span + ' · all sources') +
        kpi('Total Spend · YTD', money0(X.spendOverlap), 'card + fixed bills') +
        kpi('Net Cash Flow', money0(X.ytdNetCash), 'income − spending', X.ytdNetCash >= 0 ? 'var(--green)' : 'var(--red)') +
        kpi('Savings Rate', pct(X.savingsRate, 0), 'of net income') +
        kpi('Fixed Bills', money0(X.fixedMonthly) + '/mo', 'committed each month') +
        '</div>';
    } else {
      k = '<div class="kpi-row">' +
        kpi('YTD Net Spend', money0(A.total), A.months.length + ' months · ' + A.spend.length + ' transactions') +
        kpi('Avg / Month', money0(X.avgMonthly), 'across ' + A.completeMonths.length + ' complete months') +
        kpi(mShort(lc) + ' Spend', money0(lcVal), pc ? ('<span class="' + (mom > 0 ? 'down' : 'up') + '">' + signedPct(mom) + ' vs ' + mShort(pc) + '</span>') : '') +
        kpi('Top Category', topCat, '<span class="cat-dot" style="background:' + catColor(topCat) + '"></span>' + money0(A.catTotals[topCat]) + ' · ' + pct(A.catTotals[topCat] / A.total, 0)) +
        kpi('Rewards Earned', totalPoints.toLocaleString('en-US') + ' pts', '≈ ' + money0(totalPoints / 100) + ' value') +
        '</div>';
    }

    // income vs spending
    var netCard = '';
    if (X.hasIncome) {
      var gb = groupedBars(A.months, [
        { key: 'Net income', color: '#1F6F54', get: function (m) { return X.incNetMonth[m] || 0; } },
        { key: 'Card spend', color: '#B2473B', get: function (m) { return A.monthTotals[m] || 0; } }
      ], { w: 700, h: 230, net: { get: function (m) { return (X.incNetMonth[m] != null) ? ((X.incNetMonth[m] || 0) - (A.monthTotals[m] || 0)) : 0; } } });
      var lg = '<div class="legend wrap"><div class="legend-item"><span class="cat-dot" style="background:#1F6F54"></span><span class="lg-name">Net income</span></div><div class="legend-item"><span class="cat-dot" style="background:#B2473B"></span><span class="lg-name">Total spend</span></div><div class="legend-item"><span class="netkey"></span><span class="lg-name">Net cash flow</span></div></div>';
      netCard = '<div class="card span-2"><div class="card-h"><div>' + eyebrow('Liquidity') + '<h3>Income vs spending</h3></div><span class="muted">' + pct(X.savingsRate, 0) + ' of net income saved</span></div>' + gb + lg + '<p class="muted cf-caveat">Spending now includes card purchases <em>plus</em> fixed bills (mortgage, HOA, FPL, Tesla, student loan, Kid’s Strong). Any bill not listed isn’t captured yet.</p></div>';
    }

    // monthly trend
    var series = A.months.map(function (m) { return { m: m, value: A.monthTotals[m] || 0, partial: m === A.partialMonth }; });
    var trend = '<div class="card span-2"><div class="card-h"><div>' + eyebrow('Monthly spend') + '<h3>Where the money flows</h3></div>' + partialNote() + '</div>' + areaLine(series, { w: 680, h: 230 }) + '</div>';

    // donut top categories
    var sorted = X.cats.slice().sort(function (a, b) { return A.catTotals[b] - A.catTotals[a]; });
    var top = sorted.slice(0, 6), restVal = sorted.slice(6).reduce(function (s, c) { return s + A.catTotals[c]; }, 0);
    var ditems = top.map(function (c) { return { label: c, value: A.catTotals[c], color: catColor(c) }; });
    if (restVal > 0) ditems.push({ label: 'Other', value: restVal, color: '#C9C2B0' });
    var legend = ditems.map(function (it) { return '<div class="legend-item"><span class="cat-dot" style="background:' + it.color + '"></span><span class="lg-name">' + esc(it.label) + '</span><span class="lg-val num">' + money0(it.value) + '</span><span class="lg-pct num">' + pct(it.value / A.total, 0) + '</span></div>'; }).join('');
    var donutCard = '<div class="card"><div class="card-h"><div>' + eyebrow('Composition') + '<h3>Spending mix</h3></div></div><div class="donut-wrap">' + donut(ditems, { size: 188, stroke: 30, center: money0(A.total), center2: 'YTD' }) + '<div class="legend">' + legend + '</div></div></div>';

    // segment split
    var segItems = E.SEGMENT_ORDER.filter(function (s) { return A.segTotals[s]; }).map(function (s) { return { label: s, value: A.segTotals[s], color: segColor(s) }; });
    var segBar = '<div class="card"><div class="card-h"><div>' + eyebrow('Segments') + '<h3>Essential vs Lifestyle vs Build</h3></div></div>' + segmentStrip(segItems) + '</div>';

    // movers
    var movers = X.cats.map(function (c) {
      var a = (A.catMonth[c] && A.catMonth[c][lc]) || 0, b = pc ? ((A.catMonth[c] && A.catMonth[c][pc]) || 0) : 0;
      return { c: c, d: a - b, a: a, b: b };
    }).filter(function (x) { return Math.abs(x.d) > 1; }).sort(function (a, b) { return Math.abs(b.d) - Math.abs(a.d); }).slice(0, 6);
    var moverRows = movers.map(function (x) {
      return '<div class="mv-row"><span class="cat-dot" style="background:' + catColor(x.c) + '"></span><span class="mv-name">' + esc(x.c) + '</span><span class="mv-d num ' + (x.d > 0 ? 'down' : 'up') + '">' + (x.d > 0 ? '+' : '−') + money0(Math.abs(x.d)) + '</span></div>';
    }).join('');
    var moversCard = '<div class="card"><div class="card-h"><div>' + eyebrow(mShort(pc || lc) + ' → ' + mShort(lc)) + '<h3>Biggest movers</h3></div></div><div class="movers">' + (moverRows || '<div class="muted">Not enough history yet.</div>') + '</div></div>';

    // insight
    var diningShare = A.catTotals['Dining & Takeout'] ? A.catTotals['Dining & Takeout'] / A.total : 0;
    var lifestyleShare = (A.segTotals['Lifestyle'] || 0) / A.total;
    var invNote = A.catTotals['Investments'] ? (' A single bullion purchase (' + money0(A.catTotals['Investments']) + ' at Apmex) drove the February spike and accounts for most of your Investment segment.') : '';
    var incSentence = X.hasIncome ? ('You bring in about <strong>' + money0(X.regMonthly) + '/mo</strong> (take-home + other income) against <strong>' + money0(X.fixedMonthly) + '/mo</strong> of fixed bills before any card spending. Net of everything tracked, you’ve saved <strong>' + money0(X.ytdNetCash) + '</strong> YTD — a <strong>' + pct(X.savingsRate, 0) + '</strong> savings rate. ') : '';
    var insight = '<div class="insight"><div class="insight-mark">CFO note</div><p>' + incSentence + 'Your everyday burn is about <strong>' + money0(X.avgMonthly) + '/mo</strong>. <strong>' + esc(topCat) + '</strong> is the single largest pool at <strong>' + money0(A.catTotals[topCat]) + '</strong> (' + pct(A.catTotals[topCat] / A.total, 0) + ' of spend)' + (topCat === 'Dining & Takeout' ? ' — restaurants and takeout are where the most realistic savings live.' : '.') + ' Lifestyle spending (dining, shopping, beauty, subscriptions) is <strong>' + pct(lifestyleShare, 0) + '</strong> of the total.' + invNote + '</p></div>';

    return '<div class="grid">' + k + insight + (netCard ? '<div class="cols-1">' + netCard + '</div>' : '') + '<div class="cols-2">' + trend + donutCard + '</div><div class="cols-2">' + segBar + moversCard + '</div></div>';
  }
  function mShort0(c) { return c; }

  function segmentStrip(items) {
    var tot = items.reduce(function (a, b) { return a + b.value; }, 0) || 1;
    var bar = '<div class="seg-strip">' + items.map(function (it) { return '<div class="seg-seg" style="width:' + (it.value / tot * 100) + '%;background:' + it.color + '" title="' + esc(it.label) + ' ' + money(it.value) + '"></div>'; }).join('') + '</div>';
    var rows = items.map(function (it) { return '<div class="seg-row"><span class="cat-dot" style="background:' + it.color + '"></span><span class="seg-name">' + esc(it.label) + '</span><span class="num seg-amt">' + money0(it.value) + '</span><span class="num seg-pc muted">' + pct(it.value / tot, 0) + '</span></div>'; }).join('');
    return bar + '<div class="seg-rows">' + rows + '</div>';
  }

  /* =================================================================
     VIEW: P&L  (expenses-only statement)
     ================================================================= */
  function oneOffPanel() {
    var list = X.oneOffs || [];
    if (!list.length) return '';
    var exSet = S.excluded || {};
    var rows = list.map(function (o) {
      var off = !!exSet[o.id];
      var linkNote = o.linked && o.linked.length ? ' <span class="muted oo-link">incl. ' + money(o.linkedTotal) + ' credit' + (o.linked.length > 1 ? 's' : '') + ' → net ' + money(o.net) + '</span>' : '';
      return '<label class="oo-row' + (off ? ' off' : '') + '">' +
        '<input type="checkbox" data-action="toggle-oneoff" data-oid="' + esc(o.id) + '"' + (off ? '' : ' checked') + '>' +
        '<span class="oo-date num">' + mShort(o.month) + ' ' + o.date.slice(8, 10) + '</span>' +
        '<span class="oo-merch"><span class="cat-dot" style="background:' + catColor(o.category) + '"></span>' + esc(o.merchant) + linkNote + '</span>' +
        '<span class="oo-amt num">' + money(o.net) + '</span>' +
        '<span class="oo-state">' + (off ? '<span class="badge red">excluded</span>' : '<span class="badge">included</span>') + '</span>' +
        '</label>';
    }).join('');
    var banner = X.excludedCount
      ? '<div class="oo-banner on">Excluding <strong class="num">' + X.excludedCount + '</strong> charge' + (X.excludedCount > 1 ? 's' : '') + ' worth <strong class="num">' + money(X.excludedTotal) + '</strong> — all figures below are net of these.</div>'
      : '<div class="oo-banner">All one-off charges are included. Uncheck any to see the P&amp;L without it.</div>';
    return '<div class="card span-2"><div class="card-h"><div>' + eyebrow('One-off charges') + '<h3>Include / exclude large charges</h3></div>' +
      '<div class="seg-toggle"><button class="tg" data-action="oneoff-all" data-mode="include">Include all</button><button class="tg" data-action="oneoff-all" data-mode="exclude">Exclude all</button></div></div>' +
      banner + '<div class="oo-list">' + rows + '</div>' +
      '<p class="muted oo-help">Any single purchase of ' + money0(500) + ' or more appears here automatically. Toggling one recalculates the whole dashboard — P&amp;L, cash flow, savings rate and projections — so every figure stays consistent. Choices are remembered.</p></div>';
  }

  function drillRow(date, label, amt, attrs) {
    return '<div class="drill-row"' + (attrs || '') + '><span class="dr-date num">' + esc(date) + '</span><span class="dr-d">' + label + '</span><span class="dr-m num">' + money(amt) + '</span></div>';
  }
  function pnlDrillPanel(d) {
    var m = d.month, title = '', rows = '';
    if (d.kind === 'cat') {
      var c = d.key;
      var list = DATA.filter(function (t) { return t.isSpend && t.category === c && t.month === m; }).sort(function (a, b) { return b.amount - a.amount; });
      var sum = list.reduce(function (s, t) { return s + t.amount; }, 0);
      title = '<span class="cat-dot lg" style="background:' + catColor(c) + '"></span>' + esc(c) + ' · ' + mLong(m);
      rows = list.map(function (t) { return drillRow(t.date, esc(t.merchant) + (t.isFixed ? ' <span class="badge">fixed</span>' : '') + (t.declined ? ' <span class="badge red">declined</span>' : '') + (t.type === 'Refund' && t.description ? ' <span class="muted">· ' + esc(t.description) + '</span>' : ''), t.amount); }).join('') || '<div class="muted" style="padding:10px 8px">No transactions in this month.</div>';
      rows = '<div class="drill-row drill-sum"><span class="dr-date"></span><span class="dr-d strong">Total · ' + list.length + ' item' + (list.length === 1 ? '' : 's') + '</span><span class="dr-m num strong">' + money(sum) + '</span></div>' + rows;
    } else if (d.kind === 'month') {
      title = mLong(m) + ' · all spending';
      var cs = X.cats.filter(function (c) { return (A.catMonth[c] && A.catMonth[c][m]); }).sort(function (a, b) { return (A.catMonth[b][m] || 0) - (A.catMonth[a][m] || 0); });
      rows = cs.map(function (c) { return drillRow('', '<span class="cat-dot" style="background:' + catColor(c) + '"></span>' + esc(c), A.catMonth[c][m], ' data-action="pnl-drill" data-dk="cat" data-dkey="' + esc(c) + '" data-dm="' + m + '"'); }).join('');
      rows = '<div class="drill-row drill-sum"><span class="dr-date"></span><span class="dr-d strong">Total spend</span><span class="dr-m num strong">' + money(A.monthTotals[m] || 0) + '</span></div>' + rows + '<p class="muted" style="padding:9px 8px 0;font-size:11.5px">Tap any category to see its individual transactions.</p>';
    } else if (d.kind === 'inc') {
      var b = d.key, items = [], lab = { salary: 'Salary', bonus: 'Bonus', other: 'Other income', interest: 'Interest income' }[b] || 'Income';
      title = lab + ' · ' + mLong(m);
      if (b === 'salary') { (X.paychecks || []).filter(function (p) { return !p.bonus && String(p.payDate).slice(0, 7) === m; }).sort(function (a, b2) { return String(a.payDate) < String(b2.payDate) ? -1 : 1; }).forEach(function (p) { items.push([p.payDate, 'Paycheck (net)' + (p.source === 'stub' ? ' <span class="badge">verified</span>' : ''), +p.net || 0]); }); }
      else {
        (X.recurringIncome || []).filter(function (r) { var ty = String(r.type || '').toLowerCase(); return b === 'bonus' ? ty.indexOf('bonus') !== -1 : b === 'interest' ? ty.indexOf('interest') !== -1 : (ty.indexOf('bonus') === -1 && ty.indexOf('interest') === -1); }).forEach(function (r) { items.push([m + '-01', esc(r.name), +r.amount || 0]); });
        (X.oneOffIncome || []).filter(function (o) { if (o.month !== m) return false; var ty = String(o.type || '').toLowerCase(); return b === 'bonus' ? ty.indexOf('bonus') !== -1 : b === 'interest' ? ty.indexOf('interest') !== -1 : (ty.indexOf('bonus') === -1 && ty.indexOf('interest') === -1); }).forEach(function (o) { items.push([o.month + '-01', esc(o.name) + ' <span class="badge">one-off</span>', +o.amount || 0]); });
      }
      var sum2 = items.reduce(function (s, it) { return s + it[2]; }, 0);
      rows = items.map(function (it) { return drillRow(it[0], it[1], it[2]); }).join('') || '<div class="muted" style="padding:10px 8px">No items.</div>';
      rows = '<div class="drill-row drill-sum"><span class="dr-date"></span><span class="dr-d strong">Total · ' + items.length + ' item' + (items.length === 1 ? '' : 's') + '</span><span class="dr-m num strong">' + money(sum2) + '</span></div>' + rows;
    }
    return '<div class="card span-2 drill detail"><div class="card-h"><div>' + eyebrow('Drill-down') + '<h3>' + title + '</h3></div><button class="btn-ghost" data-action="pnl-drill" data-dk="">Close ✕</button></div><div class="drill-list">' + rows + '</div></div>';
  }
  function vPnl() {
    var months = A.months;
    var head = '<tr><th class="lcol">Category</th>' + months.map(function (m) { return '<th class="right">' + mShort(m) + (m === A.partialMonth ? '*' : '') + '</th>'; }).join('') + '<th class="right tot">YTD</th><th class="right">Avg/mo</th><th class="right">%</th></tr>';
    var body = '';
    E.SEGMENT_ORDER.forEach(function (seg) {
      var segCats = X.cats.filter(function (c) { return E.SEGMENT[c] === seg; });
      if (!segCats.length) return;
      segCats.sort(function (a, b) { return A.catTotals[b] - A.catTotals[a]; });
      body += '<tr class="seg-head" style="--sc:' + segColor(seg) + '"><td class="lcol">' + esc(seg) + '</td>' + months.map(function () { return '<td></td>'; }).join('') + '<td></td><td></td><td></td></tr>';
      segCats.forEach(function (c) {
        var row = '<tr class="cat-row"><td class="lcol"><span class="cat-dot" style="background:' + catColor(c) + '"></span>' + esc(c) + (E.FIXED_CATS[c] ? ' <span class="badge">fixed</span>' : '') + '</td>';
        months.forEach(function (m) { var v = (A.catMonth[c] && A.catMonth[c][m]) || 0; var dd = v ? ' data-action="pnl-drill" data-dk="cat" data-dkey="' + esc(c) + '" data-dm="' + m + '"' : ''; row += '<td class="right num' + (v === 0 ? ' zero' : '') + '"' + dd + '>' + (v ? money0(v) : '·') + '</td>'; });
        row += '<td class="right num tot">' + money0(A.catTotals[c]) + '</td><td class="right num muted">' + money0(X.avgCat[c]) + '</td><td class="right num muted">' + pct(A.catTotals[c] / A.total, 0) + '</td></tr>';
        body += row;
      });
      // segment subtotal
      var subRow = '<tr class="sub-row"><td class="lcol">' + esc(seg) + ' subtotal</td>';
      months.forEach(function (m) { var v = (A.segMonth[seg] && A.segMonth[seg][m]) || 0; subRow += '<td class="right num">' + (v ? money0(v) : '·') + '</td>'; });
      subRow += '<td class="right num tot">' + money0(A.segTotals[seg]) + '</td><td class="right num">' + money0(X.avgSeg[seg]) + '</td><td class="right num">' + pct(A.segTotals[seg] / A.total, 0) + '</td></tr>';
      body += subRow;
    });
    // income section (top)
    function incLine(label, color, map, bucket) {
      var has = false, cells = '';
      months.forEach(function (m) { var v = map[m]; if (v) has = true; var dd = v ? ' data-action="pnl-drill" data-dk="inc" data-dkey="' + bucket + '" data-dm="' + m + '"' : ''; cells += '<td class="right num' + (v ? '' : ' zero') + '"' + dd + '>' + (v ? money0(v) : '·') + '</td>'; });
      if (!has) return '';
      var tot = sumMap(map), avg = X.overlap.length ? tot / X.overlap.length : 0;
      return '<tr class="cat-row"><td class="lcol"><span class="cat-dot" style="background:' + color + '"></span>' + label + '</td>' + cells + '<td class="right num tot">' + money0(tot) + '</td><td class="right num muted">' + money0(avg) + '</td><td class="right num muted">—</td></tr>';
    }
    var incSection = '';
    if (X.hasIncome) {
      incSection += '<tr class="seg-head" style="--sc:var(--green)"><td class="lcol">Income</td>' + months.map(function () { return '<td></td>'; }).join('') + '<td></td><td></td><td></td></tr>';
      incSection += incLine('Salary (net)', '#1F6F54', X.incSalaryMonth, 'salary');
      incSection += incLine('Bonus (net)', '#2E8B8B', X.incBonusMonth, 'bonus');
      incSection += incLine('Other income', '#7A8450', X.incOtherMonth, 'other');
      incSection += incLine('Interest income', '#6A4C93', X.incInterestMonth, 'interest');
      var itr = '<tr class="sub-row"><td class="lcol">Total income</td>';
      months.forEach(function (m) { var v = X.incNetMonth[m]; itr += '<td class="right num">' + (v != null ? money0(v) : '·') + '</td>'; });
      var incAvg = X.overlap.length ? X.incNetTotal / X.overlap.length : 0;
      itr += '<td class="right num tot">' + money0(X.incNetTotal) + '</td><td class="right num">' + money0(incAvg) + '</td><td class="right num">—</td></tr>';
      incSection += itr;
    }

    // grand total (spend)
    var gt = '<tr class="grand"><td class="lcol">Total Net Spend</td>';
    months.forEach(function (m) { gt += '<td class="right num" data-action="pnl-drill" data-dk="month" data-dm="' + m + '">' + money0(A.monthTotals[m] || 0) + '</td>'; });
    gt += '<td class="right num tot">' + money0(A.total) + '</td><td class="right num">' + money0(X.avgMonthly) + '</td><td class="right num">100%</td></tr>';

    // net savings row
    var netRow = '';
    if (X.hasIncome) {
      netRow = '<tr class="grand netsave"><td class="lcol">Net (savings)</td>';
      months.forEach(function (m) {
        var inc = X.incNetMonth[m], sp = A.monthTotals[m] || 0;
        if (inc == null) { netRow += '<td class="right num muted">·</td>'; }
        else { var nf = inc - sp; netRow += '<td class="right num ' + (nf >= 0 ? 'up' : 'down') + '">' + (nf >= 0 ? '+' : '−') + money0(Math.abs(nf)) + '</td>'; }
      });
      netRow += '<td class="right num tot ' + (X.ytdNetCash >= 0 ? 'up' : 'down') + '">' + (X.ytdNetCash >= 0 ? '+' : '−') + money0(Math.abs(X.ytdNetCash)) + '</td><td class="right num">—</td><td class="right num">' + pct(X.savingsRate, 0) + '</td></tr>';
    }

    var pay = Object.keys(A.payByMonth).reduce(function (s, m) { return s + A.payByMonth[m]; }, 0);
    var cred = Object.keys(A.credByMonth).reduce(function (s, m) { return s + A.credByMonth[m]; }, 0);
    var memo = '<div class="memo"><div class="memo-h">' + eyebrow('Memo — excluded from spend') + '</div><div class="memo-row"><span>Card payments made</span><span class="num">' + money(Math.abs(pay)) + '</span></div><div class="memo-row"><span>Statement credits &amp; reward redemptions</span><span class="num">' + money(Math.abs(cred)) + '</span></div><p class="muted">Payments to the card and reward credits are transfers/adjustments, not spending, so they sit outside the P&amp;L.</p></div>';

    var drill = S.pnlDrill ? pnlDrillPanel(S.pnlDrill) : '';
    return '<div class="grid">' + drill + oneOffPanel() + '<div class="card span-2"><div class="card-h"><div>' + eyebrow('Profit &amp; Loss' + (X.hasIncome ? '' : ' — expenses')) + '<h3>Year-to-date statement</h3></div><div class="muted">' + partialNote() + '</div></div><div class="tbl-scroll"><table class="tbl pnl">' + head + incSection + body + gt + netRow + '</table></div></div>' + memo + '</div>';
  }

  /* =================================================================
     VIEW: CASH FLOW (month by month)
     ================================================================= */
  function vCash() {
    var months = A.months;
    var chart;
    if (S.cfMode === 'segment') {
      var segKeys = E.SEGMENT_ORDER.filter(function (s) { return A.segTotals[s]; });
      chart = stackedBars(months, segKeys, function (k, m) { return (A.segMonth[k] && A.segMonth[k][m]) || 0; }, segColor, { w: 700, h: 280 });
    } else {
      var catKeys = X.cats.slice().sort(function (a, b) { return A.catTotals[b] - A.catTotals[a]; });
      chart = stackedBars(months, catKeys, function (k, m) { return (A.catMonth[k] && A.catMonth[k][m]) || 0; }, catColor, { w: 700, h: 280 });
    }
    var legendKeys = S.cfMode === 'segment' ? E.SEGMENT_ORDER.filter(function (s) { return A.segTotals[s]; }) : X.cats.slice().sort(function (a, b) { return A.catTotals[b] - A.catTotals[a]; });
    var legend = '<div class="legend wrap">' + legendKeys.map(function (k) { var col = S.cfMode === 'segment' ? segColor(k) : catColor(k); return '<div class="legend-item"><span class="cat-dot" style="background:' + col + '"></span><span class="lg-name">' + esc(k) + '</span></div>'; }).join('') + '</div>';
    var toggle = '<div class="seg-toggle"><button class="tg ' + (S.cfMode === 'segment' ? 'on' : '') + '" data-action="cf-mode" data-mode="segment">By segment</button><button class="tg ' + (S.cfMode === 'category' ? 'on' : '') + '" data-action="cf-mode" data-mode="category">By category</button></div>';

    var chartCard = '<div class="card span-2"><div class="card-h"><div>' + eyebrow('Monthly outflow') + '<h3>Cash flow by month</h3></div>' + toggle + '</div>' + chart + legend + '</div>';

    // monthly table with MoM
    var rows = months.map(function (m, i) {
      var v = A.monthTotals[m] || 0, prev = i ? (A.monthTotals[months[i - 1]] || 0) : 0;
      var mom = i ? (v - prev) / (prev || 1) : 0;
      var pay = Math.abs(A.payByMonth[m] || 0), cred = Math.abs(A.credByMonth[m] || 0), cnt = A.txnCountMonth[m] || 0;
      return '<tr><td>' + mLong(m) + (m === A.partialMonth ? ' <span class="muted">(partial)</span>' : '') + '</td><td class="right num">' + money(v) + '</td><td class="right num ' + (i ? (mom > 0 ? 'down' : 'up') : 'muted') + '">' + (i ? signedPct(mom) : '—') + '</td><td class="right num">' + cnt + '</td><td class="right num muted">' + money(cnt ? v / cnt : 0) + '</td><td class="right num muted">' + money(pay) + '</td><td class="right num muted">' + money(cred) + '</td></tr>';
    }).join('');
    var tbl = '<div class="card span-2"><div class="card-h"><div>' + eyebrow('Ledger') + '<h3>Month-over-month</h3></div></div><div class="tbl-scroll"><table class="tbl"><tr><th>Month</th><th class="right">Net spend</th><th class="right">MoM</th><th class="right">Txns</th><th class="right">Avg/txn</th><th class="right">Card paid</th><th class="right">Credits</th></tr>' + rows + '</table></div></div>';

    // income vs spending (net cash flow)
    var incFlow = '';
    if (X.hasIncome) {
      var gb = groupedBars(A.months, [
        { key: 'Net income', color: '#1F6F54', get: function (m) { return X.incNetMonth[m] || 0; } },
        { key: 'Card spend', color: '#B2473B', get: function (m) { return A.monthTotals[m] || 0; } }
      ], { w: 700, h: 250, net: { get: function (m) { return (X.incNetMonth[m] != null) ? ((X.incNetMonth[m] || 0) - (A.monthTotals[m] || 0)) : 0; } } });
      var cfrows = A.months.map(function (m) {
        var inc = X.incNetMonth[m], sp = A.monthTotals[m] || 0;
        if (inc == null) return '<tr><td>' + mLong(m) + (m === A.partialMonth ? ' <span class="muted">(partial)</span>' : '') + '</td><td class="right num muted">no paycheck yet</td><td class="right num">' + money(sp) + '</td><td class="right num muted">—</td><td class="right num muted">—</td></tr>';
        var net = inc - sp, sr = inc ? net / inc : 0;
        return '<tr><td>' + mLong(m) + '</td><td class="right num">' + money(inc) + '</td><td class="right num">' + money(sp) + '</td><td class="right num ' + (net >= 0 ? 'up' : 'down') + '">' + (net >= 0 ? '+' : '−') + money0(Math.abs(net)) + '</td><td class="right num">' + pct(sr, 0) + '</td></tr>';
      }).join('');
      cfrows += '<tr class="grand"><td>YTD (paid months)</td><td class="right num">' + money0(X.incNetTotal) + '</td><td class="right num">' + money0(X.spendOverlap) + '</td><td class="right num ' + (X.ytdNetCash >= 0 ? 'up' : 'down') + '">' + (X.ytdNetCash >= 0 ? '+' : '−') + money0(Math.abs(X.ytdNetCash)) + '</td><td class="right num">' + pct(X.savingsRate, 0) + '</td></tr>';
      var lg2 = '<div class="legend wrap"><div class="legend-item"><span class="cat-dot" style="background:#1F6F54"></span><span class="lg-name">Net income</span></div><div class="legend-item"><span class="cat-dot" style="background:#B2473B"></span><span class="lg-name">Total spend</span></div><div class="legend-item"><span class="netkey"></span><span class="lg-name">Net cash flow</span></div></div>';
      incFlow = '<div class="card span-2"><div class="card-h"><div>' + eyebrow('Income vs outflow') + '<h3>Net cash flow</h3></div><span class="muted">' + pct(X.savingsRate, 0) + ' of net income saved</span></div>' + gb + lg2 +
        '<div class="tbl-scroll"><table class="tbl"><tr><th>Month</th><th class="right">Net income</th><th class="right">Total spend</th><th class="right">Net flow</th><th class="right">Savings %</th></tr>' + cfrows + '</table></div><p class="muted cf-caveat">Spend = card + fixed bills (mortgage, HOA, FPL, Tesla, student loan, Kid’s Strong). Income = take-home + car-loan repayment + interest.</p></div>';
    }

    // category MoM heatmap
    var hm = catHeatmap();
    return '<div class="grid">' + incFlow + '<div class="cols-1">' + chartCard + '</div>' + tbl + hm + '</div>';
  }

  function catHeatmap() {
    var months = A.months;
    var cats = X.cats.slice().sort(function (a, b) { return A.catTotals[b] - A.catTotals[a]; });
    var maxCell = 0;
    cats.forEach(function (c) { months.forEach(function (m) { var v = (A.catMonth[c] && A.catMonth[c][m]) || 0; if (v > maxCell) maxCell = v; }); });
    var head = '<tr><th class="lcol">Category</th>' + months.map(function (m) { return '<th class="right">' + mShort(m) + (m === A.partialMonth ? '*' : '') + '</th>'; }).join('') + '</tr>';
    var body = cats.map(function (c) {
      var cells = months.map(function (m) {
        var v = (A.catMonth[c] && A.catMonth[c][m]) || 0; var t = maxCell ? v / maxCell : 0;
        var fg = t > 0.55 ? '#fff' : '#2A2824';
        return '<td class="heat" style="background:' + (v ? heatColor(t) : 'transparent') + ';color:' + fg + '">' + (v ? money0(v) : '') + '</td>';
      }).join('');
      return '<tr><td class="lcol"><span class="cat-dot" style="background:' + catColor(c) + '"></span>' + esc(c) + '</td>' + cells + '</tr>';
    }).join('');
    return '<div class="card span-2"><div class="card-h"><div>' + eyebrow('Intensity') + '<h3>Category heatmap</h3></div><span class="muted">darker = more spent that month</span></div><div class="tbl-scroll"><table class="tbl heatmap">' + head + body + '</table></div></div>';
  }

  /* =================================================================
     VIEW: CATEGORIES
     ================================================================= */
  function vCats() {
    var cats = X.cats.slice().sort(function (a, b) { return A.catTotals[b] - A.catTotals[a]; });
    var cards = cats.map(function (c) {
      var vals = A.months.map(function (m) { return (A.catMonth[c] && A.catMonth[c][m]) || 0; });
      var merchants = Object.keys(A.merchantMeta).filter(function (mc) { return A.merchantMeta[mc].category === c; })
        .sort(function (a, b) { return A.merchantTotals[b] - A.merchantTotals[a]; });
      var topM = merchants[0];
      return '<button class="card cat-card" data-action="cat-detail" data-cat="' + esc(c) + '">' +
        '<div class="cc-top"><span class="cat-dot lg" style="background:' + catColor(c) + '"></span><div class="cc-name">' + esc(c) + '</div>' + segPill(E.SEGMENT[c]) + '</div>' +
        '<div class="cc-val num">' + money0(A.catTotals[c]) + '</div>' +
        '<div class="cc-sub muted">' + pct(A.catTotals[c] / A.total, 0) + ' of spend · ' + money0(X.avgCat[c]) + '/mo</div>' +
        '<div class="cc-spark">' + sparkline(vals, catColor(c), 150, 34) + '</div>' +
        '<div class="cc-merch muted">' + (topM ? ('Top: ' + esc(topM) + ' (' + money0(A.merchantTotals[topM]) + ')') : '') + '</div>' +
        '</button>';
    }).join('');
    var detail = S.catDetail ? catDetailPanel(S.catDetail) : '';
    return '<div class="grid">' + detail + '<div class="cat-grid">' + cards + '</div></div>';
  }

  function catDetailPanel(c) {
    var months = A.months;
    var series = months.map(function (m) { return { m: m, value: (A.catMonth[c] && A.catMonth[c][m]) || 0, partial: m === A.partialMonth }; });
    var merchants = Object.keys(A.merchantMeta).filter(function (mc) { return A.merchantMeta[mc].category === c; })
      .sort(function (a, b) { return A.merchantTotals[b] - A.merchantTotals[a]; });
    var mItems = merchants.slice(0, 12).map(function (mc) { return { label: mc + ' ×' + A.merchantMeta[mc].count, value: A.merchantTotals[mc], color: catColor(c) }; });
    return '<div class="card span-2 detail"><div class="card-h"><div>' + eyebrow('Category detail') + '<h3><span class="cat-dot lg" style="background:' + catColor(c) + '"></span>' + esc(c) + ' ' + segPill(E.SEGMENT[c]) + '</h3></div><button class="btn-ghost" data-action="cat-detail" data-cat="">Close ✕</button></div>' +
      '<div class="detail-body"><div class="detail-left"><div class="kpi-row mini">' + kpi('YTD', money0(A.catTotals[c])) + kpi('Avg/mo', money0(X.avgCat[c])) + kpi('Share', pct(A.catTotals[c] / A.total, 0)) + kpi('Merchants', String(merchants.length)) + '</div>' + areaLine(series, { w: 420, h: 190 }) + '</div>' +
      '<div class="detail-right"><div class="eyebrow">Merchants</div>' + hbars(mItems) + '</div></div></div>';
  }

  /* =================================================================
     VIEW: PROJECTIONS
     ================================================================= */
  function vProj() {
    var adj = 1 + (S.settings.projAdjust || 0) / 100;
    var cm = A.completeMonths.length;
    // annual = full calendar year 2026 (12 months)
    var runrateAnnual = X.avgMonthly * 12 * adj;
    // trend: actual complete months + model for remaining of year
    var trendAnnual = 0;
    for (var i = 0; i < 12; i++) {
      if (i < cm) trendAnnual += X.completeTotals[i];
      else trendAnnual += Math.max(0, X.reg.predict(i));
    }
    trendAnnual *= adj;
    var chosen = S.settings.projMethod === 'trend' ? trendAnnual : runrateAnnual;
    var ytd = A.total;
    var remaining = Math.max(0, chosen - ytd);

    // projected monthly series (Jan..Dec)
    var projSeries = [];
    for (var j = 0; j < 12; j++) {
      var key = '2026-' + String(j + 1).padStart(2, '0');
      var actual = A.monthTotals[key];
      var isActual = (j < cm);
      var val = isActual ? actual : (S.settings.projMethod === 'trend' ? Math.max(0, X.reg.predict(j)) : X.avgMonthly) * adj;
      projSeries.push({ m: key, value: val, partial: !isActual });
    }

    var methodTg = '<div class="seg-toggle"><button class="tg ' + (S.settings.projMethod === 'runrate' ? 'on' : '') + '" data-action="proj-method" data-method="runrate">Run-rate</button><button class="tg ' + (S.settings.projMethod === 'trend' ? 'on' : '') + '" data-action="proj-method" data-method="trend">Trend</button></div>';

    var k = '<div class="kpi-row">' +
      kpi('Projected 2026', money0(chosen), S.settings.projMethod === 'trend' ? 'linear trend of monthly spend' : X.avgMonthly ? (money0(X.avgMonthly) + '/mo × 12') : '') +
      kpi('Spent so far', money0(ytd), pct(ytd / (chosen || 1), 0) + ' of projection') +
      kpi('Remaining (Jun–Dec)', money0(remaining), 'at current pace') +
      kpi('Implied / month left', money0((12 - cm) ? remaining / (12 - cm) : 0), (12 - cm) + ' months to go') +
      '</div>';

    var ctrl = '<div class="card span-2"><div class="card-h"><div>' + eyebrow('Forecast') + '<h3>Full-year 2026 projection</h3></div>' + methodTg + '</div>' +
      areaLine(projSeries, { w: 700, h: 240 }) +
      '<div class="proj-ctrl"><label>Manual adjustment <strong class="num">' + (S.settings.projAdjust > 0 ? '+' : '') + S.settings.projAdjust + '%</strong></label><input type="range" min="-30" max="30" step="5" value="' + (S.settings.projAdjust || 0) + '" data-action="proj-adjust"><span class="muted">Slide to model a spending change (e.g. −20% if you cut back).</span></div></div>';

    // per-category projection
    var lumpyOn = S.settings.lumpyOneTime;
    var rows = X.cats.slice().sort(function (a, b) { return A.catTotals[b] - A.catTotals[a]; }).map(function (c) {
      var isLumpy = E.LUMPY[c];
      var proj = (isLumpy && lumpyOn) ? A.catTotals[c] : X.avgCat[c] * 12 * adj;
      var note = (isLumpy && lumpyOn) ? '<span class="badge">one-time</span>' : '';
      return '<tr><td><span class="cat-dot" style="background:' + catColor(c) + '"></span>' + esc(c) + ' ' + note + '</td><td class="right num">' + money0(A.catTotals[c]) + '</td><td class="right num muted">' + money0(X.avgCat[c]) + '</td><td class="right num strong">' + money0(proj) + '</td></tr>';
    }).join('');
    var projTot = X.cats.reduce(function (s, c) { return s + ((E.LUMPY[c] && lumpyOn) ? A.catTotals[c] : X.avgCat[c] * 12 * adj); }, 0);
    var catTbl = '<div class="card span-2"><div class="card-h"><div>' + eyebrow('By category') + '<h3>Annualized run-rate</h3></div><label class="chk"><input type="checkbox" data-action="toggle-lumpy" ' + (lumpyOn ? 'checked' : '') + '> treat one-time buys as non-recurring</label></div><div class="tbl-scroll"><table class="tbl"><tr><th>Category</th><th class="right">YTD</th><th class="right">Avg/mo</th><th class="right">Proj. 2026</th></tr>' + rows + '<tr class="grand"><td>Total</td><td class="right num">' + money0(A.total) + '</td><td class="right num">' + money0(X.avgMonthly) + '</td><td class="right num">' + money0(projTot) + '</td></tr></table></div></div>';

    var note = '<div class="insight"><div class="insight-mark">How to read this</div><p><strong>Run-rate</strong> assumes each category keeps its average monthly pace. <strong>Trend</strong> fits a straight line to your monthly totals and extends it. Big one-time buys (like the ' + money0(A.catTotals['Investments'] || 0) + ' bullion purchase) are flagged <span class="badge">one-time</span> and held flat so they don’t inflate the forecast.</p></div>';

    var savingsCard = '';
    if (X.hasIncome) {
      var pInc = X.annualNetIncome, pSpend = projTot, pSave = pInc - pSpend, pRate = pInc ? pSave / pInc : 0;
      savingsCard = '<div class="card span-2"><div class="card-h"><div>' + eyebrow('Projected savings') + '<h3>Full-year 2026 cash flow</h3></div></div><div class="kpi-row mini">' +
        kpi('Net income · proj.', money0(pInc), 'take-home + other + bonus') +
        kpi('Spending · proj.', money0(pSpend), 'card + fixed bills, one-time excl.') +
        kpi('Savings · proj.', money0(pSave), '', pSave >= 0 ? 'var(--green)' : 'var(--red)') +
        kpi('Savings rate', pct(pRate, 0), 'of net income') +
        '</div><p class="muted">Income = ' + esc((X.incMeta.frequency || '').toLowerCase()) + ' take-home (' + money0(X.regMonthly) + '/mo incl. other income) annualized plus the one-time bonus. Spending = the annualized category run-rate (one-time buys held flat) including your ' + money0(X.fixedMonthly) + '/mo fixed bills.</p></div>';
    }
    return '<div class="grid">' + k + savingsCard + '<div class="cols-1">' + ctrl + '</div>' + catTbl + note + '</div>';
  }

  /* =================================================================
     VIEW: BUDGET ALERTS
     ================================================================= */
  function vAlerts() {
    var m = S.alertMonth;
    var isPartial = (m === A.partialMonth);
    var dayFrac = isPartial ? Math.min(1, (A.maxDay) / daysInMonth(m)) : 1;
    var cats = X.cats.slice().sort(function (a, b) {
      var ra = ratioFor(a, m, dayFrac), rb = ratioFor(b, m, dayFrac); return rb - ra;
    });
    var monthSel = '<select class="select" data-action="alert-month">' + A.months.map(function (mm) { return '<option value="' + mm + '"' + (mm === m ? ' selected' : '') + '>' + mLong(mm) + (mm === A.partialMonth ? ' (partial)' : '') + '</option>'; }).join('') + '</select>';

    var totBudget = 0, totActual = 0, overCount = 0, overSum = 0;
    var rows = cats.map(function (c) {
      var actual = (A.catMonth[c] && A.catMonth[c][m]) || 0;
      var paced = isPartial ? actual / (dayFrac || 1) : actual;
      var budget = S.budgets[c] || 0;
      totBudget += budget; totActual += actual;
      var fixed = E.FIXED_CATS[c];
      var ratio = budget ? paced / budget : (paced > 0 ? 2 : 0);
      var status = fixed ? 'ok' : (ratio > 1 ? 'over' : ratio > 0.85 ? 'watch' : 'ok');
      if (!fixed && ratio > 1 && budget) { overCount++; overSum += (paced - budget); }
      var w = Math.min(100, ratio * 100);
      var tagText = fixed ? 'fixed' : (status === 'over' ? signedPct(ratio - 1) + ' over' : pct(ratio, 0));
      return '<tr class="al-row ' + status + '"><td class="al-cat"><span class="cat-dot" style="background:' + catColor(c) + '"></span>' + esc(c) + (fixed ? ' <span class="badge">fixed</span>' : '') + '</td>' +
        '<td class="al-bar"><div class="bar-track"><div class="bar-fill ' + status + '" style="width:' + w.toFixed(0) + '%"></div></div></td>' +
        '<td class="right num">' + money0(actual) + (isPartial && !fixed ? ' <span class="muted">→ ' + money0(paced) + '</span>' : '') + '</td>' +
        '<td class="right num budget-cell"><input class="bud-input num" type="number" step="5" value="' + Math.round(budget) + '" data-action="budget" data-cat="' + esc(c) + '"></td>' +
        '<td class="right num"><span class="status-tag ' + status + '">' + tagText + '</span></td></tr>';
    }).join('');

    var bannerCls = overCount > 0 ? 'over' : 'ok';
    var banner = '<div class="alert-banner ' + bannerCls + '">' +
      '<div class="ab-icon">' + (overCount > 0 ? '⚠' : '✓') + '</div>' +
      '<div class="ab-text"><strong>' + (overCount > 0 ? (overCount + ' categor' + (overCount > 1 ? 'ies' : 'y') + ' over budget' + (isPartial ? ' at current pace' : '')) : 'On track — nothing over budget') + '</strong>' +
      '<span class="muted">' + mLong(m) + ' · spent ' + money0(totActual) + (isPartial ? ' (pacing to ' + money0(totActual / (dayFrac || 1)) + ')' : '') + ' against a ' + money0(totBudget) + ' plan' + (overCount > 0 ? ' · ' + money0(overSum) + ' over' : '') + '</span></div></div>';

    var help = '<div class="muted al-help">Budgets are seeded from your monthly averages — edit any number to set your own target. Overspend triggers when projected spend passes the budget (watch at 85%).' + (isPartial ? ' Because ' + mShort(m) + ' is partial, the → figure paces today’s spend to a full month.' : '') + '</div>';

    return '<div class="grid"><div class="card span-2"><div class="card-h"><div>' + eyebrow('Overspend monitor') + '<h3>Budget vs actual</h3></div>' + monthSel + '</div>' + banner +
      '<div class="tbl-scroll"><table class="tbl alerts"><tr><th class="lcol">Category</th><th>Pace</th><th class="right">Actual' + (isPartial ? '/proj' : '') + '</th><th class="right">Budget</th><th class="right">Status</th></tr>' + rows + '</table></div>' + help + '</div></div>';
  }
  function daysInMonth(m) { var y = +m.slice(0, 4), mo = +m.slice(5, 7); return new Date(y, mo, 0).getDate(); }
  function ratioFor(c, m, dayFrac) { var a = (A.catMonth[c] && A.catMonth[c][m]) || 0; var paced = a / (dayFrac || 1); var b = S.budgets[c] || 0; return b ? paced / b : (paced > 0 ? 2 : 0); }

  /* =================================================================
     VIEW: INCOME
     ================================================================= */
  function vIncome() {
    var off = X.ytdOfficial || {}, meta = X.incMeta || {};
    if (!X.hasIncome) {
      return '<div class="grid"><div class="card span-2"><div class="card-h"><div>' + eyebrow('Income') + '<h3>No income yet</h3></div></div><p class="muted">Add a paycheck or send a pay-stub PDF to start tracking income.</p><button class="btn" data-action="toggle-addpay">+ Add a paycheck</button>' + (S.addPay ? addPayForm() : '') + '</div></div>';
    }
    var otherTotal = X.otherYTD + X.interestYTD;
    var k = '<div class="kpi-row">' +
      kpi('Total Income · YTD', money0(X.incNetTotal), 'all sources, net') +
      kpi('Salary + Bonus', money0(X.salaryYTD + X.bonusYTD), 'salary + amortized bonus') +
      kpi('Other Income · YTD', money0(otherTotal), 'repayment + interest') +
      kpi('Fixed Bills', money0(X.fixedMonthly) + '/mo', 'committed monthly') +
      kpi('Net Cash Flow', money0(X.ytdNetCash), pct(X.savingsRate, 0) + ' saved', X.ytdNetCash >= 0 ? 'var(--green)' : 'var(--red)') +
      '</div>';

    var series = X.incMonths.map(function (m) { return { m: m, value: X.incNetMonth[m] || 0, partial: false }; });
    var chart = '<div class="card span-2"><div class="card-h"><div>' + eyebrow('All income by month') + '<h3>Monthly income</h3></div><span class="muted">' + esc(meta.frequency || '') + (meta.job ? ' · ' + esc(meta.job) : '') + '</span></div>' + areaLine(series, { w: 700, h: 200 }) + '</div>';

    // income breakdown
    function brow(label, color, v) { return v ? '<div class="seg-row"><span class="cat-dot" style="background:' + color + '"></span><span class="seg-name">' + label + '</span><span class="num seg-amt">' + money0(v) + '</span><span class="num seg-pc muted">' + pct(v / X.incNetTotal, 0) + '</span></div>' : ''; }
    var breakdownCard = '<div class="card"><div class="card-h"><div>' + eyebrow('Composition') + '<h3>Income by source</h3></div></div><div class="seg-rows">' +
      brow('Salary (net)', '#1F6F54', X.salaryYTD) + brow('Bonus (net)', '#2E8B8B', X.bonusYTD) + brow('Other income', '#7A8450', X.otherYTD) + brow('Interest income', '#6A4C93', X.interestYTD) +
      '<div class="seg-row paynet"><span class="cat-dot" style="background:#23211C"></span><span class="seg-name strong">Total (YTD)</span><span class="num seg-amt strong">' + money0(X.incNetTotal) + '</span><span class="num seg-pc"></span></div></div></div>';

    var stub = X.paychecks.filter(function (p) { return p.source === 'stub'; })[0] || X.paychecks[X.paychecks.length - 1];
    var detailCard = '';
    if (stub && stub.detail) {
      var dl = Object.keys(stub.detail).map(function (key2) { return '<div class="seg-row"><span class="seg-name">' + esc(key2) + '</span><span class="num seg-amt">' + money(stub.detail[key2]) + '</span></div>'; }).join('');
      detailCard = '<div class="card"><div class="card-h"><div>' + eyebrow('Verified paycheck') + '<h3>' + mLong(stub.payDate.slice(0, 7)) + '</h3></div></div><div class="seg-rows"><div class="seg-row"><span class="seg-name strong">Gross pay</span><span class="num seg-amt">' + money(stub.gross) + '</span></div>' + dl + '<div class="seg-row paynet"><span class="seg-name strong">Net pay</span><span class="num seg-amt strong">' + money(stub.net) + '</span></div></div></div>';
    }

    // recurring (other) income management
    var recRows = (X.recurringIncome || []).map(function (r) {
      return '<div class="mng-row"><span class="cat-dot" style="background:' + (String(r.type || '').toLowerCase().indexOf('interest') !== -1 ? '#6A4C93' : '#7A8450') + '"></span><span class="mng-name">' + esc(r.name) + '</span><span class="mng-amt num">' + money(r.amount) + '/mo</span><button class="xbtn" data-action="del-recur" data-id="' + esc(r.id) + '">✕</button></div>';
    }).join('');
    var recAdd = S.addRecur ? addRecurForm() : '<button class="btn" data-action="toggle-addrecur">+ Add income source</button>';
    var ooiRows = (X.oneOffIncome || []).slice().sort(function (a, b2) { return String(b2.month).localeCompare(String(a.month)); }).map(function (o) {
      return '<div class="mng-row"><span class="cat-dot" style="background:#7A8450"></span><span class="mng-name">' + esc(o.name) + '<span class="muted mng-cat"> · ' + mShort(o.month) + ' <span class="badge">one-off</span></span></span><span class="mng-amt num">' + money(o.amount) + '</span><span></span></div>';
    }).join('');
    var recurCard = '<div class="card"><div class="card-h"><div>' + eyebrow('Other income') + '<h3>Recurring · ' + money(X.recurMonthly) + '/mo</h3></div></div><div class="mng-list">' + (recRows || '<span class="muted">None.</span>') + '</div>' +
      (ooiRows ? '<div class="eyebrow" style="margin-top:14px">One-off · ' + money(X.oneOffIncTotal) + '</div><div class="mng-list">' + ooiRows + '</div>' : '') +
      '<div class="addpay-wrap">' + recAdd + '</div></div>';

    // fixed expenses management
    var __fmLast2 = (X.activeMonths && X.activeMonths.length) ? X.activeMonths[X.activeMonths.length - 1] : null;
    var fxRows = (X.fixedExpenses || []).map(function (f) {
      return '<div class="mng-row"><span class="cat-dot" style="background:' + catColor(f.category) + '"></span><span class="mng-name">' + esc(f.name) + '<span class="muted mng-cat"> · ' + esc(f.category) + '</span></span><span class="mng-amt num">' + money((f.schedule && __fmLast2 && f.schedule[__fmLast2] != null) ? f.schedule[__fmLast2] : f.amount) + '/mo' + (f.schedule ? (fxPausedNote(f) || ' avg') : '') + '</span><button class="xbtn" data-action="del-fixed" data-id="' + esc(f.id) + '">✕</button></div>';
    }).join('');
    var fxAdd = S.addFixed ? addFixedForm() : '<button class="btn" data-action="toggle-addfixed">+ Add fixed bill</button>';
    var fixedCard = '<div class="card span-2"><div class="card-h"><div>' + eyebrow('Fixed monthly commitments') + '<h3>Bills · ' + money(X.fixedMonthly) + '/mo</h3></div><span class="muted">' + money0(X.fixedMonthly * 12) + '/yr</span></div><div class="mng-list cols">' + (fxRows || '<span class="muted">None.</span>') + '</div><div class="addpay-wrap">' + fxAdd + '</div><p class="muted">These are paid outside the card and applied to each complete month. Edit amounts here (e.g. when your FPL average changes).</p></div>';

    var prows = X.paychecks.slice().sort(function (a, b) { return String(b.payDate).localeCompare(String(a.payDate)); }).map(function (p) {
      var tag = p.source === 'stub' ? '<span class="badge">verified</span>' : p.source === 'derived' ? '<span class="badge">derived</span>' : p.source === 'manual' ? '<span class="badge">added</span>' : '<span class="badge">est.</span>';
      return '<tr><td class="num date">' + p.payDate + '</td><td>' + esc(p.type || 'Regular') + ' ' + tag + '</td><td class="right num">' + money(p.gross) + '</td><td class="right num muted">' + money(p.taxes) + '</td><td class="right num muted">' + money(p.deductions) + '</td><td class="right num">' + money(p.net) + '</td><td class="right"><button class="xbtn" data-action="del-pay" data-id="' + esc(p.id) + '" title="Remove">✕</button></td></tr>';
    }).join('');
    var addBtn = S.addPay ? addPayForm() : '<button class="btn" data-action="toggle-addpay">+ Add a paycheck</button>';
    var payCard = '<div class="card span-2"><div class="card-h"><div>' + eyebrow('Paychecks') + '<h3>Pay periods</h3></div><button class="btn ghost" data-action="reset-income">Reset to bundled</button></div><div class="tbl-scroll"><table class="tbl"><tr><th>Pay date</th><th>Type</th><th class="right">Gross</th><th class="right">Taxes</th><th class="right">Deductions</th><th class="right">Net</th><th></th></tr>' + prows + '</table></div><div class="addpay-wrap">' + addBtn + '</div><p class="muted">Send each pay-stub PDF and I’ll add the exact period. Jan–May are reconstructed from your stub’s YTD totals (net reconciles to the cent); the ' + (stub ? mShort(stub.payDate.slice(0, 7)) : '') + ' check is verified. The $10k bonus is amortized evenly across all 12 months.</p></div>';

    return '<div class="grid">' + k + chart + '<div class="cols-2">' + breakdownCard + detailCard + '</div><div class="cols-2">' + recurCard + '<div class="card"><div class="card-h"><div>' + eyebrow('Run-rate') + '<h3>Annualized</h3></div></div><div class="seg-rows"><div class="seg-row"><span class="seg-name">Monthly income</span><span class="num seg-amt">' + money(X.regMonthly) + '</span></div><div class="seg-row"><span class="seg-name">Annual net (incl. bonus)</span><span class="num seg-amt">' + money0(X.annualNetIncome) + '</span></div><div class="seg-row"><span class="seg-name">Annual fixed bills</span><span class="num seg-amt">' + money0(X.fixedMonthly * 12) + '</span></div></div></div></div>' + fixedCard + payCard + '</div>';
  }
  function addRecurForm() {
    return '<div class="addpay"><div class="addpay-grid g3"><label>Name<input type="text" id="ar-name" placeholder="e.g. Rental income"></label><label>Type<select id="ar-type"><option>Other income</option><option>Interest income</option><option>Bonus</option></select></label><label>Amount / mo<input type="number" id="ar-amt" step="0.01" placeholder="0.00"></label></div><div class="addpay-foot"><span class="muted">Applied to each complete month.</span><div class="addpay-btns"><button class="btn" data-action="save-recur">Add</button><button class="btn ghost" data-action="toggle-addrecur">Cancel</button></div></div></div>';
  }
  function addFixedForm() {
    var cats = ['Mortgage', 'HOA', 'Utilities', 'Auto Loan', 'Student Loan', 'Kids & Activities', 'Insurance', 'Housing & Home', 'Health & Medical', 'Subscriptions'];
    return '<div class="addpay"><div class="addpay-grid g3"><label>Name<input type="text" id="af-name" placeholder="e.g. Water bill"></label><label>Category<select id="af-cat">' + cats.map(function (c) { return '<option>' + c + '</option>'; }).join('') + '</select></label><label>Amount / mo<input type="number" id="af-amt" step="0.01" placeholder="0.00"></label></div><div class="addpay-foot"><span class="muted">Applied to each complete month.</span><div class="addpay-btns"><button class="btn" data-action="save-fixed">Add</button><button class="btn ghost" data-action="toggle-addfixed">Cancel</button></div></div></div>';
  }
  function addPayForm() {
    return '<div class="addpay"><div class="addpay-grid">' +
      '<label>Pay date<input type="date" id="ap-date" value="2026-06-15"></label>' +
      '<label>Type<select id="ap-type"><option>Regular</option><option>Bonus</option><option>Other</option></select></label>' +
      '<label>Gross<input type="number" id="ap-gross" step="0.01" placeholder="' + (X.incMeta.perCheckGross || '') + '"></label>' +
      '<label>Taxes<input type="number" id="ap-tax" step="0.01" placeholder="' + (X.incMeta.perCheckTax || '') + '"></label>' +
      '<label>Deductions<input type="number" id="ap-ded" step="0.01" placeholder="' + (X.incMeta.perCheckDed || '') + '"></label>' +
      '</div><div class="addpay-foot"><span class="muted">Net = gross − taxes − deductions.</span><div class="addpay-btns"><button class="btn" data-action="save-pay">Add paycheck</button><button class="btn ghost" data-action="toggle-addpay">Cancel</button></div></div></div>';
  }

  /* =================================================================
     VIEW: TRANSACTIONS
     ================================================================= */
  function vTxns() {
    var f = S.txnFilter;
    var list = DATA.filter(function (t) { return (S.settings.includeDeclined ? true : !t.declined) && !t.isFixed; });
    list = list.filter(function (t) {
      if (f.month !== 'all' && t.month !== f.month) return false;
      if (f.cat !== 'all' && t.category !== f.cat) return false;
      if (f.who !== 'all' && t.cardholder !== f.who) return false;
      if (f.q) { var q = f.q.toLowerCase(); if ((t.merchant + ' ' + t.description).toLowerCase().indexOf(q) === -1) return false; }
      return true;
    });
    list.sort(function (a, b) { return (b.date + b.time).localeCompare(a.date + a.time); });
    var sum = list.reduce(function (s, t) { return s + (t.isSpend ? t.amount : 0); }, 0);

    var who = {}; DATA.forEach(function (t) { who[t.cardholder] = 1; });
    var allCats = E.CATEGORY_ORDER.concat(['Credits & Rewards', 'Card Payment']);
    var catOptions = function (cur) { return allCats.map(function (c) { return '<option value="' + esc(c) + '"' + (c === cur ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join(''); };

    var filters = '<div class="filters">' +
      '<input class="select grow" type="search" placeholder="Search merchant or description…" value="' + esc(f.q) + '" data-action="txn-search">' +
      '<select class="select" data-action="txn-month"><option value="all">All months</option>' + A.months.map(function (m) { return '<option value="' + m + '"' + (f.month === m ? ' selected' : '') + '>' + mLong(m) + '</option>'; }).join('') + '</select>' +
      '<select class="select" data-action="txn-cat"><option value="all">All categories</option>' + X.cats.map(function (c) { return '<option value="' + esc(c) + '"' + (f.cat === c ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select>' +
      '<select class="select" data-action="txn-who"><option value="all">Everyone</option>' + Object.keys(who).map(function (w) { return '<option value="' + esc(w) + '"' + (f.who === w ? ' selected' : '') + '>' + esc(titleCase(w)) + '</option>'; }).join('') + '</select>' +
      '<label class="chk"><input type="checkbox" data-action="toggle-declined" ' + (S.settings.includeDeclined ? 'checked' : '') + '> declined</label>' +
      '</div>';

    var rows = list.slice(0, 600).map(function (t) {
      return '<tr class="' + (t.declined ? 'declined' : '') + '"><td class="num date">' + t.date + '</td>' +
        '<td>' + esc(t.merchant) + (t.declined ? ' <span class="badge red">declined</span>' : t.status === 'Pending' ? ' <span class="badge">pending</span>' : '') + (t.description ? '<div class="td-desc muted">' + esc(t.description) + '</div>' : '') + '</td>' +
        '<td><select class="cat-select" data-action="recat" data-merchant="' + esc(t.merchant.toLowerCase()) + '" style="--cc:' + catColor(t.category) + '">' + catOptions(t.category) + '</select></td>' +
        '<td class="muted who">' + esc(firstName(t.cardholder)) + '</td>' +
        '<td class="right num ' + (t.amount < 0 ? 'credit' : '') + '">' + money(t.amount) + '</td></tr>';
    }).join('');

    var count = '<div class="txn-meta"><span><strong class="num">' + list.length + '</strong> transactions</span><span>net <strong class="num">' + money(sum) + '</strong></span>' + (list.length > 600 ? '<span class="muted">showing first 600</span>' : '') + '</div>';

    return '<div class="grid"><div class="card span-2"><div class="card-h"><div>' + eyebrow('Ledger') + '<h3>All transactions</h3></div></div>' + filters + count + '<div class="tbl-scroll tall"><table class="tbl txns"><tr><th>Date</th><th>Merchant</th><th>Category</th><th>Who</th><th class="right">Amount</th></tr>' + rows + '</table></div><p class="muted">Tip: change a category here and it sticks for every transaction from that merchant.</p></div></div>';
  }
  function titleCase(s) { return String(s).toLowerCase().replace(/\b\w/g, function (c) { return c.toUpperCase(); }); }
  function firstName(s) { return titleCase(String(s).split(' ')[0]); }

  /* =================================================================
     VIEW: DATA & SETTINGS
     ================================================================= */
  function vData() {
    var merchants = Object.keys(A.merchantMeta).filter(function (mc) { return !E.FIXED_CATS[A.merchantMeta[mc].category]; }).sort(function (a, b) { return A.merchantTotals[b] - A.merchantTotals[a]; });
    var allCats = E.CATEGORY_ORDER.slice();
    var rows = merchants.map(function (mc) {
      var cur = A.merchantMeta[mc].category;
      var overridden = Object.prototype.hasOwnProperty.call(S.overrides, mc.toLowerCase());
      return '<tr><td>' + esc(mc) + (overridden ? ' <span class="badge">custom</span>' : '') + '</td><td class="right num muted">' + A.merchantMeta[mc].count + '×</td><td class="right num">' + money0(A.merchantTotals[mc]) + '</td>' +
        '<td><select class="cat-select" data-action="recat" data-merchant="' + esc(mc.toLowerCase()) + '" style="--cc:' + catColor(cur) + '">' + allCats.map(function (c) { return '<option value="' + esc(c) + '"' + (c === cur ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select></td></tr>';
    }).join('');

    var drop = '<div class="dropzone" id="dropzone"><div class="dz-inner"><div class="dz-ico">↑</div><div><strong>Update with this week’s transactions</strong><div class="muted">Drop your latest CSV export here, or <label class="link" for="csv-file">browse</label>. Same format as your bank export.</div></div></div><input type="file" id="csv-file" accept=".csv" hidden></div>';

    var meta = '<div class="data-meta">' + kpi('Transactions', String(DATA.length)) + kpi('Date range', A.months.length ? (mShort(A.months[0]) + '–' + mShort(A.months[A.months.length - 1])) : '—') + kpi('Net spend', money0(A.total)) + kpi('Last updated', S.lastUpdated ? S.lastUpdated : 'bundled data') + '</div>';

    var actions = '<div class="data-actions"><button class="btn" data-action="export-csv">Export categorized CSV</button><button class="btn" data-action="export-settings">Export settings</button><label class="btn" for="import-file">Import settings</label><input type="file" id="import-file" accept=".json" hidden><button class="btn ghost" data-action="reset-overrides">Reset categories</button><button class="btn ghost" data-action="reset-data">Restore bundled data</button></div>';

    return '<div class="grid">' +
      '<div class="card span-2"><div class="card-h"><div>' + eyebrow('Weekly update') + '<h3>Data</h3></div></div>' + drop + meta + actions + '</div>' +
      '<div class="card span-2"><div class="card-h"><div>' + eyebrow('Tagging') + '<h3>How merchants map to categories</h3></div><span class="muted">' + merchants.length + ' merchants</span></div><p class="muted tag-help">This is the engine that decides what’s housing, food, investment, and so on. Reassign any merchant and the change applies everywhere and is remembered.</p><div class="tbl-scroll tall"><table class="tbl"><tr><th>Merchant</th><th class="right">Count</th><th class="right">YTD</th><th>Category</th></tr>' + rows + '</table></div></div></div>';
  }

  /* =================================================================
     ROUTER + SHELL
     ================================================================= */
  var NAV = [
    ['overview', 'Overview', 'M3 13h2v6H3zM10 7h2v12h-2zM17 10h2v9h-2z'],
    ['income', 'Income', 'M3 8a1 1 0 011-1h16a1 1 0 011 1v8a1 1 0 01-1 1H4a1 1 0 01-1-1zM2 19h20v1.5H2z'],
    ['pnl', 'P&L Statement', 'M4 4h16v4H4zM4 10h16v2H4zM4 14h10v2H4zM4 18h7v2H4z'],
    ['cash', 'Cash Flow', 'M4 18h3v-7H4zM10 18h3V5h-3zM16 18h3v-4h-3z'],
    ['cats', 'Categories', 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z'],
    ['proj', 'Projections', 'M3 17l5-5 4 3 6-7 3 3'],
    ['alerts', 'Budget Alerts', 'M12 3l9 16H3zM12 10v4M12 16.5v.5'],
    ['txns', 'Transactions', 'M4 6h16M4 12h16M4 18h16'],
    ['data', 'Data & Tags', 'M12 4c4 0 7 1.3 7 3v10c0 1.7-3 3-7 3s-7-1.3-7-3V7c0-1.7 3-3 7-3z']
  ];

  function shell() {
    var nav = NAV.map(function (n) {
      var ic = n[0] === 'proj' || n[0] === 'alerts' ? '<polyline points="' + n[2].replace(/[ML]/g, ' ').trim() + '" fill="none" stroke="currentColor" stroke-width="1.7"/>' : '<path d="' + n[2] + '" fill="currentColor"/>';
      return '<button class="nav-item ' + (S.view === n[0] ? 'active' : '') + '" data-action="nav" data-view="' + n[0] + '"><svg viewBox="0 0 24 24" class="nav-ico">' + ic + '</svg><span>' + n[1] + '</span></button>';
    }).join('');
    return '<aside class="sidebar"><div class="brand"><div class="brand-mark">$</div><div class="brand-txt"><div class="brand-name">Domingo</div><div class="brand-sub">Personal CFO</div></div></div><nav class="nav">' + nav + '</nav><div class="side-foot"><div class="muted">YTD net spend</div><div class="side-tot num">' + money0(A.total) + '</div><div class="muted">' + (A.months.length ? mLong(A.months[0]).split(' ')[0] + '–' + mShort(A.months[A.months.length - 1]) + ' ' + A.months[0].slice(0, 4) : '') + '</div></div></aside>' +
      '<main class="content"><header class="topbar"><div><div class="eyebrow">' + ({ overview: 'Dashboard', income: 'Earnings', pnl: 'Statement', cash: 'Liquidity', cats: 'Breakdown', proj: 'Forecast', alerts: 'Monitor', txns: 'Ledger', data: 'Settings' }[S.view] || '') + '</div><h1>' + (NAV.filter(function (n) { return n[0] === S.view; })[0] || [, 'Overview'])[1] + '</h1></div><div class="top-actions"><button class="btn" data-action="nav" data-view="data">↑ Update CSV</button></div></header><div id="main" class="main"></div></main>';
  }

  var VIEWS = { overview: vOverview, income: vIncome, pnl: vPnl, cash: vCash, cats: vCats, proj: vProj, alerts: vAlerts, txns: vTxns, data: vData };

  function render() {
    var root = document.getElementById('app');
    root.className = 'app';
    root.innerHTML = shell();
    document.getElementById('main').innerHTML = (VIEWS[S.view] || vOverview)();
    window.scrollTo(0, 0);
    var mainEl = document.querySelector('.content'); if (mainEl) mainEl.scrollTop = 0;
  }

  function recompute(reseedBudgets) { if (reseedBudgets) S.budgets = null; compute(); }

  /* =================================================================
     EVENTS
     ================================================================= */
  function handleCSVText(text) {
    try {
      var recs = E.recordsFromCSV(text);
      if (!recs.length) { alert('No rows found in that file.'); return; }
      S.csv = text; S.lastUpdated = new Date().toLocaleString('en-US');
      LS.set('cfo_updated', S.lastUpdated);
      try { LS.set('cfo_csv', text); } catch (e) {}
      recompute(false);
      render();
    } catch (err) { alert('Could not read that CSV: ' + err.message); }
  }

  function bind() {
    document.addEventListener('click', function (e) {
      var el = e.target.closest('[data-action]'); if (!el) return;
      var act = el.getAttribute('data-action');
      if (act === 'nav') { S.view = el.getAttribute('data-view'); S.catDetail = null; S.pnlDrill = null; render(); }
      else if (act === 'cf-mode') { S.cfMode = el.getAttribute('data-mode'); render(); }
      else if (act === 'proj-method') { S.settings.projMethod = el.getAttribute('data-method'); saveSettings(); render(); }
      else if (act === 'cat-detail') { var c = el.getAttribute('data-cat'); S.catDetail = c || null; render(); }
      else if (act === 'oneoff-all') {
        var mode = el.getAttribute('data-mode');
        S.excluded = {};
        if (mode === 'exclude') (X.oneOffs || []).forEach(function (o) { S.excluded[o.id] = true; });
        LS.set('cfo_excluded', S.excluded); recompute(false); render();
      }
      else if (act === 'pnl-drill') { var dk = el.getAttribute('data-dk'); S.pnlDrill = dk ? { kind: dk, key: el.getAttribute('data-dkey') || '', month: el.getAttribute('data-dm') || '' } : null; render(); }
      else if (act === 'export-csv') exportCSV();
      else if (act === 'export-settings') exportSettings();
      else if (act === 'reset-overrides') { if (confirm('Clear all custom category assignments?')) { S.overrides = {}; LS.set('cfo_overrides', {}); recompute(false); render(); } }
      else if (act === 'reset-data') { if (confirm('Restore the original bundled transactions?')) { S.csv = window.__CSV__; try { localStorage.removeItem('cfo_csv'); } catch (e) {} S.lastUpdated = null; LS.set('cfo_updated', null); recompute(false); render(); } }
      else if (act === 'toggle-addpay') { S.addPay = !S.addPay; render(); }
      else if (act === 'save-pay') savePaycheck();
      else if (act === 'del-pay') { var pid = el.getAttribute('data-id'); S.paychecks = S.paychecks.filter(function (p) { return p.id !== pid; }); LS.set('cfo_paychecks', S.paychecks); recompute(false); render(); }
      else if (act === 'reset-income') { if (confirm('Restore the original reconstructed paychecks, fixed bills and other income?')) { S.paychecks = clone(INC0.paychecks || []); S.recurringIncome = clone(INC0.recurringIncome || []); S.fixedExpenses = clone(INC0.fixedExpenses || []); try { localStorage.removeItem('cfo_paychecks'); localStorage.removeItem('cfo_recurring'); localStorage.removeItem('cfo_fixed'); } catch (e) {} recompute(false); render(); } }
      else if (act === 'toggle-addrecur') { S.addRecur = !S.addRecur; render(); }
      else if (act === 'save-recur') saveRecur();
      else if (act === 'del-recur') { var rid = el.getAttribute('data-id'); S.recurringIncome = S.recurringIncome.filter(function (r) { return r.id !== rid; }); LS.set('cfo_recurring', S.recurringIncome); recompute(false); render(); }
      else if (act === 'toggle-addfixed') { S.addFixed = !S.addFixed; render(); }
      else if (act === 'save-fixed') saveFixed();
      else if (act === 'del-fixed') { var fid = el.getAttribute('data-id'); S.fixedExpenses = S.fixedExpenses.filter(function (f) { return f.id !== fid; }); LS.set('cfo_fixed', S.fixedExpenses); recompute(false); render(); }
    });
    document.addEventListener('change', function (e) {
      var el = e.target.closest('[data-action]'); if (!el) return;
      var act = el.getAttribute('data-action');
      if (act === 'recat') {
        var merch = el.getAttribute('data-merchant'); var val = el.value;
        S.overrides[merch] = val; LS.set('cfo_overrides', S.overrides); recompute(false); render();
      } else if (act === 'alert-month') { S.alertMonth = el.value; render(); }
      else if (act === 'txn-month') { S.txnFilter.month = el.value; render(); }
      else if (act === 'txn-cat') { S.txnFilter.cat = el.value; render(); }
      else if (act === 'txn-who') { S.txnFilter.who = el.value; render(); }
      else if (act === 'toggle-declined') { S.settings.includeDeclined = el.checked; saveSettings(); render(); }
      else if (act === 'toggle-lumpy') { S.settings.lumpyOneTime = el.checked; saveSettings(); render(); }
      else if (act === 'toggle-oneoff') {
        var oid = el.getAttribute('data-oid');
        if (el.checked) { delete S.excluded[oid]; } else { S.excluded[oid] = true; }
        LS.set('cfo_excluded', S.excluded); recompute(false); render();
      }
      else if (act === 'budget') { var cat = el.getAttribute('data-cat'); S.budgets[cat] = parseFloat(el.value) || 0; LS.set('cfo_budgets', S.budgets); render(); }
      else if (el.id === 'csv-file') { var file = el.files[0]; if (file) { var rd = new FileReader(); rd.onload = function () { handleCSVText(String(rd.result)); }; rd.readAsText(file); } }
      else if (el.id === 'import-file') { var f2 = el.files[0]; if (f2) { var r2 = new FileReader(); r2.onload = function () { importSettings(String(r2.result)); }; r2.readAsText(f2); } }
    });
    document.addEventListener('input', function (e) {
      var el = e.target.closest('[data-action]'); if (!el) return;
      var act = el.getAttribute('data-action');
      if (act === 'proj-adjust') { S.settings.projAdjust = parseInt(el.value, 10) || 0; saveSettings(); render(); }
      else if (act === 'txn-search') { S.txnFilter.q = el.value; debounceRender(); }
    });
    // drag & drop
    document.addEventListener('dragover', function (e) { if (e.target.closest('#dropzone')) { e.preventDefault(); e.target.closest('#dropzone').classList.add('drag'); } });
    document.addEventListener('dragleave', function (e) { var dz = e.target.closest('#dropzone'); if (dz) dz.classList.remove('drag'); });
    document.addEventListener('drop', function (e) {
      var dz = e.target.closest('#dropzone'); if (!dz) return; e.preventDefault(); dz.classList.remove('drag');
      var file = e.dataTransfer.files[0]; if (file) { var rd = new FileReader(); rd.onload = function () { handleCSVText(String(rd.result)); }; rd.readAsText(file); }
    });
  }
  var dbTimer; function debounceRender() { clearTimeout(dbTimer); dbTimer = setTimeout(function () { var a = document.activeElement, pos = a && a.selectionStart; render(); var s = document.querySelector('[data-action="txn-search"]'); if (s) { s.focus(); try { s.setSelectionRange(pos, pos); } catch (e) {} } }, 220); }
  function saveSettings() { LS.set('cfo_settings', S.settings); }
  function savePaycheck() {
    var dEl = document.getElementById('ap-date'), gEl = document.getElementById('ap-gross');
    if (!dEl || !gEl) return;
    var d = dEl.value, type = (document.getElementById('ap-type') || {}).value || 'Regular';
    var g = parseFloat(gEl.value) || 0, t = parseFloat((document.getElementById('ap-tax') || {}).value) || 0, de = parseFloat((document.getElementById('ap-ded') || {}).value) || 0;
    if (!d || !g) { alert('Enter at least a pay date and a gross amount.'); return; }
    var net = Math.round((g - t - de) * 100) / 100;
    S.paychecks.push({ id: 'usr-' + Date.now(), payDate: d, periodStart: d, periodEnd: d, gross: g, taxes: t, deductions: de, net: net, bonus: (type === 'Bonus' ? g : 0), type: type, source: 'manual' });
    LS.set('cfo_paychecks', S.paychecks); S.addPay = false; recompute(false); render();
  }
  function saveRecur() {
    var nEl = document.getElementById('ar-name'), aEl = document.getElementById('ar-amt');
    if (!nEl || !aEl) return;
    var name = (nEl.value || '').trim(), amt = parseFloat(aEl.value) || 0, type = (document.getElementById('ar-type') || {}).value || 'Other income';
    if (!name || !amt) { alert('Enter a name and a monthly amount.'); return; }
    S.recurringIncome.push({ id: 'usr-' + Date.now(), name: name, amount: amt, type: type });
    LS.set('cfo_recurring', S.recurringIncome); S.addRecur = false; recompute(false); render();
  }
  function saveFixed() {
    var nEl = document.getElementById('af-name'), aEl = document.getElementById('af-amt');
    if (!nEl || !aEl) return;
    var name = (nEl.value || '').trim(), amt = parseFloat(aEl.value) || 0, cat = (document.getElementById('af-cat') || {}).value || 'Utilities';
    if (!name || !amt) { alert('Enter a name and a monthly amount.'); return; }
    S.fixedExpenses.push({ id: 'usr-' + Date.now(), name: name, amount: amt, category: cat });
    LS.set('cfo_fixed', S.fixedExpenses); S.addFixed = false; recompute(false); render();
  }

  /* ---------- export / import ---------- */
  function download(name, text, type) {
    var blob = new Blob([text], { type: type || 'text/plain' }); var url = URL.createObjectURL(blob);
    var a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  }
  function exportCSV() {
    var head = 'Date,Time,Cardholder,Amount,Category,Segment,Status,Type,Merchant,Description\n';
    var body = DATA.map(function (t) {
      return [t.date, q(t.time), q(t.cardholder), t.amount, q(t.category), q(t.segment), t.status, t.type, q(t.merchant), q(t.description)].join(',');
    }).join('\n');
    download('finances-categorized.csv', head + body, 'text/csv');
    function q(s) { s = String(s == null ? '' : s); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
  }
  function exportSettings() { download('cfo-settings.json', JSON.stringify({ overrides: S.overrides, budgets: S.budgets, settings: S.settings, paychecks: S.paychecks, recurringIncome: S.recurringIncome, fixedExpenses: S.fixedExpenses }, null, 2), 'application/json'); }
  function importSettings(text) {
    try { var o = JSON.parse(text); if (o.overrides) { S.overrides = o.overrides; LS.set('cfo_overrides', S.overrides); } if (o.budgets) { S.budgets = o.budgets; LS.set('cfo_budgets', S.budgets); } if (o.paychecks) { S.paychecks = o.paychecks; LS.set('cfo_paychecks', S.paychecks); } if (o.recurringIncome) { S.recurringIncome = o.recurringIncome; LS.set('cfo_recurring', S.recurringIncome); } if (o.fixedExpenses) { S.fixedExpenses = o.fixedExpenses; LS.set('cfo_fixed', S.fixedExpenses); } if (o.settings) { S.settings = Object.assign(S.settings, o.settings); saveSettings(); } recompute(false); render(); alert('Settings imported.'); }
    catch (e) { alert('That file is not valid settings JSON.'); }
  }

  /* ---------- boot ---------- */
  function boot() {
    // restore previously uploaded CSV + paychecks if present
    var saved = LS.get('cfo_csv', null); if (saved) S.csv = saved;
    var savedPay = LS.get('cfo_paychecks', null); if (savedPay) S.paychecks = savedPay;
    var savedRec = LS.get('cfo_recurring', null); if (savedRec) S.recurringIncome = savedRec;
    var savedFx = LS.get('cfo_fixed', null); if (savedFx) S.fixedExpenses = savedFx;
    compute(); bind(); render();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
