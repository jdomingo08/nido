/* =====================================================================
   CFO ENGINE  —  pure data logic (runs in browser AND node)
   Parsing · categorization · segment roll-up · aggregation
   ===================================================================== */
(function (global) {
  'use strict';

  /* ---- Category taxonomy ------------------------------------------ */
  var RULES = [
    ['apmex', 'Investments'],
    ['peacock', 'Subscriptions'],
    ['tesla', 'Transportation & Auto'], ['speedway', 'Transportation & Auto'], ['service plaza', 'Transportation & Auto'],
    ['seed to table', 'Groceries & Household'],
    ['brooks burgers', 'Dining & Takeout'], ['crust pizza', 'Dining & Takeout'], ['pizza', 'Dining & Takeout'], ['burger', 'Dining & Takeout'],
    ['airbnb', 'Travel'], ['hotel', 'Travel'],
    ['american airlines', 'Travel'], ['airlines', 'Travel'], ['marriott', 'Travel'],
    ['whole foods', 'Groceries & Household'],
    ['uber eats', 'Dining & Takeout'], ['ubereats', 'Dining & Takeout'],
    ['lyft', 'Transportation & Auto'], ['uber', 'Transportation & Auto'],
    ['tax collector', 'Taxes & Fees'],
    ["lily's mediterranean", 'Dining & Takeout'], ['lilys medi', 'Dining & Takeout'], ['365 retail markets', 'Dining & Takeout'],
    ['entertain st', 'Entertainment & Recreation'], ['s.fl.ent', 'Entertainment & Recreation'],
    ['verizon', 'Phone'], ['costa del sol', 'HOA'],
    ['bark square', 'Pets'], ['petco', 'Pets'], ['petsmart', 'Pets'], ['chewy', 'Pets'],
    ['n8n', 'Business & Software'],
    ['etsy', 'Shopping & Retail'], ['ebay', 'Shopping & Retail'], ['groupon', 'Shopping & Retail'], ['tellmytale', 'Shopping & Retail'],
    ['panda express', 'Dining & Takeout'], ['mister 01', 'Dining & Takeout'], ['michi', 'Dining & Takeout'], ['pauloluigi', 'Dining & Takeout'], ['daily bread', 'Dining & Takeout'], ['cucu place', 'Dining & Takeout'], ['juice bar', 'Dining & Takeout'],
    ['bluehost', 'Business & Software'], ['replit', 'Business & Software'],
    ['supabase', 'Business & Software'], ['openai', 'Business & Software'],
    ['elevenlabs', 'Business & Software'], ['moonshot', 'Business & Software'],
    ['twilio', 'Business & Software'], ['wispr', 'Business & Software'],
    ['prodigi', 'Business & Software'], ['google cloud', 'Business & Software'],
    ['facebk', 'Business & Software'], ['facebook', 'Business & Software'],
    ['division of corporations', 'Business & Software'], ['polsia', 'Business & Software'],
    ['fabuloom', 'Business & Software'], ['xai', 'Business & Software'],
    ['spotify', 'Subscriptions'], ['apple.com', 'Subscriptions'], ['apple', 'Subscriptions'],
    ['state farm', 'Insurance'], ['insurance', 'Insurance'],
    ['cvs', 'Health & Medical'], ['walgreens', 'Health & Medical'],
    ['pharmacy', 'Health & Medical'], ['dental', 'Health & Medical'],
    ['glassesusa', 'Health & Medical'], ['for eyes', 'Health & Medical'],
    ['beauty bar', 'Personal Care & Beauty'], ['nimi skincare', 'Personal Care & Beauty'],
    ['skincare', 'Personal Care & Beauty'],
    ['central park', 'Entertainment & Recreation'], ['museum', 'Entertainment & Recreation'],
    ['kidstrong', 'Entertainment & Recreation'], ['parks broward', 'Entertainment & Recreation'],
    ['shell', 'Transportation & Auto'], ['car wash', 'Transportation & Auto'],
    ['park one', 'Transportation & Auto'], ['laz parking', 'Transportation & Auto'],
    ['parking', 'Transportation & Auto'], ['parkin', 'Transportation & Auto'],
    ['auto tag', 'Transportation & Auto'],
    ['walmart', 'Groceries & Household'], ['winn-dixie', 'Groceries & Household'],
    ['winn dixie', 'Groceries & Household'], ['publix', 'Groceries & Household'],
    ['thrive market', 'Groceries & Household'], ['grazianos', 'Groceries & Household'],
    ['meat club', 'Groceries & Household'], ['costco', 'Groceries & Household'],
    ['home depot', 'Housing & Home'], ["lowe's", 'Housing & Home'], ['ikea', 'Housing & Home'],
    ['amazon', 'Shopping & Retail'], ['target', 'Shopping & Retail'],
    ['burlington', 'Shopping & Retail'], ["dick's", 'Shopping & Retail'],
    ['dicks sporting', 'Shopping & Retail'], ['tiktok', 'Shopping & Retail'],
    ['gift shop', 'Shopping & Retail'],
    ['piccola', 'Dining & Takeout'], ['chick-fil', 'Dining & Takeout'],
    ['cuban', 'Dining & Takeout'], ['lasvegascuban', 'Dining & Takeout'],
    ['five guys', 'Dining & Takeout'], ['jimmy john', 'Dining & Takeout'],
    ['chipotle', 'Dining & Takeout'], ['papa john', 'Dining & Takeout'],
    ['mcdonald', 'Dining & Takeout'], ['pollo tropical', 'Dining & Takeout'],
    ['wendy', 'Dining & Takeout'], ['domino', 'Dining & Takeout'],
    ['panera', 'Dining & Takeout'], ['subway', 'Dining & Takeout'],
    ['ceviche', 'Dining & Takeout'], ['limon', 'Dining & Takeout'],
    ['nahuen', 'Dining & Takeout'], ['lebanese', 'Dining & Takeout'],
    ['kabob', 'Dining & Takeout'], ['sazon', 'Dining & Takeout'],
    ['sazón', 'Dining & Takeout'], ['milanezza', 'Dining & Takeout'],
    ['boulangerie', 'Dining & Takeout'], ['taco rico', 'Dining & Takeout'],
    ['crema gourmet', 'Dining & Takeout'], ['habit', 'Dining & Takeout'],
    ['coal fired', 'Dining & Takeout'], ['pummarola', 'Dining & Takeout'],
    ['capriccio', 'Dining & Takeout'], ['babilonia', 'Dining & Takeout'],
    ['sabores', 'Dining & Takeout'], ['confucio', 'Dining & Takeout'],
    ['spruce juice', 'Dining & Takeout'], ['rinconcito', 'Dining & Takeout'],
    ['sproutz', 'Dining & Takeout'], ['wawa', 'Dining & Takeout'],
    ['doordash', 'Dining & Takeout'], ['pizzeria', 'Dining & Takeout'],
    ['restaurant', 'Dining & Takeout'], ['espresso', 'Dining & Takeout']
  ];

  var SEGMENT = {
    'Groceries & Household': 'Essential', 'Health & Medical': 'Essential',
    'Insurance': 'Essential', 'Housing & Home': 'Essential', 'Transportation & Auto': 'Essential',
    'Dining & Takeout': 'Lifestyle', 'Shopping & Retail': 'Lifestyle',
    'Personal Care & Beauty': 'Lifestyle', 'Entertainment & Recreation': 'Lifestyle',
    'Subscriptions': 'Lifestyle',
    'Business & Software': 'Business',
    'Investments': 'Investment',
    'Mortgage': 'Essential', 'HOA': 'Essential', 'Utilities': 'Essential',
    'Auto Loan': 'Essential', 'Student Loan': 'Essential', 'Kids & Activities': 'Lifestyle', 'Phone': 'Essential',
    'Travel': 'Lifestyle', 'Pets': 'Lifestyle', 'Taxes & Fees': 'Essential',
    'Uncategorized': 'Unassigned', 'Credits & Rewards': 'Adjustments', 'Card Payment': 'Adjustments'
  };

  var FIXED_CATS = { 'Mortgage': 1, 'HOA': 1, 'Utilities': 1, 'Auto Loan': 1, 'Student Loan': 1, 'Kids & Activities': 1, 'Phone': 1 };

  var CATEGORY_ORDER = [
    'Dining & Takeout', 'Groceries & Household', 'Shopping & Retail', 'Business & Software',
    'Investments', 'Insurance', 'Personal Care & Beauty', 'Health & Medical',
    'Entertainment & Recreation', 'Transportation & Auto', 'Subscriptions', 'Travel', 'Pets', 'Taxes & Fees', 'Housing & Home',
    'Mortgage', 'HOA', 'Utilities', 'Phone', 'Auto Loan', 'Student Loan', 'Kids & Activities',
    'Uncategorized'
  ];

  var SEGMENT_ORDER = ['Essential', 'Lifestyle', 'Business', 'Investment', 'Unassigned'];

  var CAT_COLORS = {
    'Dining & Takeout': '#B2473B', 'Groceries & Household': '#1F6F54',
    'Shopping & Retail': '#C58A2E', 'Business & Software': '#3B5BA5',
    'Investments': '#6A4C93', 'Insurance': '#4E7689',
    'Personal Care & Beauty': '#C16B86', 'Health & Medical': '#2E8B8B',
    'Entertainment & Recreation': '#D08A3E', 'Transportation & Auto': '#7A8450',
    'Subscriptions': '#8C6D4F', 'Housing & Home': '#5B7C99', 'Travel': '#B5654D', 'Pets': '#5F9EA0', 'Taxes & Fees': '#8A8574',
    'Mortgage': '#2F4B6E', 'HOA': '#6E8CA8', 'Utilities': '#9C7A2E', 'Auto Loan': '#46756B',
    'Student Loan': '#585A8C', 'Kids & Activities': '#CC7A52', 'Phone': '#7C9BAA',
    'Uncategorized': '#9A9384', 'Credits & Rewards': '#B0A98F', 'Card Payment': '#C9C2B0'
  };

  var SEG_COLORS = {
    'Essential': '#1F6F54', 'Lifestyle': '#B2473B', 'Business': '#3B5BA5',
    'Investment': '#6A4C93', 'Unassigned': '#9A9384', 'Adjustments': '#C9C2B0'
  };

  var LUMPY = { 'Investments': true };

  /* ---- Helpers ----------------------------------------------------- */
  function num(x) {
    if (x === null || x === undefined) return 0;
    var v = parseFloat(String(x).replace(/[$,]/g, ''));
    return isNaN(v) ? 0 : v;
  }

  function cleanMerchant(m) { return String(m == null ? '' : m).replace(/^Refund:\s*/i, '').trim(); }

  function parseCSV(text) {
    var rows = [], row = [], field = '', i = 0, inQ = false, c, n;
    text = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    while (i < text.length) {
      c = text[i];
      if (inQ) {
        if (c === '"') {
          n = text[i + 1];
          if (n === '"') { field += '"'; i += 2; continue; }
          inQ = false; i++; continue;
        }
        field += c; i++; continue;
      }
      if (c === '"') { inQ = true; i++; continue; }
      if (c === ',') { row.push(field); field = ''; i++; continue; }
      if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
      field += c; i++;
    }
    if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
    return rows;
  }

  function recordsFromCSV(text) {
    var grid = parseCSV(text);
    if (!grid.length) return [];
    var header = grid[0].map(function (h) { return String(h).trim(); });
    var objs = [];
    for (var r = 1; r < grid.length; r++) {
      var g = grid[r];
      if (g.length === 1 && g[0] === '') continue;
      var o = {};
      for (var k = 0; k < header.length; k++) o[header[k]] = g[k] !== undefined ? g[k] : '';
      if (!o.Date && !o.Amount && !o.Merchant) continue;
      objs.push(o);
    }
    return objs;
  }

  function categorize(merchant, desc, type, overrides) {
    if (type === 'Payment') return 'Card Payment';
    if (type === 'Other') return 'Credits & Rewards';
    var key = String(merchant == null ? '' : merchant).trim().toLowerCase();
    if (overrides && Object.prototype.hasOwnProperty.call(overrides, key)) return overrides[key];
    if (String(merchant == null ? '' : merchant).trim().toUpperCase() === 'UPS') return 'Business & Software';
    var hay = (String(merchant || '') + ' ' + String(desc || '')).toLowerCase();
    for (var i = 0; i < RULES.length; i++) {
      if (hay.indexOf(RULES[i][0]) !== -1) return RULES[i][1];
    }
    return 'Uncategorized';
  }

  function enrich(records, overrides) {
    return records.map(function (r) {
      var amount = num(r.Amount);
      var declined = (r.Status === 'Declined');
      var merchant = cleanMerchant(r.Merchant);
      var category = categorize(merchant, r.Description, r.Type, overrides);
      var segment = SEGMENT[category] || 'Unassigned';
      var isSpend = !declined && (r.Type === 'Purchase' || r.Type === 'Refund');
      return {
        date: r.Date || '', month: String(r.Date || '').slice(0, 7), time: r.Time || '',
        cardholder: String(r.Cardholder || '').trim(), amount: amount,
        points: parseInt(r.Points || '0', 10) || 0, status: r.Status || '', type: r.Type || '',
        merchant: merchant, description: r.Description || '',
        category: category, segment: segment, declined: declined, isSpend: isSpend
      };
    });
  }

  function round2(v) { return Math.round((v + Number.EPSILON) * 100) / 100; }

  function aggregate(txns) {
    var spend = txns.filter(function (t) {
      return t.isSpend && t.category !== 'Credits & Rewards' && t.category !== 'Card Payment';
    });

    var monthsSet = {}, catTotals = {}, segTotals = {}, monthTotals = {},
        catMonth = {}, segMonth = {}, merchantTotals = {}, merchantMeta = {},
        payByMonth = {}, credByMonth = {}, txnCountMonth = {};

    spend.forEach(function (t) {
      monthsSet[t.month] = true;
      catTotals[t.category] = (catTotals[t.category] || 0) + t.amount;
      segTotals[t.segment] = (segTotals[t.segment] || 0) + t.amount;
      monthTotals[t.month] = (monthTotals[t.month] || 0) + t.amount;
      txnCountMonth[t.month] = (txnCountMonth[t.month] || 0) + 1;
      (catMonth[t.category] = catMonth[t.category] || {});
      catMonth[t.category][t.month] = (catMonth[t.category][t.month] || 0) + t.amount;
      (segMonth[t.segment] = segMonth[t.segment] || {});
      segMonth[t.segment][t.month] = (segMonth[t.segment][t.month] || 0) + t.amount;
      merchantTotals[t.merchant] = (merchantTotals[t.merchant] || 0) + t.amount;
      if (!merchantMeta[t.merchant]) merchantMeta[t.merchant] = { count: 0, category: t.category };
      merchantMeta[t.merchant].count++;
    });

    txns.forEach(function (t) {
      if (t.declined) return;
      if (t.category === 'Card Payment') payByMonth[t.month] = (payByMonth[t.month] || 0) + t.amount;
      if (t.category === 'Credits & Rewards') credByMonth[t.month] = (credByMonth[t.month] || 0) + t.amount;
    });

    var months = Object.keys(monthsSet).sort();
    var total = months.reduce(function (s, m) { return s + (monthTotals[m] || 0); }, 0);

    var maxDate = '';
    txns.forEach(function (t) { if (!t.declined && t.date > maxDate) maxDate = t.date; });
    var currentMonth = maxDate.slice(0, 7);
    var maxDay = parseInt(maxDate.slice(8, 10), 10) || 1;
    var partialMonth = (months.length && months[months.length - 1] === currentMonth && maxDay < 28)
      ? currentMonth : null;
    var completeMonths = months.filter(function (m) { return m !== partialMonth; });

    return {
      spend: spend, months: months, completeMonths: completeMonths,
      partialMonth: partialMonth, currentMonth: currentMonth, maxDate: maxDate, maxDay: maxDay,
      catTotals: catTotals, segTotals: segTotals, monthTotals: monthTotals,
      catMonth: catMonth, segMonth: segMonth, txnCountMonth: txnCountMonth,
      merchantTotals: merchantTotals, merchantMeta: merchantMeta,
      payByMonth: payByMonth, credByMonth: credByMonth,
      total: total, round2: round2
    };
  }

  function activeCategories(catTotals) {
    var present = Object.keys(catTotals);
    var ordered = CATEGORY_ORDER.filter(function (c) { return present.indexOf(c) !== -1; });
    present.forEach(function (c) { if (ordered.indexOf(c) === -1) ordered.push(c); });
    return ordered;
  }

  var API = {
    RULES: RULES, SEGMENT: SEGMENT, CATEGORY_ORDER: CATEGORY_ORDER, SEGMENT_ORDER: SEGMENT_ORDER,
    CAT_COLORS: CAT_COLORS, SEG_COLORS: SEG_COLORS, LUMPY: LUMPY, FIXED_CATS: FIXED_CATS,
    num: num, cleanMerchant: cleanMerchant, parseCSV: parseCSV, recordsFromCSV: recordsFromCSV,
    categorize: categorize, enrich: enrich, aggregate: aggregate, activeCategories: activeCategories,
    round2: round2
  };

  global.CFO_ENGINE = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
