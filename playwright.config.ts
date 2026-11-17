import { defineConfig, devices } from 'playwright/test';

// 前端 E2E：联机大厅、断线重连、重连放弃、PostGame 返回房间。
// 后端由 globalSetup 编译并启动独立端口的 Go server，测试结束自动关停。

const frontendPort = Number(process.env.E2E_FRONTEND_PORT ?? 8080);
const serverPort = Number(process.env.E2E_SERVER_PORT ?? 28090);
const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${frontendPort}`;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL,
    browserName: 'chromium',
    launchOptions: { args: ['--use-fake-ui-for-media-stream'] },
    // 自签证书：允许本测试环境忽略 HTTPS 证书错误
    ignoreHTTPSErrors: true,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  globalSetup: './tests/e2e/global-setup.mjs',
  globalTeardown: './tests/e2e/global-teardown.mjs',
});
