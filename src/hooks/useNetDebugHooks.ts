import { useEffect } from 'react';
import { IRefPhaserGame } from '../game/PhaserGame';
import type { MutableRefObject } from 'react';
import { GameParams } from '../game/models/GameParams';
import type { StageResult } from '../types/stage';
import { PhaserEventBus, PhaserEvents } from '../game/EventBus';
import { isNetDebugEnabled } from '../utils/debugFlags';
import { perfSampler } from '../utils/debug/perfSampler';
import BackendWS from '../utils/net/sync';
import { onlineStateManager } from '../store/OnlineStateManager';
import { createRoom, joinRoom } from '../utils/net/lobby';
import { SendReady, SendLoaded, SendChooseMap, SendEndGame, SendReturnToLobby } from '../utils/net/room';
import { Request } from '../pb/request';
import CombatManager from '../game/managers/CombatManager';
import CardpileManager from '../game/managers/combat/CardpileManager';
import CursorManager from '../game/managers/combat/CursorManager';
import ResourceManager from '../game/managers/combat/ResourceManager';
import MobManager from '../game/managers/combat/MobManager';
import PlantsManager from '../game/managers/combat/PlantsManager';
import { PlantCmd } from '../game/utils/cmd/PlantCmd';
import MobCmd from '../game/utils/cmd/MobCmd';
import { ProjectileCmd } from '../game/utils/cmd/ProjectileCmd';
import { BulletModel } from '../game/models/projectiles/ProjectileModels';
import { PlantLibrary } from '../game/managers/library/PlantLibrary';
import { GameManager } from '../context/save_ctx';

export interface NetTestHooksParams {
  saveManager: GameManager;
  phaserRef: MutableRefObject<IRefPhaserGame | null>;
  setGameParams: (params: GameParams) => void;
  gameExit: (result: StageResult) => void;
}

type NetTestHooks = Record<string, unknown>;

