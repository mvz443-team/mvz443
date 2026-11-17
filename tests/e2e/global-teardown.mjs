// Playwright 全局清理：关停 globalSetup 启动的 Go server

import { existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SERVER_PORT = Number(process.env.E2E_SERVER_PORT ?? 28090);
const ARTIFACTS = join(tmpdir(), `mvz-e2e-${SERVER_PORT}`);

export default async function globalTeardown() {
  const pidFile = join(ARTIFACTS, 'server.pid');
  if (existsSync(pidFile)) {
    const pid = Number(readFileSync(pidFile, 'utf8').trim());
    if (Number.isFinite(pid) && pid > 0) {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        // 进程可能已退出
      }
    }
  }
  // Windows 下进程可能尚未完全退出，exe 会短暂被占用；不要因清理失败让测试套件报错。
  try {
    rmSync(ARTIFACTS, { recursive: true, force: true });
  } catch {
    // 忽略临时目录清理失败
  }
}
