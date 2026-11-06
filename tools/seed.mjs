import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'sample_79x23.csv');

let seed = 20261106;
function rnd() { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }
function pick(a) { return a[Math.floor(rnd() * a.length) % a.length]; }
function ri(a, b) { return a + Math.floor(rnd() * (b - a + 1)); }

const brands = [
  { name: '品牌A-电竞酒店', cat: '电竞酒店', rows: 20, total: 308956 },
  { name: '品牌C-饮料', cat: '饮料', rows: 17, total: 219969 },
  { name: '品牌D-茶饮', cat: '茶饮', rows: 15, total: 188594 },
  { name: '品牌B-数码回收', cat: '数码回收', rows: 12, total: 83912 },
  { name: '品牌F-甜品', cat: '甜品', rows: 7, total: 22898 },
  { name: '品牌G-饮品', cat: '饮品', rows: 5, total: 8307 },
  { name: '品牌E-烘焙', cat: '烘焙', rows: 3, total: 4451 }
];

function split(total, n) {
  const w = Array.from({ length: n }, () => 0.55 + rnd());
  const sum = w.reduce((a, b) => a + b, 0);
  const v = w.map(x => Math.max(1, Math.round(total * x / sum)));
  v[n - 1] += total - v.reduce((a, b) => a + b, 0);
  return v;
}

const columns = ['赛事ID', '日期', '品牌名称', '品类', '渠道', '城市', '对局人次', '报名人数', '转化率', '客单价', '曝光量', '点击量', '成本', '收入', '评分', '是否新客', '时段', '设备', '年龄段', '性别', '活动类型', '备注', '批次'];
const channels = ['线上投放', '门店自然流量', '社群裂变', '异业合作', '搜索直达'];
const cities = ['深圳', '广州', '上海', '北京', '成都', '杭州'];
const periods = ['工作日白天', '工作日晚间', '周末白天', '周末晚间'];
const devices = ['手机', '平板', '桌面端'];
const ages = ['18-24', '25-30', '31-40', '41+'];
const acts = ['常规赛', '主题赛', '联名赛', '快闪赛'];

const rows = [];
let idx = 1;
for (const b of brands) {
  const chunks = split(b.total, b.rows);
  for (let k = 0; k < b.rows; k++) {
    const day = new Date(Date.UTC(2026, 6, 1) + ri(0, 91) * 86400000);
    const date = day.toISOString().slice(0, 10);
    const games = chunks[k];
    const signup = Math.round(games * (1.4 + rnd() * 0.9));
    const conv = Math.round((games / signup) * 1000) / 10;
    const exposure = signup * ri(6, 14);
    const clicks = Math.round(exposure * (0.06 + rnd() * 0.12));
    const price = Math.round(28 + rnd() * 120);
    const cost = Math.round(clicks * (0.4 + rnd() * 1.6));
    const revenue = Math.round(games * price * (0.7 + rnd() * 0.5));
    const note = (idx === 3) ? '重点复盘,"口径待确认"' : (rnd() > 0.82 ? '异常波动,已复核' : '正常');
    rows.push([
      'E' + String(idx).padStart(4, '0'), date, b.name, b.cat, pick(channels), pick(cities),
      games, signup, conv, price, exposure, clicks, cost, revenue,
      Math.round((3.6 + rnd() * 1.4) * 10) / 10, rnd() > 0.62 ? '是' : '否',
      pick(periods), pick(devices), pick(ages), rnd() > 0.5 ? '男' : '女', pick(acts), note, 'Q3-' + ri(1, 4)
    ]);
    idx++;
  }
}

function cell(v) {
  const s = String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
const csv = [columns.map(cell).join(','), ...rows.map(r => r.map(cell).join(','))].join('\n');
fs.writeFileSync(OUT, '\uFEFF' + csv, 'utf8');

const sum = {};
rows.forEach(r => { sum[r[2]] = (sum[r[2]] || 0) + Number(r[6]); });
console.log('SEED OK  ' + OUT);
console.log('  行数 ' + rows.length + ' / 列数 ' + columns.length);
Object.keys(sum).forEach(k => console.log('  ' + k + ': ' + sum[k].toLocaleString('zh-CN')));
