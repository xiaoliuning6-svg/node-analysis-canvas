(function (root) {
  var NB = root.NB = root.NB || {};

  NB.LINK = { w: { fields: 0.35, dataset: 0.25, caliber: 0.20, time: 0.15, lineage: 0.05 }, auto: 0.70, suggest: 0.50 };
  NB.BUDGET = { tokens: 6000, perNode: 400, charsPerToken: 1.6 };
  NB.LAYOUT = { grid: 24, nodeW: 240, nodeH: 176, gapX: 320, gapY: 240, originX: 80, originY: 80, zoomMin: 0.4, zoomMax: 2.0 };
  NB.LIMITS = { storageBytes: 4.5 * 1024 * 1024, undoSteps: 20, saveDebounce: 300 };

  var seq = 0;
  NB.uid = function (p) { seq += 1; return (p || 'n') + '_' + Date.now().toString(36) + '_' + seq.toString(36); };
  NB.clamp = function (v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); };
  NB.clone = function (o) { return JSON.parse(JSON.stringify(o)); };
  NB.esc = function (s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };
  NB.debounce = function (fn, ms) { var t = null; return function () { var a = arguments, c = this; clearTimeout(t); t = setTimeout(function () { fn.apply(c, a); }, ms); }; };
  NB.estimateTokens = function (s) { return Math.ceil(Array.from(String(s || '')).length / NB.BUDGET.charsPerToken); };
  NB.fmt = function (n) {
    if (typeof n !== 'number' || !isFinite(n)) return String(n);
    var neg = n < 0, a = Math.abs(n);
    var fixed = (Math.round(a * 100) / 100).toFixed(a % 1 === 0 ? 0 : 2).replace(/\.00$/, '');
    var parts = fixed.split('.'), i = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-' : '') + i + (parts[1] ? '.' + parts[1] : '');
  };
  NB.pct = function (a, b) { return b ? (Math.round(a / b * 1000) / 10) : 0; };

  function fnv(s, seed) {
    var h = seed >>> 0;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
  }
  NB.hash = function (s) {
    s = String(s || '');
    var a = fnv(s, 2166136261).toString(16);
    var b = fnv(s.split('').reverse().join(''), (2246822519 ^ s.length) >>> 0).toString(16);
    return ('00000000' + a).slice(-8) + ('00000000' + b).slice(-8);
  };

  function isNum(v) { return /^-?\d+(\.\d+)?$/.test(String(v).trim()); }
  function isDate(v) { return /^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(String(v).trim()); }

  NB.parseTable = function (text) {
    text = String(text || '').replace(/^\uFEFF/, '');
    var firstLine = text.split(/\r?\n/)[0] || '';
    var delim = firstLine.split('\t').length >= firstLine.split(',').length ? '\t' : ',';
    var rows = [], row = [], cur = '', inQ = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (inQ) {
        if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else { inQ = false; } }
        else { cur += c; }
      } else if (c === '"') { inQ = true; }
      else if (c === delim) { row.push(cur); cur = ''; }
      else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
      else if (c !== '\r') { cur += c; }
    }
    if (cur.length || row.length) { row.push(cur); rows.push(row); }
    rows = rows.filter(function (r) { return r.some(function (v) { return String(v).trim() !== ''; }); });
    if (!rows.length) return { columns: [], rows: [], types: {}, numericCols: [], dateCols: [], catCols: [], delim: delim, text: text };
    var columns = rows.shift().map(function (s, k) { return String(s).trim() || ('列' + (k + 1)); });
    rows = rows.map(function (r) {
      var out = [];
      for (var k = 0; k < columns.length; k++) out.push(String(r[k] == null ? '' : r[k]).trim());
      return out;
    });
    var types = {}, numericCols = [], dateCols = [], catCols = [];
    columns.forEach(function (col, k) {
      var vals = rows.map(function (r) { return r[k]; }).filter(function (v) { return v !== ''; });
      var nh = vals.filter(isNum).length, dh = vals.filter(isDate).length;
      if (vals.length && nh / vals.length >= 0.8) { types[col] = 'number'; numericCols.push(col); }
      else if (vals.length && dh / vals.length >= 0.8) { types[col] = 'date'; dateCols.push(col); }
      else { types[col] = 'category'; catCols.push(col); }
    });
    return { columns: columns, rows: rows, types: types, numericCols: numericCols, dateCols: dateCols, catCols: catCols, delim: delim, text: text };
  };

  NB.tableHash = function (t) {
    return NB.hash(t.columns.join('|') + '\n' + t.rows.map(function (r) { return r.join('\t'); }).join('\n'));
  };

  NB.pick = function (list, question, fallback) {
    for (var i = 0; i < list.length; i++) if (question.indexOf(list[i]) >= 0) return list[i];
    return fallback != null ? fallback : list[0];
  };

  NB.download = function (name, text, mime) {
    if (typeof document === 'undefined') return false;
    try {
      var blob = new Blob([text], { type: mime || 'application/json;charset=utf-8' });
      var url = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = url; a.download = name; document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1200);
      return true;
    } catch (e) { return false; }
  };

  NB.jaccard = function (a, b) {
    a = a || []; b = b || [];
    var sa = {}, sb = {}, i;
    for (i = 0; i < a.length; i++) sa[a[i]] = 1;
    for (i = 0; i < b.length; i++) sb[b[i]] = 1;
    var inter = 0, uni = 0, k;
    for (k in sa) { uni++; if (sb[k]) inter++; }
    for (k in sb) if (!sa[k]) uni++;
    return uni ? inter / uni : 0;
  };

  NB.log = function () {};
})(typeof window !== 'undefined' ? window : globalThis);
