# 彩智 · 云端选号助手

重新设计的双色球 / 大乐透手机端 PWA。与旧版最大的区别：**页面和开奖数据都托管在云端，手机不需要开电脑、不需要本地服务或临时隧道**。

> 仅用于号码统计与组合娱乐，不构成投注建议，不提供购彩/充值/交易功能。请理性购彩，未满 18 周岁禁止购彩。

## 线上地址

**https://d6688.github.io/lottery-cloud/**

- 手机浏览器打开后「添加到主屏幕 / 安装应用」，可离线打开；不再依赖电脑、终端或临时隧道。
- 仓库：https://github.com/D6688/lottery-cloud （公开仓库，GitHub Pages 免费托管）
- 数据更新：开奖窗口内 GitHub Actions 每 5 分钟抓取一次；页面在开奖日每 20 秒自动检查，开奖后通常几分钟内自动刷新，无需手动操作。
- 已实际验证：HTTPS、PWA 安装入口、Service Worker、断网后可打开、手机 390px 布局无横向溢出。

## 重新设计要点

- **手机优先**：底部 4 个标签（首页 / 选号 / 走势 / 我的），390px 宽度设计，桌面端居中手机壳展示。
- **核心保留**：双色球/大乐透、冷热/遗漏分析、5 种智能策略、结构约束、随机选号、复式/胆拖、走势图、中奖核对、收藏、追号计划。
- **视觉重做**：深蓝夜空 + 金色号码球，全新图标与卡片布局。
- **架构重做**：去掉本地 Node 服务与 tunnel，改为纯静态托管 + GitHub Actions 更新数据；手机端永远有一个固定 HTTPS 网址。
- **开奖追踪**：开奖日 21:00-22:55 每 5 分钟更新数据；页面自动轮询并显示「下期开奖 / 开奖追踪中」，数据变化时自动刷新且弹出提示。
- **双数据源兜底**：双色球同时抓取福彩官网与 500 彩票网，任一源拿到新一期即可更新；大乐透使用 500 彩票网历史数据。
- **缓存自更新**：v0.5 起脚本/样式带版本号，Service Worker 网络优先；「我的 → 清除缓存并更新版本」可手动强制刷新。
- **文案收敛**：以「统计组合参考」替代「精准号码/预测」表述，保留免责声明。

## 功能

| 页面 | 内容 |
| --- | --- |
| 首页 | 最新开奖、开奖追踪/下期开奖倒计时提示、数据日期/期数、冷热速览、快捷（智能一注 / 随机一注 / 中奖核对）、最近 5 期 |
| 选号 | 5 种策略、1/3/5/10 注、奇偶/大小/和值/连号高级约束、结构评分、收藏/复制、随机、复式胆拖 |
| 走势 | 冷热分析（红/蓝球热力图、热号/冷号榜）、号码分布矩阵、和值/奇偶趋势 |
| 我的 | 收藏、追号计划、云端数据状态/刷新、手动导入、安装 PWA、免责声明 |

## 截图

| 首页 | 选号 |
| --- | --- |
| ![首页](screenshots/01-home.png) | ![选号](screenshots/02-select.png) |

| 冷热分析 | 号码分布 |
| --- | --- |
| ![冷热](screenshots/04-trend-analysis.png) | ![分布](screenshots/05-trend-matrix.png) |

| 复式胆拖 | 我的 |
| --- | --- |
| ![复式](screenshots/03-compound.png) | ![我的](screenshots/08-mine.png) |

## 本地预览

```bash
cd lottery-cloud
node server.js          # http://localhost:8100
```

## 云端架构

```text
GitHub 仓库（D6688/lottery-cloud）
├── main 分支
│   ├── index.html / assets / data/latest.json / assets/snapshot.js
│   └── .github/workflows/
│       ├── deploy.yml          # push 后构建并发布 GitHub Pages
│       └── update-data.yml     # 每天开奖后抓数据 + 提交 + 重新发布
├── GitHub Actions
│   ├── 开奖窗口内每 5 分钟（北京时间 21:00-22:55），23:00 再补一次
│   └── scripts/update-data.js 抓取福彩官网 / 500 彩票网，合并后写入静态 JSON
└── GitHub Pages（HTTPS / PWA / 全球 CDN）
```

- 开奖数据先写入 `data/latest.json` 与 `assets/snapshot.js`，页面优先 fetch 最新 JSON，失败时回退到 PWA 缓存/内置快照。
- 数据源失败时脚本保留上一次成功数据，不会清空。
- 手动「导入开奖」只保存在手机本机，不影响云端。

## 测试

```bash
node tests/test.js
node tools/capture.sh   # 需要本地 Chrome；页面检查 + 截图
```

当前：**1419 项断言通过**，覆盖快照合法性、冷热统计、5 种策略、结构约束、复式/胆拖注数、中奖奖级、导入合并、PWA/页面检查。

## 部署与维护

- 托管：GitHub Pages（Actions 构建，免费 HTTPS）。
- 数据：`.github/workflows/update-data.yml`
  - 开奖日北京时间 21:00-22:55 每 5 分钟运行一次，23:00 再补一次（GitHub cron 使用 UTC）。
  - 页面在开奖窗口内每 20 秒检查一次，其他时间每 5 分钟检查一次；数据更新后自动刷新页面内容。
  - 也支持在仓库 Actions 页面手动 `Run workflow`。
  - 抓取失败会保留上一次成功数据；仍可通过页面「手动导入开奖数据」兜底。
- 代码更新：推送到 `main` 会自动触发 Pages 部署。
- 注意：GitHub Actions 的定时任务在仓库长期无活动时可能被暂停；到 Actions 页面重新启用/手动运行即可。

## 目录

```text
lottery-cloud/
├── index.html
├── manifest.webmanifest
├── service-worker.js
├── assets/               # 样式、算法、页面逻辑、云端快照
├── data/latest.json      # 云端开奖数据（Actions 更新）
├── scripts/              # 抓取与更新脚本
├── .github/workflows/    # Pages 部署 + 定时数据更新
├── tests/test.js
├── tools/                # 截图、图标
└── screenshots/
```

## 数据来源

- 双色球：中国福利彩票官网开奖公告接口 + 500 彩票网历史数据页（双源合并，取最新）
- 大乐透：500 彩票网历史数据页
- 如果页面仍显示旧版本或旧数据：打开「我的 → 清除缓存并更新版本」，或删除桌面图标后重新从线上地址添加。

数据源可能调整或限流，若 Actions 抓取失败会保留旧数据；也可页面手动导入。
