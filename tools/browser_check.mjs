import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('F:/Obsidian/vault/HBS/starry-night-3d/node_modules/playwright-core');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = path.join(ROOT, '_shots');
const URL = pathToFileURL(path.join(ROOT, 'index.html')).href;

let pass = 0, fail = 0;
async function ok(name, fn) {
  try { await fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { fail++; console.log('  FAIL  ' + name + ' :: ' + e.message); }
}

function pngStats(buf) {
  let p = 8, w = 0, h = 0, ct = 0, bd = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.slice(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bd = data[8]; ct = data[9]; }
    if (type === 'IDAT') idat.push(data);
    if (type === 'IEND') break;
    p += 12 + len;
  }
  if (bd !== 8 || (ct !== 2 && ct !== 6)) return { w, h, ratio: -1, note: 'unsupported png format' };
  const ch = ct === 6 ? 4 : 3, stride = w * ch;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const out = Buffer.alloc(h * stride);
  let pos = 0;
  for (let y = 0; y < h; y++) {
    const ft = raw[pos++];
    for (let x = 0; x < stride; x++) {
      const v = raw[pos++];
      const a = x >= ch ? out[y * stride + x - ch] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = (x >= ch && y > 0) ? out[(y - 1) * stride + x - ch] : 0;
      let val;
      if (ft === 0) val = v;
      else if (ft === 1) val = v + a;
      else if (ft === 2) val = v + b;
      else if (ft === 3) val = v + ((a + b) >> 1);
      else {
        const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        val = v + (pa <= pb && pa <= pc ? a : (pb <= pc ? b : c));
      }
      out[y * stride + x] = val & 255;
    }
  }
  const bg = [out[0], out[1], out[2]];
  let diff = 0;
  for (let i = 0; i < w * h; i++) {
    const o = i * ch;
    if (Math.abs(out[o] - bg[0]) + Math.abs(out[o + 1] - bg[1]) + Math.abs(out[o + 2] - bg[2]) > 36) diff++;
  }
  return { w, h, ratio: diff / (w * h) };
}

const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--allow-file-access-from-files']
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const external = [], errors = [];
page.on('request', r => { if (!r.url().startsWith('file://')) external.push(r.url()); });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
const state = (fn, arg) => page.evaluate(fn, arg);
const wait = ms => page.waitForTimeout(ms);
async function undo() {
  await page.evaluate(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });
  await page.keyboard.press('Control+z');
  await wait(180);
}

console.log('\n[1] 加载与静态红线');
await page.goto(URL, { waitUntil: 'load' });
await wait(350);
await page.screenshot({ path: path.join(SHOTS, '01_initial.png') });
await ok('首次打开自动出现引导卡，且可关闭并记住', async () => {
  assert.equal(await page.isVisible('#guide'), true);
  assert.ok((await page.textContent('#guide')).includes('载入数据'));
  assert.ok((await page.textContent('#quickAsk')).includes('品牌排名'));
  await page.click('#guide [data-g="close"]'); await wait(100);
  assert.equal(await page.isVisible('#guide'), false);
  assert.equal(await state(() => localStorage.getItem('nb_guide_seen_v1')), '1');
});
await ok('关键 DOM 全部存在', async () => {
  for (const id of ['toolbar', 'left', 'canvasWrap', 'nodes', 'edges', 'detailBody', 'chatLog', 'floatAsk']) {
    assert.equal(await state(id2 => !!document.getElementById(id2), id), true, 'missing #' + id);
  }
});
await ok('NB 命名空间与 Graph 已挂载（脚本整体执行）', async () => {
  assert.equal(await state(() => !!(window.NB && window.NB.Graph && window.NB.Analyzer && window.NB.Render)), true);
});
await ok('初始空画布 + 暂无数据', async () => {
  assert.equal(await state(() => window.NB.Graph.state.nodes.length), 0);
  assert.ok((await page.textContent('#dataState')).includes('暂无数据'));
});

