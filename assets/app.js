/*
 * 彩智 · 云端选号助手
 * app.js —— 手机端界面、交互、收藏与追号、PWA
 */
(function () {
  'use strict';

  var D = window.LotteryData;
  var Analyzer = window.LotteryAnalyzer;
  var Generator = window.LotteryGenerator;
  var Bets = window.LotteryBets;
  var CONFIG = D.CONFIG;
  var KEYS = D.KEYS;
  var DRAW_INFO = {
    ssq: { days: [0, 2, 4], time: '21:15' },
    dlt: { days: [1, 3, 6], time: '21:25' }
  };

  var FAV_KEY = 'caizhi.cloud.favorites.v1';
  var PLAN_KEY = 'caizhi.cloud.plans.v1';
  var MANUAL_KEY = 'caizhi.cloud.manual.v1';

  var snapshot = window.CAIZHI_SNAPSHOT || { draws: {}, updatedAt: '', sources: {} };
  var live = normalizeLive(snapshot);
  var manual = loadJSON(MANUAL_KEY) || { ssq: [], dlt: [] };
  var drawsMap = { ssq: [], dlt: [] };
  var analysisCache = {};

  var state = {
    tab: 'home',
    key: 'ssq',
    strategy: 'hot',
    notes: 3,
    results: null,
    resultsLabel: '',
    resultsStrategy: '',
    trendTab: 'analysis',
    trendDirty: true,
    matrixZone: 'red',
    matrixWindow: 30,
    favorites: loadJSON(FAV_KEY) || [],
    plans: loadJSON(PLAN_KEY) || [],
    pendingChaseFavId: null,
    compoundMode: 'compound',
    compound: { red: [], blue: [], dan: [], tuo: [] },
    compoundBets: null,
    installPrompt: null,
    offline: false,
    fetching: false,
    lastCheckAt: 0,
    loadedOnce: false
  };

  var toastTimer = null;

  /* ----------------------------- 基础工具 ----------------------------- */

  function $(id) { return document.getElementById(id); }

  function esc(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  function ball(n, color, size) {
    return '<span class="ball ball-' + color + ' ball-' + (size || 'sm') + '">' + pad2(n) + '</span>';
  }

  function balls(nums, color, size, hitSet) {
    return nums.map(function (n) {
      var hit = hitSet && hitSet[n] ? ' hit' : '';
      return '<span class="ball ball-' + color + ' ball-' + (size || 'sm') + hit + '">' + pad2(n) + '</span>';
    }).join('');
  }

  function money(yuanValue) {
    var v = Number(yuanValue) || 0;
    return '¥' + v.toFixed(2);
  }

  function toast(message) {
    var node = $('toast');
    node.textContent = message;
    node.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { node.classList.remove('show'); }, 2200);
  }

  function loadJSON(key) {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; }
  }

  function saveJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ }
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(function () { toast('已复制'); }, function () { toast(text); });
    } else {
      var ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); toast('已复制'); } catch (e) { toast(text); }
      document.body.removeChild(ta);
    }
  }

  function normalizeLive(json) {
    var result = { draws: { ssq: [], dlt: [] }, updatedAt: '', sources: {} };
    if (!json || typeof json !== 'object') return result;
    result.updatedAt = json.updatedAt || '';
    result.sources = json.sources || {};
    if (json.draws) {
      KEYS.forEach(function (key) {
        if (Array.isArray(json.draws[key])) result.draws[key] = json.draws[key].filter(function (d) {
          return d && d.issue && Array.isArray(d.red) && Array.isArray(d.blue);
        });
      });
    }
    return result;
  }

  function rebuildDraws() {
    KEYS.forEach(function (key) {
      drawsMap[key] = D.mergeDraws(live.draws[key] || [], manual[key] || [], 300);
    });
    analysisCache = {};
  }

  function drawsFor(key) { return drawsMap[key] || []; }

  function getAnalysis(key, windowSize) {
    var size = Math.min(windowSize || 30, drawsFor(key).length);
    var cacheKey = key + '|' + size;
    if (!analysisCache[cacheKey]) {
      analysisCache[cacheKey] = Analyzer.analyze(key, drawsFor(key), size);
    }
    return analysisCache[cacheKey];
  }

  function cfg() { return CONFIG[state.key]; }

  /* ----------------------------- 数据更新 ----------------------------- */

  function renderDataBadge() {
    var badge = $('dataBadge');
    var list = drawsFor(state.key);
    var latest = list[0];
    var win = drawWindowInfo(state.key);
    var liveNow = !!(win && win.inWindow) && !state.offline;

    badge.classList.toggle('is-live', liveNow);
    badge.classList.toggle('is-offline', state.offline);

    if (!latest) {
      badge.textContent = '暂无数据';
      return;
    }
    var date = latest.date ? latest.date.slice(5) : latest.issue;
    badge.textContent = '数据 ' + date + ' · ' + list.length + ' 期';
    badge.title = state.offline
      ? '当前离线数据，稍后自动重试'
      : ('来源：' + (live.sources[state.key] || '云端快照') +
        '，云端更新于 ' + (live.updatedAt ? new Date(live.updatedAt).toLocaleString('zh-CN', { hour12: false }) : '未知') +
        (state.lastCheckAt ? '，本机检查于 ' + fmtClock(state.lastCheckAt) : ''));
  }

  function refreshData(manualTrigger) {
    if (state.fetching) return Promise.resolve(false);
    state.fetching = true;
    var btn = $('refreshBtn');
    if (manualTrigger) btn.classList.add('spin');
    updateLiveStatus();

    var prevKey = state.key;
    var prevList = drawsFor(prevKey);
    var prevIssue = prevList[0] ? prevList[0].issue : '';
    var prevUpdated = live.updatedAt;

    return fetch('data/latest.json?t=' + Date.now(), { cache: 'no-store' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (json) {
        var next = normalizeLive(json);
        if (!next.draws.ssq.length && !next.draws.dlt.length) throw new Error('empty');

        var nextList = next.draws[prevKey] || [];
        var changed = next.updatedAt !== prevUpdated ||
          (nextList[0] ? nextList[0].issue !== prevIssue : false);

        live = next;
        state.offline = false;
        state.lastCheckAt = Date.now();
        rebuildDraws();

        if (!state.loadedOnce) {
          renderAll();
          state.loadedOnce = true;
        } else if (changed) {
          renderAll();
          flashLatest();
        } else {
          renderHeader();
          renderMine();
          updateLiveStatus();
        }

        if (changed && !manualTrigger) {
          var latest = drawsFor(prevKey)[0];
          toast('开奖号码已更新' + (latest ? '：第 ' + latest.issue + ' 期' : ''));
        }
        if (manualTrigger) toast(changed ? '开奖数据已更新' : '已是最新数据');
        return true;
      })
      .catch(function () {
        state.offline = true;
        state.lastCheckAt = Date.now();
        renderDataBadge();
        updateLiveStatus();
        if (manualTrigger) toast('刷新失败，正在使用离线数据');
        return false;
      })
      .then(function (ok) {
        state.fetching = false;
        if (manualTrigger) btn.classList.remove('spin');
        updateLiveStatus();
        return ok;
      });
  }

  function fmtClock(ts) {
    var d = new Date(ts);
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
  }

  function drawWindowInfo(key) {
    var info = DRAW_INFO[key];
    if (!info) return null;
    var now = new Date();
    if (info.days.indexOf(now.getDay()) < 0) return null;
    var hm = info.time.split(':');
    var draw = new Date(now.getFullYear(), now.getMonth(), now.getDate(), Number(hm[0]), Number(hm[1]), 0, 0);
    var start = draw.getTime() - 15 * 60 * 1000;
    var end = draw.getTime() + 120 * 60 * 1000;
    return {
      draw: draw,
      start: start,
      end: end,
      inWindow: now.getTime() >= start && now.getTime() <= end
    };
  }

  function nextDrawInfo(key) {
    var info = DRAW_INFO[key];
    if (!info) return null;
    var now = new Date();
    var names = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    for (var i = 0; i < 8; i++) {
      var d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
      if (info.days.indexOf(d.getDay()) < 0) continue;
      var hm = info.time.split(':');
      d.setHours(Number(hm[0]), Number(hm[1]), 0, 0);
      if (d.getTime() > now.getTime()) {
        var prefix = i === 0 ? '今天' : (i === 1 ? '明天' : names[d.getDay()]);
        return { label: prefix + ' ' + (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + info.time };
      }
    }
    return null;
  }

  function updateLiveStatus() {
    var bar = $('liveBar');
    if (!bar) return;
    var text = $('liveText');
    var check = $('liveCheck');
    var win = drawWindowInfo(state.key);
    var liveNow = !!(win && win.inWindow) && !state.offline;

    bar.classList.toggle('is-live', liveNow);
    $('dataBadge').classList.toggle('is-live', liveNow);

    if (state.fetching) {
      text.textContent = '正在检查最新开奖数据…';
    } else if (state.offline) {
      text.textContent = '网络异常，使用离线数据，稍后自动重试';
    } else if (liveNow) {
      text.textContent = '开奖追踪中 · 每 20 秒自动检查';
    } else {
      var next = nextDrawInfo(state.key);
      text.textContent = next ? '下期开奖：' + next.label : '等待下期开奖';
    }
    check.textContent = state.lastCheckAt ? '上次检查 ' + fmtClock(state.lastCheckAt) : '';
  }

  function flashLatest() {
    var card = document.querySelector('.latest-card');
    if (!card) return;
    card.classList.remove('flash');
    void card.offsetWidth;
    card.classList.add('flash');
    setTimeout(function () { card.classList.remove('flash'); }, 1600);
  }

  function startLiveTicker() {
    setInterval(function () {
      if (document.hidden) return;
      updateLiveStatus();
      var win = drawWindowInfo(state.key);
      var interval = win && win.inWindow ? 20000 : 300000;
      if (Date.now() - (state.lastCheckAt || 0) >= interval) refreshData(false);
    }, 5000);

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) return;
      updateLiveStatus();
      if (Date.now() - (state.lastCheckAt || 0) >= 60000) refreshData(false);
    });
  }

  /* ----------------------------- 顶栏 / 导航 ----------------------------- */

  function renderHeader() {
    Array.prototype.forEach.call(document.querySelectorAll('#lotterySwitch button'), function (btn) {
      btn.classList.toggle('active', btn.dataset.key === state.key);
    });
    renderDataBadge();
  }

  function switchTab(tab) {
    state.tab = tab;
    Array.prototype.forEach.call(document.querySelectorAll('.view'), function (view) {
      view.classList.toggle('active', view.id === 'view-' + tab);
    });
    Array.prototype.forEach.call(document.querySelectorAll('.tabbar button[data-tab]'), function (btn) {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (tab === 'trend') renderTrend();
    updateLiveStatus();
  }

  function renderAll() {
    renderHeader();
    renderHome();
    renderSelect();
    renderMine();
    if (state.tab === 'trend') renderTrend();
    updateLiveStatus();
    state.trendDirty = true;
  }

  /* ----------------------------- 首页 ----------------------------- */

  function renderHome() {
    var key = state.key;
    var c = CONFIG[key];
    var list = drawsFor(key);
    var latest = list[0];

    if (!latest) {
      $('latestIssue').textContent = '—';
      $('latestDate').textContent = '';
      $('latestBalls').innerHTML = '<span class="muted">暂无开奖数据</span>';
      $('latestCount').textContent = '—';
      $('latestSource').textContent = '—';
      $('homeHot').innerHTML = '';
      $('homeCold').innerHTML = '';
      $('recentDraws').innerHTML = '';
      return;
    }

    $('latestIssue').textContent = latest.issue;
    $('latestDate').textContent = latest.date || '';
    $('latestBalls').innerHTML = balls(latest.red, 'red', 'lg') +
      '<span class="ball-sep"></span>' + balls(latest.blue, 'blue', 'lg');
    $('latestCount').textContent = '共 ' + list.length + ' 期数据';
    $('latestSource').textContent = live.sources[key] || '云端数据';

    var a = getAnalysis(key, 30);
    var hot = Analyzer.top(a.red, 6);
    var cold = Analyzer.topCold(a.red, 6);

    $('homeHot').innerHTML = hot.map(function (s) {
      return '<span title="近30期出现 ' + s.count + ' 次 · 热度 ' + s.heat + '">' + ball(s.num, 'red', 'xs') + '</span>';
    }).join('') || '<span class="muted" style="font-size:10px">暂无热号</span>';

    $('homeCold').innerHTML = cold.map(function (s) {
      return '<span title="当前遗漏 ' + s.gap + ' 期">' + ball(s.num, 'blue', 'xs') + '</span>';
    }).join('') || '<span class="muted" style="font-size:10px">暂无冷号</span>';

    $('recentDraws').innerHTML = list.slice(0, 5).map(function (d) {
      return '<div class="recent-item">' +
        '<span class="issue">' + esc(d.issue) + '</span>' +
        '<span class="balls">' + balls(d.red, 'red', 'xs') + '<span class="ball-sep" style="height:14px"></span>' + balls(d.blue, 'blue', 'xs') + '</span>' +
        '<span class="date">' + esc(d.date || '') + '</span></div>';
    }).join('');
  }

  /* ----------------------------- 选号 ----------------------------- */

  function renderSelect() {
    var c = cfg();
    var strategies = Generator.STRATEGIES;
    $('strategyGrid').innerHTML = Object.keys(strategies).map(function (key) {
      var s = strategies[key];
      var icon = { hot: '🔥', cold: '❄️', balanced: '⚖️', omission: '⏳', uniform: '🎲' }[key] || '✨';
      return '<button type="button" class="strategy-card' + (state.strategy === key ? ' active' : '') + '" data-strategy="' + key + '">' +
        '<span class="s-icon">' + icon + '</span><b>' + s.name + '</b><span>' + s.desc + '</span></button>';
    }).join('');

    buildRatioOptions($('oddEven'), c.red.pick);
    buildRatioOptions($('bigSmall'), c.red.pick);
    renderResults();
  }

  function buildRatioOptions(select, pick) {
    var prev = select.value || 'any';
    var html = '<option value="any">不限</option>';
    for (var odd = 1; odd < pick; odd++) {
      html += '<option value="' + odd + ':' + (pick - odd) + '">' + odd + ':' + (pick - odd) + '</option>';
    }
    select.innerHTML = html;
    select.value = prev;
    if (!select.value) select.value = 'any';
  }

  function readConstraints() {
    var sumMin = $('sumMin').value === '' ? null : Number($('sumMin').value);
    var sumMax = $('sumMax').value === '' ? null : Number($('sumMax').value);
    if (sumMin != null && sumMax != null && sumMin > sumMax) {
      var tmp = sumMin; sumMin = sumMax; sumMax = tmp;
    }
    return {
      oddEven: $('oddEven').value || 'any',
      bigSmall: $('bigSmall').value || 'any',
      sumMin: sumMin,
      sumMax: sumMax,
      maxRun: $('maxRun').value || 'any'
    };
  }

  function renderResults() {
    var box = $('results');
    var sets = state.results;
    if (!sets || !sets.length) {
      $('resultsMeta').textContent = '尚未生成';
      box.innerHTML = '<div class="empty-state">选择策略后点击「智能生成号码」<br />支持结构约束与一键收藏</div>';
      return;
    }
    var c = cfg();
    $('resultsMeta').textContent = state.resultsLabel || (sets.length + ' 注');
    box.innerHTML = sets.map(function (set, i) {
      var st = set.structure || Generator.structure(set.red, c.red.max);
      var scoreClass = st.score >= 78 ? '' : (st.score >= 62 ? 'mid' : 'low');
      return '<div class="result-card">' +
        '<div class="result-top">' +
        '<span class="idx">' + (i + 1) + '</span>' +
        '<span class="balls">' + balls(set.red, 'red', 'xs') + '<span class="ball-sep" style="height:14px"></span>' + balls(set.blue, 'blue', 'xs') + '</span>' +
        '<span class="score ' + scoreClass + '">' + st.score + ' 分</span>' +
        '</div>' +
        '<div class="result-foot">' +
        '<span class="meta">和值 ' + st.sum + ' · 奇偶 ' + st.odd + ':' + st.even + ' · 大小 ' + st.big + ':' + st.small + ' · 跨度 ' + st.span + '</span>' +
        '<span class="result-actions">' +
        '<button type="button" class="mini-btn gold" data-fav-index="' + i + '">收藏</button>' +
        '<button type="button" class="mini-btn" data-copy-index="' + i + '">复制</button>' +
        '</span></div></div>';
    }).join('');
  }

  function generateSmart() {
    if (!drawsFor(state.key).length) { toast('暂无开奖数据'); return; }
    var a = getAnalysis(state.key, 30);
    var res = Generator.generateSmart({
      key: state.key,
      analysis: a,
      noteCount: state.notes,
      strategy: state.strategy,
      constraints: readConstraints()
    });
    state.results = res.sets;
    state.resultsStrategy = state.strategy;
    state.resultsLabel = res.strategyName + ' · ' + res.sets.length + ' 注' + (res.relaxed ? '（约束已放宽）' : '');
    renderResults();
    toast('已生成 ' + res.sets.length + ' 注');
  }

  function generateRandom(count) {
    if (!drawsFor(state.key).length) { toast('暂无开奖数据'); return; }
    var res = Generator.generateRandom({ key: state.key, noteCount: count || state.notes });
    state.results = res.sets;
    state.resultsStrategy = 'random';
    state.resultsLabel = '随机选号 · ' + res.sets.length + ' 注';
    renderResults();
  }

  function quickSmartOne() {
    state.strategy = 'hot';
    state.notes = 1;
    $('noteCount').value = '1';
    switchTab('select');
    generateSmart();
  }

  function quickRandomOne() {
    switchTab('select');
    generateRandom(1);
  }

  /* ----------------------------- 走势 ----------------------------- */

  function renderTrend() {
    state.trendDirty = false;
    Array.prototype.forEach.call(document.querySelectorAll('#trendTabs button'), function (btn) {
      btn.classList.toggle('active', btn.dataset.trend === state.trendTab);
    });
    $('trendAnalysis').hidden = state.trendTab !== 'analysis';
    $('trendMatrix').hidden = state.trendTab !== 'matrix';
    $('trendChart').hidden = state.trendTab !== 'chart';

    if (state.trendTab === 'analysis') renderAnalysisTab();
    else if (state.trendTab === 'matrix') renderMatrixTab();
    else renderChartTab();
  }

  function renderAnalysisTab() {
    var c = cfg();
    var a = getAnalysis(state.key, 30);
    $('analysisMeta').textContent = M2(c.name) + ' · 近 ' + a.windowSize + ' 期';
    $('redHeatmap').innerHTML = a.red.map(heatCell).join('');
    $('blueHeatmap').innerHTML = a.blue.map(heatCell).join('');

    $('hotRank').innerHTML = Analyzer.top(a.red, 6).map(function (s) {
      return '<div class="rank-item"><b>' + pad2(s.num) + '</b><span>出现 ' + s.count + ' 次</span>' +
        '<span class="rank-bar"><i style="width:' + Math.min(100, Math.round(s.heat * 45)) + '%"></i></span></div>';
    }).join('');

    $('coldRank').innerHTML = Analyzer.topCold(a.red, 6).map(function (s) {
      return '<div class="rank-item cold"><b>' + pad2(s.num) + '</b><span>遗漏 ' + s.gap + ' 期</span>' +
        '<span class="rank-bar"><i style="width:' + Math.min(100, Math.round(s.gap * 5)) + '%"></i></span></div>';
    }).join('');
  }

  function M2(text) { return text; }

  function heatCell(s) {
    return '<div class="heat-cell is-' + s.label + (s.frozen ? ' is-frozen' : '') + '" title="出现 ' + s.count + ' 次 · 遗漏 ' + s.gap + ' 期 · ' + (s.label === 'hot' ? '热号' : s.label === 'cold' ? '冷号' : '温号') + '">' +
      '<span class="n">' + pad2(s.num) + '</span><span class="c">' + s.count + '</span></div>';
  }

  function renderMatrixTab() {
    var c = cfg();
    var color = state.matrixZone === 'red' ? c.red : c.blue;
    var list = drawsFor(state.key).slice(0, state.matrixWindow);
    var a = getAnalysis(state.key, 30);
    $('matrixZone').value = state.matrixZone;
    $('matrixWindow').value = String(state.matrixWindow);
    $('matrixMeta').textContent = color.label + ' · 近 ' + list.length + ' 期';
    $('matrixChart').innerHTML = matrixSvg(list, color, a[state.matrixZone], state.matrixZone);
  }

  function matrixSvg(list, color, stats, zone) {
    if (!list.length) return '<div class="empty-line">暂无数据</div>';
    var cellW = 24, rowH = 21, left = 62, top = 24;
    var omitY = top + list.length * rowH + 18;
    var width = left + color.max * cellW + 10;
    var height = omitY + 18;
    var dotClass = zone === 'blue' ? 'chart-dot-blue' : 'chart-dot-red';
    var parts = ['<svg class="chart-svg" viewBox="0 0 ' + width + ' ' + height + '" width="' + width + '" height="' + height + '">'];

    for (var n = 1; n <= color.max; n++) {
      var cx = left + (n - 0.5) * cellW;
      parts.push('<text x="' + cx + '" y="' + (top - 9) + '" text-anchor="middle" class="chart-head">' + pad2(n) + '</text>');
      parts.push('<line x1="' + (left + (n - 1) * cellW) + '" x2="' + (left + (n - 1) * cellW) + '" y1="' + (top - 4) + '" y2="' + (top + list.length * rowH) + '" class="chart-grid" />');
    }

    list.forEach(function (draw, i) {
      var y = top + i * rowH;
      if (i % 2 === 1) {
        parts.push('<rect x="' + (left - 2) + '" y="' + y + '" width="' + (color.max * cellW + 4) + '" height="' + rowH + '" fill="rgba(255,255,255,.015)" />');
      }
      parts.push('<text x="' + (left - 8) + '" y="' + (y + rowH / 2 + 2.5) + '" text-anchor="end" class="chart-label">' + esc(draw.issue) + '</text>');
      draw[zone].forEach(function (num) {
        var hx = left + (num - 0.5) * cellW;
        var hy = y + rowH / 2;
        parts.push('<circle cx="' + hx + '" cy="' + hy + '" r="8" class="' + dotClass + '"><title>' + esc(draw.issue) + ' · ' + pad2(num) + '</title></circle>');
        parts.push('<text x="' + hx + '" y="' + (hy + 2.6) + '" text-anchor="middle" class="chart-num">' + pad2(num) + '</text>');
      });
    });

    parts.push('<line x1="' + (left - 6) + '" x2="' + (width - 8) + '" y1="' + (omitY - 10) + '" y2="' + (omitY - 10) + '" class="chart-axis" />');
    parts.push('<text x="' + (left - 8) + '" y="' + (omitY + 2) + '" text-anchor="end" class="chart-label">遗漏</text>');
    stats.forEach(function (s) {
      var ox = left + (s.num - 0.5) * cellW;
      parts.push('<text x="' + ox + '" y="' + (omitY + 2) + '" text-anchor="middle" class="' + (s.gap >= 10 ? 'chart-omit-hot' : 'chart-omit') + '">' + s.gap + '</text>');
    });
    parts.push('</svg>');
    return parts.join('');
  }

  function renderChartTab() {
    var c = cfg();
    var recent = drawsFor(state.key).slice(0, 30).reverse();
    if (!recent.length) {
      $('sumChart').innerHTML = '<div class="empty-line">暂无数据</div>';
      $('oddChart').innerHTML = '';
      return;
    }
    var sums = recent.map(function (d) {
      return { label: d.issue, value: d.red.reduce(function (x, y) { return x + y; }, 0) };
    });
    var sumValues = sums.map(function (d) { return d.value; });
    var mean = sumValues.reduce(function (x, y) { return x + y; }, 0) / sumValues.length;
    $('sumChart').innerHTML = lineChartSvg(sums, { stroke: '#ff5b6e', fill: 'rgba(255,91,110,.12)', ref: mean, refLabel: '均值 ' + Math.round(mean) });
    $('sumMeta').textContent = '近 ' + sums.length + ' 期 · 均值 ' + Math.round(mean) + ' · 范围 ' + Math.min.apply(null, sumValues) + '-' + Math.max.apply(null, sumValues);

    var odds = recent.map(function (d) {
      return { label: d.issue, value: d.red.filter(function (n) { return n % 2 === 1; }).length };
    });
    $('oddChart').innerHTML = lineChartSvg(odds, { stroke: '#ffcc66', fill: 'rgba(255,204,102,.1)', ref: c.red.pick / 2, refLabel: '均衡 ' + c.red.pick / 2 });
    $('oddMeta').textContent = '近 ' + odds.length + ' 期 · 奇数均值 ' + (odds.reduce(function (s, d) { return s + d.value; }, 0) / odds.length).toFixed(2) + ' 个';
  }

  function lineChartSvg(data, opts) {
    var W = 340, H = 160, L = 38, R = 12, T = 14, B = 22;
    var values = data.map(function (d) { return d.value; });
    var min = Math.min.apply(null, values);
    var max = Math.max.apply(null, values);
    if (opts.ref != null) { min = Math.min(min, opts.ref); max = Math.max(max, opts.ref); }
    if (max === min) { max += 1; min -= 1; }
    var pad = (max - min) * 0.15;
    min -= pad; max += pad;
    var innerW = W - L - R, innerH = H - T - B;
    var x = function (i) { return L + (data.length <= 1 ? innerW / 2 : innerW * i / (data.length - 1)); };
    var y = function (v) { return T + innerH - innerH * ((v - min) / (max - min)); };
    var parts = ['<svg class="chart-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img">'];

    for (var g = 0; g <= 4; g++) {
      var gv = min + (max - min) * g / 4;
      var gy = y(gv);
      parts.push('<line x1="' + L + '" x2="' + (W - R) + '" y1="' + gy.toFixed(1) + '" y2="' + gy.toFixed(1) + '" class="chart-grid" />');
      parts.push('<text x="' + (L - 6) + '" y="' + (gy + 2.5).toFixed(1) + '" text-anchor="end" class="chart-label">' + Math.round(gv) + '</text>');
    }

    if (opts.ref != null) {
      var ry = y(opts.ref);
      parts.push('<line x1="' + L + '" x2="' + (W - R) + '" y1="' + ry.toFixed(1) + '" y2="' + ry.toFixed(1) + '" stroke="rgba(255,204,102,.5)" stroke-dasharray="4 4" />');
      parts.push('<text x="' + (W - R) + '" y="' + (ry - 4).toFixed(1) + '" text-anchor="end" class="chart-label">' + esc(opts.refLabel || '') + '</text>');
    }

    var pts = data.map(function (d, i) { return x(i).toFixed(1) + ',' + y(d.value).toFixed(1); }).join(' ');
    var area = 'M ' + x(0).toFixed(1) + ' ' + (T + innerH) + ' L ' + data.map(function (d, i) {
      return x(i).toFixed(1) + ' ' + y(d.value).toFixed(1);
    }).join(' L ') + ' L ' + x(data.length - 1).toFixed(1) + ' ' + (T + innerH) + ' Z';
    parts.push('<path d="' + area + '" fill="' + opts.fill + '" />');
    parts.push('<polyline points="' + pts + '" fill="none" stroke="' + opts.stroke + '" stroke-width="2" stroke-linejoin="round" />');
    data.forEach(function (d, i) {
      parts.push('<circle cx="' + x(i).toFixed(1) + '" cy="' + y(d.value).toFixed(1) + '" r="2.4" fill="' + opts.stroke + '"><title>' + esc(d.label) + ' · ' + d.value + '</title></circle>');
    });
    var step = Math.max(1, Math.ceil(data.length / 8));
    data.forEach(function (d, i) {
      if (i % step === 0 || i === data.length - 1) {
        parts.push('<text x="' + x(i).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle" class="chart-label">' + esc(String(d.label).slice(-3)) + '</text>');
      }
    });
    parts.push('</svg>');
    return parts.join('');
  }

  /* ----------------------------- 收藏 ----------------------------- */

  function favoriteSignature(fav) {
    return [fav.key, fav.mode, (fav.red || []).join('-'), (fav.blue || []).join('-'),
      (fav.dan || []).join('-'), (fav.tuo || []).join('-')].join('|');
  }

  function addFavorite(selection, source) {
    var validation = Bets.validate(state.key, selection);
    if (!validation.ok) { toast(validation.errors[0]); return false; }
    var mode = selection.mode === 'danTuo' ? 'danTuo' : (selection.mode === 'single' ? 'single' : 'compound');
    var fav = {
      id: 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      key: state.key,
      mode: mode,
      red: (mode === 'danTuo' ? selection.dan.concat(selection.tuo) : selection.red).slice().sort(function (a, b) { return a - b; }),
      blue: selection.blue.slice().sort(function (a, b) { return a - b; }),
      dan: (selection.dan || []).slice().sort(function (a, b) { return a - b; }),
      tuo: (selection.tuo || []).slice().sort(function (a, b) { return a - b; }),
      source: source || '手动',
      createdAt: new Date().toISOString()
    };
    var sig = favoriteSignature(fav);
    if (state.favorites.some(function (f) { return favoriteSignature(f) === sig; })) {
      toast('已经收藏过这注号码');
      return false;
    }
    state.favorites.unshift(fav);
    if (state.favorites.length > 100) state.favorites.length = 100;
    saveJSON(FAV_KEY, state.favorites);
    renderMine();
    toast('已收藏');
    return true;
  }

  function deleteFavorite(id) {
    state.favorites = state.favorites.filter(function (f) { return f.id !== id; });
    saveJSON(FAV_KEY, state.favorites);
    renderMine();
    toast('已删除收藏');
  }

  function favText(fav) {
    var c = CONFIG[fav.key];
    if (fav.mode === 'danTuo') {
      return '胆拖 · 胆码 ' + fav.dan.map(pad2).join(' ') + '；拖码 ' + fav.tuo.map(pad2).join(' ') +
        '；' + c.blue.label + ' ' + fav.blue.map(pad2).join(' ');
    }
    if (fav.mode === 'compound') {
      return '复式 · ' + c.red.label + ' ' + fav.red.map(pad2).join(' ') + '；' + c.blue.label + ' ' + fav.blue.map(pad2).join(' ');
    }
    return c.red.label + ' ' + fav.red.map(pad2).join(' ') + '；' + c.blue.label + ' ' + fav.blue.map(pad2).join(' ');
  }

  function favSingleBet(fav) {
    var c = CONFIG[fav.key];
    if (fav.mode !== 'single') return null;
    if (fav.red.length !== c.red.pick || fav.blue.length !== c.blue.pick) return null;
    return { red: fav.red.slice(), blue: fav.blue.slice() };
  }

  /* ----------------------------- 追号 ----------------------------- */

  function renderPlans() {
    if (!state.plans.length) {
      $('planList').innerHTML = '<div class="empty-line">还没有追号计划<br />收藏号码后点「追号」即可创建</div>';
      return;
    }
    $('planList').innerHTML = state.plans.map(function (plan) {
      var c = CONFIG[plan.key];
      var counted = Bets.countFavorite(plan.key, plan.favorite || {});
      var issues = plan.issues || 10;
      var multiplier = plan.multiplier || 1;
      var perIssue = counted.ok ? counted.cost * multiplier : 0;
      var list = drawsFor(plan.key);
      var done = plan.startDate ? list.filter(function (d) { return d.date && d.date > plan.startDate; }).length : 0;
      done = Math.min(done, issues);
      var status = plan.status === 'paused' ? 'paused' : (done >= issues ? 'done' : 'active');
      var statusText = status === 'paused' ? '已暂停' : (status === 'done' ? '已完成' : '进行中');
      var progress = Math.round(done / issues * 100);
      return '<div class="plan-card">' +
        '<div class="plan-top"><span class="balls">' +
        plan.favorite.red.map(function (n) { return ball(n, 'red', 'xs'); }).join('') +
        '<span class="ball-sep" style="height:12px"></span>' +
        plan.favorite.blue.map(function (n) { return ball(n, 'blue', 'xs'); }).join('') +
        '</span><span class="plan-status ' + status + '">' + statusText + '</span></div>' +
        '<div class="plan-meta"><span>' + c.name + ' · 共 ' + (counted.ok ? counted.total : 0) + ' 注</span>' +
        '<span>起始 ' + esc(plan.startIssue || '—') + '</span><span>每期 ' + multiplier + ' 倍</span></div>' +
        '<div class="plan-progress"><i style="width:' + progress + '%"></i></div>' +
        '<div class="plan-meta"><span>进度 <b>' + done + ' / ' + issues + '</b> 期</span><span>单期 <b>' + money(perIssue) + '</b></span><span>预算 <b>' + money(perIssue * issues) + '</b></span></div>' +
        '<div class="plan-actions">' +
        (status !== 'done' ? '<button type="button" class="mini-btn" data-plan-action="toggle" data-id="' + plan.id + '">' + (status === 'paused' ? '继续' : '暂停') + '</button>' : '') +
        '<button type="button" class="mini-btn" data-plan-action="delete" data-id="' + plan.id + '">删除</button></div>' +
        '</div>';
    }).join('');
  }

  function openChase(favId) {
    var fav = state.favorites.filter(function (f) { return f.id === favId; })[0];
    if (!fav) return;
    var counted = Bets.countFavorite(fav.key, fav);
    if (!counted.ok) { toast('号码不完整，无法追号'); return; }
    state.pendingChaseFavId = favId;
    var c = CONFIG[fav.key];
    var modeLabel = fav.mode === 'danTuo' ? '胆拖' : (fav.mode === 'single' ? '单式' : '复式');
    $('chaseInfo').innerHTML = c.name + ' · ' + modeLabel + ' · 共 ' + counted.total + ' 注（单期 ' + money(counted.cost) + '）';
    updateChasePreview();
    $('chaseSheet').hidden = false;
  }

  function updateChasePreview() {
    var fav = state.favorites.filter(function (f) { return f.id === state.pendingChaseFavId; })[0];
    if (!fav) return;
    var counted = Bets.countFavorite(fav.key, fav);
    var issues = Number($('chaseIssues').value) || 10;
    var multiplier = Number($('chaseMultiplier').value) || 1;
    var per = counted.cost * multiplier;
    $('chasePreview').innerHTML = '每期 <b>' + counted.total + ' 注 × ' + multiplier + ' 倍 = ' + money(per) + '</b>，共 ' + issues + ' 期，预算合计 <b>' + money(per * issues) + '</b>。仅做本机记录，不会自动购买。';
  }

  function createPlan() {
    var fav = state.favorites.filter(function (f) { return f.id === state.pendingChaseFavId; })[0];
    if (!fav) return;
    var latest = drawsFor(fav.key)[0] || {};
    var plan = {
      id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      key: fav.key,
      favorite: { mode: fav.mode, red: fav.red.slice(), blue: fav.blue.slice(), dan: (fav.dan || []).slice(), tuo: (fav.tuo || []).slice() },
      issues: Number($('chaseIssues').value) || 10,
      multiplier: Number($('chaseMultiplier').value) || 1,
      startIssue: latest.issue || '',
      startDate: latest.date || '',
      status: 'active',
      createdAt: new Date().toISOString()
    };
    state.plans.unshift(plan);
    saveJSON(PLAN_KEY, state.plans);
    $('chaseSheet').hidden = true;
    renderMine();
    toast('追号计划已创建');
  }

  function planAction(action, id) {
    var plan = state.plans.filter(function (p) { return p.id === id; })[0];
    if (!plan) return;
    if (action === 'delete') {
      if (!window.confirm('删除这个追号计划？')) return;
      state.plans = state.plans.filter(function (p) { return p.id !== id; });
    } else if (action === 'toggle') {
      plan.status = plan.status === 'paused' ? 'active' : 'paused';
    }
    saveJSON(PLAN_KEY, state.plans);
    renderMine();
  }

  /* ----------------------------- 我的 ----------------------------- */

  function renderMine() {
    $('favCount').textContent = state.favorites.length + ' 注';
    $('planCount').textContent = state.plans.length + ' 个';
    $('mineSub').textContent = '收藏 ' + state.favorites.length + ' 注 · 追号 ' + state.plans.length + ' 个 · 仅存本机';
    $('dataStatus').textContent = state.offline
      ? '离线数据'
      : (live.updatedAt
        ? '更新 ' + (new Date(live.updatedAt).getMonth() + 1) + '/' + new Date(live.updatedAt).getDate() + ' ' + fmtClock(new Date(live.updatedAt).getTime())
        : '本地快照');

    var list = $('favList');
    if (!state.favorites.length) {
      list.innerHTML = '<div class="empty-line">还没有收藏，去「选号」生成后点击收藏</div>';
    } else {
      list.innerHTML = state.favorites.map(function (fav) {
        var single = favSingleBet(fav);
        var modeLabel = fav.mode === 'danTuo' ? '胆拖' : (fav.mode === 'compound' ? '复式' : '单式');
        return '<div class="fav-item">' +
          '<span class="balls">' + fav.red.map(function (n) { return ball(n, 'red', 'xs'); }).join('') +
          '<span class="ball-sep" style="height:12px"></span>' +
          fav.blue.map(function (n) { return ball(n, 'blue', 'xs'); }).join('') + '</span>' +
          '<span class="fav-meta">' + CONFIG[fav.key].name + ' · ' + modeLabel + '</span>' +
          '<div class="fav-actions">' +
          '<button type="button" class="mini-btn" data-fav-action="copy" data-id="' + fav.id + '">复制</button>' +
          (single ? '<button type="button" class="mini-btn" data-fav-action="check" data-id="' + fav.id + '">核对</button>' : '') +
          '<button type="button" class="mini-btn gold" data-fav-action="chase" data-id="' + fav.id + '">追号</button>' +
          '<button type="button" class="mini-btn" data-fav-action="delete" data-id="' + fav.id + '">删除</button>' +
          '</div></div>';
      }).join('');
    }
    renderPlans();
  }

  function favAction(action, id) {
    var fav = state.favorites.filter(function (f) { return f.id === id; })[0];
    if (!fav) return;
    if (action === 'delete') { deleteFavorite(id); return; }
    if (action === 'copy') { copyText(favText(fav)); return; }
    if (action === 'chase') { openChase(id); return; }
    if (action === 'check') {
      var bet = favSingleBet(fav);
      if (!bet) return;
      if (fav.key !== state.key) {
        state.key = fav.key;
        renderAll();
      }
      openCheck();
      $('checkInput').value = bet.red.map(pad2).join(' ') + ' ' + bet.blue.map(pad2).join(' ');
      runCheck();
    }
  }

  /* ----------------------------- 中奖核对 ----------------------------- */

  function openCheck(prefill) {
    var c = cfg();
    var list = drawsFor(state.key);
    $('checkInputLabel').textContent = c.red.label + ' ' + c.red.pick + ' 个 + ' + c.blue.label + ' ' + c.blue.pick + ' 个';
    $('checkInput').placeholder = prefill || (c.key === 'ssq' ? '01 05 12 18 23 29 07' : '03 09 15 22 31 04 11');
    $('checkIssue').innerHTML = list.slice(0, 80).map(function (d, i) {
      return '<option value="' + i + '">' + esc(d.issue) + (d.date ? ' · ' + esc(d.date) : '') + '</option>';
    }).join('');
    if (!list.length) $('checkIssue').innerHTML = '<option value="">暂无数据</option>';
    $('checkInput').value = prefill || '';
    $('checkResult').innerHTML = '';
    $('checkSheet').hidden = false;
  }

  function runCheck() {
    var c = cfg();
    var list = drawsFor(state.key);
    var idx = Number($('checkIssue').value);
    var draw = list[idx];
    if (!draw) { toast('请选择有效的开奖期号'); return; }
    var nums = ($('checkInput').value.match(/\d+/g) || []).map(Number);
    if (nums.length !== c.red.pick + c.blue.pick) {
      $('checkResult').innerHTML = '<div class="check-note">需要 ' + (c.red.pick + c.blue.pick) + ' 个号码（' + c.red.label + ' ' + c.red.pick + ' 个 + ' + c.blue.label + ' ' + c.blue.pick + ' 个），当前识别到 ' + nums.length + ' 个。</div>';
      return;
    }
    var red = nums.slice(0, c.red.pick).sort(function (a, b) { return a - b; });
    var blue = nums.slice(c.red.pick).sort(function (a, b) { return a - b; });
    if (!D.isValidDraw(state.key, { red: red, blue: blue })) {
      $('checkResult').innerHTML = '<div class="check-note">号码不合法，请检查范围与重复。</div>';
      return;
    }
    var result = Analyzer.checkPrize(state.key, red, blue, draw);
    var win = result.level != null;
    var drawRed = {}; draw.red.forEach(function (n) { drawRed[n] = true; });
    var betRed = {}; red.forEach(function (n) { betRed[n] = true; });
    var drawBlue = {}; draw.blue.forEach(function (n) { drawBlue[n] = true; });
    var betBlue = {}; blue.forEach(function (n) { betBlue[n] = true; });

    $('checkResult').innerHTML =
      '<div class="check-banner ' + (win ? 'win' : '') + '">' +
      '<div><div class="level">' + (win ? result.levelName : '未中奖') + '</div>' +
      '<div class="amount">' + (win ? '参考奖金：' + esc(result.amount) : '本注未达到最低奖级') + '</div></div>' +
      '<div class="hits">命中 ' + result.redHits + ' + ' + result.blueHits + '</div></div>' +
      '<div class="check-draw"><div class="check-draw-title">开奖 · ' + esc(draw.issue) + (draw.date ? ' · ' + esc(draw.date) : '') + '</div>' +
      '<div class="ball-row">' + balls(draw.red, 'red', 'sm', betRed) + '<span class="ball-sep"></span>' + balls(draw.blue, 'blue', 'sm', betBlue) + '</div></div>' +
      '<div class="check-draw"><div class="check-draw-title">我的号码</div>' +
      '<div class="ball-row">' + balls(red, 'red', 'sm', drawRed) + '<span class="ball-sep"></span>' + balls(blue, 'blue', 'sm', drawBlue) + '</div></div>' +
      '<div class="check-note">仅按命中个数参考核对，实际奖金以官方公布为准；历史开奖随机，不代表未来概率。</div>';
  }

  /* ----------------------------- 复式 / 胆拖 ----------------------------- */

  function compoundSelection() {
    var b = state.compound;
    if (state.compoundMode === 'danTuo') {
      return { mode: 'danTuo', dan: b.dan.slice(), tuo: b.tuo.slice(), red: b.dan.concat(b.tuo).sort(function (a, z) { return a - z; }), blue: b.blue.slice() };
    }
    return { mode: 'compound', red: b.red.slice(), blue: b.blue.slice() };
  }

  function openCompound() {
    state.compound = { red: [], blue: [], dan: [], tuo: [] };
    state.compoundMode = 'compound';
    state.compoundBets = null;
    renderCompound();
    $('compoundSheet').hidden = false;
  }

  function renderCompound() {
    var c = cfg();
    Array.prototype.forEach.call(document.querySelectorAll('#compoundMode button'), function (btn) {
      btn.classList.toggle('active', btn.dataset.mode === state.compoundMode);
    });
    var b = state.compound;
    var html = '';
    if (state.compoundMode === 'danTuo') {
      html += pickGroup('胆码', '必须出现的号码，选 1-' + (c.red.pick - 1) + ' 个', 'dan', b.dan, b.tuo, 'red');
      html += pickGroup('拖码', '与胆码搭配，胆码+拖码至少 ' + c.red.pick + ' 个', 'tuo', b.tuo, b.dan, 'red');
    } else {
      html += pickGroup('红球 / 前区', '至少选 ' + c.red.pick + ' 个', 'red', b.red, [], 'red');
    }
    html += pickGroup('蓝球 / 后区', '至少选 ' + c.blue.pick + ' 个', 'blue', b.blue, [], 'blue');
    $('compoundPickers').innerHTML = html;

    var counted = Bets.count(state.key, compoundSelection());
    if (counted.ok) {
      var lines = [];
      if (counted.mode === 'danTuo') {
        lines.push('胆码 ' + b.dan.length + ' + 拖码 ' + b.tuo.length + ' → C(' + b.tuo.length + ',' + (c.red.pick - b.dan.length) + ') = <b>' + counted.redCombos + '</b> 注');
      } else {
        lines.push(c.red.label + ' ' + b.red.length + ' → C(' + b.red.length + ',' + c.red.pick + ') = <b>' + counted.redCombos + '</b> 注');
      }
      lines.push(c.blue.label + ' ' + b.blue.length + ' → C(' + b.blue.length + ',' + c.blue.pick + ') = <b>' + counted.blueCombos + '</b> 注');
      lines.push('共 <b>' + counted.total + '</b> 注 · 金额 <b>' + money(counted.cost) + '</b>');
      $('compoundSummary').innerHTML = lines.join('<br />');
    } else {
      $('compoundSummary').innerHTML = '<span class="err">' + counted.errors.map(esc).join('<br />') + '</span>';
    }
    renderCompoundResults();
  }

  function pickGroup(title, hint, zone, selected, disabled, color) {
    var c = cfg();
    var max = zone === 'blue' ? c.blue.max : c.red.max;
    var cells = '';
    for (var n = 1; n <= max; n++) {
      var isSel = selected.indexOf(n) >= 0;
      var isDis = disabled.indexOf(n) >= 0;
      cells += '<button type="button" class="pick-cell' + (isSel ? ' selected' : '') + (zone === 'blue' ? ' blue' : '') + '"' +
        ' data-pick="' + zone + '" data-num="' + n + '"' + (isDis ? ' disabled' : '') + '>' + pad2(n) +
        (zone === 'dan' && isSel ? '<span class="dan-tag">胆</span>' : '') + '</button>';
    }
    return '<div class="pick-group"><div class="pick-head"><b>' + title + '</b><span>' + hint + '</span>' +
      '<span class="count">已选 ' + selected.length + '</span></div><div class="pick-grid pick-' + color + '">' + cells + '</div></div>';
  }

  function toggleCompound(zone, num) {
    var c = cfg();
    var b = state.compound;
    if (zone === 'red' || zone === 'blue') {
      var arr = zone === 'blue' ? b.blue : b.red;
      var i = arr.indexOf(num);
      if (i >= 0) arr.splice(i, 1); else arr.push(num);
      arr.sort(function (a, z) { return a - z; });
    } else {
      var target = zone === 'dan' ? b.dan : b.tuo;
      var other = zone === 'dan' ? b.tuo : b.dan;
      var idx = target.indexOf(num);
      if (idx >= 0) target.splice(idx, 1);
      else {
        if (zone === 'dan' && b.dan.length >= c.red.pick - 1) { toast('胆码最多选 ' + (c.red.pick - 1) + ' 个'); return; }
        var oi = other.indexOf(num);
        if (oi >= 0) other.splice(oi, 1);
        target.push(num);
      }
      b.dan.sort(function (a, z) { return a - z; });
      b.tuo.sort(function (a, z) { return a - z; });
    }
    state.compoundBets = null;
    renderCompound();
  }

  function generateCompound() {
    var counted = Bets.count(state.key, compoundSelection());
    if (!counted.ok) { toast(counted.errors[0]); return; }
    var expanded = Bets.expand(state.key, compoundSelection(), 200);
    state.compoundBets = { bets: expanded.bets, total: expanded.total, truncated: expanded.truncated };
    renderCompoundResults();
    toast('共 ' + expanded.total + ' 注' + (expanded.truncated ? '，展示前 200 注' : ''));
  }

  function renderCompoundResults() {
    var box = $('compoundResults');
    var res = state.compoundBets;
    if (!res) { box.innerHTML = ''; return; }
    box.innerHTML = res.bets.map(function (bet, i) {
      return '<div class="compound-row"><span class="idx">' + (i + 1) + '</span>' +
        '<span class="balls">' + balls(bet.red, 'red', 'xs') + '<span class="ball-sep" style="height:12px"></span>' + balls(bet.blue, 'blue', 'xs') + '</span>' +
        '<button type="button" class="mini-btn" data-copy-text="' + esc(D.CONFIG[state.key].red.label + ' ' + bet.red.map(pad2).join(' ') + ' ' + D.CONFIG[state.key].blue.label + ' ' + bet.blue.map(pad2).join(' ')) + '">复制</button></div>';
    }).join('') + (res.truncated ? '<div class="empty-line">共 ' + res.total + ' 注，以上为前 ' + res.bets.length + ' 注</div>' : '');
  }

  /* ----------------------------- 导入 ----------------------------- */

  function openImport() {
    var ex = state.key === 'ssq' ? '2026125,2026-11-01,01,05,12,18,23,29,07' : '2026125,2026-11-01,03,09,15,22,31,04,11';
    $('importHelp').innerHTML = '当前彩种：<b>' + CONFIG[state.key].name + '</b>。每行一期，期号与日期可选，号码写在最后，逗号/空格分隔。示例：<br /><code>' + ex + '</code>';
    $('importText').value = '';
    $('importError').textContent = '';
    $('importSheet').hidden = false;
  }

  function applyImport() {
    var parsed = D.parseImport(state.key, $('importText').value);
    if (!parsed.draws.length) {
      $('importError').textContent = '未识别到有效数据，请检查号码个数与范围。';
      return;
    }
    manual[state.key] = D.mergeDraws(manual[state.key] || [], parsed.draws, 200);
    saveJSON(MANUAL_KEY, manual);
    rebuildDraws();
    $('importSheet').hidden = true;
    renderAll();
    toast('已导入 ' + parsed.draws.length + ' 期（仅本机）');
  }

  /* ----------------------------- 事件 ----------------------------- */

  function wire() {
    Array.prototype.forEach.call(document.querySelectorAll('#lotterySwitch button'), function (btn) {
      btn.addEventListener('click', function () {
        state.key = btn.dataset.key;
        state.results = null;
        state.compoundBets = null;
        analysisCache = {};
        renderAll();
      });
    });

    Array.prototype.forEach.call(document.querySelectorAll('.tabbar button[data-tab]'), function (btn) {
      btn.addEventListener('click', function () { switchTab(btn.dataset.tab); });
    });

    $('refreshBtn').addEventListener('click', function () { refreshData(true); });
    $('dataBadge').addEventListener('click', function () { switchTab('mine'); });

    $('homeMore').addEventListener('click', function () {
      switchTab('trend');
      state.trendTab = 'analysis';
      renderTrend();
    });

    $('checkBtn').addEventListener('click', runCheck);
    $('homeCold').addEventListener('click', function () { switchTab('trend'); });
    $('homeHot').addEventListener('click', function () { switchTab('trend'); });

    Array.prototype.forEach.call(document.querySelectorAll('#trendTabs button'), function (btn) {
      btn.addEventListener('click', function () {
        state.trendTab = btn.dataset.trend;
        renderTrend();
      });
    });
    $('matrixZone').addEventListener('change', function () {
      state.matrixZone = $('matrixZone').value;
      renderMatrixTab();
    });
    $('matrixWindow').addEventListener('change', function () {
      state.matrixWindow = Number($('matrixWindow').value) || 30;
      renderMatrixTab();
    });

    $('strategyGrid').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-strategy]');
      if (!btn) return;
      state.strategy = btn.dataset.strategy;
      renderSelect();
    });
    $('noteCount').addEventListener('change', function () { state.notes = Number($('noteCount').value) || 3; });
    $('advancedToggle').addEventListener('click', function () {
      var panel = $('advancedPanel');
      panel.hidden = !panel.hidden;
      $('advancedToggle').textContent = panel.hidden ? '高级设置' : '收起设置';
    });
    $('generateBtn').addEventListener('click', generateSmart);
    $('randomBtn').addEventListener('click', function () { generateRandom(); });
    $('compoundBtn').addEventListener('click', openCompound);

    document.addEventListener('click', function (e) {
      var close = e.target.closest('[data-close]');
      if (close) {
        var el = $(close.dataset.close);
        if (el) el.hidden = true;
        return;
      }
      var action = e.target.closest('[data-action]');
      if (action) {
        var act = action.dataset.action;
        if (act === 'smart-one') quickSmartOne();
        else if (act === 'random-one') quickRandomOne();
        else if (act === 'check') openCheck();
        return;
      }
      var copy = e.target.closest('[data-copy-text]');
      if (copy) { copyText(copy.dataset.copyText); return; }
      var copyResult = e.target.closest('[data-copy-index]');
      if (copyResult) {
        var set = state.results[Number(copyResult.dataset.copyIndex)];
        if (set) {
          var c = cfg();
          copyText(c.red.label + ' ' + set.red.map(pad2).join(' ') + ' ' + c.blue.label + ' ' + set.blue.map(pad2).join(' '));
        }
        return;
      }
      var favResult = e.target.closest('[data-fav-index]');
      if (favResult) {
        var set2 = state.results[Number(favResult.dataset.favIndex)];
        if (set2) addFavorite({ mode: 'single', red: set2.red.slice(), blue: set2.blue.slice() }, state.resultsStrategy === 'random' ? '随机选号' : '智能选号');
        return;
      }
      var favBtn = e.target.closest('[data-fav-action]');
      if (favBtn) { favAction(favBtn.dataset.favAction, favBtn.dataset.id); return; }
      var planBtn = e.target.closest('[data-plan-action]');
      if (planBtn) { planAction(planBtn.dataset.planAction, planBtn.dataset.id); return; }
      var pick = e.target.closest('[data-pick]');
      if (pick && !pick.disabled) { toggleCompound(pick.dataset.pick, Number(pick.dataset.num)); return; }
    });

    $('compoundMode').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-mode]');
      if (!btn) return;
      state.compoundMode = btn.dataset.mode;
      state.compoundBets = null;
      renderCompound();
    });
    $('compoundGenerate').addEventListener('click', generateCompound);
    $('compoundFavorite').addEventListener('click', function () {
      addFavorite(compoundSelection(), '复式胆拖');
    });
    $('chaseIssues').addEventListener('change', updateChasePreview);
    $('chaseMultiplier').addEventListener('change', updateChasePreview);
    $('chaseConfirm').addEventListener('click', createPlan);
    $('importBtn').addEventListener('click', openImport);
    $('importApply').addEventListener('click', applyImport);
    $('refreshDataBtn').addEventListener('click', function () { refreshData(true); });
    $('installBtn').addEventListener('click', function () {
      if (!state.installPrompt) { toast('请使用浏览器菜单中的「安装应用 / 添加到主屏幕」'); return; }
      state.installPrompt.prompt();
      state.installPrompt.userChoice.then(function () { state.installPrompt = null; });
    });
  }

  /* ----------------------------- PWA ----------------------------- */

  function initPWA() {
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('./service-worker.js').catch(function (err) {
          console.warn('[PWA] SW 注册失败', err);
        });
      });
    }
    window.addEventListener('beforeinstallprompt', function (event) {
      event.preventDefault();
      state.installPrompt = event;
      $('installCard').hidden = false;
    });
    window.addEventListener('appinstalled', function () {
      state.installPrompt = null;
      $('installCard').hidden = true;
      toast('已安装到桌面');
    });
    var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    if (isIOS && !window.navigator.standalone) $('installCard').hidden = false;
  }

  /* ----------------------------- 启动 ----------------------------- */

  function applyUrlParams() {
    try {
      var params = new URLSearchParams(location.search);
      var tab = params.get('tab');
      if (['home', 'select', 'trend', 'mine'].indexOf(tab) >= 0) switchTab(tab);
      if (params.get('action') === 'check') { switchTab('home'); setTimeout(function () { openCheck(); }, 200); }
    } catch (e) { /* ignore */ }
  }

  function init() {
    rebuildDraws();
    wire();
    renderAll();
    switchTab(state.tab);
    refreshData(false);
    startLiveTicker();
    initPWA();
    applyUrlParams();
  }

  init();
})();
