/*
 * 彩智 · 智能选号助手
 * bets.js —— 复式 / 胆拖的注数、金额与号码组合展开
 */
(function (global) {
  'use strict';

  var CONFIG = global.LotteryData.CONFIG;

  function combinations(n, k) {
    if (!Number.isInteger(n) || !Number.isInteger(k)) return 0;
    if (n < 0 || k < 0 || k > n) return 0;
    k = Math.min(k, n - k);
    var result = 1;
    for (var i = 1; i <= k; i++) {
      result = (result * (n - k + i)) / i;
    }
    return Math.round(result);
  }

  function isInt(n) { return Number.isInteger(n); }

  function checkNums(nums, max, label) {
    var errors = [];
    if (!Array.isArray(nums)) return [label + '格式错误'];
    var seen = {};
    nums.forEach(function (n) {
      if (!isInt(n) || n < 1 || n > max) errors.push(label + ' ' + n + ' 超出范围（01-' + pad2(max) + '）');
      else if (seen[n]) errors.push(label + ' ' + pad2(n) + ' 重复');
      else seen[n] = true;
    });
    return errors;
  }

  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  function normalizeMode(mode) {
    return mode === 'single' ? 'compound' : (mode === 'danTuo' ? 'danTuo' : 'compound');
  }

  /**
   * 校验一组选号定义。
   * selection: { mode: 'compound'|'danTuo'|'single', red, blue, dan, tuo }
   * @returns {{ ok:boolean, errors:string[], mode:string }}
   */
  function validate(key, selection) {
    var cfg = CONFIG[key];
    var errors = [];
    if (!cfg || !selection) return { ok: false, errors: ['彩种或选号为空'], mode: 'compound' };

    var mode = normalizeMode(selection.mode);
    var red = (selection.red || []).slice();
    var blue = (selection.blue || []);
    var dan = (selection.dan || []).slice();
    var tuo = (selection.tuo || []).slice();

    errors = errors.concat(checkNums(red, cfg.red.max, cfg.red.label));
    errors = errors.concat(checkNums(blue, cfg.blue.max, cfg.blue.label));

    if (blue.length < cfg.blue.pick) {
      errors.push(cfg.blue.label + '至少选择 ' + cfg.blue.pick + ' 个');
    }

    if (mode === 'compound') {
      if (red.length < cfg.red.pick) {
        errors.push(cfg.red.label + '至少选择 ' + cfg.red.pick + ' 个');
      }
    } else {
      errors = errors.concat(checkNums(dan, cfg.red.max, '胆码'));
      errors = errors.concat(checkNums(tuo, cfg.red.max, '拖码'));
      if (dan.length < 1) errors.push('胆码至少选择 1 个');
      if (dan.length > cfg.red.pick - 1) errors.push('胆码最多选择 ' + (cfg.red.pick - 1) + ' 个');
      if (tuo.length < cfg.red.pick - dan.length) {
        errors.push('拖码至少选择 ' + Math.max(cfg.red.pick - dan.length, 0) + ' 个');
      }
      var overlap = dan.filter(function (n) { return tuo.indexOf(n) >= 0; });
      if (overlap.length) errors.push('胆码与拖码不能重复：' + overlap.map(pad2).join('、'));
    }

    return { ok: errors.length === 0, errors: errors, mode: mode };
  }

  /**
   * 计算注数与金额。
   * @returns {{ ok, errors, mode, redCombos, blueCombos, total, cost, price }}
   */
  function count(key, selection) {
    var cfg = CONFIG[key];
    var validation = validate(key, selection);
    if (!validation.ok) {
      return {
        ok: false, errors: validation.errors, mode: validation.mode,
        redCombos: 0, blueCombos: 0, total: 0, cost: 0, price: cfg ? cfg.price : 2
      };
    }

    var mode = validation.mode;
    var redCombos;
    if (mode === 'danTuo') {
      redCombos = combinations(selection.tuo.length, cfg.red.pick - selection.dan.length);
    } else {
      redCombos = combinations(selection.red.length, cfg.red.pick);
    }
    var blueCombos = combinations(selection.blue.length, cfg.blue.pick);
    var total = redCombos * blueCombos;

    return {
      ok: true,
      errors: [],
      mode: mode,
      redCombos: redCombos,
      blueCombos: blueCombos,
      total: total,
      cost: total * cfg.price,
      price: cfg.price
    };
  }

  /* ------------------------- 组合展开 ------------------------- */

  function combinationsOf(arr, k, limit) {
    var result = [];
    if (k <= 0) return [arr.slice(0, 0)];
    if (arr.length < k) return result;

    var max = limit || Infinity;
    var idx = [];
    for (var i = 0; i < k; i++) idx.push(i);

    while (true) {
      result.push(idx.map(function (i) { return arr[i]; }).sort(function (a, b) { return a - b; }));
      if (result.length >= max) break;

      var pos = k - 1;
      while (pos >= 0 && idx[pos] === arr.length - k + pos) pos--;
      if (pos < 0) break;
      idx[pos]++;
      for (var j = pos + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
    }
    return result;
  }

  /**
   * 展开成所有单注。
   * @param {number} [limit] 生成上限，默认 2000；超过上限时返回空 bets 并标记 truncated
   * @returns {{ bets:Array<{red:number[],blue:number[]}>, total:number, truncated:boolean }}
   */
  function expand(key, selection, limit) {
    var cfg = CONFIG[key];
    var max = limit || 2000;
    var counted = count(key, selection);
    if (!counted.ok) return { bets: [], total: 0, truncated: false, errors: counted.errors };

    var mode = counted.mode;
    var reds;
    if (mode === 'danTuo') {
      var dan = selection.dan.slice().sort(function (a, b) { return a - b; });
      var rest = combinationsOf(selection.tuo, cfg.red.pick - dan.length, max);
      reds = rest.map(function (combo) {
        return dan.concat(combo).sort(function (a, b) { return a - b; });
      });
    } else {
      reds = combinationsOf(selection.red, cfg.red.pick, max);
    }
    var blues = combinationsOf(selection.blue, cfg.blue.pick, max);

    var bets = [];
    outer:
    for (var i = 0; i < reds.length; i++) {
      for (var j = 0; j < blues.length; j++) {
        if (bets.length >= max) break outer;
        bets.push({ red: reds[i].slice(), blue: blues[j].slice() });
      }
    }

    return { bets: bets, total: counted.total, truncated: counted.total > bets.length, errors: [] };
  }

  /**
   * 收藏/追号记录的注数金额（单式也走复式算法，注数为 1）。
   */
  function countFavorite(key, favorite) {
    if (!favorite) return { ok: false, total: 0, cost: 0, errors: ['收藏为空'] };
    var selection = {
      mode: favorite.mode === 'danTuo' ? 'danTuo' : 'compound',
      red: favorite.red || [],
      blue: favorite.blue || [],
      dan: favorite.dan || [],
      tuo: favorite.tuo || []
    };
    return count(key, selection);
  }

  global.LotteryBets = {
    combinations: combinations,
    combinationsOf: combinationsOf,
    validate: validate,
    count: count,
    expand: expand,
    countFavorite: countFavorite,
    pad2: pad2
  };
})(window);
