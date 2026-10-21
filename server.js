'use strict';
/*
 * Kỳ Đạo – web app Cờ Tướng. Chạy: node server.js  (không cần cài thêm thư viện nào)
 * Biến môi trường: PORT (mặc định 3000), HOST (mặc định 0.0.0.0), DATA_FILE.
 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { handleUpgrade } = require('./server/ws');
const Store = require('./server/store');
const Hub = require('./server/hub');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data', 'db.json');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json'
};

const store = new Store(DATA_FILE);
const hub = new Hub(store);
const MAX_CONN_PER_IP = Number(process.env.MAX_CONN_PER_IP) || 30;
const connPerIp = new Map();

/** IP thật của người chơi. Chỉ tin header của proxy (Render, Cloudflare Tunnel…) khi kết nối đến từ mạng nội bộ. */
function clientIp(req) {
  const direct = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  const internal = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|f[cd])/i.test(direct);
  if (internal) {
    const fwd = req.headers['cf-connecting-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0];
    if (fwd && String(fwd).trim()) return String(fwd).trim();
  }
  return direct || '?';
}

function securityHeaders(req) {
  const host = String(req.headers.host || '').replace(/[^\w.:[\]-]/g, '');
  return {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; worker-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
      "connect-src 'self'" + (host ? ' ws://' + host + ' wss://' + host : '') + "; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
  };
}

const server = http.createServer((req, res) => {
  let urlPath;
  try { urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (e) { res.writeHead(400); return res.end(); }
  if (urlPath === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }
  if (urlPath === '/') urlPath = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, urlPath));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end(); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Không tìm thấy'); }
    res.writeHead(200, Object.assign({
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'no-cache'
    }, securityHeaders(req)));
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
});

server.on('upgrade', (req, socket, head) => {
  if (!req.url.startsWith('/ws')) return socket.destroy();
  const ip = clientIp(req);
  const n = connPerIp.get(ip) || 0;
  if (n >= MAX_CONN_PER_IP) { socket.end('HTTP/1.1 429 Too Many Requests\r\n\r\n'); return; }
  connPerIp.set(ip, n + 1);
  handleUpgrade(req, socket, head, conn => {
    conn.on('close', () => {
      const left = (connPerIp.get(ip) || 1) - 1;
      if (left > 0) connPerIp.set(ip, left); else connPerIp.delete(ip);
    });
    hub.attach(conn, ip);
  });
});

server.listen(PORT, HOST, () => {
  console.log('Kỳ Đạo – Cờ Tướng đang chạy:');
  console.log('  Máy này:   http://localhost:' + PORT);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) console.log('  Mạng LAN:  http://' + a.address + ':' + PORT);
  }
});

function shutdown() {
  try { store.flush(); } catch (e) { console.error(e); }
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
