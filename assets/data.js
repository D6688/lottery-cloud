/*
 * 彩智 · 智能选号助手
 * data.js —— 彩种配置 + 示例历史开奖数据（本地生成，仅供功能演示）
 *
 * 说明：示例数据由固定随机种子生成，旨在让冷热分析、遗漏统计有可视化效果，
 *      并非真实开奖结果。正式使用请通过「导入数据」粘贴真实历史开奖。
 */
(function (global) {
  'use strict';

  /* ---------------------------- 彩种配置 ---------------------------- */

  var CONFIG = {
    ssq: {
      key: 'ssq',
      name: '双色球',
      colors: ['red', 'blue'],
      red: { key: 'red', label: '红球', max: 33, pick: 6 },
      blue: { key: 'blue', label: '蓝球', max: 16, pick: 1 },
      price: 2,
      startDate: '2023-01-03',
      dateSteps: [2, 3, 2], // 二、四、日
      schedule: '每周二、四、日 21:15 开奖',
      prizeTable: [
        { name: '一等奖', amount: '浮动（约 500 万）', test: function (r, b) { return r === 6 && b === 1; } },
        { name: '二等奖', amount: '浮动', test: function (r, b) { return r === 6 && b === 0; } },
        { name: '三等奖', amount: '3,000 元', test: function (r, b) { return r === 5 && b === 1; } },
        { name: '四等奖', amount: '200 元', test: function (r, b) { return (r === 5 && b === 0) || (r === 4 && b === 1); } },
        { name: '五等奖', amount: '10 元', test: function (r, b) { return (r === 4 && b === 0) || (r === 3 && b === 1); } },
        { name: '六等奖', amount: '5 元', test: function (r, b) { return b === 1 && r <= 2; } }
      ]
    },
    dlt: {
      key: 'dlt',
      name: '大乐透',
      colors: ['red', 'blue'],
      red: { key: 'red', label: '前区', max: 35, pick: 5 },
      blue: { key: 'blue', label: '后区', max: 12, pick: 2 },
      price: 2,
      startDate: '2023-01-02',
      dateSteps: [2, 3, 2], // 一、三、六
      schedule: '每周一、三、六 21:25 开奖',
      prizeTable: [
        { name: '一等奖', amount: '浮动（约 1000 万）', test: function (r, b) { return r === 5 && b === 2; } },
        { name: '二等奖', amount: '浮动', test: function (r, b) { return r === 5 && b === 1; } },
        { name: '三等奖', amount: '10,000 元', test: function (r, b) { return r === 5 && b === 0; } },
        { name: '四等奖', amount: '3,000 元', test: function (r, b) { return r === 4 && b === 2; } },
        { name: '五等奖', amount: '300 元', test: function (r, b) { return r === 4 && b === 1; } },
        { name: '六等奖', amount: '200 元', test: function (r, b) { return r === 3 && b === 2; } },
        { name: '七等奖', amount: '100 元', test: function (r, b) { return r === 4 && b === 0; } },
        { name: '八等奖', amount: '15 元', test: function (r, b) { return (r === 3 && b === 1) || (r === 2 && b === 2); } },
        { name: '九等奖', amount: '5 元', test: function (r, b) {
          return (r === 3 && b === 0) || (r === 1 && b === 2) || (r === 2 && b === 1) || (r === 0 && b === 2);
        } }
      ]
    }
  };

  var KEYS = ['ssq', 'dlt'];

  /* ---------------------------- 工具函数 ---------------------------- */

  function pad(n, width) {
    var s = String(n);
    while (s.length < width) s = '0' + s;
    return s;
  }

  function pad2(n) { return pad(n, 2); }

  // mulberry32：小而稳定的可复现伪随机数生成器
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function parseDate(str) {
    var p = String(str).split('-');
    return Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  }

  function addDays(ts, days) { return ts + days * 86400000; }

  function fmtDate(ts) {
    var d = new Date(ts);
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
  }

  // 本地上开奖数据“最新在前”，界面与统计都按这个约定
  function sortNewestFirst(draws) {
    return draws.slice().sort(function (a, b) {
      if (a.date && b.date && a.date !== b.date) return a.date < b.date ? 1 : -1;
      return String(b.issue).localeCompare(String(a.issue));
    });
  }

  // 按权重不放回抽样，返回升序号码数组
  function weightedSample(rnd, weights, k) {
    var pool = [];
    var total = 0;
    for (var i = 0; i < weights.length; i++) {
      var w = weights[i] > 0 ? weights[i] : 0.0001;
      pool.push({ num: i + 1, w: w });
      total += w;
    }
    var out = [];
    for (var j = 0; j < k && pool.length; j++) {
      var r = rnd() * total;
      var acc = 0;
      var chosen = pool.length - 1;
      for (var p = 0; p < pool.length; p++) {
        acc += pool[p].w;
        if (r <= acc) { chosen = p; break; }
      }
      out.push(pool[chosen].num);
      total -= pool[chosen].w;
      pool.splice(chosen, 1);
    }
    return out.sort(function (a, b) { return a - b; });
  }

  /* ------------------------- 示例开奖数据生成 ------------------------- */

  var SAMPLE_DRAW_COUNT = 120;

  function makeSample(key) {
    var cfg = CONFIG[key];
    var rnd = mulberry32(key === 'ssq' ? 20230103 : 20230102);

    // 每个号码一个固定“体质权重”，让示例数据里自然出现偏热/偏冷的号码
    var redWeights = [];
    for (var i = 0; i < cfg.red.max; i++) redWeights.push(0.45 + rnd() * 1.9);
    var blueWeights = [];
    for (var j = 0; j < cfg.blue.max; j++) blueWeights.push(0.5 + rnd() * 1.8);

    var ts = parseDate(cfg.startDate);
    var seqByYear = {};
    var draws = [];

    for (var n = 0; n < SAMPLE_DRAW_COUNT; n++) {
      var d = new Date(ts);
      var year = d.getUTCFullYear();
      seqByYear[year] = (seqByYear[year] || 0) + 1;
      draws.push({
        issue: String(year) + pad(seqByYear[year], 3),
        date: fmtDate(ts),
        red: weightedSample(rnd, redWeights, cfg.red.pick),
        blue: weightedSample(rnd, blueWeights, cfg.blue.pick)
      });
      ts = addDays(ts, cfg.dateSteps[n % cfg.dateSteps.length]);
    }

    return draws.reverse(); // 最新在前
  }

  var SAMPLE = {};
  KEYS.forEach(function (key) { SAMPLE[key] = makeSample(key); });

  function getSample(key) {
    return JSON.parse(JSON.stringify(SAMPLE[key]));
  }

  /* ----------------------------- 校验/解析 ----------------------------- */

  function isValidDraw(key, draw) {
    var cfg = CONFIG[key];
    if (!cfg || !draw) return false;
    return checkColor(draw.red, cfg.red) && checkColor(draw.blue, cfg.blue);
  }

  function checkColor(nums, color) {
    if (!Array.isArray(nums) || nums.length !== color.pick) return false;
    var seen = {};
    for (var i = 0; i < nums.length; i++) {
      var n = nums[i];
      if (typeof n !== 'number' || !isFinite(n) || n % 1 !== 0) return false;
      if (n < 1 || n > color.max) return false;
      if (seen[n]) return false;
      seen[n] = true;
    }
    return true;
  }

  /**
   * 解析导入的文本。支持格式（每行一期，逗号/空格/制表符均可）：
   *   2023120,2023-10-05,01,05,12,18,23,29,07
   *   2023120 01 05 12 18 23 29 07
   *   2023-10-05,01,05,12,18,23,29,07     （无期号时自动编号）
   * 返回 { draws, skipped, errors }
   */
  function parseImport(key, text) {
    var cfg = CONFIG[key];
    var total = cfg.red.pick + cfg.blue.pick;
    var lines = String(text || '').split(/\r?\n/);
    var draws = [];
    var skipped = 0;
    var firstError = '';
    var autoSeq = 0;

    lines.forEach(function (rawLine) {
      var line = rawLine.trim();
      if (!line || /^[#/]/.test(line)) return; // 空行与注释

      var dateMatch = line.match(/(20\d{2})\s*[-\/年.]\s*(\d{1,2})\s*[-\/月.]\s*(\d{1,2})/);
      var date = '';
      if (dateMatch) {
        date = dateMatch[1] + '-' + pad2(dateMatch[2]) + '-' + pad2(dateMatch[3]);
        line = line.replace(dateMatch[0], ' ');
      }

      var nums = (line.match(/\d+/g) || []).map(Number);
      if (nums.length < total) { skipped++; if (!firstError) firstError = rawLine; return; }

      // 行内可能混有序号、期号、销售额等多余数字：
      // 从前往后尝试几个起始位置，选第一组能构成合法号码的数字。
      var red = null;
      var blue = null;
      var startUsed = -1;
      var maxStart = Math.min(4, nums.length - total);
      for (var start = 0; start <= maxStart; start++) {
        var candidateRed = nums.slice(start, start + cfg.red.pick).sort(function (a, b) { return a - b; });
        var candidateBlue = nums.slice(start + cfg.red.pick, start + total).sort(function (a, b) { return a - b; });
        if (isValidDraw(key, { red: candidateRed, blue: candidateBlue })) {
          red = candidateRed;
          blue = candidateBlue;
          startUsed = start;
          break;
        }
      }

      if (!red) {
        skipped++;
        if (!firstError) firstError = rawLine;
        return;
      }

      var issue = startUsed >= 1 ? String(nums[startUsed - 1]) : '';

      autoSeq++;
      draws.push({
        issue: issue || ('导入' + pad(autoSeq, 3)),
        date: date,
        red: red,
        blue: blue
      });
    });

    return { draws: sortNewestFirst(draws), skipped: skipped, firstError: firstError };
  }

  /**
   * 合并新旧开奖数据（按期号去重，新数据优先），返回最新在前。
   */
  function mergeDraws(existing, incoming, limit) {
    var map = {};
    var issues = [];

    function keep(draw) {
      if (!draw || !draw.issue) return;
      if (!map[draw.issue]) issues.push(draw.issue);
      map[draw.issue] = draw; // 后写入的（新抓到的）优先
    }

    (existing || []).forEach(keep);
    (incoming || []).forEach(keep);

    var merged = issues.map(function (issue) { return map[issue]; });
    merged.sort(function (a, b) {
      if (a.date && b.date && a.date !== b.date) return a.date < b.date ? 1 : -1;
      return String(b.issue).localeCompare(String(a.issue));
    });
    return limit ? merged.slice(0, limit) : merged;
  }

  global.LotteryData = {
    mergeDraws: mergeDraws,
    CONFIG: CONFIG,
    KEYS: KEYS,
    SAMPLE: SAMPLE,
    SAMPLE_DRAW_COUNT: SAMPLE_DRAW_COUNT,
    getSample: getSample,
    makeSample: makeSample,
    isValidDraw: isValidDraw,
    parseImport: parseImport,
    sortNewestFirst: sortNewestFirst,
    utils: { pad: pad, pad2: pad2, mulberry32: mulberry32, weightedSample: weightedSample, fmtDate: fmtDate }
  };
})(window);
