/*
 * 彩智 · 云端选号助手 —— 数据与算法测试
 * 运行：node tests/test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const sandbox = { window: {}, console };
vm.createContext(sandbox);
['assets/snapshot.js', 'assets/data.js', 'assets/analyzer.js', 'assets/bets.js', 'assets/generator.js'].forEach(function (file) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), sandbox, { filename: file });
});

const D = sandbox.window.LotteryData;
const A = sandbox.window.LotteryAnalyzer;
const G = sandbox.window.LotteryGenerator;
const B = sandbox.window.LotteryBets;
const SNAP = sandbox.window.CAIZHI_SNAPSHOT;

let passed = 0;
const failures = [];
function assert(cond, name) {
  if (cond) { passed++; return; }
  failures.push(name);
  console.error('  ✗ ' + name);
}
function section(title) { console.log('\n• ' + title); }

/* ============================ 云端快照 ============================ */
section('云端快照');
assert(SNAP && SNAP.draws, 'snapshot.js 存在');
assert(D.KEYS.length === 2, '彩种数量正确');
D.KEYS.forEach(function (key) {
  const list = SNAP.draws[key] || [];
  assert(list.length >= 100, key + ' 开奖数据不少于 100 期（当前 ' + list.length + '）');
  list.forEach(function (d, i) {
    assert(D.isValidDraw(key, d), key + ' 第 ' + i + ' 期号码合法');
    if (i > 0) assert(list[i - 1].date >= d.date, key + ' 数据按日期倒序');
    assert(/^\d{7}$/.test(d.issue), key + ' 期号格式正确');
    assert(d.red.join(',') === d.red.slice().sort(function (a, b) { return a - b; }).join(','), key + ' 红/前区升序');
  });
  assert(!!SNAP.updatedAt, '快照带更新时间');
  assert(!!SNAP.sources[key], key + ' 快照带数据来源');
});

const latestJson = JSON.parse(fs.readFileSync(path.join(root, 'data', 'latest.json'), 'utf8'));
assert(latestJson.draws.ssq.length === SNAP.draws.ssq.length, 'latest.json 与 snapshot.js 双色球期数一致');
assert(latestJson.draws.dlt.length === SNAP.draws.dlt.length, 'latest.json 与 snapshot.js 大乐透期数一致');

/* ============================ 分析 ============================ */
section('冷热 / 遗漏分析');
D.KEYS.forEach(function (key) {
  const c = D.CONFIG[key];
  [20, 30, 50, 100].forEach(function (win) {
    const a = A.analyze(key, SNAP.draws[key], win);
    assert(a.windowSize === Math.min(win, SNAP.draws[key].length), key + ' 窗口 ' + win + ' 生效');
    assert(a.red.length === c.red.max && a.blue.length === c.blue.max, key + ' 号码统计完整');
    assert(a.red.reduce(function (s, x) { return s + x.count; }, 0) === a.windowSize * c.red.pick, key + ' 红/前区出现次数总和正确');
    assert(a.red.every(function (s) { return s.gap >= 0 && s.heat >= 0; }), key + ' 遗漏/热度合法');
  });
});

/* ============================ 智能选号 ============================ */
section('智能选号');
Object.keys(G.STRATEGIES).forEach(function (strategy) {
  D.KEYS.forEach(function (key) {
    const a = A.analyze(key, SNAP.draws[key], 30);
    const res = G.generateSmart({ key: key, analysis: a, noteCount: 5, strategy: strategy, seed: 20261103 });
    assert(res.sets.length === 5, key + '/' + strategy + ' 注数正确');
    const seen = {};
    res.sets.forEach(function (set) {
      assert(D.isValidDraw(key, { red: set.red, blue: set.blue }), key + '/' + strategy + ' 号码合法');
      const sig = set.red.join(',') + '|' + set.blue.join(',');
      assert(!seen[sig], key + '/' + strategy + ' 注间不重复');
      seen[sig] = true;
      assert(set.structure.score >= 20 && set.structure.score <= 100, key + '/' + strategy + ' 结构评分');
    });
  });
});

const constrained = G.generateSmart({
  key: 'ssq', analysis: A.analyze('ssq', SNAP.draws.ssq, 30), noteCount: 5, strategy: 'hot',
  constraints: { oddEven: '3:3', bigSmall: '2:4', sumMin: 80, sumMax: 130, maxRun: 2 }, seed: 7
});
assert(constrained.sets.every(function (set) {
  const odd = set.red.filter(function (n) { return n % 2 === 1; }).length;
  const big = set.red.filter(function (n) { return n > 16.5; }).length;
  return odd === 3 && big === 2 && set.structure.sum >= 80 && set.structure.sum <= 130 && G.maxRunLength(set.red) <= 2;
}), '结构约束全部满足');

const random = G.generateRandom({ key: 'dlt', noteCount: 10 });
assert(random.sets.length === 10 && random.sets.every(function (s) {
  return D.isValidDraw('dlt', { red: s.red, blue: s.blue });
}), '随机选号合法');

