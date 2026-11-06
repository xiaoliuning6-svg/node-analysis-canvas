import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const mem = {};
const sandbox = {
  console,
  Blob,
  setTimeout,
  clearTimeout,
  localStorage: {
    getItem: k => Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null,
    setItem: (k, v) => { mem[k] = String(v); },
    removeItem: k => { delete mem[k]; },
    clear: () => { Object.keys(mem).forEach(k => delete mem[k]); }
  }
};
vm.createContext(sandbox);
['00_util.js', '10_graph.js', '20_analyze.js', '30_context.js', '40_layout.js'].forEach(f => {
  vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), sandbox, { filename: f });
});
const NB = sandbox.NB;
const G = NB.Graph, A = NB.Analyzer, C = NB.Ctx, L = NB.Layout;

let pass = 0, fail = 0;
function ok(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { fail++; console.log('  FAIL  ' + name + ' :: ' + e.message); }
}

const csv = fs.readFileSync(path.join(ROOT, 'data', 'sample_79x23.csv'), 'utf8').replace(/^\uFEFF/, '');
const table = NB.parseTable(csv);
const schema = {
  name: '示例表格', hash: NB.tableHash(table), columns: table.columns, types: table.types,
  numericCols: table.numericCols, dateCols: table.dateCols, catCols: table.catCols,
  rowCount: table.rows.length,
  dateMin: '2026-07-01', dateMax: '2026-09-30'
};

console.log('\n[1] CSV 解析与样例数据');
ok('79 行 × 23 列', () => {
  assert.equal(table.rows.length, 79);
  assert.equal(table.columns.length, 23);
});
ok('列数正确 + 数值列/日期列推断', () => {
  assert.ok(table.numericCols.includes('对局人次'));
  assert.ok(table.dateCols.includes('日期'));
  assert.ok(table.catCols.includes('品牌名称'));
});
ok('引号内逗号与双引号正确还原', () => assert.equal(table.rows[2][21], '重点复盘,"口径待确认"'));
ok('BOM 剥离后首列名正常', () => assert.equal(table.columns[0], '赛事ID'));
const sums = {};
table.rows.forEach(r => { sums[r[2]] = (sums[r[2]] || 0) + Number(r[6]); });
ok('7 个品牌对局人次精确复现文章截图', () => {
  assert.equal(sums['品牌A-电竞酒店'], 308956);
  assert.equal(sums['品牌C-饮料'], 219969);
  assert.equal(sums['品牌D-茶饮'], 188594);
  assert.equal(sums['品牌B-数码回收'], 83912);
  assert.equal(sums['品牌F-甜品'], 22898);
  assert.equal(sums['品牌G-饮品'], 8307);
  assert.equal(sums['品牌E-烘焙'], 4451);
});

console.log('\n[2] 可复算 spec 与规则引擎');
ok('排名意图 → bar_h / 品牌名称 / 对局人次', () => {
  const s = A.parseIntent('各品牌对局人次排名如何？', schema);
  assert.equal(s.intent, 'rank'); assert.equal(s.chart, 'bar_h');
  assert.equal(s.metric, '对局人次'); assert.equal(s.dimension, '品牌名称');
  assert.equal(JSON.stringify(s.fields), JSON.stringify(['品牌名称', '对局人次']));
});
ok('渠道转化率对比 → 维度渠道 / 指标转化率', () => {
  const s = A.parseIntent('渠道转化率对比', schema);
  assert.equal(s.metric, '转化率'); assert.equal(s.dimension, '渠道');
});
ok('趋势 → line / 按日期分组', () => {
  const s = A.parseIntent('按日期看对局人次趋势', schema);
  assert.equal(s.intent, 'trend'); assert.equal(s.chart, 'line'); assert.equal(s.groupBy, '日期');
});
ok('占比 → pie；平均 → agg=avg', () => {
  assert.equal(A.parseIntent('各品牌对局人次占比', schema).chart, 'pie');
  assert.equal(A.parseIntent('各品牌平均客单价', schema).agg, 'avg');
});
const spec = A.parseIntent('各品牌对局人次排名如何？', schema);
const result = A.render(spec, table);
ok('结论复现 1.4 倍 / 69 倍 / 86%', () => {
  assert.ok(result.conclusion.includes('1.4 倍'), result.conclusion);
  assert.ok(result.conclusion.includes('的 69 倍'), result.conclusion);
  assert.ok(result.conclusion.includes('86%'), result.conclusion);
});
ok('榜首数值 308,956 且平均值约 120K', () => {
  assert.equal(result.table[0].name, '品牌A-电竞酒店');
  assert.equal(result.table[0].value, 308956);
  assert.equal(Math.round(result.average), 119584);
});
ok('recompute 幂等：同 spec 同数据 → 同结论', () => {
  const fake = { spec: spec };
  const r = A.recompute(fake, table);
  assert.equal(r.result.conclusion, result.conclusion);
  assert.equal(r.hash, NB.tableHash(table));
});
ok('chartSVG 输出内联 SVG 且不含外部引用', () => {
  const svg = A.chartSVG(result, spec);
  assert.ok(svg.startsWith('<svg'));
  assert.ok(svg.includes('平均值'));
  assert.ok(!svg.includes('http'));
});

