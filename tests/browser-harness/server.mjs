import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const root = '/home/claude/stoph-shop-main/public';
const html = fs.readFileSync('/home/claude/stoph-shop-main/index.html', 'utf8')
  .replace(/<script type="module"[^>]*><\/script>/, '<link rel="stylesheet" href="/app.css"><script type="module" src="/app.js"></script>');
const types = { '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'); const p = u.pathname;
  if (p === '/app.js' || p === '/app.css') { const f = '/tmp/harness/dist' + p; res.writeHead(200, { 'Content-Type': types[path.extname(p)] }); return res.end(fs.readFileSync(f)); }
  if (p.startsWith('/img/')) { const n = p.slice(5, -4); const c = ['#e10600', '#fe9201', '#1d3557', '#2a9d8f', '#6a4c93'][n.replace(/\D/g, '') % 5]; res.writeHead(200, { 'Content-Type': 'image/svg+xml' }); return res.end(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><rect width="800" height="800" fill="${c}"/><text x="400" y="420" font-size="120" fill="#fff" text-anchor="middle" font-family="sans-serif">${n}</text></svg>`); }
  const f = path.join(root, p);
  if (p !== '/' && fs.existsSync(f) && fs.statSync(f).isFile()) { res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); return res.end(fs.readFileSync(f)); }
  res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(html);
}).listen(4173, () => console.log('up'));
