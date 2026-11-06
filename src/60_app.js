(function (root) {
  var NB = root.NB = root.NB || {};
  var G = NB.Graph, R = NB.Render, A = NB.Analyzer, L = NB.Layout;
  function $(id) { return document.getElementById(id); }
  function bind() {
    var wrap = $('canvasWrap'), canvas = $('canvas'), nodes = $('nodes'), edges = $('edges'), groups = $('groups');

    $('btnImport').onclick = function () { $('fileInput').click(); };
    $('btnSample').onclick = loadSample;
    $('btnEngine').onclick = R.openEngine;
    $('btnMemory').onclick = R.openMemory;
    $('btnTidy').onclick = function () { G.tidy(); R.toast('已按推理层级重排'); };
    $('btnNew').onclick = R.openNewNode;
    $('btnExport').onclick = function () { NB.download('节点分析图_' + Date.now() + '.json', G.export()); R.toast('整图已导出（含 spec / result / rawAnswer）'); };
    $('btnReset').onclick = R.openReset;
    $('detailClose').onclick = function () { G.setActive(null); };
    $('btnHelp').onclick = function () { openGuide(); };
    $('hintGuide').onclick = function () { openGuide(); };
    $('guideX').onclick = closeGuide;

    $('quickAsk').addEventListener('click', function (e) {
      var b = e.target.closest('[data-q]'); if (!b) return;
      quickAsk(b.getAttribute('data-q'));
    });
    $('guide').addEventListener('click', function (e) {
      var b = e.target.closest('[data-g]'); if (!b) return;
      var a = b.getAttribute('data-g');
      if (a === 'demo') runDemo();
      else if (a === 'close' || a === 'done') closeGuide();
    });

    $('fileInput').onchange = function (e) {
      var f = e.target.files && e.target.files[0]; if (!f) return;
      var fr = new FileReader();
      fr.onload = function () {
        var text = String(fr.result || '');
        if (/\.json$/i.test(f.name)) {
          try { G.import(text); R.toast('已导入整图：' + G.state.nodes.length + ' 个节点'); R.draw(); }
          catch (err) { R.toast('导入失败：' + err.message); }
        } else {
          var t = NB.parseTable(text);
          if (!t.columns.length) { R.toast('表格为空或格式无法识别'); return; }
          G.setDataset(t, f.name, text);
          R.addMsg('ai', '已导入 ' + f.name + '（' + t.rows.length + ' 行 · ' + t.columns.length + ' 列）。数值列：' + t.numericCols.slice(0, 5).join('、'));
        }
      };
      fr.readAsText(f, 'utf-8');
      e.target.value = '';
    };

    $('ask').onclick = function () { submit($('q').value); };
    $('q').onkeydown = function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit($('q').value); } };

    $('chatLog').addEventListener('dragstart', function (e) {
      var t = e.target.getAttribute && e.target.getAttribute('data-text');
      if (t == null) return;
      e.dataTransfer.setData('text/plain', t); e.dataTransfer.effectAllowed = 'copy';
    });
    wrap.addEventListener('dragover', function (e) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
    wrap.addEventListener('drop', function (e) {
      e.preventDefault();
      var text = e.dataTransfer.getData('text/plain'); if (!text) return;
      var n = G.fromAnswer(text);
      R.toast('对话内容已结构化解析为节点，原始上下文完整保留');
      ensureVisible(n.id);
    });

    nodes.addEventListener('click', function (e) {
      if (R._suppressClick) return;
      var el = e.target.closest('.node'); if (!el) return;
      var id = el.getAttribute('data-id'), act = e.target.getAttribute && e.target.getAttribute('data-act');
      if (act === 'check') { G.toggleSelect(id); return; }
      if (act === 'copy') { copyNode(id); return; }
      if (act === 'del') { G.removeNode(id); return; }
      if (act === 'nodesend') {
        var inp = el.querySelector('[data-act="nodeask"]');
        if (inp && inp.value.trim()) { submit(inp.value.trim(), id); }
        return;
      }
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'B') return;
      G.setActive(id);
    });
    nodes.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      var inp = e.target.closest('[data-act="nodeask"]'); if (!inp) return;
      var el = inp.closest('.node'); if (!el) return;
      e.preventDefault(); submit(inp.value.trim(), el.getAttribute('data-id')); inp.value = '';
    });

    edges.addEventListener('click', function (e) {
      var p = e.target.closest ? e.target.closest('path.edge') : null;
      if (!p) return;
      R.openEdgeEditor(p.getAttribute('data-id'));
    });

    groups.addEventListener('click', function (e) {
      var l = e.target.closest('[data-act="togglegroup"]'); if (!l) return;
      G.toggleGroup(l.getAttribute('data-gid'));
    });

    $('detailBody').addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]'); if (!b) return;
      var id = G.state.active, act = b.getAttribute('data-act');
      if (act === 'recompute') { var r = G.recompute(id); R.toast(r.ok ? ('已用当前数据复算 · 版本 ' + r.hash.slice(0, 8)) : r.msg); }
      else if (act === 'editconcl') R.openEditConclusion(id);
      else if (act === 'askfrom') { pendingParent = id; $('q').focus(); R.toast('已指定父节点，下一个问题将从这里分支'); }
      else if (act === 'delnode') G.removeNode(id);
    });

    $('floatAsk').addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]'); if (!b) return;
      var act = b.getAttribute('data-act'), ids = G.state.selected.slice(), q = ($('faQ') || {}).value || '';
      q = q.trim();
      if (act === 'cancel') { G.clearSelection(); return; }
      if (act === 'group') { R.openGroupDialog(ids); return; }
      if (act === 'fuse') { R.openFuseDialog(ids); return; }
      if (act === 'cross') {
        if (!q) { R.toast('请输入交叉分析问题'); return; }
        var res = G.makeCross(ids, q);
        if (res.ok) { R.addMsg('user', q); R.addMsg('ai', res.node.result.conclusion, { drag: true }); ensureVisible(res.node.id); }
      }
    });
    $('floatAsk').addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' || e.target.id !== 'faQ') return;
      e.preventDefault();
      var go = $('floatAsk').querySelector('[data-act="cross"]'); if (go) go.click();
    });

    $('suggestBar').addEventListener('click', function (e) {
      var a = e.target.closest('[data-act="clearauto"]');
      if (a) { var n = G.clearAutoEdges(); R.toast('已清除 ' + n + ' 条自动连线，人工连线保留'); return; }
      var s = e.target.closest('[data-sg]');
      if (s) { var item = G.suggestions[Number(s.getAttribute('data-sg'))]; if (item) { G.acceptSuggestion(item); R.toast('已采纳建议连线（转为人工线，不再重算）'); } }
    });

    function zoomBy(f) {
      var ui = G.state.ui, mx = wrap.clientWidth / 2, my = wrap.clientHeight / 2;
      var w = L.screenToWorld(ui, mx, my);
      var z = NB.clamp(Math.round(ui.zoom * f * 100) / 100, NB.LAYOUT.zoomMin, NB.LAYOUT.zoomMax);
      G.setUI({ zoom: z, tx: mx - w.x * z, ty: my - w.y * z });
    }
    $('zoomIn').onclick = function () { zoomBy(1.15); };
    $('zoomOut').onclick = function () { zoomBy(1 / 1.15); };
    $('zoomFit').onclick = function () { L.fitTo(G.state.ui, G.state.nodes, { w: wrap.clientWidth, h: wrap.clientHeight }); G.setUI({}); };
    wrap.addEventListener('wheel', function (e) {
      e.preventDefault();
      var rect = wrap.getBoundingClientRect(), mx = e.clientX - rect.left, my = e.clientY - rect.top;
      var ui = G.state.ui, w = L.screenToWorld(ui, mx, my);
      var z = NB.clamp(Math.round(ui.zoom * (e.deltaY < 0 ? 1.1 : 0.9) * 100) / 100, NB.LAYOUT.zoomMin, NB.LAYOUT.zoomMax);
      G.setUI({ zoom: z, tx: mx - w.x * z, ty: my - w.y * z });
    }, { passive: false });

    var drag = null, lastPos = { x: 0, y: 0 };
    wrap.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      if (e.target.closest('#floatAsk,#suggestBar,#zoomBar,#modal,.group-label')) return;
      var nodeEl = e.target.closest('.node');
      if (nodeEl) {
        if (e.target.closest('input,b,.n-tools span,.n-ask')) return;
        var id = nodeEl.getAttribute('data-id'), n = G.findNode(id); if (!n) return;
        drag = { type: 'node', id: id, sx: e.clientX, sy: e.clientY, x: n.x, y: n.y, moved: false };
      } else if (e.target.tagName && e.target.tagName.toLowerCase() === 'path') {
        return;
      } else {
        drag = { type: 'pan', sx: e.clientX, sy: e.clientY, tx: G.state.ui.tx, ty: G.state.ui.ty };
      }
    });
    document.addEventListener('pointermove', function (e) {
      lastPos = { x: e.clientX, y: e.clientY };
      if (!drag) return;
      var dx = e.clientX - drag.sx, dy = e.clientY - drag.sy, z = G.state.ui.zoom;
      if (drag.type === 'node') {
        if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
        var n = G.findNode(drag.id); if (!n) return;
        n.x = Math.max(0, Math.round(drag.x + dx / z)); n.y = Math.max(0, Math.round(drag.y + dy / z));
        var el = document.querySelector('.node[data-id="' + drag.id + '"]');
        if (el) { el.style.left = n.x + 'px'; el.style.top = n.y + 'px'; }
        R.drawEdges(); R.drawGroups();
      } else {
        G.state.ui.tx = drag.tx + dx; G.state.ui.ty = drag.ty + dy;
        R.drawView();
      }
    });
    document.addEventListener('pointerup', function () {
      if (!drag) return;
      var d = drag; drag = null; G.saveSoon();
      if (d.type !== 'node' || !d.moved) return;
      R._suppressClick = true;
      setTimeout(function () { R._suppressClick = false; }, 60);
      var el = document.querySelector('.node[data-id="' + d.id + '"]');
      if (el) el.style.display = 'none';
      var under = document.elementFromPoint(lastPos.x, lastPos.y);
      if (el) el.style.display = '';
      var other = under && under.closest ? under.closest('.node') : null;
      if (other && other.getAttribute('data-id') !== d.id) {
        R.openGroupDialog([d.id, other.getAttribute('data-id')]);
      }
    });

    $('search').addEventListener('input', function () {
      var q = this.value.trim();
      Array.prototype.forEach.call(nodes.querySelectorAll('.node'), function (el) {
        var n = G.findNode(el.getAttribute('data-id'));
        var hit = !!q && !!n && (n.title.indexOf(q) >= 0 || (n.result && n.result.conclusion.indexOf(q) >= 0));
        el.classList.toggle('focus', hit);
      });
    });
    $('search').addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      var q = this.value.trim(); if (!q) return;
      var hit = null;
      for (var i = 0; i < G.state.nodes.length; i++) {
        var n = G.state.nodes[i];
        if (n.title.indexOf(q) >= 0 || (n.result && n.result.conclusion.indexOf(q) >= 0)) { hit = n; break; }
      }
      if (!hit) { R.toast('没有匹配的节点'); return; }
      var z = G.state.ui.zoom;
      G.setUI({ tx: Math.round(wrap.clientWidth / 2 - (hit.x + 120) * z), ty: Math.round(wrap.clientHeight / 2 - (hit.y + 88) * z) });
      G.setActive(hit.id);
    });

    document.addEventListener('keydown', function (e) {
      if (!(e.ctrlKey || e.metaKey) || String(e.key).toLowerCase() !== 'z') return;
      var t = String(e.target.tagName).toUpperCase();
      if (t === 'INPUT' || t === 'TEXTAREA') return;
      e.preventDefault(); G.undo(); R.draw();
    });
    $('modal').addEventListener('click', function (e) { if (e.target === $('modal')) R.closeModal(); });
  }

  /* ---- 新手引导：让「不会玩」的人点 3 下就能看到完整效果 ---- */
  var GUIDE_KEY = 'nb_guide_seen_v1';
  function guideSeen() {
    try { return localStorage.getItem(GUIDE_KEY) === '1'; } catch (e) { return false; }
  }
  function markGuideSeen() {
    try { localStorage.setItem(GUIDE_KEY, '1'); } catch (e) { }
  }
  function openGuide() {
    renderGuide(0);
    $('guide').classList.remove('hidden');
  }
  function closeGuide() {
    $('guide').classList.add('hidden');
    markGuideSeen();
  }
  function renderGuide(step) {
    var body = $('guideBody'), foot = $('guideFoot');
    $('guide').querySelector('.g-head b').textContent = step === 1 ? '演示完成 · 最后一步' : '第一次用？跟着点 3 下';
    if (step === 1) {
      body.innerHTML = '<div class="g-done"><b>演示已跑完。</b>画布上现在是「数据入口 → 两个分支节点」，' +
        '左下图里有条形图、数据表和结论，还能看到这次用了哪些字段、什么口径。<br><br>' +
        '最后一步留给你：在紫色框里打一句（比如「趋势变化是否与渠道结构有关？」），点 <b>交叉分析</b>，' +
        '就会长出一个同时连着两个父节点的汇聚节点。<br><br>' +
        '以后想再看这份说明，点顶部「? 说明」；点错了按 Ctrl+Z 撤销。</div>';
      foot.innerHTML = '<div class="g-foot"><button data-g="done" class="go">知道了，开始玩</button></div>';
      return;
    }
    body.innerHTML = '<ol class="g-steps">' +
      '<li><b>① 载入数据</b>：点顶部「样例数据」→ 79 行 × 23 列示例表格。</li>' +
      '<li><b>② 问一句</b>：左下输入框打「各品牌对局人次排名如何？」回车，或直接点「品牌排名」这类示例。</li>' +
      '<li><b>③ 看结果</b>：画布长出节点，左下出图表 + 表格 + 结论，并列出字段口径与数据版本。</li>' +
      '<li><b>④ 做汇总</b>：勾两个节点右上角的 □，紫框里点「交叉分析」→ 出现分叉汇聚的推理链。</li>' +
      '</ol>' +
      '<div class="g-note">不想一步步点？「一键跑一遍演示」会自动做完 ①②③ 并把 ④ 的紫框摆好，最后一步留给你亲手点。' +
      '演示不会覆盖已有节点；任何操作都能 Ctrl+Z 撤销。</div>';
    foot.innerHTML = '<div class="g-foot"><button data-g="demo" class="go">▶ 一键跑一遍演示</button><button data-g="close">我自己来</button></div>';
  }
  function quickAsk(q) {
    if (!G.table) loadSample();
    $('q').value = q;
    submit(q);
  }
  function runDemo() {
    if (G.state.nodes.length) {
      R.toast('当前已有节点，演示不会覆盖它们；直接点左下的示例问题继续');
      closeGuide();
      return;
    }
    loadSample();
    submit('各品牌对局人次排名如何？');
    submit('渠道转化率对比');
    var qs = G.state.nodes.filter(function (n) { return n.type === 'question'; });
    if (qs.length >= 2) {
      G.clearSelection();
      G.toggleSelect(qs[0].id);
      G.toggleSelect(qs[1].id);
    }
    renderGuide(1);
    R.toast('演示已跑完：2 个分支节点已生成，最后一步留给你');
  }

  function copyNode(id) {
    var n = G.findNode(id); if (!n) return;
    var c = NB.clone(n);
    c.id = NB.uid('n'); c.title = n.title + '（副本）'; c.x = n.x + 40; c.y = n.y + 40;
    c.createdAt = Date.now(); c.parentIds = []; c.version = 1;
    G.commit(function () { G.state.nodes.push(c); G.state.active = c.id; });
    R.toast('已复制节点（spec 与结论快照一并保留）');
  }

  function loadSample() {
    var t = NB.parseTable(NB.SAMPLE_CSV);
    var h = NB.tableHash(t);
    if (G.state.dataset && G.state.dataset.hash === h && G.table) { R.toast('样例数据已是当前版本'); return; }
    G.setDataset(t, '示例表格_脱敏版.csv', NB.SAMPLE_CSV);
    R.addMsg('ai', '已载入 79 行 × 23 列样例数据。试试问「各品牌对局人次排名如何？」或「渠道转化率对比」。');
  }

  var pendingParent = null;
  function ensureVisible(id) {
    var n = G.findNode(id); if (!n) return;
    var wrap = $('canvasWrap'), ui = G.state.ui, pad = 28;
    var vx = -ui.tx / ui.zoom, vy = -ui.ty / ui.zoom;
    var vw = wrap.clientWidth / ui.zoom, vh = wrap.clientHeight / ui.zoom;
    var l = n.x - pad, r = n.x + NB.LAYOUT.nodeW + pad, t = n.y - pad, b = n.y + NB.LAYOUT.nodeH + pad;
    var dx = 0, dy = 0;
    if (r > vx + vw) dx = (vx + vw) - r;
    if (l + dx < vx) dx = vx - l;
    if (b > vy + vh) dy = (vy + vh) - b;
    if (t + dy < vy) dy = vy - t;
    if (dx || dy) G.setUI({ tx: ui.tx + dx * ui.zoom, ty: ui.ty + dy * ui.zoom });
  }

  function submit(q, parentId) {
    q = String(q || '').trim(); if (!q) return;
    var pid = parentId || pendingParent; pendingParent = null;
    var res = G.ask(q, pid ? { parentId: pid } : undefined);
    if (!res.ok) { R.toast(res.msg); return; }
    R.addMsg('user', q);
    if (res.cross) {
      R.addMsg('ai', res.node.result.conclusion + '\n\n[已合并 ' + res.ctx.included.length + ' 个节点上下文 · ' + res.ctx.tokens + ' token' +
        (res.ctx.omitted.length ? ' · 省略 ' + res.ctx.omitted.length + ' 个' : '') + ']', { drag: true });
    } else {
      R.addMsg('ai', res.node.result.conclusion + '\n\n[自动连线 ' + res.autoEdges + ' 条 · 建议 ' + res.suggest + ' 条]', { drag: true });
    }
    $('q').value = '';
    ensureVisible(res.node.id);
  }

  function init() {
    G.init(); R.init(); R.draw(); bind();
    if (!G.state.nodes.length && !guideSeen()) openGuide();
    if (!G.state.nodes.length) {
      R.addMsg('ai', '欢迎。先点「样例数据」载入 79 行 × 23 列示例表格，再用日常语言提问。\n\n每个节点同时保存 spec（可复算口径）、result（图表与结论快照）、rawAnswer（原始上下文）——这是它和「只存结论的思维导图」的区别。');
    } else {
      R.addMsg('ai', '已恢复上次的分析现场：' + G.state.nodes.length + ' 个节点 / ' + G.state.edges.length + ' 条连线。');
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(typeof window !== 'undefined' ? window : globalThis);
