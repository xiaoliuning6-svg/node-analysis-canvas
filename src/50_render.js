(function (root) {
  var NB = root.NB = root.NB || {};
  var R = NB.Render = {};
  var G = NB.Graph;
  function $(id) { return document.getElementById(id); }
  function esc(s) { return NB.esc(s); }
  function each(list, fn) { Array.prototype.forEach.call(list, fn); }

  R.refs = {};
  R._floatKey = '';
  R._tt = null;

  R.init = function () {
    R.refs = {
      wrap: $('canvasWrap'), canvas: $('canvas'), nodes: $('nodes'), edges: $('edges'),
      groups: $('groups'), detail: $('detailBody'), chat: $('chatLog'),
      float: $('floatAsk'), suggest: $('suggestBar'), modal: $('modal')
    };
    G.subscribe(function (evt, p) {
      if (evt === 'change') R.draw();
      else if (evt === 'view') R.drawView();
      else if (evt === 'toast') R.toast(p);
    });
  };

  R.draw = function () {
    R.drawView(); R.drawGroups(); R.drawNodes(); R.drawEdges();
    R.drawDetail(); R.drawFloat(); R.drawSuggest(); R.drawState();
  };

  R.drawView = function () {
    NB.Layout.applyTransform($('canvas'), G.state.ui);
    $('zoomVal').textContent = Math.round(G.state.ui.zoom * 100) + '%';
  };

  function collapsedIds() {
    var m = {};
    G.state.groups.filter(function (g) { return g.collapsed; }).forEach(function (g) {
      g.members.forEach(function (id) { m[id] = 1; });
    });
    return m;
  }

  R.drawGroups = function () {
    $('groups').innerHTML = G.state.groups.map(function (g) {
      var members = g.members.map(G.findNode).filter(Boolean);
      if (members.length < 2) return '';
      var bd = NB.Layout.groupBox(members);
      return '<div class="group-box" data-gid="' + g.id + '" style="left:' + bd.x + 'px;top:' + bd.y + 'px;width:' + bd.w + 'px;height:' + bd.h + 'px">' +
        '<span class="group-label" data-act="togglegroup" data-gid="' + g.id + '">' + esc(g.title) + ' · ' + members.length + ' 个节点' + (g.collapsed ? '（已折叠，点击展开）' : '') + '</span></div>';
    }).join('');
  };

  R.drawNodes = function () {
    var hidden = collapsedIds(), sel = G.state.selected;
    $('nodes').innerHTML = G.state.nodes.filter(function (n) { return !hidden[n.id]; }).map(function (n) {
      var stale = !!(n.datasetHash && G.state.dataset && n.datasetHash !== G.state.dataset.hash);
      var cls = ['node'];
      if (n.type === 'data') cls.push('data');
      if (n.type === 'cross' || n.type === 'fused') cls.push('cross');
      if (stale) cls.push('stale');
      if (sel.indexOf(n.id) >= 0) cls.push('selected');
      if (G.state.active === n.id) cls.push('focus');
      var sum = n.result ? n.result.conclusion : (n.rawAnswer || '（无结构化结果，保留对话原文）');
      var checked = sel.indexOf(n.id) >= 0;
      return '<div class="' + cls.join(' ' ) + '" data-id="' + n.id + '" style="left:' + n.x + 'px;top:' + n.y + 'px">' +
        '<div class="n-top"><span class="n-kind">' + esc(n.kind) + '</span><span class="n-tools">' +
        '<span data-act="copy" title="复制">⧉</span><span data-act="del" title="删除">✕</span>' +
        '<span data-act="check" class="' + (checked ? 'on' : '') + '" title="多选">' + (checked ? '■' : '□') + '</span></span></div>' +
        '<div class="n-title">' + esc(n.title) + '</div>' +
        '<div class="n-sum">' + esc(String(sum).slice(0, 46)) + '</div>' +
        '<div class="n-tags"><i>文字</i><span>+ 标签</span>' + (stale ? '<span style="color:var(--amber)">数据已变更</span>' : '') + '</div>' +
        '<div class="n-ask"><input data-act="nodeask" placeholder="基于这个节点继续提问"><b data-act="nodesend">➤</b></div>' +
        '</div>';
    }).join('');
  };

  function marker(id, color) {
    return '<marker id="' + id + '" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">' +
      '<path d="M2 1L8 5L2 9" fill="none" stroke="' + color + '" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></marker>';
  }

  R.drawEdges = function () {
    var byId = {}, hidden = collapsedIds();
    G.state.nodes.forEach(function (n) { byId[n.id] = n; });
    var defs = '<defs>' + marker('arrP', '#7F77DD') + marker('arrG', '#0F6E56') + marker('arrR', '#A32D2D') + '</defs>';
    var body = G.state.edges.map(function (e) {
      var a = byId[e.from], b = byId[e.to];
      if (!a || !b || hidden[a.id] || hidden[b.id]) return '';
      var p = NB.Layout.edgePath(a, b);
      var key = e.rel === '冲突' ? 'arrR' : (e.source === 'auto' ? 'arrP' : 'arrG');
      var color = e.rel === '冲突' ? '#A32D2D' : (e.source === 'auto' ? '#7F77DD' : '#0F6E56');
      var dash = e.source === 'auto' ? '6 4' : (e.rel === '冲突' ? '3 3' : '');
      var mEnd = (e.dir === '→' || e.dir === '⇄') ? ' marker-end="url(#' + key + ')"' : '';
      var mStart = (e.dir === '←' || e.dir === '⇄') ? ' marker-start="url(#' + key + ')"' : '';
      var path = '<path class="edge" data-id="' + e.id + '" d="' + p.d + '" fill="none" stroke="' + color + '" stroke-width="1.7"' +
        (dash ? ' stroke-dasharray="' + dash + '"' : '') + mEnd + mStart + '/>';
      var note = e.note ? '<text x="' + p.mx.toFixed(1) + '" y="' + p.my.toFixed(1) + '" font-size="11" fill="#5F5E5A" text-anchor="middle" pointer-events="none">' + esc(e.note) + '</text>' : '';
      return path + note;
    }).join('');
    $('edges').innerHTML = defs + body;
  };

  function specLines(s) {
    s = s || {};
    return [
      '意图      ' + (s.intent || '-'),
      '字段      ' + ((s.fields || []).join('、') || '-'),
      '指标      ' + (s.metric || '-') + '  ·  ' + (s.agg || '-'),
      '分组维度  ' + (s.groupBy || '-'),
      '过滤      ' + ((s.filters && s.filters.length) ? s.filters.join(';') : '无'),
      '时间范围  ' + (s.timeRange || '-'),
      '口径      ' + (s.caliber || '-'),
      '数据版本  ' + (s.datasetHash || '-'),
      '样本行数  ' + (s.rowCount || 0)
    ].join('\n');
  }

  function detailTable(rows) {
    if (!rows || !rows.length) return '';
    var h = '<table class="d-table"><thead><tr><th>名称</th><th style="text-align:right">数值</th><th style="text-align:right">占比</th><th>排名</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      h += '<tr><td>' + esc(r.name) + '</td><td class="num">' + esc(NB.fmt(r.value)) + '</td><td class="num">' + esc(r.ratio) + '%</td><td><span class="rank">第' + esc(r.rank) + '</span></td></tr>';
    });
    return h + '</tbody></table>';
  }

  R.drawDetail = function () {
    var n = G.findNode(G.state.active), box = $('detailBody');
    if (!n) { box.innerHTML = '<div class="empty">选择一个节点<br>查看字段口径、图表与结论</div>'; return; }
    var stale = !!(n.datasetHash && G.state.dataset && n.datasetHash !== G.state.dataset.hash);
    var h = '<div class="d-title">' + esc(n.title) + ' <span style="font-weight:400;font-size:11px;color:var(--purple)">' + esc(n.kind) + ' · v' + (n.version || 1) + '</span></div>';
    if (stale) h += '<div class="stale-tip">数据版本已变更（节点 ' + esc(String(n.datasetHash).slice(0, 8)) + ' / 当前 ' + esc(String(G.state.dataset.hash).slice(0, 8)) + '）。结论仍按旧版本保存，点「重新计算」用当前数据复算。</div>';
    h += '<div class="d-k">字段口径 spec（可复算）</div><div class="d-spec">' + esc(specLines(n.spec)) + '</div>';
    if (n.type === 'data' && G.state.dataset) {
      var d = G.state.dataset, s0 = (d.sampleRows && d.sampleRows[0]) || [];
      h += '<div class="d-card"><div class="d-k" style="margin-top:0">列结构（' + d.columns.length + ' 列 / ' + d.rowCount + ' 行）</div>' +
        '<table class="d-table"><thead><tr><th>列名</th><th>类型</th><th>样本首行</th></tr></thead><tbody>' +
        d.columns.map(function (c, i) { return '<tr><td>' + esc(c) + '</td><td>' + esc(d.types[c]) + '</td><td>' + esc(s0[i] || '') + '</td></tr>'; }).join('') +
        '</tbody></table></div>';
    }
    if (n.result) {
      if (n.result.chart && n.result.chart !== 'none') h += '<div class="d-card">' + NB.Analyzer.chartSVG(n.result, n.spec) + '</div>';
      if (n.type !== 'data') h += '<div class="d-card">' + detailTable(n.result.table) + '</div>';
      h += '<div class="d-concl">' + esc(n.result.conclusion) + '</div>';
      h += '<div class="d-k">关键洞察</div><ul>' + (n.result.insights || []).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>';
    } else {
      h += '<div class="d-card"><div class="d-k" style="margin-top:0">对话原文（完整保留上下文）</div><div style="white-space:pre-wrap;word-break:break-word;font-size:12px">' + esc(n.rawAnswer) + '</div></div>';
    }
    if (n.archivedRaw) h += '<div class="d-k">归档源节点 ' + n.archivedRaw.length + ' 个</div><ul>' + n.archivedRaw.map(function (a) { return '<li>' + esc(a.title) + '</li>'; }).join('') + '</ul>';
    h += '<div class="d-actions">' +
      '<button data-act="recompute">重新计算</button>' +
      '<button data-act="editconcl">编辑结论</button>' +
      '<button data-act="askfrom">基于此节点提问</button>' +
      '<button data-act="delnode">删除节点</button></div>';
    box.innerHTML = h;
  };

  R.drawFloat = function () {
    var sel = G.state.selected, f = $('floatAsk'), key = sel.join(',');
    if (sel.length < 2) { f.classList.add('hidden'); R._floatKey = ''; return; }
    var nodes = sel.map(G.findNode).filter(Boolean);
    if (nodes.length < 2) { f.classList.add('hidden'); return; }
    var view = NB.Ctx.viewport(G.state.ui, { w: R.refs.wrap.clientWidth, h: R.refs.wrap.clientHeight });
    var pos = NB.Ctx.centroid(nodes, view);
    f.style.left = pos.x + 'px'; f.style.top = pos.y + 'px';
    f.classList.remove('hidden');
    if (R._floatKey !== key) {
      R._floatKey = key;
      f.innerHTML = '<div class="fa-head">已选 ' + sel.length + ' 个节点 · 合并上下文后提问</div>' +
        '<input id="faQ" placeholder="例如：趋势变化是否与渠道结构有关？">' +
        '<div class="fa-row"><button data-act="cross" class="go">交叉分析</button><button data-act="group">分组</button>' +
        '<button data-act="fuse">融合</button><button data-act="cancel">取消</button></div>';
    }
  };

  R.drawSuggest = function () {
    var bar = $('suggestBar'), list = G.suggestions || [];
    if (!list.length) { bar.classList.add('hidden'); return; }
    bar.classList.remove('hidden');
    bar.innerHTML = '<b>建议连线 ' + list.length + ' 条</b> · score 0.50–0.70，未自动落线（点击采纳）' +
      '<a data-act="clearauto" style="float:right;cursor:pointer;color:var(--red)">清除全部自动线</a><div>' +
      list.map(function (s, i) { return '<span class="sg-item" data-sg="' + i + '">' + esc(s.label) + ' · ' + s.score + '</span>'; }).join('') + '</div>';
  };

  R.drawState = function () {
    var d = G.state.dataset;
    $('dataState').textContent = d ? (d.rowCount + ' 行 · ' + d.columns.length + ' 列 · ' + String(d.hash).slice(0, 8)) : '暂无数据';
    $('canvasHint').style.display = G.state.nodes.length ? 'none' : '';
  };

  R.toast = function (msg) {
    if (!msg) return;
    var t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(R._tt); R._tt = setTimeout(function () { t.classList.remove('show'); }, 2400);
  };

  R.addMsg = function (role, text, opts) {
    var d = document.createElement('div');
    d.className = 'msg ' + (role === 'user' ? 'user' : 'ai');
    var inner = '<span>' + esc(text) + '</span>';
    if (opts && opts.drag) inner += '<span class="drag-tag" draggable="true" data-text="' + esc(text) + '">拖入画布 →</span>';
    d.innerHTML = inner;
    $('chatLog').appendChild(d);
    $('chatLog').scrollTop = $('chatLog').scrollHeight;
  };

  R.closeModal = function () { var m = $('modal'); m.classList.add('hidden'); m.innerHTML = ''; };

  R.modal = function (opts) {
    var m = $('modal');
    var btns = (opts.buttons || []).map(function (b, i) {
      return '<button data-mb="' + i + '" class="' + (b.cls || '') + '">' + esc(b.label) + '</button>';
    }).join('');
    m.innerHTML = '<div class="modal-card"><h3>' + esc(opts.title || '') + '</h3>' + (opts.body || '') +
      '<div class="modal-foot">' + btns + '</div></div>';
    m.classList.remove('hidden');
    each(m.querySelectorAll('[data-mb]'), function (b) {
      b.onclick = function () {
        var f = opts.buttons[Number(b.getAttribute('data-mb'))];
        if (f.onClick) f.onClick(m);
        if (!f.keep) R.closeModal();
      };
    });
    if (opts.onOpen) opts.onOpen(m);
  };

  R.openEdgeEditor = function (id) {
    var e = G.findEdge(id); if (!e) return;
    var tmp = { rel: e.rel, dir: e.dir, note: e.note || '' };
    function body() {
      var rels = ['父子', '关联', '冲突'], dirs = ['→', '←', '⇄', '—'];
      return '<div class="modal-row">关系：' + rels.map(function (r) {
        return '<button data-rel="' + r + '" class="' + (tmp.rel === r ? 'on' : '') + '">' + r + '</button>';
      }).join('') + '</div><div class="modal-row">方向：' + dirs.map(function (r) {
        return '<button data-dir="' + r + '" class="' + (tmp.dir === r ? 'on' : '') + '">' + r + '</button>';
      }).join('') + '</div>' +
        '<input id="edNote" placeholder="给连线加一段文字说明" value="' + esc(tmp.note) + '">' +
        '<div style="font-size:11px;color:var(--muted);margin-top:8px">来源：' + (e.source === 'auto' ? '系统自动（编辑后转人工，不再重算）' : '人工') + ' · 相关度 ' + esc(e.score) + '</div>';
    }
    function open() {
      R.modal({
        title: '编辑连线', body: body(),
        buttons: [
          { label: '删除连线', cls: 'del', onClick: function () { G.removeEdge(id); } },
          { label: '取消' },
          { label: '完成', cls: 'ok', onClick: function () { G.updateEdge(id, { rel: tmp.rel, dir: tmp.dir, note: tmp.note }); } }
        ],
        onOpen: function (m) {
          each(m.querySelectorAll('[data-rel],[data-dir]'), function (b) {
            b.onclick = function () {
              var note = m.querySelector('#edNote'); if (note) tmp.note = note.value;
              if (b.getAttribute('data-rel')) tmp.rel = b.getAttribute('data-rel');
              if (b.getAttribute('data-dir')) tmp.dir = b.getAttribute('data-dir');
              open();
            };
          });
          var note = m.querySelector('#edNote');
          if (note) note.oninput = function () { tmp.note = note.value; };
        }
      });
    }
    open();
  };

  R.openGroupDialog = function (ids) {
    R.modal({
      title: '节点分组', body: '<p style="font-size:12px;color:var(--muted);margin:0 0 10px">将 ' + ids.length + ' 个节点组成一个分析单元：可逆，可整体折叠 / 移动 / 复制 / 提问 / 关联。原节点不会被删除。</p>' +
        '<input id="gTitle" value="分析组 ' + (G.state.groups.length + 1) + '">',
      buttons: [{ label: '取消' }, {
        label: '分组', cls: 'ok', onClick: function (m) {
          var t = m.querySelector('#gTitle').value || ('分析组 ' + (G.state.groups.length + 1));
          G.group(ids, t); G.clearSelection(); R.toast('已分组，可点击组标题折叠');
        }
      }]
    });
  };

  R.openFuseDialog = function (ids) {
    R.modal({
      title: '融合节点（销毁性）',
      body: '<p style="font-size:12px;color:var(--muted);margin:0">融合会删除 ' + ids.length + ' 个源节点并把入/出边重定向到新节点。原始 spec 与回答会归档到 <code>archivedRaw</code>，但追溯链不再自动可导航。可用 Ctrl+Z 回滚，建议先导出备份。</p>',
      buttons: [
        { label: '取消' },
        { label: '先导出再融合', onClick: function () { NB.download('融合前备份_' + Date.now() + '.json', G.export()); G.fuse(ids); } },
        { label: '直接融合', cls: 'ok', onClick: function () { G.fuse(ids); } }
      ]
    });
  };

  R.openEditConclusion = function (id) {
    var n = G.findNode(id); if (!n) return;
    var text = n.result ? n.result.conclusion : (n.rawAnswer || '');
    R.modal({
      title: '编辑结论', body: '<textarea id="ecText" rows="6">' + esc(text) + '</textarea>',
      buttons: [{ label: '取消' }, { label: '保存', cls: 'ok', onClick: function (m) { G.setConclusion(id, m.querySelector('#ecText').value); } }]
    });
  };

  R.openNewNode = function () {
    R.modal({
      title: '新建节点', body: '<input id="nnTitle" placeholder="节点标题" value="新节点">',
      buttons: [{ label: '取消' }, { label: '创建', cls: 'ok', onClick: function (m) { G.addManual(m.querySelector('#nnTitle').value || '新节点'); } }]
    });
  };

  R.openMemory = function () {
    var s = G.stats();
    var lines = [
      '节点 ' + s.nodes + ' 个 / 连线 ' + s.edges + ' 条（自动 ' + s.auto + ' 条）/ 分析组 ' + s.groups + ' 个',
      '数据 ' + s.rows + ' 行 × ' + s.cols + ' 列，版本 ' + s.hash,
      '可撤销步数 ' + s.undo + ' / ' + NB.LIMITS.undoSteps,
      '已用存储 ' + Math.round(s.bytes / 1024) + ' KB / 上限 ' + Math.round(NB.LIMITS.storageBytes / 1024) + ' KB',
      '原始表格在内存：' + (s.table ? '是（可重新计算）' : '否（需重新导入）')
    ].join('\n');
    R.modal({
      title: '记忆 · 当前分析现场',
      body: '<div class="d-spec">' + esc(lines) + '</div><p style="font-size:12px;color:var(--muted);margin:10px 0 0">每个节点同时保存 spec（可复算口径）、result（图表与结论快照）、rawAnswer（原始上下文）。即使原始表格丢失，结论仍可查阅；重新导入表格后可「重新计算」验证。</p>',
      buttons: [{ label: '关闭' }]
    });
  };

  R.openEngine = function () {
    R.modal({
      title: '分析引擎 · 可替换插件',
      body: '<div class="d-spec">Analyzer {\n  parseIntent(q, schema) → spec\n  render(spec, rows)  → result\n  summarize(ctx[])    → text\n}</div>' +
        '<p style="font-size:12px;color:var(--muted);margin:10px 0 0">v0 是确定性规则引擎，不调用任何外部模型：趋势→折线 / 对比排名→横向条形 / 占比→饼图 / 平均→带均值虚线。v1 只需替换 parseIntent 与 summarize，画布、连线、分组、持久化都不用改——这是把 AI 隔离在插件层的原因。</p>',
      buttons: [{ label: '知道了' }]
    });
  };

  R.openReset = function () {
    R.modal({
      title: '重置整个分析现场？',
      body: '<p style="font-size:12px;color:var(--red);margin:0">将清空全部节点、连线、分组与对话。此操作可用 Ctrl+Z 回滚一步，但建议先导出备份。</p>',
      buttons: [{ label: '取消' }, { label: '先导出再重置', onClick: function () { NB.download('重置前备份_' + Date.now() + '.json', G.export()); doReset(); } }, { label: '确认重置', cls: 'del', onClick: doReset }]
    });
    function doReset() { G.reset(); $('chatLog').innerHTML = ''; R.draw(); R.toast('已重置'); }
  };
})(typeof window !== 'undefined' ? window : globalThis);
