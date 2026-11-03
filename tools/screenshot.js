/*
 * 开发工具：本地预览页面检查 + 截图（需先启动 server.js 和 headless Chrome）
 */
'use strict';

const fs = require('fs');
const path = require('path');
const PORT = 9333;
const APP_URL = process.env.APP_URL || 'http://127.0.0.1:8100/';
const OUT = path.join(__dirname, '..', 'screenshots');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const target = await fetch('http://127.0.0.1:' + PORT + '/json/new?about:blank', { method: 'PUT' }).then(r => r.json());
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });

  let seq = 0;
  const pending = new Map();
  const errors = [];
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      if (m.error) p.reject(new Error(JSON.stringify(m.error))); else p.resolve(m.result);
    }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      errors.push((d.exception && d.exception.description) || d.text);
    }
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errors.push(m.params.entry.text);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params }));
  });
  const ev = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  async function waitFor(expr, timeout, label) {
    const end = Date.now() + (timeout || 8000);
    while (Date.now() < end) {
      try { if (await ev(expr)) return true; } catch (e) {}
      await sleep(120);
    }
    throw new Error('等待超时：' + (label || expr));
  }
  async function go(url) {
    await send('Page.navigate', { url });
    for (let i = 0; i < 100; i++) {
      try { if (await ev('document.readyState') === 'complete') break; } catch (e) {}
      await sleep(100);
    }
    await sleep(500);
  }
  async function shot(name, opts = {}) {
    await ev("var t=document.getElementById('toast'); if(t) t.classList.remove('show');");
    if (!opts.viewport) await ev("var tb=document.querySelector('.tabbar'); if(tb) tb.style.position='absolute';");
    await sleep(160);
    const w = opts.viewport ? await ev('innerWidth') : await ev('document.documentElement.scrollWidth');
    let h;
    if (opts.viewport) h = await ev('innerHeight');
    else {
      const metrics = await send('Page.getLayoutMetrics');
      h = Math.ceil((metrics.cssContentSize || metrics.contentSize).height);
    }
    const capture = await send('Page.captureScreenshot', {
      format: 'png', captureBeyondViewport: !opts.viewport,
      clip: { x: 0, y: 0, width: w, height: Math.min(h, 4200), scale: 1 }
    });
    fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(capture.data, 'base64'));
    if (!opts.viewport) await ev("var tb=document.querySelector('.tabbar'); if(tb) tb.style.position='';");
    console.log('  截图 ' + name + ' (' + w + 'x' + Math.min(h, 4200) + ')');
  }

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

  const report = {};

  await go(APP_URL);
  await waitFor("document.getElementById('latestIssue').textContent !== '—'", 8000, '首页数据');
  report.title = await ev('document.title');
  report.issue = await ev("document.getElementById('latestIssue').textContent");
  report.badge = await ev("document.getElementById('dataBadge').textContent");
  report.sw = await ev("'serviceWorker' in navigator ? navigator.serviceWorker.ready.then(r=>r.scope).catch(()=> 'fail') : 'none'");
  report.manifest = await ev("fetch('./manifest.webmanifest').then(r=>r.status)");
  report.recent = await ev("document.querySelectorAll('#recentDraws .recent-item').length");
  await shot('01-home');

  // 选号 + 生成
  await ev("document.querySelector('.tabbar button[data-tab=\"select\"]').click()");
  await sleep(300);
  await ev("document.querySelector('[data-strategy=\"cold\"]').click()");
  await ev("document.getElementById('generateBtn').click()");
  await sleep(500);
  report.results = await ev("document.querySelectorAll('#results .result-card').length");
  await shot('02-select');

  // 复式胆拖
  await ev("document.getElementById('compoundBtn').click()");
  await waitFor("!document.getElementById('compoundSheet').hidden", 4000, '复式面板');
  await ev(`(function(){
    [1,2,3,4,5,6,7,8].forEach(function(n){
      var el=document.querySelector('#compoundPickers .pick-cell[data-pick="red"][data-num="'+n+'"]'); if(el) el.click();
    });
    [2,7].forEach(function(n){
      var el=document.querySelector('#compoundPickers .pick-cell[data-pick="blue"][data-num="'+n+'"]'); if(el) el.click();
    });
  })()`);
  await sleep(300);
  report.compoundSummary = await ev("document.getElementById('compoundSummary').textContent.replace(/\\s+/g,' ').trim()");
  await ev("document.getElementById('compoundGenerate').click()");
  await sleep(400);
  report.compoundRows = await ev("document.querySelectorAll('#compoundResults .compound-row').length");
  await shot('03-compound', { viewport: true });
  await ev("document.querySelector('#compoundSheet [data-close]').click()");

  // 走势三个子页
  await ev("document.querySelector('.tabbar button[data-tab=\"trend\"]').click()");
  await sleep(400);
  report.heatCells = await ev("document.querySelectorAll('#redHeatmap .heat-cell').length");
  await shot('04-trend-analysis');
  await ev("document.querySelector('#trendTabs button[data-trend=\"matrix\"]').click()");
  await sleep(300);
  report.matrixCircles = await ev("document.querySelectorAll('#matrixChart svg circle').length");
  await shot('05-trend-matrix');
  await ev("document.querySelector('#trendTabs button[data-trend=\"chart\"]').click()");
  await sleep(300);
  report.chartLines = await ev("document.querySelectorAll('#sumChart svg polyline, #oddChart svg polyline').length");
  await shot('06-trend-chart');

  // 中奖核对（用最新一期号码）
  await ev("document.querySelector('.tabbar button[data-tab=\"home\"]').click()");
  await ev("document.querySelector('[data-action=\"check\"]').click()");
  await waitFor("!document.getElementById('checkSheet').hidden", 4000, '核对面板');
  await ev(`(function(){
    var nums=Array.prototype.map.call(document.querySelectorAll('#latestBalls .ball'), function(el){return el.textContent.trim();});
    document.getElementById('checkInput').value=nums.join(' ');
    document.getElementById('checkBtn').click();
  })()`);
  await sleep(350);
  report.checkBanner = await ev("document.querySelector('#checkResult .check-banner') ? document.querySelector('#checkResult .check-banner').innerText.replace(/\\n/g,' / ') : 'NONE'");
  await shot('07-check', { viewport: true });
  await ev("document.querySelector('#checkSheet [data-close]').click()");

  // 我的
  await ev("document.querySelector('.tabbar button[data-tab=\"mine\"]').click()");
  await sleep(300);
  await shot('08-mine');

  // 桌面
  await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 900, deviceScaleFactor: 1, mobile: false });
  await go(APP_URL);
  await waitFor("document.getElementById('latestIssue').textContent !== '—'", 8000, '桌面首页');
  await shot('09-desktop');

  // 手机尺寸检查横向溢出
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await go(APP_URL + '?tab=mine');
  report.mobileScrollWidth = await ev('document.documentElement.scrollWidth');
  report.mobileInnerWidth = await ev('innerWidth');

  console.log('\n检查结果：');
  Object.keys(report).forEach(k => console.log('  ' + k + ': ' + report[k]));
  console.log('\nJS 错误：' + (errors.length ? errors.join('\n') : '无'));

  const problems = [];
  if (report.results !== 3) problems.push('智能选号结果数量异常');
  if (report.recent !== 5) problems.push('最近开奖行数异常');
  if (!report.badge || report.badge.indexOf('数据') < 0) problems.push('数据状态未显示');
  if (report.sw === 'fail' || report.sw === 'none') problems.push('Service Worker 未注册');
  if (report.manifest !== 200) problems.push('manifest 加载失败');
  if (!report.compoundSummary || report.compoundSummary.indexOf('56') < 0) problems.push('复式注数计算异常');
  if (report.compoundRows !== 56) problems.push('复式生成行数异常');
  if (report.heatCells !== 33) problems.push('冷热热力图异常');
  if (report.matrixCircles < 100) problems.push('号码分布图未绘制');
  if (report.chartLines !== 2) problems.push('和值/奇偶走势未绘制');
  if (report.checkBanner === 'NONE') problems.push('中奖核对未渲染');
  if (report.mobileScrollWidth > report.mobileInnerWidth + 1) problems.push('移动端横向溢出');
  if (errors.length) problems.push('存在 JS 错误');

  ws.close();
  if (problems.length) {
    console.error('\n❌ 问题：\n- ' + problems.join('\n- '));
    process.exit(1);
  }
  console.log('\n✅ 页面检查全部通过');
}

main().catch(err => { console.error(err); process.exit(1); });
