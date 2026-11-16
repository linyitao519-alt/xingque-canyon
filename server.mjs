// 零依赖静态服务器：node server.mjs [port]
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)));
const port = Number(process.argv[2] || process.env.PORT || 5173);
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.map': 'application/json', '.webmanifest': 'application/manifest+json',
};

createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = normalize(join(root, p));
    if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
    const s = await stat(file);
    if (!s.isFile()) throw new Error('not file');
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404');
  }
}).listen(port, '0.0.0.0', () => {
  console.log(`星阙峡谷 已启动`);
  console.log(`  本机:   http://localhost:${port}/`);
  for (const list of Object.values(networkInterfaces()))
    for (const n of list || [])
      if (n.family === 'IPv4' && !n.internal) console.log(`  手机:   http://${n.address}:${port}/   (手机与电脑连同一 Wi-Fi)`);
});
