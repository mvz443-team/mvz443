# 前端性能报告

生成时间：2026-11-18T11:08:12.496Z

运行环境：真实 Chromium（每个上下文等价无痕窗口），桌面 1280x720；单机与联机都使用相同固定场景、固定实体布局，并采样 8 秒。

| 场景 | rAF FPS | Phaser FPS | 帧时间 p50 (ms) | 帧时间 p95 (ms) | 长任务数 | JS Heap (MB) | TaskDuration (s) | 权威帧 | 植物/僵尸/投射物 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 单机-高负载 | 41.8 | 41.8 | 16.7 | 33.4 | 0 | 39.9 | 7.94 | 164 | 17 / 36 / 23 |
| 联机-高负载(房主端) | 22.0 | 26.3 | 50.0 | 66.7 | 13 | 38.1 | 8.03 | 0 | 17 / 36 / 33 |

说明：

- rAF FPS/帧时间来自浏览器 requestAnimationFrame 采样；
- Phaser FPS 来自 game.loop.actualFps，反映渲染循环；
- 长任务来自 PerformanceObserver longtask；
- JS Heap、TaskDuration、LayoutCount、RecalcStyleCount 来自 CDP Performance.getMetrics；
- 权威帧只对联机场景有意义，0 表示该页面未收到权威帧。

游戏逻辑固定步为 20 FPS（50ms）；因此联机高负载场景的 rAF/Phaser 低帧率需要结合 p95 与长任务判断，50ms 附近的帧间隔并不必然代表渲染卡顿。详细原始数据见 PERFORMANCE_REPORT.json。