function buildNetTestHooks({ saveManager, phaserRef, setGameParams, gameExit }: NetTestHooksParams): NetTestHooks {
  const getGameScene = (): import('../game/scenes/Game').Game | undefined => {
    const scene = (window as unknown as { __MVZ443_GAME__?: import('../game/scenes/Game').Game }).__MVZ443_GAME__;
    return scene
      ?? (phaserRef.current?.game?.scene?.getScene('Game') as import('../game/scenes/Game').Game | null | undefined)
      ?? undefined;
  };

  return {
    getSimulationHash: () => ({ frameId: 0, hash: '' }),
    getDesyncState: () => ({
      offline: CombatManager.Instance.isDesyncOffline(),
      reason: CombatManager.Instance.getDesyncReason(),
    }),
    getPerfSampler: () => perfSampler.snapshot(),
    resetPerfSampler: () => perfSampler.reset(),
    getState: () => ({
      reconnecting: BackendWS.isReconnecting(),
      reconnectAttempt: BackendWS.getReconnectAttempt(),
      latencyMs: BackendWS.getAverageLatencyMs(),
      online: BackendWS.isOnlineMode(),
      roomSession: BackendWS.isRoomSessionMode(),
      inGame: BackendWS.GetFrameID() > 0,
      frameId: BackendWS.GetFrameID(),
      stage: onlineStateManager.getCurrentGameStage(),
      roomId: onlineStateManager.getRoomInfo().roomId,
      myId: onlineStateManager.getRoomInfo().myId,
      lordId: onlineStateManager.getRoomInfo().lordId,
      peers: onlineStateManager.getRoomPeersData(),
    }),
    configureReconnect: (options: { baseDelayMs?: number; maxDelayMs?: number; maxAttempts?: number }) =>
      BackendWS.configureReconnectForTest(options),
    openRoom: (options: { roomName?: string; roomId?: number; chapterId?: number; stageId?: number; username?: string }) => {
      // E2E 专用：直接走与房间列表 UI 相同的 lobby 入口，避免依赖 DOM 流程。
      const serverAddress = new URLSearchParams(window.location.search).get('serverAddr')
        || saveManager.getOnlineConfig().serverAddr
        || '';
      const params = { baseUrl: serverAddress, ...options };
      if (typeof options.roomId === 'number') return joinRoom(params);
      return createRoom(params);
    },
    closeRoom: () => BackendWS.closeConnection(),
    dropSocketForTest: () => BackendWS.dropSocketForTest(),
    forceGiveUpForTest: (reason: string) => BackendWS.giveUpReconnectForTest(reason),
    getRecentRoutes: () => BackendWS.getRecentRoutesForTest(),
    sendReady: (isReady: boolean) => SendReady(isReady),
    sendLoaded: (isLoaded?: boolean) => SendLoaded(isLoaded ?? true),
    chooseStage: (chapterId: number, stageId: number) => SendChooseMap(chapterId, stageId),
    sendEndGame: (isWin: boolean) => SendEndGame(isWin),
    // E2E：不挂载 Phaser 时也能把当前已收到的权威帧 ACK 给服务端，
    // 用于验证 PostGame 等需要 committedFrameID 的服务端状态机。
    ackLatestFrameForTest: () => {
      // 挂载了 Phaser 时以 QueueReceive 已执行的帧为准；未挂载时退回网络层
      // 记录的最新已送达帧，否则该钩子在 E2E 中永远只能 ACK 到 0。
      const frameId = BackendWS.FrameID > 0
        ? BackendWS.FrameID
        : BackendWS.getLatestReceivedFrameId();
      if (frameId <= 0) return false;
      BackendWS.send(Request.toBinary({
        payload: {
          blank: {
            frameId,
            ackFrameId: frameId,
            stateHash: 0,
            hashFrameId: 0,
            stateHashHex: "",
            inlineSnapshotJson: "",
            stateHashVersion: 0,
            clientLatencyMs: 0,
            energy: 0,
            starShards: 0,
            cardCooldowns: [],
            resourcesReported: false,
          },
          oneofKind: "blank",
        },
      }));
      return true;
    },
    sendReturnToLobby: () => SendReturnToLobby(),
    // E2E：刷新后存档注入存在时序差异，允许直接设置联机配置。
    setOnlineConfigForTest: (config: { username?: string; serverAddr?: string }) =>
      saveManager.updateOnlineConfig(config),
    requestExitGame: () => PhaserEventBus.emit(PhaserEvents.RequestExitGame, { online: BackendWS.isOnlineMode() }),
    // E2E：暂停菜单体验——联机打开菜单不暂停、倍速锁定、二次确认退出。
    toggleOnlinePauseMenu: () => {
      const scene = getGameScene();
      scene?.toggleOnlinePauseMenu();
      return Boolean(scene);
    },
    requestPauseMenuExit: () => {
      const scene = getGameScene();
      scene?.requestPauseMenuExit();
      return Boolean(scene);
    },
    toggleTimeSpeedForTest: () => CombatManager.Instance.handleTimespeedToggle(),
    getGameRuntime: () => {
      const scene = getGameScene();
      return {
        paused: CombatManager.Instance.isPaused,
        timeScale: scene?.time?.timeScale ?? null,
        pauseMenu: scene?.getPauseMenuState() ?? { visible: false },
        frameId: BackendWS.FrameID,
        energy: ResourceManager.Instance.getEnergy('mine'),
        energyText: scene?.getCardSlotEnergyText() ?? null,
        starShards: ResourceManager.Instance.getStarShards('mine'),
        cardpile: [...CardpileManager.Instance.cardpileStatus.entries()].map(([pid, status]) => ({
          pid,
          level: status.level,
          leftMs: status.leftMs,
          totalMs: status.totalMs,
        })),
      };
    },
    // 走与真实“确认/准备”按钮完全相同的选卡确认路径：设置 GameParams +
    // 发送带 loadout 的 ready。仅 sendReady 无法挂载 Phaser，权威帧永远不被消费。
    confirmLoadout: (plants: Array<{ pid: number; level: number }>, stageId: number, chapterId: number) => {
      const params: GameParams = {
        level: stageId,
        plants,
        gold: 0,
        gameExit: (result: StageResult) => gameExit(result),
        gameSettings: {
          isBluePrint: false,
          basicDebug: false,
          isBgm: false,
          isSoundAudio: false,
          showCardLevelInGame: false,
        },
      };
      setGameParams(params);
      const loadout = {
        cards: plants,
        level: stageId,
        initialEnergy: 0,
        initialStarShards: 0,
        globalModifiers: [],
      };
      SendReady(true, loadout);
      return true;
    },
    // 走与真实鼠标点击完全相同的种植路径（选卡 → onAttemptPlant → QueueSend），
    // 供双窗口联机 E2E 驱动权威操作。
    plantAt: (pid: number, level: number, col: number, row: number) => {
      CardpileManager.Instance.ClickCard(pid, level);
      CursorManager.Instance.EventBus.emit('onAttemptPlant', col, row);
    },
    // 性能测试专用：单机 mock 房间启动。设置 GameParams 后启动 mockServer，
    // 再复用与真实 UI 相同的 chooseMap + ready 进入 Preloader/Game。
    startSinglePlayerForPerf: (plants: Array<{ pid: number; level: number }>, stageId: number, chapterId: number) => {
      const params: GameParams = {
        level: stageId,
        plants,
        gold: 0,
        gameExit: (result: StageResult) => gameExit(result),
        gameSettings: {
          isBluePrint: false,
          basicDebug: false,
          isBgm: false,
          isSoundAudio: false,
          showCardLevelInGame: false,
        },
      };
      setGameParams(params);
      BackendWS.startSinglePlayerRoom();
      BackendWS.send(Request.toBinary({
        payload: { chooseMap: { chapterId, stageId }, oneofKind: 'chooseMap' },
      }));
      BackendWS.send(Request.toBinary({
        payload: {
          ready: {
            isReady: true,
            loadout: {
              cards: plants,
              level: stageId,
              initialEnergy: 0,
              initialStarShards: 0,
              globalModifiers: [],
            },
          },
          oneofKind: 'ready',
        },
      }));
      window.setTimeout(() => {
        BackendWS.send(Request.toBinary({
          payload: { playerLoaded: { progress: 100 }, oneofKind: 'playerLoaded' },
        }));
        // UI 的 gameStart 由 RoomAllReady 触发；单机 mock 已完成 ready，这里补发一次。
        PhaserEventBus.emit(PhaserEvents.RoomAllReady, { allPlayerCount: 1 });
      }, 50);
      return true;
    },
    // 性能测试专用：只通过 Cmd 层注入确定性的实体/投射物批次。
    // 不直接改 Model 字段，保证 DeferredManager 与帧边界语义一致。
    injectPerfScene: (config: {
      plants: Array<{ pid: number; level: number; col: number; row: number }>;
      zombies: Array<{ mid: number; col: number; row: number; wave?: number }>;
      projectiles: Array<{ x: number; row: number; damage?: number; maxDistance?: number }>;
    }) => {
      const activeScene = getGameScene();
      if (!activeScene) return false;
      for (const item of config.plants ?? []) {
        const model = PlantLibrary.GetModel(item.pid);
        if (model) PlantCmd.Create(model, activeScene, item.col, item.row, item.level);
      }
      for (const item of config.zombies ?? []) {
        MobCmd.Spawn(item.mid, activeScene, item.col, item.row, item.wave ?? 0);
      }
      for (const item of config.projectiles ?? []) {
        ProjectileCmd.Create(BulletModel, activeScene, item.x, item.row, {
          damage: item.damage ?? 1,
          faction: 1,
          maxDistance: item.maxDistance ?? 5000,
          penetratePower: 1,
          skipTiny: false,
        });
      }
      return true;
    },
    getPerfCounts: () => {
      let zombies = 0;
      MobManager.Instance.MobsByLane.forEach((list) => { zombies += list.length; });
      let plants = 0;
      PlantsManager.Instance.PlantsMap.forEach((list) => { plants += list.length; });
      const game = getGameScene();
      return {
        plants,
        zombies,
        projectiles: ProjectileCmd.getActiveProjectiles().length,
        phaserFps: game?.game?.loop?.actualFps ?? null,
        phaserDelta: game?.game?.loop?.delta ?? null,
      };
    },
    showResultForTest: () => gameExit({
      isWin: true,
      chapterId: 1,
      stageId: 1,
      onWin: { unLock: [], unLockPlant: [] },
      rewards: [],
      progress: 100,
    }),
  };
}

