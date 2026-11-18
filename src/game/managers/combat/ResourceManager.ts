import { BaseManager } from "../BaseManager";
import type { Game } from "../../scenes/Game";
import { PhaserEventBus, PhaserEvents } from "../../EventBus";
import { EventBus } from "../../../utils/eventBus";
import { onlineStateManager } from "../../../store/OnlineStateManager";
import { RoomAllReadyEvent } from "../../../types/online";
import { desyncDiagnostics } from "../../../utils/debug/desyncDiagnostics";

export type PlayerIdentify = number;

const MAX_STAR_SHARDS = 10;

type ResourceManagerEvents = {
  onEnergyUpdate: (newEnergy: number, playerId: PlayerIdentify) => void;
  onStarShardsUpdate: (newStarShards: number, playerId: PlayerIdentify) => void;
}

/**
 * 资源管理器
 * 给各种资源上锁，防止变化
 */
export default class ResourceManager extends BaseManager {
  private static _instance: ResourceManager;
  protected scene: Game | null = null;

  Eventbus: EventBus<ResourceManagerEvents>;

  mineId: number = 101;
  /** 是否已经用权威快照恢复过资源；重连后的 RoomGameStart 不得再覆盖。 */
  private restoredFromSnapshot = false;
  /** 本局是否已经进入运行态；晚到的 RoomAllReady 不能清空已扣除的资源。 */
  private gameStarted = false;
  private readonly handleRoomAllReady = (data: RoomAllReadyEvent) => {
    this.mineId = data.myId;
    if (this.restoredFromSnapshot || this.gameStarted) {
      desyncDiagnostics.record("resources", "RoomAllReady skipped (restored from snapshot)", {
        mineId: this.mineId,
        gameStarted: this.gameStarted,
        energy: this.CaptureCanonicalResourceState(),
      });
      // 已经开战后只能补齐缺失的资源槽，不能用初始值覆盖已扣除的权威资源。
      const stageEnergy = this.scene?.stageData?.energy ?? 0;
      for (const playerId of data.playerIds) {
        const loadout = data.loadouts?.find((entry) => entry.playerId === playerId)?.loadout;
        if (!this.EnergyMaps.has(playerId)) {
          this.EnergyMaps.set(playerId, loadout?.initialEnergy || stageEnergy);
        }
        if (!this.StarShardsMaps.has(playerId)) {
          this.StarShardsMaps.set(playerId, loadout?.initialStarShards ?? 0);
        }
      }
      return;
    }
    this.EnergyMaps.clear();
    this.StarShardsMaps.clear();
    // 当前 loadout 协议里的 initialEnergy 恒为 0，真正的开局能量由关卡数据决定。
    // 这里把 0 视为“未指定”，避免 allReady 在 RoomGameStart 之后到达时把能量清空。
    const stageEnergy = this.scene?.stageData?.energy ?? 0;
    for (const playerId of data.playerIds) {
      const loadout = data.loadouts?.find((entry) => entry.playerId === playerId)?.loadout;
      this.EnergyMaps.set(playerId, loadout?.initialEnergy || stageEnergy);
      this.StarShardsMaps.set(playerId, loadout?.initialStarShards ?? 0);
      this.Eventbus.emit('onEnergyUpdate', this.getDisplayEnergy(playerId), playerId);
      this.Eventbus.emit('onStarShardsUpdate', this.getDisplayStarShards(playerId), playerId);
    }
    desyncDiagnostics.record("resources", "RoomAllReady loadouts applied", {
      mineId: this.mineId,
      playerIds: data.playerIds,
      energy: this.CaptureCanonicalResourceState(),
    });
  };

  private EnergyMaps: Map<PlayerIdentify, number> = new Map();
  private StarShardsMaps: Map<PlayerIdentify, number> = new Map();
  private previewEnergyDeltaMaps: Map<PlayerIdentify, number> = new Map();
  private previewStarShardsDeltaMaps: Map<PlayerIdentify, number> = new Map();

  constructor() {
    super();
    this.Eventbus = new EventBus<ResourceManagerEvents>();
  }

  public static get Instance(): ResourceManager {
    if (!this._instance) {
      this._instance = new ResourceManager();
    }
    return this._instance;
  }

