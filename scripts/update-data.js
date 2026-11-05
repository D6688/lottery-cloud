/*
 * 云端数据更新脚本（GitHub Actions 调用）
 * 抓取双色球 / 大乐透历史开奖，写入 data/latest.json 和 assets/snapshot.js。
 * 任一数据源失败时保留旧数据，不让 Action 失败。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { SOURCES } = require('./sources');

const ROOT = path.join(__dirname, '..');
const JSON_FILE = path.join(ROOT, 'data', 'latest.json');
const SNAPSHOT_FILE = path.join(ROOT, 'assets', 'snapshot.js');
const COUNT = 150;

function readExisting() {
  try {
    return JSON.parse(fs.readFileSync(JSON_FILE, 'utf8'));
  } catch (e) {
    return null;
  }
}

function merge(existing, incoming) {
  const map = {};
  const order = [];
  const keep = (draw) => {
    if (!draw || !draw.issue) return;
    if (!map[draw.issue]) order.push(draw.issue);
    map[draw.issue] = draw;
  };
  (existing || []).forEach(keep);
  (incoming || []).forEach(keep);
  return order.map((issue) => map[issue]).sort((a, b) => {
    if (a.date && b.date && a.date !== b.date) return a.date < b.date ? 1 : -1;
    return String(b.issue).localeCompare(String(a.issue));
  }).slice(0, COUNT);
}

async function main() {
  const existing = readExisting();
  const output = {
    app: 'caizhi',
    version: 1,
    updatedAt: '',
    sources: {},
    draws: {}
  };

  for (const key of Object.keys(SOURCES)) {
    const source = SOURCES[key];
    const old = existing && existing.draws ? existing.draws[key] : [];
    try {
      const draws = await source.fetch(COUNT);
      if (!draws.length) throw new Error('未解析到数据');
      const merged = merge(old, draws);
      output.draws[key] = merged;
      output.sources[key] = source.name;
      console.log(`✓ ${key === 'ssq' ? '双色球' : '大乐透'}：抓取 ${draws.length} 期，合并后 ${merged.length} 期，最新 ${merged[0].issue}`);
    } catch (err) {
      console.error(`✗ ${key} 抓取失败：${err.message}，保留旧数据`);
      output.draws[key] = old;
      output.sources[key] = existing && existing.sources ? existing.sources[key] : '';
    }
  }

  const ssq = output.draws.ssq || [];
  const dlt = output.draws.dlt || [];
  if (!ssq.length && !dlt.length) {
    console.error('没有任何数据，终止（不覆盖已有文件）');
    process.exit(0);
  }

  const changed = !existing || !existing.draws ||
    JSON.stringify(existing.draws) !== JSON.stringify(output.draws);

  if (!changed) {
    console.log('没有新的开奖数据，跳过文件更新（保持原更新时间）');
    if (process.env.GITHUB_OUTPUT) {
      fs.appendFileSync(process.env.GITHUB_OUTPUT, 'changed=false\n');
    }
    return;
  }

  output.updatedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(JSON_FILE), { recursive: true });
  fs.writeFileSync(JSON_FILE, JSON.stringify(output, null, 2) + '\n', 'utf8');

  const snapshot =
    '/* 由 scripts/update-data.js 自动生成，请勿手改。数据更新于 ' + output.updatedAt + ' */\n' +
    'window.CAIZHI_SNAPSHOT = ' + JSON.stringify(output) + ';\n';
  fs.writeFileSync(SNAPSHOT_FILE, snapshot, 'utf8');
  console.log('已写入 data/latest.json 与 assets/snapshot.js');
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, 'changed=true\n');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
