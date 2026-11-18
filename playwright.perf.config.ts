// 独立性能测试项目：真实无痕浏览器跑前端游戏。
// 与 tests/e2e 分离：不复用 E2E 的断言性生命周期用例，而是采集可重复的负载指标。

import { defineConfig, devices } from 'playwright/test';

const frontendPort = Number(process.env.E2E_FRONTEND_PORT ?? 8080);
const serverPort = Number(process.env.E2E_SERVER_PORT ?? 28090);
const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${frontendPort}`;

export default defineConfig({
  testDir: './tests/perf',
  outputDir: './test-results/perf',
  timeout: 180_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['line']],
  use: {
    baseURL,
    browserName: 'chromium',
    ignoreHTTPSErrors: true,
    launchOptions: { args: ['--use-fake-ui-for-media-stream'] },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  globalSetup: './tests/perf/global-setup.mjs',
  globalTeardown: './tests/e2e/global-teardown.mjs',
});
