# 前端 Playwright E2E

覆盖后端重构后的四个关键链路：

| Spec | 场景 | 验收点 |
| --- | --- | --- |
| `lobby.spec.mjs` | 两个上下文建房/加入房间 | roomId 一致、双方 stage=InLobby、peers 各 2 人 |
| `reconnect.spec.mjs` | InGame 断线重连 | 重连徽标出现、attempt ≥ 1、自动重连后保留房间席位 |
| `reconnect-giveup.spec.mjs` | 重连中止 UI | 断线徽标出现后，放弃时显示关闭 Toast 并退出在线状态 |
| `postgame-return.spec.mjs` | 权威结算后返回房间 | “返回房间”按钮发送 ReturnToLobby，回到原房间等待阶段 |

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

页面通过 `?netDebug=1&serverAddr=localhost:28090` 暴露 `window.MVZ_NET`：

- `getState()`：`stage / roomId / myId / lordId / peers / reconnecting / reconnectAttempt / online / roomSession / frameId`
- `openRoom({ roomName | roomId, chapterId, stageId, username })`：走与房间列表 UI 相同的 lobby 入口建房/加入
- `sendReady / sendLoaded / chooseStage / sendEndGame / sendReturnToLobby`：按房间生命周期推进
- `dropSocketForTest()`：只断底层 WebSocket，保留重连策略与业务状态
- `configureReconnect / forceGiveUpForTest`：验证重连 UI 链路
- `showResultForTest()`：E2E 跳过 Phaser 战斗场景时直接打开结算视图

前端网络层的退避/放弃策略与消息分流由 `npm run test:core` 中的 `reconnect_controller.test.mjs` 与 `message_router.test.mjs` 覆盖。
