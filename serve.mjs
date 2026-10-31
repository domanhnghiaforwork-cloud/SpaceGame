/**
 * Máy chủ tĩnh tối giản để chạy game (ES module không hoạt động với file://).
 *   node serve.mjs            → http://localhost:8000
 *   PORT=3000 node serve.mjs  → đổi cổng
 *
 * Không phụ thuộc gói ngoài: chỉ dùng http/fs của Node.
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)));
const port = Number(process.env.PORT ?? 8000);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
};

function resolveRequestPath(url) {
  const pathname = decodeURIComponent(new URL(url ?? '/', 'http://localhost').pathname);
  const relative = normalize(pathname).replace(/^([/\\])+/, '');
  const filePath = join(root, relative || 'index.html');
  if (filePath !== root && !filePath.startsWith(root + sep)) return null;
  return filePath;
}

const server = createServer(async (request, response) => {
  const filePath = resolveRequestPath(request.url);
  if (!filePath) {
    response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Truy cập bị từ chối');
    return;
  }

  try {
    const info = await stat(filePath);
    const target = info.isDirectory() ? join(filePath, 'index.html') : filePath;
    const data = await readFile(target);
    response.writeHead(200, {
      'Content-Type': MIME[extname(target)] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    response.end(data);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Không tìm thấy tệp');
  }
});

server.listen(port, () => {
  console.log(`SpaceGame đang chạy tại http://localhost:${port}`);
});
