'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { createScanner } = require('./transcripts');
const { demoState } = require('./demo');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
};

function startServer({ port, host, root, hide, demo }) {
  const scanner = demo ? null : createScanner({ root, hide });

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/state') {
      const hours = Math.min(168, Math.max(0.25, Number(url.searchParams.get('hours')) || 3));
      let body;
      try { body = demo ? demoState(hours) : scanner.scan(hours); } catch (e) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(String((e && e.stack) || e));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(body));
      return;
    }
    const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const file = path.normalize(path.join(PUBLIC_DIR, rel));
    if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end(); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve(server));
  });
}

module.exports = { startServer };
