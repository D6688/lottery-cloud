/*
 * 彩智 · 智能选号助手
 * generator.js —— 智能选号（多策略 + 结构约束）与随机选号
 */
(function (global) {
  'use strict';

  var LotteryData = global.LotteryData;
  var CONFIG = LotteryData.CONFIG;
  var mulberry32 = LotteryData.utils.mulberry32;
  var weightedSample = LotteryData.utils.weightedSample;

  var STRATEGIES = {
    hot: { key: 'hot', name: '热号追踪', desc: '近期出现频率越高的号码权重越大，跟随热度。' },
    cold: { key: 'cold', name: '冷号回补', desc: '长期未出、热度偏低的号码权重更大，等待回补。' },
    balanced: { key: 'balanced', name: '冷热均衡', desc: '按 热:温:冷 约 2:2:2 的配比组合号码。' },
    omission: { key: 'omission', name: '遗漏优先', desc: '当前遗漏期数越大权重越高，偏向久未开出。' },
    uniform: { key: 'uniform', name: '均匀覆盖', desc: '全号段等概率，不做冷热偏向，仅保证结构。' }
  };

  var DEFAULT_CONSTRAINTS = {
    oddEven: 'any',   // 'any' 或 "奇:偶"，例如 '3:3'
    bigSmall: 'any',  // 'any' 或 "大:小"
    sumMin: null,
    sumMax: null,
    maxRun: 'any'     // 'any' 或 1/2/3 连号最大长度
  };

  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

  function randomSeed() {
    return (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
  }

  /* --------------------------- 权重构建 --------------------------- */

  function buildWeights(analysis, color, strategy, colorKey) {
    var stats = analysis[colorKey];
    var expectedGap = color.max / color.pick;

    return stats.map(function (s) {
      switch (strategy) {
        case 'hot':
          return Math.pow(Math.max(s.heat, 0.04), 2.2);
        case 'cold':
          return Math.pow(1 + s.gap / expectedGap, 1.4) / Math.pow(s.heat + 0.3, 1.1);
        case 'omission':
          return Math.pow(1 + s.gap, 1.7);
        case 'balanced':
          return 1 + s.gap / expectedGap;
        default:
          return 1;
      }
    }).map(function (w) { return Math.max(w, 0.0005); });
  }

  function weightedPickFromStats(stats, k, rnd, weightOf) {
    var pool = stats.slice();
    var out = [];
    while (out.length < k && pool.length) {
      var total = 0;
      var weights = pool.map(function (s) { return Math.max(weightOf(s), 0.0005); });
      for (var i = 0; i < weights.length; i++) total += weights[i];

      var r = rnd() * total;
      var acc = 0;
      var idx = pool.length - 1;
      for (var j = 0; j < pool.length; j++) {
        acc += weights[j];
        if (r <= acc) { idx = j; break; }
      }
      out.push(pool[idx].num);
      pool.splice(idx, 1);
    }
    return out;
  }

  // 冷热均衡：先决定标签配比，再从各标签池中抽取
  function sampleByComposition(stats, k, rnd) {
    var pools = { hot: [], warm: [], cold: [] };
    stats.forEach(function (s) { pools[s.label].push(s); });

    var hotN = Math.max(1, Math.round(k * 0.34));
    var coldN = Math.max(1, Math.round(k * 0.25));
    var warmN = k - hotN - coldN;
    if (warmN < 0) { warmN = 0; hotN = Math.ceil(k * 0.5); coldN = k - hotN; }

    var wants = [
      { label: 'hot', need: hotN, weightOf: function (s) { return 1 + s.heat * 1.5; } },
      { label: 'warm', need: warmN, weightOf: function () { return 1; } },
      { label: 'cold', need: coldN, weightOf: function (s) { return 1 + s.gap; } }
    ];

    var chosen = [];
    var used = {};
    wants.forEach(function (want) {
      var picked = weightedPickFromStats(pools[want.label], want.need, rnd, want.weightOf);
      picked.forEach(function (n) { chosen.push(n); used[n] = true; });
    });

    if (chosen.length < k) {
      var rest = stats.filter(function (s) { return !used[s.num]; });
      var extra = weightedPickFromStats(rest, k - chosen.length, rnd, function () { return 1; });
      extra.forEach(function (n) { chosen.push(n); });
    }

    return chosen.sort(function (a, b) { return a - b; });
  }

  /* --------------------------- 结构判定 --------------------------- */

  function maxRunLength(nums) {
    var run = 1;
    var maxRun = 1;
    for (var i = 1; i < nums.length; i++) {
      if (nums[i] === nums[i - 1] + 1) run++;
      else run = 1;
      if (run > maxRun) maxRun = run;
    }
    return maxRun;
  }

  function structure(nums, max) {
    var k = nums.length;
    var sum = 0;
    var odd = 0;
    var big = 0;
    var zones = [0, 0, 0];
    for (var i = 0; i < nums.length; i++) {
      var n = nums[i];
      sum += n;
      if (n % 2 === 1) odd++;
      if (n > max / 2) big++;
      zones[Math.min(2, Math.floor((n - 1) / (max / 3)))]++;
    }

    var meanSum = (k * (max + 1)) / 2;
    var score = 100;
    score -= Math.min(28, (Math.abs(sum - meanSum) / meanSum) * 60);
    score -= Math.abs(odd - k / 2) * 5;
    score -= Math.abs(big - k / 2) * 3;
    zones.forEach(function (c) { score -= Math.abs(c - k / 3) * 3; });

    var run = maxRunLength(nums);
    score -= Math.max(0, run - 1) * 5;

    return {
      sum: sum,
      odd: odd,
      even: k - odd,
      big: big,
      small: k - big,
      span: nums[nums.length - 1] - nums[0],
      maxRun: run,
      score: clamp(Math.round(score), 20, 100)
    };
  }

  function satisfies(nums, constraints, color) {
    var c = constraints || DEFAULT_CONSTRAINTS;
    var k = nums.length;

    if (c.oddEven && c.oddEven !== 'any') {
      var wantOdd = Number(String(c.oddEven).split(':')[0]);
      var odd = nums.filter(function (n) { return n % 2 === 1; }).length;
      if (odd !== wantOdd) return false;
    }

    if (c.bigSmall && c.bigSmall !== 'any') {
      var wantBig = Number(String(c.bigSmall).split(':')[0]);
      var big = nums.filter(function (n) { return n > color.max / 2; }).length;
      if (big !== wantBig) return false;
    }

    if (c.sumMin != null && c.sumMin !== '' && !isNaN(Number(c.sumMin))) {
      var sum = nums.reduce(function (a, b) { return a + b; }, 0);
      if (sum < Number(c.sumMin)) return false;
    }
    if (c.sumMax != null && c.sumMax !== '' && !isNaN(Number(c.sumMax))) {
      var sum2 = nums.reduce(function (a, b) { return a + b; }, 0);
      if (sum2 > Number(c.sumMax)) return false;
    }

    if (c.maxRun && c.maxRun !== 'any') {
      if (maxRunLength(nums) > Number(c.maxRun)) return false;
    }

    return true;
  }

  function signature(red, blue) { return red.join(',') + '|' + blue.join(','); }

  /* --------------------------- 智能选号 --------------------------- */

  /**
   * @param {Object} opts
   * @param {string} opts.key         彩种
   * @param {Object} opts.analysis    LotteryAnalyzer.analyze 的结果
   * @param {number} [opts.noteCount] 注数
   * @param {string} [opts.strategy]  STRATEGIES 的 key
   * @param {Object} [opts.constraints]
   * @param {number} [opts.seed]      可选随机种子（便于测试复现）
   */
  function generateSmart(opts) {
    var key = opts.key;
    var analysis = opts.analysis;
    var cfg = CONFIG[key];
    var noteCount = clamp(Number(opts.noteCount) || 3, 1, 20);
    var strategy = STRATEGIES[opts.strategy] ? opts.strategy : 'hot';
    var constraints = Object.assign({}, DEFAULT_CONSTRAINTS, opts.constraints || {});
    var rnd = mulberry32(opts.seed != null ? opts.seed : randomSeed());

    var redWeights = strategy === 'balanced' ? null : buildWeights(analysis, cfg.red, strategy, 'red');
    var blueStrategy = strategy === 'balanced' ? 'hot' : strategy;
    var blueWeights = buildWeights(analysis, cfg.blue, blueStrategy, 'blue');

    function nextRed() {
      if (strategy === 'balanced') return sampleByComposition(analysis.red, cfg.red.pick, rnd);
      return weightedSample(rnd, redWeights, cfg.red.pick);
    }

    var sets = [];
    var seen = {};
    var relaxed = false;

    for (var i = 0; i < noteCount; i++) {
      var red = null;
      var achievedBlue = null;
      var satisfied = false;

      for (var attempt = 0; attempt < 600; attempt++) {
        var candidate = nextRed();
        candidate.sort(function (a, b) { return a - b; });
        if (!satisfies(candidate, constraints, cfg.red)) continue;

        var blueCandidate = weightedSample(rnd, blueWeights, cfg.blue.pick);
        blueCandidate.sort(function (a, b) { return a - b; });
        var sig = signature(candidate, blueCandidate);
        if (seen[sig] && attempt < 500) continue;

        red = candidate;
        achievedBlue = blueCandidate;
        satisfied = true;
        break;
      }

      if (!satisfied) {
        // 约束过严时降级：只保证号码合法，标记已放宽
        relaxed = true;
        var fallbackRed = nextRed();
        fallbackRed.sort(function (a, b) { return a - b; });
        var fallbackBlue = weightedSample(rnd, blueWeights, cfg.blue.pick);
        fallbackBlue.sort(function (a, b) { return a - b; });
        red = fallbackRed;
        achievedBlue = fallbackBlue;
      }

      var sigFinal = signature(red, achievedBlue);
      seen[sigFinal] = true;
      sets.push({
        red: red,
        blue: achievedBlue,
        structure: structure(red, cfg.red.max)
      });
    }

    return {
      key: key,
      strategy: strategy,
      strategyName: STRATEGIES[strategy].name,
      sets: sets,
      relaxed: relaxed,
      noteCount: noteCount
    };
  }

  /* --------------------------- 随机选号 --------------------------- */

  function generateRandom(opts) {
    var key = opts.key;
    var cfg = CONFIG[key];
    var noteCount = clamp(Number(opts.noteCount) || 3, 1, 20);
    var rnd = mulberry32(opts.seed != null ? opts.seed : randomSeed());
    var redWeights = new Array(cfg.red.max).fill(1);
    var blueWeights = new Array(cfg.blue.max).fill(1);

    var sets = [];
    var seen = {};

    for (var i = 0; i < noteCount; i++) {
      var red, blue, sig;
      for (var attempt = 0; attempt < 300; attempt++) {
        red = weightedSample(rnd, redWeights, cfg.red.pick).sort(function (a, b) { return a - b; });
        blue = weightedSample(rnd, blueWeights, cfg.blue.pick).sort(function (a, b) { return a - b; });
        sig = signature(red, blue);
        if (!seen[sig]) break;
      }
      seen[sig] = true;
      sets.push({ red: red, blue: blue, structure: structure(red, cfg.red.max) });
    }

    return { key: key, sets: sets, noteCount: noteCount };
  }

  global.LotteryGenerator = {
    STRATEGIES: STRATEGIES,
    DEFAULT_CONSTRAINTS: DEFAULT_CONSTRAINTS,
    generateSmart: generateSmart,
    generateRandom: generateRandom,
    structure: structure,
    maxRunLength: maxRunLength,
    satisfies: satisfies,
    buildWeights: buildWeights,
    sampleByComposition: sampleByComposition
  };
})(window);