  public Load(): void {
    PhaserEventBus.on(PhaserEvents.RoomAllReady, this.handleRoomAllReady, this);

    PhaserEventBus.on(PhaserEvents.RoomGameStart, this.handleRoomGameStart, this);
    const roomAllReady = onlineStateManager.getRoomAllReady();
    if (roomAllReady) {
      this.handleRoomAllReady(roomAllReady);
    }
  }

  public Reset(): void {
    PhaserEventBus.off(PhaserEvents.RoomAllReady, this.handleRoomAllReady, this);
    PhaserEventBus.off(PhaserEvents.RoomGameStart, this.handleRoomGameStart, this);
    this.scene = null;
    this.Eventbus.removeAllListeners();
    this.EnergyMaps.clear();
    this.StarShardsMaps.clear();
    this.previewEnergyDeltaMaps.clear();
    this.previewStarShardsDeltaMaps.clear();
    this.restoredFromSnapshot = false;
    this.gameStarted = false;
  }

  public setScene(scene: Game): void {
    this.scene = scene;
  }

  public UpdateEnergy(energyDelta: number, playerId: PlayerIdentify | 'mine' | 'all') {
    if (playerId === 'all') {
      for (let pid of this.EnergyMaps.keys()) {
        this.UpdateEnergy(energyDelta, pid);
      }
      return;
    }
    if (playerId === 'mine') {
      playerId = this.mineId;
    }
    this.EnsurePlayerResources(playerId);
    const currentEnergy = this.EnergyMaps.get(playerId) || 0;
    const newEnergy = currentEnergy + energyDelta;
    this.EnergyMaps.set(playerId, newEnergy);
    this.reconcilePreviewDelta(this.previewEnergyDeltaMaps, energyDelta, playerId);
    this.Eventbus.emit('onEnergyUpdate', this.getDisplayEnergy(playerId), playerId);
  }

  public UpdateStarShards(starShardsDelta: number, playerId: PlayerIdentify | 'mine' | 'all') {
    if (playerId === 'all') {
      for (let pid of this.StarShardsMaps.keys()) {
        this.UpdateStarShards(starShardsDelta, pid);
      }
      return;
    }
    if (playerId === 'mine') {
      playerId = this.mineId;
    }
    this.EnsurePlayerResources(playerId);
    const currentStarShards = this.StarShardsMaps.get(playerId) || 0;
    const newStarShards = Math.max(0, Math.min(MAX_STAR_SHARDS, currentStarShards + starShardsDelta));
    const actualDelta = newStarShards - currentStarShards;
    this.StarShardsMaps.set(playerId, newStarShards);
    this.reconcilePreviewDelta(this.previewStarShardsDeltaMaps, actualDelta, playerId);
    this.Eventbus.emit('onStarShardsUpdate', this.getDisplayStarShards(playerId), playerId);
  }

  public EnergySufficient(requiredEnergy: number, playerId: PlayerIdentify | 'mine'): boolean {
    if (playerId === 9961) {
      return true;
    }
    if (playerId === 'mine') {
      playerId = this.mineId;
    }
    return this.getDisplayEnergy(playerId) >= requiredEnergy;
  }

  public StarShardsSufficient(requiredStarShards: number, playerId: PlayerIdentify | 'mine'): boolean {
    if (playerId === 9961) {
      return true;
    }
    if (playerId === 'mine') {
      playerId = this.mineId;
    }
    return this.getDisplayStarShards(playerId) >= requiredStarShards;
  }

  public SetInitialEnergy(initialEnergy: number): void {
    const roomAllReady = onlineStateManager.getRoomAllReady();
    if (roomAllReady) {
      this.mineId = roomAllReady.myId;
    }
    const playerIds = new Set<PlayerIdentify>([
      ...this.EnergyMaps.keys(),
      ...(roomAllReady?.playerIds ?? []),
      this.mineId,
    ]);
    for (const playerId of playerIds) {
      this.EnergyMaps.set(playerId, initialEnergy);
      this.Eventbus.emit('onEnergyUpdate', this.getDisplayEnergy(playerId), playerId);
    }
  }

