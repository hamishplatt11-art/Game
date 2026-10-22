// Zero-dependency launcher: serves the built game with plain Node (no
// `npm install` needed). Uses dist/ if you have run `npm run build`,
// otherwise the committed prebuilt/ copy.
//   node play.mjs            -> http://localhost:8080
//   node play.mjs 3000       -> custom port
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = ['dist', 'prebuilt'].map((d) => path.join(here, d)).find((d) => fs.existsSync(path.join(d, 'index.html')));
if (!root) { console.error('No dist/ or prebuilt/ folder with index.html found.'); process.exit(1); }
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm', '.ico': 'image/x-icon' };

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = path.normalize(path.join(root, url));
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});
let port = Number(process.argv[2] || 8080);
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE' && port < 8100) { port++; server.listen(port, '127.0.0.1'); } else throw e;
});
server.on('listening', () => {
  const url = `http://localhost:${port}/`;
  console.log(`Hardwood 27 is running at ${url}  (serving ${path.basename(root)}/, Ctrl+C to stop)`);
  if (process.platform === 'darwin') exec(`open ${url}`);
});
server.listen(port, '127.0.0.1');
