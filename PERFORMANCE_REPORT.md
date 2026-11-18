# 前端性能报告

生成时间：2026-11-18T11:52:54.008Z

运行环境：真实 Chromium（每个上下文等价无痕窗口），桌面 1280x720；单机与联机都使用相同固定场景、固定实体布局，并采样 8 秒。

| 场景 | rAF FPS | Phaser FPS | 帧时间 p50 (ms) | 帧时间 p95 (ms) | 长任务数 | JS Heap (MB) | TaskDuration (s) | 权威帧 | 植物/僵尸/投射物 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 单机-高负载 | 59.0 | 60.1 | 16.7 | 16.8 | 0 | 25.6 | 7.18 | 147 | 17 / 36 / 20 |
| 联机-高负载(房主端) | 35.9 | 38.6 | 33.3 | 33.4 | 0 | 42.4 | 8.03 | 153 | 17 / 36 / 30 |

说明：

- rAF FPS/帧时间来自浏览器 requestAnimationFrame 采样；
- Phaser FPS 来自 game.loop.actualFps，反映渲染循环；
- 长任务来自 PerformanceObserver longtask；
- JS Heap、TaskDuration、LayoutCount、RecalcStyleCount 来自 CDP Performance.getMetrics；
- 权威帧只对联机场景有意义，0 表示该页面未收到权威帧。

游戏逻辑固定步为 20 FPS（50ms）；因此联机高负载场景的 rAF/Phaser 低帧率需要结合 p95 与长任务判断，50ms 附近的帧间隔并不必然代表渲染卡顿。详细原始数据见 PERFORMANCE_REPORT.json。
