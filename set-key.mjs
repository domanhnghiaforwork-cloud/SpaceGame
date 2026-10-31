#!/usr/bin/env node
/**
 * Ghi DEEPSEEK_API_KEY vào `.env` từ terminal — không cần mở tệp bằng editor.
 *
 *   npm run key                 → hỏi key (ký tự không hiện lại khi gõ)
 *   npm run key -- sk-abc...    → ghi thẳng (lưu ý: key sẽ nằm trong lịch sử shell)
 *   echo sk-abc... | npm run key
 *
 * Giữ nguyên các dòng khác trong `.env`. Tệp `.env` đã nằm trong .gitignore.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const envPath = join(root, '.env');
const ENV_KEY = 'DEEPSEEK_API_KEY';

/** Che bớt key khi in ra màn hình. */
function mask(key) {
  if (key.length <= 10) return `${key.slice(0, 2)}…`;
  return `${key.slice(0, 5)}…${key.slice(-4)}`;
}

/** Hỏi key mà không echo ký tự nào (khi chạy trong terminal thật). */
async function askHidden(question) {
  if (!process.stdin.isTTY) {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    const text = Buffer.concat(chunks).toString('utf8');
    return text.split(/\r?\n/)[0] ?? '';
  }

  process.stdout.write(question);
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const originalWrite = rl.output.write.bind(rl.output);
  rl.output.write = () => true; // nuốt mọi ký tự echo
  const answer = await new Promise((resolve) => rl.question('', resolve));
  rl.output.write = originalWrite;
  rl.close();
  process.stdout.write('\n');
  return answer;
}

/** Ghi key vào `.env`, giữ nguyên các khai báo khác. */
async function writeKey(key) {
  let lines = [];
  try {
    const raw = await readFile(envPath, 'utf8');
    lines = raw.replace(/\r\n/g, '\n').split('\n');
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
  } catch {
    lines = ['# Điền key DeepSeek của bạn vào đây rồi khởi động lại: npm start'];
  }

  const entry = `${ENV_KEY}=${key}`;
  const index = lines.findIndex((line) => line.trim().startsWith(`${ENV_KEY}=`));
  if (index >= 0) lines[index] = entry;
  else lines.push(entry);

  await writeFile(envPath, `${lines.join('\n')}\n`, 'utf8');
}

const fromArgs = process.argv
  .slice(2)
  .find((arg) => !arg.startsWith('-') && arg.trim().length > 0);
const fromEnv = process.env[ENV_KEY]?.trim();
const answer = fromArgs ?? fromEnv ?? (await askHidden('Dán DEEPSEEK_API_KEY (không hiện lại khi gõ): '));
const key = answer.trim();

if (!key) {
  console.error('Chưa nhập key. Chạy lại: npm run key');
  process.exit(1);
}
if (!key.startsWith('sk-')) {
  console.warn('Cảnh báo: key DeepSeek thường bắt đầu bằng "sk-". Vẫn ghi theo đúng những gì bạn nhập.');
}

await writeKey(key);
console.log(`Đã ghi ${ENV_KEY} (${mask(key)}) vào ${envPath}`);
console.log('Khởi động lại server (Ctrl+C rồi npm start) để trợ lý dùng key mới.');
