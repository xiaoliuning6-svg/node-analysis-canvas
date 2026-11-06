(function (root) {
  var NB = root.NB = root.NB || {};
  var L = NB.Layout = {};

  L.relayout = function (state) {
    var nodes = state.nodes || [], byId = {};
    nodes.forEach(function (n) { byId[n.id] = n; });
    var rank = {}, visiting = {};
    function depth(id) {
      if (rank[id] != null) return rank[id];
      if (visiting[id]) return 0;
      visiting[id] = 1;
      var n = byId[id], ps = (n && n.parentIds) || [];
      var d = ps.length ? Math.max.apply(null, ps.map(function (p) { return byId[p] ? depth(p) + 1 : 0; })) : 0;
      visiting[id] = 0; rank[id] = d; return d;
    }
    nodes.forEach(function (n) { depth(n.id); });
    var tiers = {};
    nodes.forEach(function (n) {
      var d = rank[n.id] || 0;
      (tiers[d] = tiers[d] || []).push(n);
    });
    Object.keys(tiers).forEach(function (d) {
      tiers[d].sort(function (a, b) { return a.createdAt - b.createdAt; });
      tiers[d].forEach(function (n, i) {
        n.x = NB.LAYOUT.originX + Number(d) * NB.LAYOUT.gapX;
        n.y = NB.LAYOUT.originY + i * NB.LAYOUT.gapY;
      });
    });
  };

  L.placeNew = function (state, node) {
    var byId = {};
    state.nodes.forEach(function (n) { byId[n.id] = n; });
    var parents = (node.parentIds || []).map(function (id) { return byId[id]; }).filter(Boolean);
    var px = parents.length ? Math.max.apply(null, parents.map(function (p) { return p.x; })) : 0;
    var x = parents.length ? px + NB.LAYOUT.gapX : NB.LAYOUT.originX;
    var maxY = 0, sameCol = false;
    state.nodes.forEach(function (n) { if (Math.abs(n.x - x) < 10) { sameCol = true; if (n.y > maxY) maxY = n.y; } });
    node.x = x;
    node.y = sameCol ? maxY + NB.LAYOUT.gapY : NB.LAYOUT.originY;
  };

  L.edgePath = function (a, b) {
    var W = NB.LAYOUT.nodeW, H = NB.LAYOUT.nodeH;
    var x1 = a.x + W, y1 = a.y + H / 2;
    var x2 = b.x, y2 = b.y + H / 2;
    var dx = Math.max(40, Math.abs(x2 - x1) * 0.45);
    var p1x = x1 + dx, p1y = y1, p2x = x2 - dx, p2y = y2;
    var d = 'M' + x1 + ' ' + y1 + ' C ' + p1x + ' ' + p1y + ', ' + p2x + ' ' + p2y + ', ' + x2 + ' ' + y2;
    return { d: d, mx: (x1 + 3 * p1x + 3 * p2x + x2) / 8, my: (y1 + 3 * p1y + 3 * p2y + y2) / 8 - 6 };
  };

  L.applyTransform = function (el, ui) {
    el.style.transform = 'translate(' + ui.tx + 'px,' + ui.ty + 'px) scale(' + ui.zoom + ')';
  };
  L.screenToWorld = function (ui, sx, sy) { return { x: (sx - ui.tx) / ui.zoom, y: (sy - ui.ty) / ui.zoom }; };

  L.bounds = function (nodes) {
    if (!nodes.length) return { x: 0, y: 0, w: 600, h: 400 };
    var xs = nodes.map(function (n) { return n.x; }), ys = nodes.map(function (n) { return n.y; });
    var x = Math.min.apply(null, xs), y = Math.min.apply(null, ys);
    var r = Math.max.apply(null, nodes.map(function (n) { return n.x + NB.LAYOUT.nodeW; }));
    var b = Math.max.apply(null, nodes.map(function (n) { return n.y + NB.LAYOUT.nodeH; }));
    return { x: x, y: y, w: r - x, h: b - y };
  };

  L.fitTo = function (ui, nodes, wrap) {
    var bd = L.bounds(nodes);
    var z = NB.clamp(Math.min((wrap.w - 120) / (bd.w || 1), (wrap.h - 120) / (bd.h || 1)), NB.LAYOUT.zoomMin, NB.LAYOUT.zoomMax);
    ui.zoom = Math.round(z * 100) / 100;
    ui.tx = Math.round((wrap.w - bd.w * ui.zoom) / 2 - bd.x * ui.zoom);
    ui.ty = Math.round((wrap.h - bd.h * ui.zoom) / 2 - bd.y * ui.zoom);
    return ui;
  };

  L.groupBox = function (members) {
    var bd = L.bounds(members);
    return { x: bd.x - 20, y: bd.y - 30, w: bd.w + 40, h: bd.h + 50 };
  };
})(typeof window !== 'undefined' ? window : globalThis);