console.log('\n[2] 导入与提问');
await ok('点「样例数据」→ 79 行 × 23 列 + 1 个数据入口节点', async () => {
  await page.click('#btnSample'); await wait(180);
  assert.equal(await state(() => window.NB.Graph.state.nodes.length), 1);
  assert.ok((await page.textContent('#dataState')).includes('79 行 · 23 列'));
});
await ok('提问「各品牌对局人次排名如何？」→ 节点 2', async () => {
  await page.fill('#q', '各品牌对局人次排名如何？');
  await page.click('#ask'); await wait(200);
  assert.equal(await state(() => window.NB.Graph.state.nodes.length), 2);
});
await ok('详情面板含 308,956 / 86% / 数据版本 / 口径', async () => {
  const t = await page.textContent('#detailBody');
  assert.ok(t.includes('308,956'), '缺少榜首数值');
  assert.ok(t.includes('86%'), '缺少头部集中度');
  assert.ok(t.includes('数据版本'), '缺少 spec 数据版本');
  assert.ok(t.includes('口径'), '缺少 spec 口径');
});
await ok('节点同时存 spec + result + rawAnswer', async () => {
  const n = await state(() => {
    const a = window.NB.Graph.state.nodes.filter(x => x.type === 'question')[0];
    return { spec: !!a.spec.caliber, result: !!a.result.conclusion, raw: !!a.rawAnswer, hash: a.datasetHash };
  });
  assert.deepEqual([n.spec, n.result, n.raw, !!n.hash], [true, true, true, true]);
});
await page.screenshot({ path: path.join(SHOTS, '02_after_query.png') });
await ok('第二个问题形成分支 → 节点 3', async () => {
  await page.fill('#q', '渠道转化率对比');
  await page.click('#ask'); await wait(200);
  assert.equal(await state(() => window.NB.Graph.state.nodes.length), 3);
});

console.log('\n[3] 多选汇总与拓扑');
await ok('勾选 2 个分析节点 → 重心提问框出现', async () => {
  await page.locator('.node [data-act="check"]').nth(1).click();
  await page.locator('.node [data-act="check"]').nth(2).click();
  await wait(150);
  assert.equal(await state(() => window.NB.Graph.state.selected.length), 2);
  assert.equal(await page.isVisible('#floatAsk'), true);
});
await ok('重心提问框定位在选中节点几何重心附近', async () => {
  const d = await state(() => {
    const s = window.NB.Graph.state, ns = s.selected.map(window.NB.Graph.findNode).filter(Boolean);
    const cx = ns.reduce((a, n) => a + n.x + 120, 0) / ns.length;
    const f = document.getElementById('floatAsk');
    return Math.abs((parseFloat(f.style.left) + 150) - cx);
  });
  assert.ok(d < 260, '重心偏差 ' + d);
});
await ok('提交交叉分析 → 节点 4 且 parentIds 长度 2（多入边）', async () => {
  await page.fill('#faQ', '趋势变化是否与渠道结构有关？');
  await page.click('#floatAsk [data-act="cross"]'); await wait(220);
  const r = await state(() => {
    const s = window.NB.Graph.state;
    const c = s.nodes.filter(n => n.type === 'cross')[0];
    return { total: s.nodes.length, parents: c ? c.parentIds.length : 0, inbound: c ? s.edges.filter(e => e.to === c.id).length : 0 };
  });
  assert.equal(r.total, 4);
  assert.equal(r.parents, 2);
  assert.equal(r.inbound, 2);
});
await page.screenshot({ path: path.join(SHOTS, '03_after_merge.png') });
await ok('Ctrl+Z 撤销汇总 → 节点回到 3', async () => {
  await undo();
  assert.equal(await state(() => window.NB.Graph.state.nodes.length), 3);
});
await ok('重做一次汇总以继续后续交互', async () => {
  const checks = page.locator('.node [data-act="check"]');
  const selected = await state(() => window.NB.Graph.state.selected.length);
  if (selected < 2) { await checks.nth(1).click(); await checks.nth(2).click(); }
  await wait(150);
  await page.fill('#faQ', '趋势变化是否与渠道结构有关？');
  await page.click('#floatAsk [data-act="cross"]'); await wait(220);
  assert.equal(await state(() => window.NB.Graph.state.nodes.length), 4);
});

console.log('\n[4] 连线编辑器、持久化、视图');
await ok('点连线 → 关系改为「冲突」并保存', async () => {
  await page.locator('#edges path.edge').first().dispatchEvent('click'); await wait(150);
  assert.equal(await page.isVisible('#modal'), true);
  await page.click('#modal [data-rel="冲突"]'); await wait(100);
  await page.click('#modal [data-mb="2"]'); await wait(180);
  assert.equal(await state(() => window.NB.Graph.state.edges.some(e => e.rel === '冲突')), true);
});
await ok('Ctrl+Z 回滚连线修改', async () => {
  await undo();
  assert.equal(await state(() => window.NB.Graph.state.edges.some(e => e.rel === '冲突')), false);
});
await ok('localStorage 已落盘 v2 图', async () => {
  const r = await state(() => { const x = localStorage.getItem('nb_node_graph_v2'); return x ? JSON.parse(x).v : 0; });
  assert.equal(r, 2);
});
await ok('缩放按钮改变画布比例', async () => {
  const before = await page.textContent('#zoomVal');
  await page.click('#zoomIn'); await wait(100);
  assert.notEqual(await page.textContent('#zoomVal'), before);
});
await ok('搜索定位不报错', async () => {
  await page.fill('#search', '品牌');
  await page.press('#search', 'Enter'); await wait(120);
  assert.equal(await state(() => window.NB.Graph.state.nodes.length), 4);
});

