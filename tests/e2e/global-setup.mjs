// Playwright 全局初始化：
// 1. 确认前端 dev server 已就绪（由外部启动，见 tests/e2e/README.md）
// 2. 编译并启动独立端口的 Go 后端，供 E2E 使用

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import https from 'node:https';

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const FRONTEND_DIR = join(ROOT, 'mvz443');
const SERVER_DIR = join(ROOT, 'server-repo-temp');
const SERVER_PORT = Number(process.env.E2E_SERVER_PORT ?? 28090);
const BASE_URL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${Number(process.env.E2E_FRONTEND_PORT ?? 8080)}`;
const ARTIFACTS = join(tmpdir(), `mvz-e2e-${SERVER_PORT}`);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHttp(url, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await new Promise((resolve) => {
      const req = https.get(url, { rejectUnauthorized: false, timeout: 800 }, (res) => {
        res.resume();
        resolve(res.statusCode !== undefined && res.statusCode < 500);
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
    });
    if (ok) return true;
    await sleep(200);
  }
  return false;
}

export default async function globalSetup() {
  mkdirSync(ARTIFACTS, { recursive: true });

  // 前端必须已启动
  const frontOk = await new Promise((resolve) => {
    const req = http.get(BASE_URL, { timeout: 800 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200 || res.statusCode === 304);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
  if (!frontOk) {
    throw new Error(`前端 dev server 未就绪: ${BASE_URL}。请先运行 npm run dev-nolog 或 ./run-all.sh`);
  }

  // 编译 Go server（独立二进制，避免与 run-all 的进程冲突）
  const exeName = process.platform === 'win32' ? 'mvzserver-e2e.exe' : 'mvzserver-e2e';
  const exePath = join(ARTIFACTS, exeName);
  execFileSync('go', ['build', '-o', exePath, '.'], { cwd: SERVER_DIR, stdio: 'inherit' });

  const child = spawn(exePath, ['-p', String(SERVER_PORT), '-l', ARTIFACTS], {
    cwd: SERVER_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, MVZ_DEBUG_FRAME_MS: '50' },
  });
  const logs = [];
  const capture = (chunk) => {
    for (const line of String(chunk).split(/\r?\n/)) {
      if (line.trim()) logs.push(line.trim());
    }
    writeFileSync(join(ARTIFACTS, 'server.log'), logs.join('\n'));
  };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);

  if (!await waitForHttp(`https://localhost:${SERVER_PORT}/ping`)) {
    child.kill('SIGKILL');
    throw new Error(`Go server 启动失败:\n${logs.join('\n')}`);
  }

  // 把 PID 写文件，供 globalTeardown 关停
  writeFileSync(join(ARTIFACTS, 'server.pid'), String(child.pid));
  writeFileSync(join(ARTIFACTS, 'server-address.txt'), `localhost:${SERVER_PORT}`);
}
