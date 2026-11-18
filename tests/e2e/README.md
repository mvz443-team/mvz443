# 前端 Playwright E2E

覆盖后端重构后的四个关键链路：

| Spec | 场景 | 验收点 |
| --- | --- | --- |
| `lobby.spec.mjs` | 两个上下文建房/加入房间 | roomId 一致、双方 stage=InLobby、peers 各 2 人 |
| `room-seats-ready.spec.mjs` | 固定座位、房主开始门槛、退出重置 | 座位号 0/1 一致；房主离开后补位与房主转移；未全准备不能开始；退出后 ready 清零 |
| `reconnect.spec.mjs` | InGame 断线重连 | 重连徽标出现、attempt ≥ 1、自动重连后保留房间席位 |
| `reconnect-refresh.spec.mjs` | 页面刷新后重连 | 从服务端 profile 重建 GameParams，进入 Preloader/Game，不再出现 no game params |
| `reconnect-giveup.spec.mjs` | 重连中止 UI | 断线徽标出现后，放弃时显示关闭 Toast 并退出在线状态 |
| `postgame-return.spec.mjs` | 权威结算后返回房间 | “返回房间”按钮发送 ReturnToLobby，回到原房间等待阶段 |
| `pause-exit.spec.mjs` | 联机暂停菜单与确认退出 | 打开菜单不暂停、倍速锁定；二次确认后永久离房、取消房间、对方收到 roomClosed |

## 运行

1. 先启动前端 dev server（globalSetup 会检查 `http://127.0.0.1:8080/`）：

   ```bash
   cd mvz443
   npm run dev-nolog
   ```

2. 在另一终端运行：

   ```bash
   cd mvz443
   npx playwright test
   ```

`globalSetup` 会自行编译并启动独立端口（`E2E_SERVER_PORT`，默认 28090）的 Go server，使用临时目录中的自签证书，`globalTeardown` 自动关停。

## 测试钩子

页面通过 `?netDebug=1&serverAddr=localhost:28090`（或在 设置 → 调试 中打开 `netDebug`）暴露 `window.MVZ_NET`：

- `getState()`：`stage / roomId / myId / lordId / peers / reconnecting / reconnectAttempt / online / roomSession / frameId`
- `openRoom({ roomName | roomId, chapterId, stageId, username })`：走与房间列表 UI 相同的 lobby 入口建房/加入
- `sendReady / sendLoaded / chooseStage / sendEndGame / sendReturnToLobby`：按房间生命周期推进
- `confirmLoadout(plants, stageId, chapterId)`：等价真实 UI 的“确认/准备”按钮——同时设置 `GameParams`（Phaser 挂载前提）并发送带 loadout 的 ready；联机战局 E2E 必须用这个而不是单独 `sendReady`
- `getSimulationHash()`：最近一次确定性状态采样 `{ frameId, hash }`（每 20 帧一次）
- `plantAt(pid, level, col, row)`：走真实“选卡 → onAttemptPlant → QueueSend”路径，不预测、不直接改 Model
- `dropSocketForTest()`：只断底层 WebSocket，保留重连策略与业务状态
- `configureReconnect / forceGiveUpForTest`：验证重连 UI 链路
- `toggleOnlinePauseMenu / getGameRuntime()`：验证联机暂停菜单不暂停模拟、倍速锁定
- `requestPauseMenuExit()`：走真实暂停菜单的二次确认退出路径
- `requestExitGame()`：跳过确认直接触发退出（仅用于清理类断言）
- `setOnlineConfigForTest({ username, serverAddr })`：刷新后直接写入联机配置，绕开 E2E 存档注入时序
- `showResultForTest()`：E2E 跳过 Phaser 战斗场景时直接打开结算视图

前端网络层的退避/放弃策略与消息分流由 `npm run test:core` 中的 `reconnect_controller.test.mjs` 与 `message_router.test.mjs` 覆盖。

## 双无痕窗口联机确定性用例

`dual-window-desync.spec.mjs` 用两个隔离的浏览器上下文（等价两个无痕窗口）真实建房、加入、选图、准备、加载并进入联机战局：

- 验证权威帧在两端同步推进；
- 两端每 20 帧比对一次确定性状态哈希（h64），要求同一帧完全一致；
- 两端各执行真实权威种植操作后，后续采样哈希仍一致。

该用例覆盖 sim 测无法覆盖的浏览器侧问题（渲染帧写回物理、rAF 节流、Phaser/WS 事件串位、checkpoint 重连冻结、结束结果矛盾等）。运行方式：先 `npm run dev-nolog`，再 `npx playwright test tests/e2e/dual-window-desync.spec.mjs`。
