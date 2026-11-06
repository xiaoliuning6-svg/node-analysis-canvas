(function (root) {
  var NB = root.NB = root.NB || {};
  var KEY = 'nb_node_graph_v2';
  var G = NB.Graph = {};

  G.state = null;
  G.table = null;
  G.rawText = '';
  G.undoStack = [];
  G.suggestions = [];
  G.listeners = [];

  function store() { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch (e) { return null; } }
  function byteLen(s) { try { return new Blob([s]).size; } catch (e) { return s.length * 2; } }
  function uniq(a) { var o = {}, r = []; a.forEach(function (x) { if (!o[x]) { o[x] = 1; r.push(x); } }); return r; }

  G.blank = function () {
    return { v: 2, dataset: null, nodes: [], edges: [], groups: [], ui: { zoom: 1, tx: 0, ty: 0 }, selected: [], active: null, savedAt: 0 };
  };
  G.subscribe = function (fn) { G.listeners.push(fn); };
  G.emit = function (evt, payload) { G.listeners.forEach(function (f) { try { f(evt, payload); } catch (e) { } }); };

  G.init = function () {
    G.state = G.blank(); G.undoStack = []; G.suggestions = [];
    var s = store();
    if (s) {
      try { var raw = s.getItem(KEY); if (raw) { var o = JSON.parse(raw); if (o && o.v === 2) G.state = Object.assign(G.blank(), o); } } catch (e) { }
    }
    G.state.selected = []; G.state.active = null;
    var rt = G.state.dataset && G.state.dataset.rawText;
    if (rt) { G.rawText = rt; G.table = NB.parseTable(rt); }
    return G.state;
  };

  G.save = function () {
    var text = JSON.stringify(G.state), bytes = byteLen(text);
    if (bytes > NB.LIMITS.storageBytes && G.state.dataset && G.state.dataset.rawText) {
      delete G.state.dataset.rawText;
      G.state.dataset.rawTruncated = true;
      text = JSON.stringify(G.state); bytes = byteLen(text);
      G.emit('toast', '原始数据超过存储上限，已保留图与结论；重新导入表格可再次重算');
    }
    if (bytes > NB.LIMITS.storageBytes) {
      NB.download('节点分析图_溢出备份_' + Date.now() + '.json', text);
      G.emit('toast', '存储空间不足，已自动下载整图备份');
      return false;
    }
    var s = store();
    if (!s) return false;
    try { s.setItem(KEY, text); G.state.savedAt = Date.now(); return true; }
    catch (e) { G.emit('toast', '保存失败：' + e.message); return false; }
  };
  G.saveSoon = NB.debounce(function () { G.save(); }, NB.LIMITS.saveDebounce);

  G.snapshot = function () {
    G.undoStack.push(NB.clone(G.state));
    if (G.undoStack.length > NB.LIMITS.undoSteps) G.undoStack.shift();
  };
  G.commit = function (fn) { G.snapshot(); fn(); G.save(); G.emit('change'); };
  G.undo = function () {
    if (!G.undoStack.length) { G.emit('toast', '没有可撤销的操作'); return false; }
    G.state = G.undoStack.pop(); G.save(); G.emit('change'); G.emit('toast', '已撤销'); return true;
  };

  G.findNode = function (id) { for (var i = 0; i < G.state.nodes.length; i++) if (G.state.nodes[i].id === id) return G.state.nodes[i]; return null; };
  G.findEdge = function (id) { for (var i = 0; i < G.state.edges.length; i++) if (G.state.edges[i].id === id) return G.state.edges[i]; return null; };
  G.schema = function () {
    var d = G.state.dataset || {};
    return { columns: d.columns || [], types: d.types || {}, numericCols: d.numericCols || [], dateCols: d.dateCols || [], catCols: d.catCols || [], hash: d.hash || '', name: d.name || '', rowCount: d.rowCount || 0, dateMin: d.dateMin || '', dateMax: d.dateMax || '' };
  };
  G.dataSourceId = function () {
    for (var i = 0; i < G.state.nodes.length; i++) if (G.state.nodes[i].type === 'data') return G.state.nodes[i].id;
    return null;
  };

  function makeNode(o) {
    return {
      id: NB.uid('n'), type: o.type || 'question', kind: o.kind || '问题记录',
      title: o.title || '', question: o.question || '', spec: o.spec || {}, result: o.result || null,
      rawAnswer: o.rawAnswer || '', parentIds: o.parentIds || [], tags: ['文字'],
      x: o.x == null ? 80 : o.x, y: o.y == null ? 80 : o.y,
      createdAt: Date.now(), version: 1,
      datasetHash: (o.spec && o.spec.datasetHash) || ''
    };
  }
  function mkEdge(from, to, rel, dir, source, score) {
    return { id: NB.uid('e'), from: from, to: to, rel: rel || '关联', dir: dir || '→', note: '', score: score == null ? 1 : score, source: source || 'manual' };
  }
  function hasEdge(a, b) {
    return G.state.edges.some(function (e) { return (e.from === a && e.to === b) || (e.from === b && e.to === a); });
  }

  G.linkScore = function (a, b) {
    var w = NB.LINK.w, s1 = a.spec || {}, s2 = b.spec || {};
    var sc = w.fields * NB.jaccard(s1.fields, s2.fields)
      + w.dataset * (s1.datasetHash && s1.datasetHash === s2.datasetHash ? 1 : 0)
      + w.caliber * (s1.caliber && s1.caliber === s2.caliber ? 1 : 0)
      + w.time * (s1.timeRange && s1.timeRange === s2.timeRange ? 1 : 0)
      + w.lineage * (((a.parentIds || []).indexOf(b.id) >= 0 || (b.parentIds || []).indexOf(a.id) >= 0) ? 1 : 0);
    return Math.round(sc * 100) / 100;
  };

  G.autoLink = function (node) {
    var added = [], suggest = [];
    if (!/^(question|cross|fused)$/.test(node.type)) return { added: added, suggest: suggest };
    G.state.nodes.forEach(function (other) {
      if (other.id === node.id || !/^(question|cross|fused)$/.test(other.type)) return;
      if (hasEdge(node.id, other.id)) return;
      var sc = G.linkScore(node, other);
      if (sc >= NB.LINK.auto) {
        G.state.edges.push(mkEdge(other.id, node.id, '关联', '→', 'auto', sc));
        added.push({ a: other.id, b: node.id, score: sc });
      } else if (sc >= NB.LINK.suggest) {
        suggest.push({ a: other.id, b: node.id, score: sc, label: other.title + ' ↔ ' + node.title });
      }
    });
    return { added: added, suggest: suggest };
  };

  G.setDataset = function (table, name, rawText) {
    var hash = NB.tableHash(table);
    var dateCol = table.dateCols[0], dateMin = '', dateMax = '';
    if (dateCol) {
      var i = table.columns.indexOf(dateCol);
      var ds = table.rows.map(function (r) { return r[i]; }).filter(Boolean).sort();
      dateMin = ds[0] || ''; dateMax = ds[ds.length - 1] || '';
    }
    var meta = {
      name: name || '未命名表格', hash: hash,
      columns: table.columns, types: table.types,
      numericCols: table.numericCols, dateCols: table.dateCols, catCols: table.catCols,
      rowCount: table.rows.length, dateMin: dateMin, dateMax: dateMax,
      sampleRows: table.rows.slice(0, 5), importedAt: Date.now()
    };
    if (rawText && rawText.length < 1024 * 1024) meta.rawText = rawText;
    else meta.rawTruncated = true;

    var spec = {
      intent: 'source', chart: 'none', agg: 'sum', question: '数据导入',
      datasetHash: hash, datasetName: meta.name, rowCount: meta.rowCount,
      fields: table.columns.slice(0, 4), metric: table.numericCols[0] || '',
      dimension: table.catCols[0] || '', timeCol: dateCol || null, groupBy: '',
      filters: [], timeRange: dateMin && dateMax ? dateMin + ' ~ ' + dateMax : '全量',
      caliber: '原始数据：' + meta.rowCount + ' 行 × ' + table.columns.length + ' 列'
    };
    var node = makeNode({
      type: 'data', kind: '数据入口', title: meta.name, question: '数据导入',
      spec: spec, rawAnswer: '已导入 ' + meta.rowCount + ' 行 · ' + table.columns.length + ' 列，可以开始提问。',
      parentIds: [], x: 80, y: 80
    });
    node.result = {
      chart: 'none', labels: [], values: [], average: 0,
      table: meta.sampleRows.map(function (r, k) { return { name: '第' + (k + 1) + '行', value: 0, ratio: 0, rank: k + 1 }; }),
      conclusion: '数据已导入（' + meta.rowCount + ' 行 · ' + table.columns.length + ' 列），可以开始提问。',
      insights: ['数值列：' + table.numericCols.join('、'), '日期列：' + (table.dateCols.join('、') || '无'), '数据版本：' + hash.slice(0, 8)],
      total: 0, isCross: false
    };
    var existing = G.state.nodes.filter(function (n) { return n.type === 'data'; })[0];
    G.commit(function () {
      G.state.dataset = meta;
      if (existing) {
        existing.title = meta.name; existing.spec = spec; existing.result = node.result;
        existing.rawAnswer = node.rawAnswer; existing.datasetHash = hash;
        existing.version = (existing.version || 1) + 1;
        G.state.active = existing.id;
      } else {
        G.state.nodes.push(node);
        G.state.active = node.id;
      }
      G.state.selected = [];
    });
    G.table = table;
    G.rawText = rawText || '';
    G.emit('toast', '已导入 ' + meta.rowCount + ' 行 × ' + table.columns.length + ' 列，数据版本 ' + hash.slice(0, 8));
    return node;
  };

  G.addAnalysis = function (question, parentId) {
    if (!G.table) return { ok: false, msg: '请先导入表格或点击「样例数据」' };
    var schema = G.schema();
    var spec = NB.Analyzer.parseIntent(question, schema);
    var result = NB.Analyzer.render(spec, G.table);
    var ds = G.dataSourceId();
    var parents = parentId ? [parentId] : (ds ? [ds] : []);
    var node = makeNode({
      type: 'question', kind: '问题记录', title: question.slice(0, 14),
      question: question, spec: spec, result: result,
      rawAnswer: result.conclusion, parentIds: parents
    });
    NB.Layout.placeNew(G.state, node);
    var linkResult = { added: [], suggest: [] };
    G.commit(function () {
      G.state.nodes.push(node);
      parents.forEach(function (pid) { G.state.edges.push(mkEdge(pid, node.id, '父子', '→', 'manual', 1)); });
      linkResult = G.autoLink(node);
      G.state.active = node.id;
      G.state.selected = [];
    });
    G.suggestions = linkResult.suggest;
    return { ok: true, node: node, cross: false, autoEdges: linkResult.added.length, suggest: linkResult.suggest.length };
  };

  G.makeCross = function (ids, question) {
    var nodes = ids.map(G.findNode).filter(Boolean);
    if (nodes.length < 2) return { ok: false, msg: '至少勾选 2 个节点' };
    var ctx = NB.Ctx.merge(nodes, question);
    var spec = NB.Ctx.crossSpec(nodes, question, G.schema());
    var result = NB.Analyzer.crossResult(nodes, question, ctx);
    var node = makeNode({
      type: 'cross', kind: '交叉分析', title: '交叉：' + question.slice(0, 12),
      question: question, spec: spec, result: result,
      rawAnswer: ctx.text, parentIds: ids.slice()
    });
    NB.Layout.placeNew(G.state, node);
    node.contextTokens = ctx.tokens;
    node.contextOmitted = ctx.omitted;
    G.commit(function () {
      G.state.nodes.push(node);
      ids.forEach(function (pid) { G.state.edges.push(mkEdge(pid, node.id, '父子', '→', 'manual', 1)); });
      G.state.active = node.id;
      G.state.selected = [];
    });
    G.suggestions = [];
    return { ok: true, node: node, cross: true, ctx: ctx };
  };

  G.ask = function (question, opts) {
    if (!question || !String(question).trim()) return { ok: false, msg: '请输入问题' };
    if (G.state.selected.length >= 2) return G.makeCross(G.state.selected.slice(), String(question).trim());
    return G.addAnalysis(String(question).trim(), opts && opts.parentId);
  };

  G.addManual = function (title) {
    var node = makeNode({
      type: 'manual', kind: '手动节点', title: title || '新节点',
      question: '', spec: { intent: 'manual', fields: [], caliber: '', timeRange: '', datasetHash: G.state.dataset ? G.state.dataset.hash : '' },
      result: null, rawAnswer: '', parentIds: []
    });
    NB.Layout.placeNew(G.state, node);
    G.commit(function () { G.state.nodes.push(node); G.state.active = node.id; });
    return node;
  };

  G.fromAnswer = function (text) {
    var schema = G.schema();
    var spec = G.table ? NB.Analyzer.parseIntent(text, schema) : {
      intent: 'manual', chart: 'none', agg: 'sum', question: text,
      datasetHash: schema.hash, datasetName: schema.name, rowCount: schema.rowCount,
      fields: [], metric: '', dimension: '', timeCol: null, groupBy: '',
      filters: [], timeRange: '全量', caliber: '对话原文（未结构化计算）'
    };
    var parent = G.state.active ? [G.state.active] : [];
    var node = makeNode({
      type: 'question', kind: '问题记录', title: String(text).slice(0, 14),
      question: text, spec: spec, result: null, rawAnswer: text, parentIds: parent
    });
    NB.Layout.placeNew(G.state, node);
    G.commit(function () {
      G.state.nodes.push(node);
      parent.forEach(function (pid) { G.state.edges.push(mkEdge(pid, node.id, '父子', '→', 'manual', 1)); });
      G.state.active = node.id; G.state.selected = [];
    });
    return node;
  };

  G.removeNode = function (id) {
    G.commit(function () {
      G.state.nodes = G.state.nodes.filter(function (n) { return n.id !== id; });
      G.state.edges = G.state.edges.filter(function (e) { return e.from !== id && e.to !== id; });
      G.state.groups.forEach(function (g) { g.members = g.members.filter(function (m) { return m !== id; }); });
      G.state.groups = G.state.groups.filter(function (g) { return g.members.length > 1; });
      G.state.selected = G.state.selected.filter(function (s) { return s !== id; });
      if (G.state.active === id) G.state.active = null;
    });
  };

  G.updateNode = function (id, patch) {
    var n = G.findNode(id); if (!n) return;
    G.commit(function () { Object.assign(n, patch); });
  };
  G.setConclusion = function (id, text) {
    var n = G.findNode(id); if (!n) return;
    G.commit(function () { if (!n.result) n.result = { table: [] }; n.result.conclusion = text; n.rawAnswer = text; n.version = (n.version || 1) + 1; });
  };
  G.recompute = function (id) {
    var n = G.findNode(id); if (!n) return { ok: false, msg: '节点不存在' };
    if (!G.table) return { ok: false, msg: '原始数据未持久化，请重新导入表格后再重算' };
    if (!n.result || !n.spec || !n.spec.metric) return { ok: false, msg: '该节点没有可复算的 spec' };
    var r = NB.Analyzer.recompute(n, G.table);
    G.commit(function () {
      n.result = r.result; n.rawAnswer = r.result.conclusion;
      n.spec.datasetHash = r.hash; n.datasetHash = r.hash; n.version = (n.version || 1) + 1;
    });
    return { ok: true, hash: r.hash };
  };

  G.toggleSelect = function (id) {
    var i = G.state.selected.indexOf(id);
    if (i >= 0) G.state.selected.splice(i, 1); else G.state.selected.push(id);
    G.emit('change');
    return G.state.selected.length;
  };
  G.clearSelection = function () { G.state.selected = []; G.emit('change'); };
  G.setActive = function (id) { G.state.active = id; G.emit('change'); };
  G.setUI = function (patch) { Object.assign(G.state.ui, patch); G.saveSoon(); G.emit('view'); };

  G.addEdge = function (from, to, rel, dir) {
    if (from === to || hasEdge(from, to)) return null;
    var e = mkEdge(from, to, rel || '关联', dir || '→', 'manual', 1);
    G.commit(function () { G.state.edges.push(e); });
    return e;
  };
  G.updateEdge = function (id, patch) {
    var e = G.findEdge(id); if (!e) return;
    G.commit(function () { Object.assign(e, patch, { source: 'manual' }); });
  };
  G.removeEdge = function (id) { G.commit(function () { G.state.edges = G.state.edges.filter(function (e) { return e.id !== id; }); }); };
  G.clearAutoEdges = function () {
    var n = G.state.edges.filter(function (e) { return e.source === 'auto'; }).length;
    G.commit(function () { G.state.edges = G.state.edges.filter(function (e) { return e.source !== 'auto'; }); });
    return n;
  };
  G.acceptSuggestion = function (s) {
    if (hasEdge(s.a, s.b)) return;
    G.commit(function () { G.state.edges.push(mkEdge(s.a, s.b, '关联', '⇄', 'manual', s.score)); });
    G.suggestions = G.suggestions.filter(function (x) { return x !== s; });
    G.emit('change');
  };

  G.group = function (ids, title) {
    if (ids.length < 2) return null;
    var g = { id: NB.uid('g'), title: title || ('分析组 ' + (G.state.groups.length + 1)), members: ids.slice(), collapsed: false, createdAt: Date.now() };
    G.commit(function () {
      G.state.groups.push(g);
      ids.forEach(function (id) { var n = G.findNode(id); if (n) n.groupId = g.id; });
    });
    return g;
  };
  G.ungroup = function (gid) {
    G.commit(function () {
      G.state.groups.filter(function (g) { return g.id === gid; }).forEach(function (g) {
        g.members.forEach(function (id) { var n = G.findNode(id); if (n) delete n.groupId; });
      });
      G.state.groups = G.state.groups.filter(function (g) { return g.id !== gid; });
    });
  };
  G.toggleGroup = function (gid) {
    G.commit(function () {
      G.state.groups.forEach(function (g) { if (g.id === gid) g.collapsed = !g.collapsed; });
    });
  };
  G.fuse = function (ids) {
    var nodes = ids.map(G.findNode).filter(Boolean);
    if (nodes.length < 2) return null;
    var spec = NB.Ctx.crossSpec(nodes, '融合', G.schema());
    var tables = [];
    nodes.forEach(function (n) {
      if (n.result && n.result.table) n.result.table.forEach(function (t) { tables.push(Object.assign({ from: n.title }, t)); });
    });
    var fused = makeNode({
      type: 'fused', kind: '融合节点', title: '融合：' + nodes.length + ' 个节点',
      question: '融合', spec: spec, parentIds: [],
      result: {
        chart: 'bar_h', labels: nodes.map(function (n) { return n.title; }),
        values: nodes.map(function (n) { return (n.result && n.result.table && n.result.table[0]) ? n.result.table[0].value : 0; }),
        average: 0, table: tables,
        conclusion: '已融合 ' + nodes.length + ' 个节点的结论，原始上下文归档在 archivedRaw。',
        insights: ['融合是销毁性操作，原始节点已删除，可用 Ctrl+Z 回滚。', '归档保留了每个源节点的 spec 与原始回答，追溯链仍可人工查阅。'],
        total: 0, isCross: true
      },
      rawAnswer: nodes.map(function (n) { return n.rawAnswer; }).join('\n---\n')
    });
    fused.archivedRaw = nodes.map(function (n) { return { id: n.id, title: n.title, spec: n.spec, rawAnswer: n.rawAnswer }; });
    fused.datasetHash = nodes[0] ? nodes[0].datasetHash : '';
    fused.x = Math.round(nodes.reduce(function (s, n) { return s + n.x; }, 0) / nodes.length);
    fused.y = Math.round(nodes.reduce(function (s, n) { return s + n.y; }, 0) / nodes.length);
    G.commit(function () {
      G.state.nodes = G.state.nodes.filter(function (n) { return ids.indexOf(n.id) < 0; });
      G.state.nodes.push(fused);
      G.state.edges.forEach(function (e) {
        if (ids.indexOf(e.from) >= 0) e.from = fused.id;
        if (ids.indexOf(e.to) >= 0) e.to = fused.id;
      });
      G.state.edges = G.state.edges.filter(function (e) { return e.from !== e.to; });
      G.state.groups.forEach(function (g) { g.members = uniq(g.members.map(function (m) { return ids.indexOf(m) >= 0 ? fused.id : m; })); });
      G.state.selected = []; G.state.active = fused.id;
    });
    return fused;
  };

  G.tidy = function () { G.commit(function () { NB.Layout.relayout(G.state); }); };
  G.reset = function () { G.commit(function () { G.state = G.blank(); G.table = null; G.rawText = ''; G.suggestions = []; }); };
  G.stats = function () {
    var d = G.state.dataset;
    return {
      nodes: G.state.nodes.length, edges: G.state.edges.length, groups: G.state.groups.length,
      auto: G.state.edges.filter(function (e) { return e.source === 'auto'; }).length,
      rows: d ? d.rowCount : 0, cols: d ? d.columns.length : 0,
      hash: d ? d.hash : '-', undo: G.undoStack.length,
      bytes: byteLen(JSON.stringify(G.state)), table: !!G.table
    };
  };
  G.export = function () {
    return JSON.stringify({ v: 2, exportedAt: new Date().toISOString(), state: G.state, rawText: G.rawText || (G.state.dataset && G.state.dataset.rawText) || '' }, null, 2);
  };
  G.import = function (data) {
    var o = typeof data === 'string' ? JSON.parse(data) : data;
    if (!o || !o.state || o.state.v !== 2) throw new Error('不是有效的节点分析图（v2）');
    G.commit(function () {
      G.state = Object.assign(G.blank(), o.state);
      G.state.selected = []; G.state.active = null;
      G.rawText = o.rawText || (G.state.dataset && G.state.dataset.rawText) || '';
      G.table = G.rawText ? NB.parseTable(G.rawText) : null;
      G.suggestions = [];
    });
    return G.stats();
  };
})(typeof window !== 'undefined' ? window : globalThis);
