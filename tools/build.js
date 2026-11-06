const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const OUT = path.join(ROOT, 'index.html');

const shell = fs.readFileSync(path.join(SRC, 'shell.html'), 'utf8');
const css = fs.readFileSync(path.join(SRC, 'style.css'), 'utf8');
const files = fs.readdirSync(SRC).filter(f => /^\d+_.*\.js$/.test(f)).sort();
const csv = fs.readFileSync(path.join(ROOT, 'data', 'sample_79x23.csv'), 'utf8').replace(/^\uFEFF/, '');
const sampleJs = '/* ==== sample data inlined (file:// cannot fetch local files) ==== */\nNB.SAMPLE_CSV = ' + JSON.stringify(csv) + ';';
const parts = files.map(f => '/* ==== ' + f + ' ==== */\n' + fs.readFileSync(path.join(SRC, f), 'utf8'));
parts.splice(1, 0, sampleJs);
const js = parts.join('\n\n');

const html = shell
  .replace('/*__CSS__*/', () => css)
  .replace('/*__JS__*/', () => js);

const errors = [];
if (html.indexOf('/*__CSS__*/') >= 0 || html.indexOf('/*__JS__*/') >= 0) errors.push('模板占位符未替换');

const lines = html.split(/\r?\n/);
let longest = 0, longestAt = 0;
lines.forEach((l, i) => { if (l.length > longest) { longest = l.length; longestAt = i + 1; } });
if (longest > 100000) errors.push('最长行 ' + longest + ' 字符 @line ' + longestAt + '（>100000 会导致 wcsc/babel 静默解析失败）');

const external = [];
lines.forEach((l, i) => {
  if (/https?:\/\//.test(l)) external.push('line ' + (i + 1) + ': 外部 URL');
  if (/<script[^>]*\bsrc\s*=/i.test(l)) external.push('line ' + (i + 1) + ': 外部 script');
  if (/@import/i.test(l)) external.push('line ' + (i + 1) + ': CSS @import');
  if (/\bimport\s*\{/.test(l)) external.push('line ' + (i + 1) + ': ES module import');
});
if (external.length) errors.push('发现外部依赖:\n  ' + external.slice(0, 10).join('\n  '));

if (errors.length) {
  console.error('BUILD FAILED\n- ' + errors.join('\n- '));
  process.exit(1);
}

fs.writeFileSync(OUT, html, 'utf8');
console.log('BUILD OK');
console.log('  模块: ' + files.join(' → '));
console.log('  产物: ' + OUT);
console.log('  字节: ' + Buffer.byteLength(html, 'utf8'));
console.log('  行数: ' + lines.length + '，最长行 ' + longest + ' 字符');
console.log('  外部请求: 0，ES module: 0');