/* ============================ 复式 / 胆拖 ============================ */
section('复式 / 胆拖');
assert(B.combinations(8, 6) === 28 && B.combinations(33, 6) === 1107568, '组合数计算正确');
const compound = B.count('ssq', { mode: 'compound', red: [1, 2, 3, 4, 5, 6, 7, 8], blue: [1, 2] });
assert(compound.ok && compound.total === 56 && compound.cost === 112, '双色球复式 56 注 / 112 元');
const dltCompound = B.count('dlt', { mode: 'compound', red: [1, 2, 3, 4, 5, 6, 7], blue: [1, 2, 3] });
assert(dltCompound.ok && dltCompound.total === 63 && dltCompound.cost === 126, '大乐透复式 63 注 / 126 元');
const danTuo = B.count('ssq', { mode: 'danTuo', dan: [1, 2], tuo: [3, 4, 5, 6, 7, 8], blue: [5] });
assert(danTuo.ok && danTuo.total === 15 && danTuo.cost === 30, '双色球胆拖 15 注 / 30 元');
const expanded = B.expand('ssq', { mode: 'danTuo', dan: [1, 2], tuo: [3, 4, 5, 6, 7, 8], blue: [5] }, 500);
assert(expanded.bets.length === 15 && expanded.bets.every(function (bet) {
  return D.isValidDraw('ssq', bet) && bet.red.indexOf(1) >= 0 && bet.red.indexOf(2) >= 0;
}), '胆拖展开正确');
const capped = B.expand('ssq', { mode: 'compound', red: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], blue: [1] }, 100);
assert(capped.total === 210 && capped.bets.length === 100 && capped.truncated, '超量展开截断正确');

/* ============================ 中奖核对 ============================ */
section('中奖核对');
const ssqDraw = { issue: 'test', date: '2026-11-01', red: [1, 2, 3, 4, 5, 6], blue: [7] };
assert(A.checkPrize('ssq', [1, 2, 3, 4, 5, 6], [7], ssqDraw).level === 1, '双色球一等奖');
assert(A.checkPrize('ssq', [1, 2, 3, 4, 5, 6], [8], ssqDraw).level === 2, '双色球二等奖');
assert(A.checkPrize('ssq', [1, 2, 3, 4, 5, 9], [7], ssqDraw).level === 3, '双色球三等奖');
assert(A.checkPrize('ssq', [1, 2, 9, 10, 11, 12], [7], ssqDraw).level === 6, '双色球六等奖');
assert(A.checkPrize('ssq', [9, 10, 11, 12, 13, 14], [8], ssqDraw).level === null, '双色球未中奖');
const dltDraw = { issue: 'test', date: '2026-11-02', red: [1, 2, 3, 4, 5], blue: [6, 7] };
assert(A.checkPrize('dlt', [1, 2, 3, 4, 5], [6, 7], dltDraw).level === 1, '大乐透一等奖');
assert(A.checkPrize('dlt', [1, 2, 3, 9, 10], [6, 8], dltDraw).level === 8, '大乐透八等奖');
assert(A.checkPrize('dlt', [1, 2, 9, 10, 11], [8, 9], dltDraw).level === null, '大乐透未中奖');

/* ============================ 导入 / 合并 ============================ */
section('导入与合并');
const imported = D.parseImport('ssq', '2026125,2026-11-01,01,05,12,18,23,29,07\n2026124 2026-10-30 02 06 13 19 24 30 08\nbad-line');
assert(imported.draws.length === 2 && imported.skipped === 1, '导入解析与跳过统计正确');
assert(D.mergeDraws(imported.draws, SNAP.draws.ssq, 300).length === SNAP.draws.ssq.length, '手动导入与云端数据合并去重');
const messy = D.parseImport('ssq', '1,2026125,2026-11-01,01,05,12,18,23,29,07,364308228');
assert(messy.draws.length === 1 && messy.draws[0].red.join() === '1,5,12,18,23,29', '兼容多余列导入');

/* ============================ 数据源备用解析 ============================ */
section('数据源备用解析');
const Sources = require(path.join(root, 'scripts', 'sources.js'));
const ssq500Sample = '<tbody><tr class="t_tr1"><!--<td>2</td>--><td>26128</td><td class="t_cfont2">05</td><td class="t_cfont2">06</td><td class="t_cfont2">10</td><td class="t_cfont2">25</td><td class="t_cfont2">27</td><td class="t_cfont2">30</td><td class="t_cfont4">11</td><td class="t_cfont4">&nbsp;</td><td>1,174,385,127</td><td>4</td><td>10,000,000</td><td>161</td><td>175,266</td><td>442,016,354</td><td>2026-11-08</td></tr></tbody>';
const parsed500 = Sources.parseSsq500Html(ssq500Sample);
assert(parsed500.length === 1, '500 双色球备用解析出行数');
assert(parsed500[0].issue === '2026128' && parsed500[0].date === '2026-11-08', '500 双色球备用解析期号/日期');
assert(parsed500[0].red.join(',') === '5,6,10,25,27,30' && parsed500[0].blue.join(',') === '11', '500 双色球备用解析号码');

/* ============================ 汇总 ============================ */
console.log('\n──────────────────────────────');
console.log(failures.length === 0
  ? '✅ 全部通过：' + passed + ' 项断言'
  : '❌ ' + failures.length + ' 项失败 / 共 ' + (passed + failures.length) + ' 项');
if (failures.length) {
  console.error('\n失败项：\n- ' + failures.join('\n- '));
  process.exit(1);
}
