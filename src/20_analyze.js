(function (root) {
  var NB = root.NB = root.NB || {};
  var A = NB.Analyzer = {};
  var PALETTE = ['#7F77DD', '#5DCAA5', '#EF9F27', '#F0997B', '#85B7EB', '#97C459', '#ED93B1', '#B4B2A9'];

  function findCol(list, q) {
    list = list || [];
    for (var i = 0; i < list.length; i++) if (q.indexOf(list[i]) >= 0) return list[i];
    for (var j = 0; j < list.length; j++) {
      var key = list[j].replace(/(名称|名字|编号|ID|id)$/, '').slice(0, 2);
      if (key && q.indexOf(key) >= 0) return list[j];
    }
    return list[0];
  }

  A.parseIntent = function (q, schema) {
    q = String(q || '').trim() || '各维度对比';
    var intent = 'rank', chart = 'bar_h', agg = 'sum';
    if (/关联|相关|交叉|综合|一起看|合并|汇总/.test(q)) { intent = 'cross'; }
    else if (/占比|结构|分布|构成|比例/.test(q)) { intent = 'share'; chart = 'pie'; }
    else if (/趋势|走势|变化|随时间|逐月|按月|按日/.test(q)) { intent = 'trend'; chart = 'line'; }
    else if (/平均|均值/.test(q)) { intent = 'avg'; agg = 'avg'; }

    var numeric = schema.numericCols || [], cat = schema.catCols || [], dates = schema.dateCols || [];
    var metric = findCol(numeric, q) || numeric[0];
    var dimension = findCol(cat, q) || cat[0];
    var timeCol = dates[0] || null;
    var groupBy = intent === 'trend' ? (timeCol || dimension) : dimension;
    var fields = [];
    [groupBy, metric].forEach(function (c) { if (c && fields.indexOf(c) < 0) fields.push(c); });
    var timeRange = schema.dateMin && schema.dateMax ? schema.dateMin + ' ~ ' + schema.dateMax : '全量';

    return {
      intent: intent, chart: chart, agg: agg, question: q,
      datasetHash: schema.hash || '', datasetName: schema.name || '', rowCount: schema.rowCount || 0,
      fields: fields, metric: metric, dimension: dimension, timeCol: timeCol, groupBy: groupBy,
      filters: [], timeRange: timeRange,
      caliber: agg + '(' + metric + ') 按 ' + groupBy + ' 分组；过滤：无；口径：逐行汇总，不去重'
    };
  };

  A.render = function (spec, table) {
    var cols = table.columns || [], rows = table.rows || [];
    var gi = cols.indexOf(spec.groupBy), mi = cols.indexOf(spec.metric);
    if (gi < 0) gi = cols.indexOf((table.catCols || [])[0]);
    if (mi < 0) mi = cols.indexOf((table.numericCols || [])[0]);
    var sums = {}, counts = {};
    for (var r = 0; r < rows.length; r++) {
      var k = String(rows[r][gi] == null || rows[r][gi] === '' ? '(空)' : rows[r][gi]);
      var v = Number(rows[r][mi]);
      if (!isFinite(v)) v = 0;
      sums[k] = (sums[k] || 0) + v;
      counts[k] = (counts[k] || 0) + 1;
    }
    var items = Object.keys(sums).map(function (k) {
      return { name: k, value: spec.agg === 'avg' ? sums[k] / (counts[k] || 1) : sums[k] };
    });
    if (spec.intent === 'trend') items.sort(function (a, b) { return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0); });
    else items.sort(function (a, b) { return b.value - a.value; });
    items = items.slice(0, 12);

    var total = items.reduce(function (s, x) { return s + x.value; }, 0);
    var average = items.length ? total / items.length : 0;
    var detailTable = items.map(function (x, i) {
      return { name: x.name, value: Math.round(x.value * 100) / 100, ratio: Math.round(x.value / (total || 1) * 1000) / 10, rank: i + 1 };
    });

    var conclusion = '', insights = [];
    if (spec.intent === 'trend') {
      var hi = items.reduce(function (a, b) { return b.value > a.value ? b : a; }, items[0] || { name: '-', value: 0 });
      var lo = items.reduce(function (a, b) { return b.value < a.value ? b : a; }, items[0] || { name: '-', value: 0 });
      conclusion = '按 ' + spec.groupBy + ' 观察 ' + spec.metric + '，峰值出现在 ' + hi.name + '（' + NB.fmt(hi.value) + '），低点 ' + lo.name + '（' + NB.fmt(lo.value) + '），区间均值 ' + NB.fmt(average) + '。';
      insights.push('共 ' + items.length + ' 个时间点，峰谷差 ' + NB.fmt(hi.value - lo.value) + '。');
    } else if (items.length >= 3) {
      var top = items[0], second = items[1], last = items[items.length - 1];
      var t3 = items.slice(0, 3).reduce(function (s, x) { return s + x.value; }, 0);
      conclusion = top.name + '以 ' + NB.fmt(top.value) + ' 居首，是第二名 ' + second.name + ' 的 ' +
        (top.value / (second.value || 1)).toFixed(1) + ' 倍，是末位 ' + last.name + ' 的 ' +
        Math.round(top.value / (last.value || 1)) + ' 倍；前三名合计占 ' +
        Math.round(t3 / (total || 1) * 100) + '%，头部集中效应明显。';
      insights.push('头部集中效应明显：前三名合计占据总' + spec.metric + '的 ' + Math.round(t3 / (total || 1) * 100) + '%，形成明显的马太效应。');
      insights.push('组均值 ' + NB.fmt(average) + '，高于均值的仅 ' + items.filter(function (x) { return x.value > average; }).length + ' 个' + spec.groupBy + '，长尾差异大。');
    } else {
      conclusion = '共 ' + items.length + ' 个' + spec.groupBy + '，' + spec.metric + '合计 ' + NB.fmt(total) + '。';
      insights.push('样本分组数偏少，结论稳健性有限。');
    }
    insights.push('口径：' + spec.caliber + '（数据版本 ' + String(spec.datasetHash).slice(0, 8) + '）');

    return {
      chart: spec.chart, labels: items.map(function (x) { return x.name; }),
      values: items.map(function (x) { return Math.round(x.value * 100) / 100; }),
      average: Math.round(average * 100) / 100, table: detailTable,
      conclusion: conclusion, insights: insights, total: total,
      rowCount: rows.length, groupCount: items.length, isCross: false
    };
  };

  A.crossResult = function (nodes, question, ctx) {
    var rows = nodes.map(function (n) {
      var t = (n.result && n.result.table) || [];
      return {
        name: n.title,
        value: t.length ? t[0].value : 0,
        metric: (n.spec && n.spec.metric) || '-',
        conclusion: (n.result && n.result.conclusion) || ''
      };
    });
    var calibers = {}, calCount = 0;
    nodes.forEach(function (n) { var c = (n.spec && n.spec.caliber) || '-'; if (!calibers[c]) { calibers[c] = 1; calCount++; } });
    var same = calCount === 1;
    var values = rows.map(function (r) { return r.value; });
    var total = values.reduce(function (a, b) { return a + b; }, 0);
    var avg = rows.length ? total / rows.length : 0;

    var conclusion = '已合并 ' + nodes.length + ' 个节点的上下文（字段口径 ' + calCount + ' 种，实际纳入 ' + ctx.included.length + ' 个）。' +
      (same ? '口径一致，可直接横向对比。' : '存在不同统计口径，对比前需先确认换算关系。') +
      rows.map(function (r) { return r.name + '：' + String(r.conclusion).split('；')[0]; }).join('；') + '。';

    return {
      chart: 'bar_h', labels: rows.map(function (r) { return r.name; }), values: values,
      average: Math.round(avg * 100) / 100,
      table: rows.map(function (r, i) { return { name: r.name, value: r.value, ratio: Math.round(r.value / (total || 1) * 1000) / 10, rank: i + 1 }; }),
      conclusion: conclusion,
      insights: [
        '注意：各节点指标可能量纲不同，柱长仅示意，不可直接比较绝对大小。',
        '合并上下文 ' + ctx.tokens + ' token（预算 ' + NB.BUDGET.tokens + '），每节点摘要上限 ' + NB.BUDGET.perNode + ' 字。',
        ctx.omitted.length ? '省略节点：' + ctx.omitted.join('、') + '（超出预算）' : '所有选中节点均已纳入。'
      ],
      total: total, rowCount: 0, groupCount: rows.length, isCross: true
    };
  };

  A.recompute = function (node, table) {
    var r = A.render(node.spec, table);
    return { result: r, hash: NB.tableHash(table) };
  };

  A.chartSVG = function (result, spec) {
    var labels = result.labels || [], values = result.values || [];
    if (!labels.length) return '<div class="empty">暂无图表数据</div>';
    if (spec && spec.chart === 'line') return lineSVG(labels, values, result, spec);
    if (spec && spec.chart === 'pie') return pieSVG(labels, values, result, spec);
    return barSVG(labels, values, result, spec);
  };

  function legend(avg, metric) {
    return '<rect x="4" y="4" width="10" height="10" rx="2" fill="#A32D2D"/>' +
      '<text x="18" y="13" font-size="11" fill="#5F5E5A">平均值 ' + NB.esc(NB.fmt(avg)) + '</text>' +
      '<rect x="124" y="4" width="10" height="10" rx="2" fill="#7F77DD"/>' +
      '<text x="138" y="13" font-size="11" fill="#5F5E5A">' + NB.esc(metric || '数值') + '</text>';
  }

  function barSVG(labels, values, result, spec) {
    var W = 400, left = 104, right = 62, rowH = 24, top = 26;
    var H = top + labels.length * rowH + 30;
    var maxV = Math.max.apply(null, values.concat([1]));
    var barW = W - left - right;
    var avgX = left + barW * (result.average / maxV);
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="d-chart" role="img">';
    s += legend(result.average, (spec && spec.metric) || '数值');
    s += '<line x1="' + avgX.toFixed(1) + '" y1="' + (top - 4) + '" x2="' + avgX.toFixed(1) + '" y2="' + (top + labels.length * rowH) + '" stroke="#A32D2D" stroke-width="1" stroke-dasharray="4 3"/>';
    for (var i = 0; i < labels.length; i++) {
      var y = top + i * rowH, w = Math.max(1, barW * (values[i] / maxV));
      s += '<text x="' + (left - 8) + '" y="' + (y + 13) + '" font-size="11" text-anchor="end" fill="#2C2C2A">' + NB.esc(String(labels[i]).slice(0, 10)) + '</text>';
      s += '<rect x="' + left + '" y="' + (y + 3) + '" width="' + w.toFixed(1) + '" height="15" rx="2" fill="' + PALETTE[i % PALETTE.length] + '"/>';
      s += '<text x="' + (left + w + 6) + '" y="' + (y + 15) + '" font-size="10" fill="#5F5E5A">' + NB.esc(NB.fmt(values[i])) + '</text>';
    }
    s += '<text x="' + left + '" y="' + (H - 8) + '" font-size="10" fill="#98968F">0</text>';
    s += '<text x="' + (W - right) + '" y="' + (H - 8) + '" font-size="10" text-anchor="end" fill="#98968F">' + NB.esc(NB.fmt(maxV)) + '</text>';
    if (result.isCross) s += '<text x="4" y="' + (H - 8) + '" font-size="10" fill="#A32D2D">量纲不同 · 仅示意</text>';
    s += '</svg>';
    return s;
  }

  function lineSVG(labels, values, result, spec) {
    var W = 400, H = 180, left = 40, right = 12, top = 24, bottom = 30;
    var maxV = Math.max.apply(null, values.concat([1])), minV = Math.min.apply(null, values.concat([0]));
    var plotW = W - left - right, plotH = H - top - bottom;
    var pts = values.map(function (v, i) {
      return [left + (values.length === 1 ? plotW / 2 : plotW * i / (values.length - 1)), top + plotH - plotH * ((v - minV) / ((maxV - minV) || 1))];
    });
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="d-chart" role="img">';
    s += legend(result.average, (spec && spec.metric) || '数值');
    var avgY = top + plotH - plotH * ((result.average - minV) / ((maxV - minV) || 1));
    s += '<line x1="' + left + '" y1="' + avgY.toFixed(1) + '" x2="' + (W - right) + '" y2="' + avgY.toFixed(1) + '" stroke="#A32D2D" stroke-width="1" stroke-dasharray="4 3"/>';
    s += '<polyline fill="none" stroke="#7F77DD" stroke-width="2" points="' + pts.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' ') + '"/>';
    pts.forEach(function (p) { s += '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="3" fill="#534AB7"/>'; });
    s += '<text x="4" y="' + (top + 4) + '" font-size="10" fill="#98968F">' + NB.esc(NB.fmt(maxV)) + '</text>';
    s += '<text x="4" y="' + (top + plotH) + '" font-size="10" fill="#98968F">' + NB.esc(NB.fmt(minV)) + '</text>';
    s += '<text x="' + left + '" y="' + (H - 8) + '" font-size="10" fill="#98968F">' + NB.esc(String(labels[0]).slice(0, 10)) + '</text>';
    s += '<text x="' + (W - right) + '" y="' + (H - 8) + '" font-size="10" text-anchor="end" fill="#98968F">' + NB.esc(String(labels[labels.length - 1]).slice(0, 10)) + '</text>';
    s += '</svg>';
    return s;
  }

  function pieSVG(labels, values, result, spec) {
    var W = 400, H = 190, cx = 105, cy = 92, r = 72;
    var total = values.reduce(function (a, b) { return a + b; }, 0) || 1;
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="d-chart" role="img">';
    var ang = -Math.PI / 2;
    for (var i = 0; i < values.length; i++) {
      var a2 = ang + 2 * Math.PI * values[i] / total;
      var x1 = cx + r * Math.cos(ang), y1 = cy + r * Math.sin(ang);
      var x2 = cx + r * Math.cos(a2), y2 = cy + r * Math.sin(a2);
      var large = (a2 - ang) > Math.PI ? 1 : 0;
      s += '<path fill="' + PALETTE[i % PALETTE.length] + '" d="M' + cx + ' ' + cy + ' L' + x1.toFixed(1) + ' ' + y1.toFixed(1) + ' A' + r + ' ' + r + ' 0 ' + large + ' 1 ' + x2.toFixed(1) + ' ' + y2.toFixed(1) + ' Z"/>';
      ang = a2;
      if (i < 8) {
        var ly = 20 + i * 20;
        s += '<rect x="210" y="' + (ly - 10) + '" width="10" height="10" rx="2" fill="' + PALETTE[i % PALETTE.length] + '"/>';
        s += '<text x="226" y="' + ly + '" font-size="11" fill="#2C2C2A">' + NB.esc(String(labels[i]).slice(0, 10)) + ' · ' + Math.round(values[i] / total * 100) + '%</text>';
      }
    }
    s += '<text x="4" y="' + (H - 8) + '" font-size="10" fill="#98968F">口径：' + NB.esc(String((spec && spec.caliber) || '')) + '</text>';
    s += '</svg>';
    return s;
  }

  A.PALETTE = PALETTE;
})(typeof window !== 'undefined' ? window : globalThis);
