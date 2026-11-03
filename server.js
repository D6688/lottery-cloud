/*
 * 本地预览服务（仅开发用；线上使用 GitHub Pages + Actions）
 */
'use strict';

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 8100;
const HOST = process.env.HOST || '0.0.0.0';
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

function localAddresses() {
  const result = [];
  const interfaces = os.networkInterfaces();
  Object.keys(interfaces).forEach(function (name) {
    (interfaces[name] || []).forEach(function (addr) {
      if (addr.family === 'IPv4' && !addr.internal) {
        result.push({ name: name, address: addr.address, url: 'http://' + addr.address + ':' + PORT });
      }
    });
  });
  return result;
}

const server = http.createServer(function (req, res) {
  const url = new URL(req.url, 'http://localhost');
  let pathname = url.pathname === '/' ? '/index.html' : url.pathname;
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch (e) { res.writeHead(400); res.end(); return; }
  if (decoded.indexOf('\0') >= 0 || decoded.split('/').indexOf('..') >= 0) {
    res.writeHead(403); res.end('forbidden'); return;
  }
  const filePath = path.resolve(ROOT, '.' + decoded);
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
    res.writeHead(403); res.end('forbidden'); return;
  }
  if (url.pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, app: 'caizhi-cloud', time: new Date().toISOString() }));
    return;
  }
  fs.stat(filePath, function (err, stat) {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('未找到文件');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': 'no-cache'
    });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, HOST, function () {
  console.log('彩智云端版本地预览：http://localhost:' + PORT);
  localAddresses().forEach(function (item) { console.log('手机访问：' + item.url); });
});

server.on('error', function (err) {
  console.error(err.code === 'EADDRINUSE' ? '端口 ' + PORT + ' 被占用，可换：PORT=8101 node server.js' : err);
  process.exit(1);
});