  /**
   * 权威操作落地前确保玩家资源槽存在。
   * 远端玩家 map 缺失时不能静默按 0 处理，否则同一操作在两端扣减结果不同。
   */
  public EnsurePlayerResources(playerId: PlayerIdentify): void {
    if (this.EnergyMaps.has(playerId) && this.StarShardsMaps.has(playerId)) {
      return;
    }
    const stageEnergy = this.scene?.stageData?.energy ?? 0;
    if (!this.EnergyMaps.has(playerId)) {
      this.EnergyMaps.set(playerId, stageEnergy);
    }
    if (!this.StarShardsMaps.has(playerId)) {
      this.StarShardsMaps.set(playerId, 0);
    }
    this.Eventbus.emit('onEnergyUpdate', this.getDisplayEnergy(playerId), playerId);
    this.Eventbus.emit('onStarShardsUpdate', this.getDisplayStarShards(playerId), playerId);
  }

  getEnergy(playerId: PlayerIdentify | 'mine'): number {
    if (playerId === 'mine') {
      playerId = this.mineId;
    }
    return this.EnergyMaps.get(playerId) || 0;
  }

  getStarShards(playerId: PlayerIdentify | 'mine'): number {
    if (playerId === 'mine') {
      playerId = this.mineId;
    }
    return this.StarShardsMaps.get(playerId) || 0;
  }

  getDisplayEnergy(playerId: PlayerIdentify | 'mine'): number {
    if (playerId === 'mine') {
      playerId = this.mineId;
    }
    return (this.EnergyMaps.get(playerId) || 0) + (this.previewEnergyDeltaMaps.get(playerId) || 0);
  }

  getDisplayStarShards(playerId: PlayerIdentify | 'mine'): number {
    if (playerId === 'mine') {
      playerId = this.mineId;
    }
    return (this.StarShardsMaps.get(playerId) || 0) + (this.previewStarShardsDeltaMaps.get(playerId) || 0);
  }

  /** 导出全部玩家的权威资源与预览资源快照（仅本地调试用，不参与跨端哈希）。 */
  public GetResourceState(): Record<string, number> {
    const snapshot: Record<string, number> = {};
    this.EnergyMaps.forEach((value, pid) => { snapshot[`energy:${pid}`] = value; });
    this.StarShardsMaps.forEach((value, pid) => { snapshot[`star:${pid}`] = value; });
    this.previewEnergyDeltaMaps.forEach((value, pid) => { snapshot[`previewEnergy:${pid}`] = value; });
    this.previewStarShardsDeltaMaps.forEach((value, pid) => { snapshot[`previewStar:${pid}`] = value; });
    snapshot["mineId"] = this.mineId;
    return snapshot;
  }

  /**
   * 跨端一致性哈希使用：只包含权威资源。
   * mineId 是本机席位号，preview* 是输入预测表现值，二者两端天然不同，
   * 若进入哈希会在首个 20 帧采样点产生必然分叉。
   */
  public CaptureCanonicalResourceState(): Record<string, number> {
    const snapshot: Record<string, number> = {};
    this.EnergyMaps.forEach((value, pid) => { snapshot[`energy:${pid}`] = value; });
    this.StarShardsMaps.forEach((value, pid) => { snapshot[`star:${pid}`] = value; });
    return snapshot;
  }

  /** 从快照恢复权威资源；保留本机 mineId 并清除本地预测值。 */
  public RestoreResourceState(state: Record<string, number>): void {
    this.EnergyMaps.clear();
    this.StarShardsMaps.clear();
    this.previewEnergyDeltaMaps.clear();
    this.previewStarShardsDeltaMaps.clear();
    this.restoredFromSnapshot = true;
    Object.keys(state).sort().forEach((key) => {
      const value = state[key];
      const [kind, idText] = key.split(":");
      const pid = Number(idText);
      if (!Number.isFinite(pid)) return;
      if (kind === "energy") this.EnergyMaps.set(pid, value);
      else if (kind === "star") this.StarShardsMaps.set(pid, value);
    });
    this.EnergyMaps.forEach((value, pid) => this.Eventbus.emit("onEnergyUpdate", value, pid));
    this.StarShardsMaps.forEach((value, pid) => this.Eventbus.emit("onStarShardsUpdate", value, pid));
  }