console.log('\n[5] 文章核心功能补测');
await ok('节点复制 / 删除', async () => {
  const before = await state(() => window.NB.Graph.state.nodes.length);
  await page.locator('.node [data-act="copy"]').first().click(); await wait(150);
  assert.equal(await state(() => window.NB.Graph.state.nodes.length), before + 1);
  await page.locator('.node [data-act="del"]').last().click(); await wait(150);
  assert.equal(await state(() => window.NB.Graph.state.nodes.length), before);
});
await ok('一键整理（全量重排）不改变节点数', async () => {
  const before = await state(() => window.NB.Graph.state.nodes.length);
  await page.click('#btnTidy'); await wait(150);
  assert.equal(await state(() => window.NB.Graph.state.nodes.length), before);
});
await ok('对话内容拖入画布 → 生成节点且保留原始上下文', async () => {
  const before = await state(() => window.NB.Graph.state.nodes.length);
  await page.evaluate(() => {
    const tag = document.querySelector('.drag-tag');
    const dt = new DataTransfer();
    tag.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true }));
    document.getElementById('canvasWrap').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  });
  await wait(160);
  const r = await state(() => {
    const s = window.NB.Graph.state, n = s.nodes[s.nodes.length - 1];
    return { count: s.nodes.length, raw: n.rawAnswer, hasSpec: !!n.spec };
  });
  assert.equal(r.count, before + 1);
  assert.ok(r.raw.length > 10);
  assert.equal(r.hasSpec, true);
});
await ok('连线文字备注可写入并保存', async () => {
  await page.locator('#edges path.edge').first().dispatchEvent('click'); await wait(120);
  await page.fill('#modal #edNote', '口径存疑，需确认');
  await page.click('#modal [data-mb="2"]'); await wait(160);
  assert.equal(await state(() => window.NB.Graph.state.edges.some(e => e.note === '口径存疑，需确认')), true);
});
await ok('多选 → 分组（容器引用，原节点不删）', async () => {
  const ids = await state(() => {
    const s = window.NB.Graph.state;
    const two = s.nodes.filter(n => n.type === 'question').slice(0, 2).map(n => n.id);
    s.selected = [];
    two.forEach(id => window.NB.Graph.toggleSelect(id));
    return two;
  });
  await wait(150);
  assert.equal(await page.isVisible('#floatAsk'), true);
  await page.click('#floatAsk [data-act="group"]'); await wait(120);
  await page.fill('#modal #gTitle', '渠道与品牌');
  await page.click('#modal [data-mb="1"]'); await wait(180);
  const r = await state(ids2 => ({
    groups: window.NB.Graph.state.groups.length,
    alive: ids2.every(id => !!window.NB.Graph.findNode(id))
  }), ids);
  assert.equal(r.groups, 1);
  assert.equal(r.alive, true);
});
await ok('多选 → 融合（销毁性 + 归档）→ Ctrl+Z 恢复', async () => {
  const before = await state(() => window.NB.Graph.state.nodes.length);
  const ids = await state(() => {
    const s = window.NB.Graph.state;
    const two = s.nodes.filter(n => n.type === 'question').slice(0, 2).map(n => n.id);
    s.selected = [];
    two.forEach(id => window.NB.Graph.toggleSelect(id));
    return two;
  });
  await wait(150);
  await page.click('#floatAsk [data-act="fuse"]'); await wait(120);
  await page.click('#modal [data-mb="2"]'); await wait(200);
  const r = await state(ids2 => {
    const s = window.NB.Graph.state, f = s.nodes.filter(n => n.type === 'fused')[0];
    return { count: s.nodes.length, archived: f ? f.archivedRaw.length : 0, alive: ids2.some(id => !!window.NB.Graph.findNode(id)) };
  }, ids);
  assert.equal(r.count, before - 1);
  assert.equal(r.archived, 2);
  assert.equal(r.alive, false);
  await undo();
  assert.equal(await state(() => window.NB.Graph.state.nodes.length), before);
});
await ok('详情「重新计算」用当前 spec 复算并升版本', async () => {
  await page.evaluate(() => {
    const n = window.NB.Graph.state.nodes.filter(x => x.type === 'question' && x.result)[0];
    window.NB.Graph.setActive(n.id);
  });
  await wait(120);
  const before = await state(() => window.NB.Graph.findNode(window.NB.Graph.state.active).version);
  await page.click('#detailBody [data-act="recompute"]'); await wait(180);
  const after = await state(() => window.NB.Graph.findNode(window.NB.Graph.state.active).version);
  assert.equal(after, before + 1);
});
await ok('记忆 / 分析引擎弹窗可打开关闭', async () => {
  await page.click('#btnMemory'); await wait(100);
  assert.equal(await page.isVisible('#modal'), true);
  await page.click('#modal [data-mb="0"]'); await wait(100);
  await page.click('#btnEngine'); await wait(100);
  assert.ok((await page.textContent('#modal')).includes('parseIntent'));
  await page.click('#modal [data-mb="0"]'); await wait(100);
  assert.equal(await page.isVisible('#modal'), false);
});
await ok('整图导出含 spec / result / rawAnswer', async () => {
  const j = await state(() => window.NB.Graph.export());
  assert.ok(j.includes('"spec"') && j.includes('"result"') && j.includes('"rawAnswer"'));
  assert.equal(JSON.parse(j).v, 2);
});