/**
 * 注册 `window.MVZ_NET` 调试钩子。
 *
 * 只在 `netDebug=1` 或 `perfHarness=1` 时挂载，普通游戏零开销。
 * 同时在 netDebug 模式下订阅权威帧哈希采样，记录最近一次结果供 E2E 比对。
 */
export function useNetDebugHooks({ saveManager, phaserRef, setGameParams, gameExit }: NetTestHooksParams): void {
  useEffect(() => {
    // 测试钩子：netDebug=1 或 perfHarness=1 时暴露网络状态与测试配置接口。
    // 性能基线用 perfHarness=1，只开测试 API，不开网络字节/console 诊断记录。
    const isHarness = typeof window !== 'undefined'
      && new URLSearchParams(window.location.search).get('perfHarness') === '1';
    if (typeof window === 'undefined' || (!isNetDebugEnabled() && !isHarness)) {
      return;
    }

    // 记录最近一次确定性状态采样，供双窗口联机 E2E 比对两端模拟是否分叉。
    // 只在 netDebug/perfHarness 时订阅，普通游戏零开销。
    let lastHash: { frameId: number; hash: string } | null = null;
    const onHashSampled = (sample: { frameId: number; hash: string }) => {
      lastHash = { frameId: sample.frameId, hash: sample.hash };
    };
    PhaserEventBus.on(PhaserEvents.SimulationHashSampled, onHashSampled);

    const hooks = buildNetTestHooks({ saveManager, phaserRef, setGameParams, gameExit });
    // 将实时采样的最近哈希接到 getSimulationHash 上。
    (hooks as { getSimulationHash: () => { frameId: number; hash: string } }).getSimulationHash = () => (
      lastHash ?? { frameId: 0, hash: '' }
    );
    (window as unknown as { MVZ_NET?: NetTestHooks }).MVZ_NET = hooks;

    return () => {
      PhaserEventBus.off(PhaserEvents.SimulationHashSampled, onHashSampled);
      delete (window as unknown as { MVZ_NET?: NetTestHooks }).MVZ_NET;
    };
  }, [saveManager, phaserRef, setGameParams, gameExit]);
}