(function (root) {
  var NB = root.NB = root.NB || {};
  var C = NB.Ctx = {};

  function uniq(a) { var o = {}, r = []; a.forEach(function (x) { if (!o[x]) { o[x] = 1; r.push(x); } }); return r; }

  C.centroid = function (nodes, view) {
    var W = NB.LAYOUT.nodeW, H = NB.LAYOUT.nodeH;
    var cx = 0, cy = 0;
    nodes.forEach(function (n) { cx += n.x + W / 2; cy += n.y + H / 2; });
    cx /= (nodes.length || 1); cy /= (nodes.length || 1);
    var bw = 300, bh = 96, pad = 24;
    var x = cx - bw / 2, y = cy - bh / 2;
    if (view) {
      x = NB.clamp(x, view.x + pad, view.x + view.w - bw - pad);
      y = NB.clamp(y, view.y + pad, view.y + view.h - bh - pad);
    }
    return { x: Math.round(x), y: Math.round(y) };
  };

  C.merge = function (nodes, question) {
    var parts = [], included = [], omitted = [], tokens = 0, seen = {};
    parts.push('【当前提问】' + question);
    tokens += NB.estimateTokens(parts[0]);
    nodes.forEach(function (n) {
      var spec = n.spec || {};
      var key = (spec.datasetHash || '') + '|' + (spec.fields || []).join(',');
      var dup = !!seen[key];
      seen[key] = 1;
      var block = [
        '【' + (n.title || n.id) + '】',
        dup ? '字段口径：（同上，已去重）' : '字段口径：' + (spec.caliber || '-'),
        dup ? '使用字段：（同上，已去重）' : '使用字段：' + (spec.fields || []).join('、'),
        '核心结论：' + ((n.result && n.result.conclusion) || ''),
        '原始回答：' + String(n.rawAnswer || '').slice(0, 120)
      ].join('\n');
      if (Array.from(block).length > NB.BUDGET.perNode) block = Array.from(block).slice(0, NB.BUDGET.perNode).join('') + '…';
      var t = NB.estimateTokens(block);
      if (tokens + t > NB.BUDGET.tokens) { omitted.push(n.title || n.id); return; }
      tokens += t; parts.push(block); included.push(n.id);
    });
    return { text: parts.join('\n\n'), included: included, omitted: omitted, tokens: tokens, dedupKeys: Object.keys(seen).length };
  };

  C.crossSpec = function (nodes, question, schema) {
    var fields = uniq([].concat.apply([], nodes.map(function (n) { return (n.spec && n.spec.fields) || []; })));
    var calibers = uniq(nodes.map(function (n) { return (n.spec && n.spec.caliber) || '-'; }));
    var base = (nodes[0] && nodes[0].spec) || {};
    return {
      intent: 'cross', chart: 'bar_h', agg: 'sum', question: question,
      datasetHash: schema.hash || base.datasetHash || '', datasetName: schema.name || '',
      rowCount: schema.rowCount || 0,
      fields: fields, metric: base.metric || '', dimension: base.dimension || '',
      timeCol: base.timeCol || null, groupBy: base.groupBy || '',
      filters: [], timeRange: base.timeRange || '全量',
      caliber: '交叉分析：合并 ' + nodes.length + ' 个节点上下文；源口径 ' + calibers.length + ' 种；' +
        (calibers.length === 1 ? '口径一致' : '口径不一致需核对'),
      parentNodeIds: nodes.map(function (n) { return n.id; })
    };
  };

  C.viewport = function (ui, wrap) {
    return { x: -ui.tx / ui.zoom, y: -ui.ty / ui.zoom, w: wrap.w / ui.zoom, h: wrap.h / ui.zoom };
  };
})(typeof window !== 'undefined' ? window : globalThis);
