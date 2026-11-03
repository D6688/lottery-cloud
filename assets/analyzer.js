/*
 * 彩智 · 智能选号助手
 * analyzer.js —— 冷热、遗漏、频次分析 + 中奖核对
 */
(function (global) {
  'use strict';

  var LotteryData = global.LotteryData;
  var CONFIG = LotteryData.CONFIG;

  var LABELS = {
    hot: { key: 'hot', text: '热号' },
    warm: { key: 'warm', text: '温号' },
    cold: { key: 'cold', text: '冷号' }
  };

  function round2(n) { return Math.round(n * 100) / 100; }

  function mean(arr) {
    if (!arr.length) return 0;
    var sum = 0;
    for (var i = 0; i < arr.length; i++) sum += arr[i];
    return sum / arr.length;
  }

  function labelOf(heat) {
    if (heat >= 1.2) return 'hot';
    if (heat <= 0.8) return 'cold';
    return 'warm';
  }

  function buildStats(color, windowDraws, allDraws) {
    var windowSize = windowDraws.length;
    var expected = windowSize ? (windowSize * color.pick) / color.max : 0;
    var stats = [];

    for (var num = 1; num <= color.max; num++) {
      var count = 0;
      for (var i = 0; i < windowDraws.length; i++) {
        if (windowDraws[i][color.key].indexOf(num) >= 0) count++;
      }

      // 当前遗漏：从最新一期往前数，多少期没有出现（用全量数据，避免窗口外号码漏统计）
      var gap = allDraws.length;
      var positions = [];
      for (var j = 0; j < allDraws.length; j++) {
        if (allDraws[j][color.key].indexOf(num) >= 0) {
          positions.push(j);
          if (gap === allDraws.length) gap = j;
        }
      }

      var intervals = [];
      for (var k = 1; k < positions.length; k++) intervals.push(positions[k] - positions[k - 1]);
      var avgGap = intervals.length ? mean(intervals) : color.max / color.pick;
      var maxGap = intervals.length ? Math.max.apply(null, intervals) : gap;
      if (gap > maxGap) maxGap = gap;

      var heat = expected > 0 ? count / expected : 0;
      var label = labelOf(heat);
      var frozen = gap >= Math.max(avgGap * 2, color.pick * 4);
      if (frozen && label === 'warm') label = 'cold';

      stats.push({
        num: num,
        count: count,
        heat: round2(heat),
        gap: gap,
        avgGap: round2(avgGap),
        maxGap: maxGap,
        label: label,
        frozen: frozen
      });
    }

    return stats;
  }

  function byHeatDesc(a, b) {
    if (b.heat !== a.heat) return b.heat - a.heat;
    if (b.count !== a.count) return b.count - a.count;
    return a.gap - b.gap;
  }

  function byGapDesc(a, b) {
    if (b.gap !== a.gap) return b.gap - a.gap;
    return a.heat - b.heat;
  }

  /**
   * 分析一组开奖数据。
   * @param {string} key       彩种 key
   * @param {Array}  draws     开奖数据（最新在前）
   * @param {number} windowSize 统计最近多少期
   */
  function analyze(key, draws, windowSize) {
    var cfg = CONFIG[key];
    var all = draws || [];
    var size = Math.min(windowSize || 30, all.length);
    var win = all.slice(0, size);

    var red = buildStats(cfg.red, win, all);
    var blue = buildStats(cfg.blue, win, all);

    return {
      key: key,
      windowSize: size,
      available: all.length,
      latest: all[0] || null,
      earliest: win.length ? win[win.length - 1] : null,
      red: red,
      blue: blue,
      summary: summarize(red, blue)
    };
  }

  function summarize(red, blue) {
    var hotList = red.filter(function (s) { return s.label === 'hot'; }).sort(byHeatDesc);
    var coldList = red.filter(function (s) { return s.label === 'cold'; }).sort(byGapDesc);
    var gaps = red.map(function (s) { return s.gap; });
    var maxGapStat = red.slice().sort(byGapDesc)[0] || null;

    return {
      redHot: hotList.map(function (s) { return s.num; }),
      redCold: coldList.map(function (s) { return s.num; }),
      redWarm: red.filter(function (s) { return s.label === 'warm'; }).length,
      hotCount: hotList.length,
      coldCount: coldList.length,
      avgGap: round2(mean(gaps)),
      maxGap: maxGapStat ? maxGapStat.gap : 0,
      maxGapNum: maxGapStat ? maxGapStat.num : null,
      blueHot: blue.filter(function (s) { return s.label === 'hot'; }).sort(byHeatDesc).map(function (s) { return s.num; }),
      blueCold: blue.filter(function (s) { return s.label === 'cold'; }).sort(byGapDesc).map(function (s) { return s.num; })
    };
  }

  function top(list, n) {
    return list.slice().sort(byHeatDesc).slice(0, n);
  }

  function topCold(list, n) {
    return list.filter(function (s) { return s.label === 'cold'; })
      .sort(byGapDesc)
      .slice(0, n);
  }

  function labelText(label) {
    return (LABELS[label] || LABELS.warm).text;
  }

  /* --------------------------- 中奖核对 --------------------------- */

  function intersectCount(a, b) {
    var setB = {};
    for (var i = 0; i < b.length; i++) setB[b[i]] = true;
    var c = 0;
    for (var j = 0; j < a.length; j++) if (setB[a[j]]) c++;
    return c;
  }

  /**
   * 核对一注号码与一期开奖结果。
   * @returns {{redHits:number, blueHits:number, level:number|null, levelName:string, amount:string}}
   */
  function checkPrize(key, red, blue, draw) {
    var cfg = CONFIG[key];
    var redHits = intersectCount(red, draw.red);
    var blueHits = intersectCount(blue, draw.blue);
    var table = cfg.prizeTable;

    for (var i = 0; i < table.length; i++) {
      if (table[i].test(redHits, blueHits)) {
        return {
          redHits: redHits,
          blueHits: blueHits,
          level: i + 1,
          levelName: table[i].name,
          amount: table[i].amount
        };
      }
    }
    return { redHits: redHits, blueHits: blueHits, level: null, levelName: '未中奖', amount: '—' };
  }

  global.LotteryAnalyzer = {
    analyze: analyze,
    top: top,
    topCold: topCold,
    labelText: labelText,
    byHeatDesc: byHeatDesc,
    byGapDesc: byGapDesc,
    checkPrize: checkPrize,
    intersectCount: intersectCount,
    LABELS: LABELS
  };
})(window);
