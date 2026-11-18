# 前端性能测试项目

真实无痕浏览器性能验收，独立于功能 E2E。测试使用 Playwright chromium 的两个隔离上下文（等价两个无痕窗口）跑单机 mock 与双端联机。

## 运行

前置：先启动前端 dev server：

```bash
npm run dev-nolog
```

然后：

```bash
npx playwright test --config playwright.perf.config.ts
```

`globalSetup` 会复用 E2E 的 Go server 启动逻辑（端口默认 28090），结束后由 E2E globalTeardown 关停。

## 固定场景

- 关卡：1-1，固定卡组 `[{ pid: 1, level: 1 }]`
- 实体布局写死在 `tests/perf/helpers.mjs` 的 `STRESS_SCENE`
- 每轮都重新打开页面/房间，不复用状态
- 注入通过前端调试钩子的 Cmd 层完成，不直接改 Model 字段

## 指标

- rAF FPS / 平均帧时间 / p50 / p95
- Phaser `game.loop.actualFps`
- `PerformanceObserver('longtask')` 长任务次数与总耗时
- CDP `Performance.getMetrics`：JS Heap、TaskDuration、Layout/RecalcStyle
- 实体数量：植物 / 僵尸 / 投射物
- 权威帧（联机场景）：房间服务端下发并由客户端 ACK 的当前帧

## 报告

每次运行覆盖仓库根目录：

- `PERFORMANCE_REPORT.md`
- `PERFORMANCE_REPORT.json`

注意：逻辑固定步是 20 FPS（50ms），因此 rAF/Phaser 帧率接近 20-30 FPS 不一定代表渲染卡顿，需要同时看 p95、长任务和 TaskDuration。