console.log('\n[5.5] 新手引导 / 一键演示 / 示例问题');
await ok('清除标记后刷新 → 引导重新自动出现', async () => {
  await page.evaluate(() => {
    localStorage.removeItem('nb_guide_seen_v1');
    localStorage.removeItem('nb_node_graph_v2');
  });
  await page.reload({ waitUntil: 'load' }); await wait(300);
  assert.equal(await page.isVisible('#guide'), true);
  assert.equal(await state(() => window.NB.Graph.state.nodes.length), 0);
});
await ok('「一键跑一遍演示」→ 3 节点 / 选中 2 个 / 紫框出现', async () => {
  await page.click('#guide [data-g="demo"]'); await wait(320);
  const r = await state(() => ({
    nodes: window.NB.Graph.state.nodes.length,
    sel: window.NB.Graph.state.selected.length,
    rows: document.getElementById('dataState').textContent,
    types: window.NB.Graph.state.nodes.map(n => n.type)
  }));
  assert.equal(r.nodes, 3, 'nodes=' + r.nodes);
  assert.equal(r.sel, 2, 'selected=' + r.sel);
  assert.ok(r.types.includes('data') && r.types.filter(t => t === 'question').length === 2);
  assert.ok(r.rows.includes('79 行 · 23 列'));
  assert.equal(await page.isVisible('#floatAsk'), true);
  assert.ok((await page.textContent('#guide')).includes('交叉分析'));
});
await page.screenshot({ path: path.join(SHOTS, '04_guide_demo.png') });
await ok('完成引导 → 记住不再自动弹；刷新后图仍在', async () => {
  await page.click('#guide [data-g="done"]'); await wait(120);
  assert.equal(await page.isVisible('#guide'), false);
  await page.reload({ waitUntil: 'load' }); await wait(300);
  assert.equal(await page.isVisible('#guide'), false);
  assert.equal(await state(() => window.NB.Graph.state.nodes.length), 3);
});
await ok('点示例问题「品牌占比」→ 第 4 个节点且是饼图', async () => {
  await page.click('#quickAsk [data-q="各品牌对局人次占比"]'); await wait(240);
  const r = await state(() => {
    const s = window.NB.Graph.state, n = s.nodes[s.nodes.length - 1];
    return { count: s.nodes.length, chart: n.result && n.result.chart, q: n.question };
  });
  assert.equal(r.count, 4);
  assert.equal(r.chart, 'pie');
  assert.equal(r.q, '各品牌对局人次占比');
});
await ok('顶部「? 说明」可随时重开引导', async () => {
  await page.click('#btnHelp'); await wait(120);
  assert.equal(await page.isVisible('#guide'), true);
  assert.ok((await page.textContent('#guide')).includes('载入数据'));
  await page.click('#guideX'); await wait(100);
  assert.equal(await page.isVisible('#guide'), false);
});

console.log('\n[6] 零外部请求 / 零 JS 报错 / 非空白像素');
await ok('外部网络请求 = 0', () => assert.equal(external.length, 0, external.join(', ')));
await ok('JS 报错 = 0', () => assert.equal(errors.length, 0, errors.join(' | ')));
await ok('截图非空白像素比例 > 2%', () => {
  const p = path.join(SHOTS, '03_after_merge.png');
  const buf = fs.readFileSync(p);
  assert.ok(buf.length > 15000, '截图过小 ' + buf.length);
  const s = pngStats(buf);
  assert.ok(s.ratio > 0.02, 'ratio=' + s.ratio + ' ' + JSON.stringify(s));
  console.log('        截图 ' + s.w + '×' + s.h + '，非背景像素 ' + (s.ratio * 100).toFixed(1) + '%');
});
await ok('最长行 < 100000 字符（防模块静默解析失败白屏）', () => {
  const lines = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').split(/\r?\n/);
  const max = Math.max(...lines.map(l => l.length));
  assert.ok(max < 100000, 'max=' + max);
});

await browser.close();
console.log('\n' + pass + ' passed / ' + fail + ' failed');
if (fail) process.exit(1);