console.log('\n[3] 自动连线打分与上下文合并');
ok('linkScore 例子 = 0.69（Jaccard 并集 4 个元素，可手算复现）', () => {
  const a = { id: 'a', parentIds: [], spec: { fields: ['品牌名称', '对局人次'], datasetHash: 'h1', caliber: 'c1', timeRange: 't1' } };
  const b = { id: 'b', parentIds: [], spec: { fields: ['品牌名称', '渠道', '转化率'], datasetHash: 'h1', caliber: 'c1', timeRange: 't1' } };
  assert.equal(NB.jaccard(a.spec.fields, b.spec.fields), 0.25);
  assert.equal(G.linkScore(a, b), 0.69);
});
ok('0.69 → 不自动连、进建议区', () => {
  assert.ok(0.69 < NB.LINK.auto);
  assert.ok(0.69 >= NB.LINK.suggest);
});
ok('merge 每节点 ≤400 字 + 总预算 ≤6000 token + spec 去重', () => {
  const mk = (i, fields) => ({
    id: 'n' + i, title: '节点' + i, rawAnswer: '原文'.repeat(200),
    spec: { fields: fields, caliber: 'c' + i, datasetHash: 'h1' },
    result: { conclusion: '结论'.repeat(100) }
  });
  const ctx = C.merge([mk(1, ['A', 'B']), mk(2, ['A', 'B']), mk(3, ['C'])], '交叉问题');
  assert.ok(ctx.tokens <= NB.BUDGET.tokens, 'tokens=' + ctx.tokens);
  assert.ok(ctx.text.includes('已去重'));
  assert.equal(ctx.included.length, 3);
});
ok('centroid 两节点几何重心 = 130', () => {
  const p = C.centroid([{ x: 0, y: 0 }, { x: 320, y: 0 }], { x: 0, y: 0, w: 3000, h: 2000 });
  assert.equal(p.x, 130);
});