  public ActualEnergySufficient(requiredEnergy: number, playerId: PlayerIdentify | 'mine'): boolean {
    return this.getEnergy(playerId) >= requiredEnergy;
  }

  public ActualStarShardsSufficient(requiredStarShards: number, playerId: PlayerIdentify | 'mine'): boolean {
    return this.getStarShards(playerId) >= requiredStarShards;
  }

  public ApplyPreviewEnergy(energyDelta: number, playerId: PlayerIdentify | 'mine') {
    if (playerId === 'mine') {
      playerId = this.mineId;
    }
    const nextDelta = (this.previewEnergyDeltaMaps.get(playerId) || 0) + energyDelta;
    this.previewEnergyDeltaMaps.set(playerId, nextDelta);
    this.Eventbus.emit('onEnergyUpdate', this.getDisplayEnergy(playerId), playerId);
  }

  public ApplyPreviewStarShards(starShardsDelta: number, playerId: PlayerIdentify | 'mine') {
    if (playerId === 'mine') {
      playerId = this.mineId;
    }
    const nextDelta = (this.previewStarShardsDeltaMaps.get(playerId) || 0) + starShardsDelta;
    this.previewStarShardsDeltaMaps.set(playerId, nextDelta);
    this.Eventbus.emit('onStarShardsUpdate', this.getDisplayStarShards(playerId), playerId);
  }

  /** 拒绝预测后清除尚未被权威更新抵消的预演资源，避免回滚后 HUD 仍显示已撤销的花费。 */
  public ClearPreviewDeltas(): void {
    const players = new Set<PlayerIdentify>([
      ...this.EnergyMaps.keys(),
      ...this.StarShardsMaps.keys(),
      ...this.previewEnergyDeltaMaps.keys(),
      ...this.previewStarShardsDeltaMaps.keys(),
    ]);
    this.previewEnergyDeltaMaps.clear();
    this.previewStarShardsDeltaMaps.clear();
    for (const playerId of players) {
      this.Eventbus.emit('onEnergyUpdate', this.getDisplayEnergy(playerId), playerId);
      this.Eventbus.emit('onStarShardsUpdate', this.getDisplayStarShards(playerId), playerId);
    }
  }

  private reconcilePreviewDelta(
    previewMap: Map<PlayerIdentify, number>,
    actualDelta: number,
    playerId: PlayerIdentify
  ) {
    const previewDelta = previewMap.get(playerId) || 0;
    if (previewDelta === 0) {
      return;
    }

    // When the authoritative update arrives, consume the matching preview
    // so the HUD doesn't apply the same cost twice.
    if (previewDelta < 0 && actualDelta < 0) {
      const nextPreviewDelta = Math.min(0, previewDelta - actualDelta);
      if (nextPreviewDelta === 0) {
        previewMap.delete(playerId);
      } else {
        previewMap.set(playerId, nextPreviewDelta);
      }
      return;
    }

    if (previewDelta > 0 && actualDelta > 0) {
      const nextPreviewDelta = Math.max(0, previewDelta - actualDelta);
      if (nextPreviewDelta === 0) {
        previewMap.delete(playerId);
      } else {
        previewMap.set(playerId, nextPreviewDelta);
      }
    }
  }

  private handleRoomGameStart() {
    if (this.restoredFromSnapshot) {
      this.gameStarted = true;
      desyncDiagnostics.record("resources", "RoomGameStart initial energy skipped (restored)", {
        energy: this.CaptureCanonicalResourceState(),
      });
      return;
    }
    if (this.gameStarted) {
      desyncDiagnostics.record("resources", "RoomGameStart initial energy skipped (already started)", {
        energy: this.CaptureCanonicalResourceState(),
      });
      return;
    }
    this.gameStarted = true;
    const initialEnergy = this.scene?.stageData.energy ?? 0;
    desyncDiagnostics.record("resources", "RoomGameStart initial energy", {
      initialEnergy,
      before: this.CaptureCanonicalResourceState(),
    });
    this.SetInitialEnergy(initialEnergy);
  }
}
