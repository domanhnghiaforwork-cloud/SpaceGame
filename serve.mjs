/**
 * Máy chủ tĩnh để chạy game (ES module không hoạt động với file://).
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

function announce(actualPort) {
  console.log(`SpaceGame đang chạy tại http://localhost:${actualPort}`);
}

/**
 * Chiếm cổng, và nếu cổng đã có người dùng (thường là một `npm start` cũ còn chạy) thì
 * báo rõ rồi tự thử cổng kế tiếp thay vì ném lỗi EADDRINUSE làm sập chương trình.
 */
let attempt = 0;

server.on('listening', () => announce(server.address().port));

server.on('error', (error) => {
  if (error.code !== 'EADDRINUSE') {
    console.error(`Không mở được cổng: ${error.message}`);
    process.exitCode = 1;
    return;
  }
  if (attempt >= 10) {
    console.error(`Cổng ${port}–${port + 10} đều đang bận. Tắt tiến trình đang giữ cổng rồi chạy lại:`);
    console.error(`  netstat -ano | findstr :${port}`);
    console.error('  taskkill /F /PID <PID>');
    console.error('Hoặc chọn cổng khác: $env:PORT=8100; npm start');
    process.exitCode = 1;
    return;
  }
  attempt += 1;
  console.warn(`Cổng ${port + attempt - 1} đang bận — thử cổng ${port + attempt}…`);
  server.listen(port + attempt);
});

server.listen(port);
