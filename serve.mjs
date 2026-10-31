/**
 * Máy chủ tĩnh tối giản để chạy game (ES module không hoạt động với file://).
 *   node serve.mjs            → http://localhost:8000
 *   PORT=3000 node serve.mjs  → đổi cổng
 *
 * Ngoài việc phục vụ tệp tĩnh, server còn một endpoint duy nhất `/api/assistant`
 * làm proxy tới DeepSeek: API key nằm trong `.env` ở server và không bao giờ được
 * gửi xuống trình duyệt. Không có key thì endpoint trả 400 và phần còn lại của game
 * vẫn chạy bình thường.
 *
 * Không phụ thuộc gói ngoài: chỉ dùng http/fs của Node.
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)));
const port = Number(process.env.PORT ?? 8000);

/** Đọc `.env` kiểu KEY=VALUE; biến đã có trong môi trường thì giữ nguyên. */
async function loadEnv() {
  try {
    const raw = await readFile(join(root, '.env'), 'utf8');
    const lines = raw.split(/\r?\n/);
    for (const line of lines) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!match) continue;
      const key = match[1];
      const value = match[2].replace(/^["']|["']$/g, '');
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch {
    /* không có .env: game vẫn chạy, chỉ trợ lý là không dùng được */
  }
}

await loadEnv();

const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';
const ASSISTANT_MODEL = 'deepseek-chat';
const ASSISTANT_TIMEOUT_MS = 20_000;
const MAX_BODY_BYTES = 16 * 1024;

/** Bối cảnh chung; bối cảnh riêng của từng nhiệm vụ được chèn thêm bên dưới. */
const BASE_PROMPT = [
  'Bạn là trợ lý phi vụ trong một game mô phỏng lái tên lửa 2D quanh Trái Đất.',
  'Bạn nhận số liệu cảm biến của tàu và trả lời bằng tiếng Việt, tối đa 2 câu:',
  'câu đầu nói trạng thái hiện tại (ổn định, sắp quá nhiệt, sắp cạn nhiên liệu, lệch quỹ đạo...),',
  'câu sau nêu đúng một hành động cụ thể nên làm ngay (ví dụ "kéo ga lên 60 % để giữ cận điểm trên 150 km").',
  'Không chào hỏi, không markdown, không lặp lại toàn bộ số liệu, không bịa số liệu không có trong dữ liệu.',
].join(' ');

/** Ghép bối cảnh nhiệm vụ (nếu có) vào system prompt. */
function systemPromptFor(mission) {
  if (!mission || typeof mission !== 'object') return BASE_PROMPT;
  const parts = [
    `Nhiệm vụ hiện tại: ${mission.ten ?? mission.id ?? 'không rõ'}.`,
    mission.mucTieu ? `Mục tiêu: ${mission.mucTieu}.` : '',
    mission.boiCanh ? `Bối cảnh: ${mission.boiCanh}.` : '',
    mission.buocDangLam ? `Bước đang làm: ${mission.buocDangLam}.` : '',
    mission.huongDan ? `Hướng dẫn trong game: ${mission.huongDan}.` : '',
    'Chỉ khuyên những việc phục vụ đúng mục tiêu của nhiệm vụ này.',
  ];
  return `${BASE_PROMPT} ${parts.filter(Boolean).join(' ')}`;
}

function sendJson(response, status, payload) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

function readJsonBody(request) {
  return new Promise((resolveBody, rejectBody) => {
    let size = 0;
    const chunks = [];
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        rejectBody(new Error('Dữ liệu gửi lên quá lớn'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      try {
        resolveBody(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        rejectBody(new Error('JSON không hợp lệ'));
      }
    });
    request.on('error', rejectBody);
  });
}

async function handleAssistant(request, response) {
  const key = process.env.DEEPSEEK_API_KEY?.trim();
  if (!key) {
    sendJson(response, 400, {
      error: 'missing-key',
      message: 'Chưa có DEEPSEEK_API_KEY trong .env',
    });
    return;
  }

  let body;
  try {
    body = await readJsonBody(request);
  } catch (error) {
    sendJson(response, 400, { error: 'bad-request', message: error.message });
    return;
  }

  const telemetry = body?.telemetry;
  if (!telemetry || typeof telemetry !== 'object') {
    sendJson(response, 400, { error: 'bad-request', message: 'Thiếu trường telemetry' });
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ASSISTANT_TIMEOUT_MS);
  try {
    const upstream = await fetch(DEEPSEEK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: ASSISTANT_MODEL,
        messages: [
          { role: 'system', content: systemPromptFor(telemetry.nhiemVu) },
          { role: 'user', content: `Số liệu tàu: ${JSON.stringify(telemetry)}` },
        ],
        temperature: 0.3,
        max_tokens: 140,
        stream: false,
      }),
      signal: controller.signal,
    });

    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => '');
      sendJson(response, 502, {
        error: 'upstream',
        message: `DeepSeek trả về ${upstream.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`,
      });
      return;
    }

    const data = await upstream.json();
    const reply = data?.choices?.[0]?.message?.content?.trim();
    if (!reply) {
      sendJson(response, 502, { error: 'empty', message: 'DeepSeek không trả lời nội dung nào' });
      return;
    }
    sendJson(response, 200, { reply });
  } catch (error) {
    const message =
      error?.name === 'AbortError'
        ? 'DeepSeek không phản hồi kịp (quá 20 giây)'
        : `Không gọi được DeepSeek: ${error?.message ?? 'lỗi không rõ'}`;
    sendJson(response, 502, { error: 'network', message });
  } finally {
    clearTimeout(timer);
  }
}

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
  const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;

  if (pathname === '/api/assistant/status') {
    const configured = Boolean(process.env.DEEPSEEK_API_KEY?.trim());
    sendJson(response, 200, { configured, model: ASSISTANT_MODEL });
    return;
  }

  if (pathname === '/api/assistant') {
    if (request.method !== 'POST') {
      sendJson(response, 405, { error: 'method', message: 'Chỉ nhận POST' });
      return;
    }
    await handleAssistant(request, response);
    return;
  }

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
  console.log(
    process.env.DEEPSEEK_API_KEY?.trim()
      ? 'Trợ lý AI: đã có DEEPSEEK_API_KEY trong .env'
      : 'Trợ lý AI: chưa có DEEPSEEK_API_KEY — điền vào .env rồi khởi động lại server',
  );
});
