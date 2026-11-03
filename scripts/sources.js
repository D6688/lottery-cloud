/*
 * 彩智 · 智能选号助手
 * tools/sources.js —— 真实开奖数据源（Node 端，供抓取脚本与本地服务共用）
 *
 * 双色球：中国福利彩票官网开奖公告接口
 * 大乐透：500 彩票网历史数据页
 */
'use strict';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const LIMITS = {
  ssq: { redMax: 33, redPick: 6, blueMax: 16, bluePick: 1 },
  dlt: { redMax: 35, redPick: 5, blueMax: 12, bluePick: 2 }
};

function asc(a, b) { return a - b; }

function isValidDraw(key, draw) {
  const limits = LIMITS[key];
  if (!limits || !draw) return false;
  const check = (nums, max, pick) => {
    if (!Array.isArray(nums) || nums.length !== pick) return false;
    const seen = {};
    return nums.every(n => Number.isInteger(n) && n >= 1 && n <= max && !seen[n] && (seen[n] = true));
  };
  return check(draw.red, limits.redMax, limits.redPick) &&
    check(draw.blue, limits.blueMax, limits.bluePick);
}

function normalizeCount(count) {
  const n = Number(count);
  if (!Number.isFinite(n)) return 120;
  return Math.max(30, Math.min(200, Math.round(n)));
}

/* ----------------------------- 双色球 ----------------------------- */

async function fetchSsq(count) {
  const issueCount = normalizeCount(count);
  const url = 'https://www.cwl.gov.cn/cwl_admin/front/cwlkj/search/kjxx/findDrawNotice?name=ssq&issueCount=' + issueCount;
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      'Referer': 'https://www.cwl.gov.cn/',
      'Accept': 'application/json, text/javascript, */*; q=0.01'
    },
    signal: AbortSignal.timeout(12000)
  });
  if (!res.ok) throw new Error('双色球接口 HTTP ' + res.status);

  const json = await res.json();
  if (json.state !== 0 || !Array.isArray(json.result)) {
    throw new Error('双色球接口返回异常：' + (json.message || '未知错误'));
  }

  return json.result.map(function (item) {
    const dateMatch = String(item.date || '').match(/\d{4}-\d{2}-\d{2}/);
    return {
      issue: String(item.code),
      date: dateMatch ? dateMatch[0] : '',
      red: String(item.red).split(',').map(Number).sort(asc),
      blue: String(item.blue).split(',').map(Number).sort(asc)
    };
  }).filter(function (d) {
    return /^\d{7}$/.test(d.issue) && isValidDraw('ssq', d);
  });
}

/* ----------------------------- 大乐透 ----------------------------- */

function parseDltHtml(html) {
  const rows = Array.from(String(html).matchAll(/<tr class="t_tr1">([\s\S]*?)<\/tr>/g)).map(function (m) { return m[1]; });
  const draws = [];

  rows.forEach(function (row) {
    const cells = Array.from(row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)).map(function (m) {
      return m[1].replace(/<[^>]+>/g, '').trim();
    });
    if (cells.length < 9) return;

    let issue = cells[1].replace(/\D/g, '');
    if (issue.length === 5) issue = '20' + issue;
    if (!/^\d{7}$/.test(issue)) return;

    const dateMatch = (cells[cells.length - 1] || '').match(/\d{4}-\d{2}-\d{2}/);
    const draw = {
      issue: issue,
      date: dateMatch ? dateMatch[0] : '',
      red: cells.slice(2, 7).map(Number).sort(asc),
      blue: cells.slice(7, 9).map(Number).sort(asc)
    };
    if (isValidDraw('dlt', draw)) draws.push(draw);
  });

  return draws;
}

async function fetchDlt(count) {
  const issueCount = normalizeCount(count);
  const url = 'https://datachart.500.com/dlt/history/newinc/history.php?limit=' + issueCount;
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Referer': 'https://datachart.500.com/dlt/' },
    signal: AbortSignal.timeout(12000)
  });
  if (!res.ok) throw new Error('大乐透数据页 HTTP ' + res.status);

  const buf = await res.arrayBuffer();
  const html = new TextDecoder('gb18030').decode(buf);
  return parseDltHtml(html);
}

const SOURCES = {
  ssq: { name: '中国福利彩票官网', fetch: fetchSsq, url: 'https://www.cwl.gov.cn/' },
  dlt: { name: '500 彩票网 · 历史数据', fetch: fetchDlt, url: 'https://datachart.500.com/dlt/' }
};

module.exports = {
  LIMITS: LIMITS,
  SOURCES: SOURCES,
  isValidDraw: isValidDraw,
  parseDltHtml: parseDltHtml,
  fetchSsq: fetchSsq,
  fetchDlt: fetchDlt
};