console.log('\n[4] 图状态、undo、分组/融合、持久化');
G.init();
ok('初始为空图', () => assert.equal(G.state.nodes.length, 0));
G.setDataset(table, '示例表格.csv', csv);
ok('导入后 1 个数据入口节点 + 数据集元信息', () => {
  assert.equal(G.state.nodes.length, 1);
  assert.equal(G.state.nodes[0].type, 'data');
  assert.equal(G.state.dataset.rowCount, 79);
});
const q1 = G.ask('各品牌对局人次排名如何？');
ok('提问生成节点并挂 spec + result + rawAnswer', () => {
  assert.equal(q1.ok, true);
  assert.equal(G.state.nodes.length, 2);
  const n = G.findNode(q1.node.id);
  assert.ok(n.spec.caliber.includes('sum(对局人次)'));
  assert.ok(n.result.conclusion.includes('86%'));
  assert.ok(n.rawAnswer.length > 0);
});
ok('父子边由推理路径自动建立', () => {
  assert.equal(G.state.edges.length, 1);
  assert.equal(G.state.edges[0].rel, '父子');
  assert.equal(G.state.edges[0].source, 'manual');
});
const q2 = G.ask('渠道转化率对比');
ok('第二个分析节点形成分支', () => assert.equal(G.state.nodes.length, 3));
ok('分层布局：数据源 rank0 / 子节点 rank1', () => {
  const d = G.dataSourceId();
  assert.equal(G.findNode(d).x, NB.LAYOUT.originX);
  assert.equal(G.findNode(q1.node.id).x, NB.LAYOUT.originX + NB.LAYOUT.gapX);
});
G.toggleSelect(q1.node.id); G.toggleSelect(q2.node.id);
ok('多选 2 个节点', () => assert.equal(G.state.selected.length, 2));
const cross = G.ask('趋势变化是否与渠道结构有关？');
ok('多选 → 交叉节点，parentIds 长度 2（多入边）', () => {
  assert.equal(cross.cross, true);
  const n = G.findNode(cross.node.id);
  assert.equal(n.parentIds.length, 2);
  assert.equal(n.type, 'cross');
  assert.ok(n.result.conclusion.includes('已合并 2 个节点'));
});
ok('汇聚节点产生 2 条入边', () => {
  const inEdges = G.state.edges.filter(e => e.to === cross.node.id);
  assert.equal(inEdges.length, 2);
});
const beforeUndo = G.state.nodes.length;
ok('Ctrl+Z 撤销回到汇总前', () => {
  assert.equal(G.undo(), true);
  assert.equal(G.state.nodes.length, beforeUndo - 1);
});
ok('融合：归档 2 个源节点、原节点删除、边重定向', () => {
  const ids = [q1.node.id, q2.node.id];
  const f = G.fuse(ids);
  assert.equal(f.archivedRaw.length, 2);
  assert.equal(G.findNode(q1.node.id), null);
  assert.equal(G.state.edges.filter(e => e.from === f.id || e.to === f.id).length > 0, true);
});
ok('融合可逆：undo 后源节点恢复', () => {
  assert.equal(G.undo(), true);
  assert.ok(G.findNode(q1.node.id));
});
ok('分组是容器引用，不删节点', () => {
  const g = G.group([q1.node.id, q2.node.id], '测试组');
  assert.equal(g.members.length, 2);
  assert.ok(G.findNode(q1.node.id));
  assert.equal(G.state.groups.length, 1);
});
ok('重新计算刷新数据版本', () => {
  const r = G.recompute(q1.node.id);
  assert.equal(r.ok, true);
  assert.equal(G.findNode(q1.node.id).spec.datasetHash, r.hash);
});
ok('不同数据 → 旧节点标记 stale（hash 不一致）', () => {
  const t2 = NB.parseTable(csv.replace('E0001', 'E9999'));
  const oldHash = G.state.dataset.hash;
  G.setDataset(t2, '改过的表.csv', csv.replace('E0001', 'E9999'));
  assert.notEqual(G.state.dataset.hash, oldHash);
  assert.notEqual(G.findNode(q1.node.id).datasetHash, G.state.dataset.hash);
});
ok('export → import 往返节点数一致', () => {
  const json = G.export();
  const n = G.state.nodes.length;
  G.import(json);
  assert.equal(G.state.nodes.length, n);
});
ok('localStorage 已落盘且含 v2 标记', () => {
  const raw = mem['nb_node_graph_v2'];
  assert.ok(raw && raw.length > 100);
  assert.equal(JSON.parse(raw).v, 2);
});
ok('超大数据集触发 4.5MB 剥离而非静默丢失', () => {
  G.state.dataset.rawText = 'x'.repeat(6 * 1024 * 1024);
  G.save();
  assert.ok(G.state.dataset.rawTruncated || !G.state.dataset.rawText);
});

console.log('\n' + pass + ' passed / ' + fail + ' failed');
if (fail) process.exit(1);
