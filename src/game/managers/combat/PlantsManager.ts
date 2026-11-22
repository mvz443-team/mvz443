import { EventBus } from "../../../utils/eventBus";
import { Faction } from "../../models/Enum";
import { PlantEntity } from "../../models/entities/PlantEntity";
import PlantHelper from "../../utils/helper/PlantHelper";
import { BaseManager } from "../BaseManager";
import { DeferredManager } from "../DeferredManager";
import { PlantLibrary } from "../library/PlantLibrary";
import CardpileManager from "./CardpileManager";
import CursorManager from "./CursorManager";
import GridManager from "./GridManager";
import ResourceManager, { PlayerIdentify } from "./ResourceManager";
import SyncManager from "./SyncManager";
import type { AuthoritativeOperationRequest, OperationApplyResult } from "./SyncManager";
import SoundCmd from "../../utils/cmd/SoundCmd";
import CombatManager from "../CombatManager";
import { desyncDiagnostics } from "../../../utils/debug/desyncDiagnostics";

type PlantsManagerEvent = {
  // 用户决定操作事件，之后要在send_queue监听
  onDeterminePlant: (pid: number, level: number, col: number, row: number, cost: number) => void;
  onDetermineUseStarShards: (pid: number, col: number, row: number, cost: number) => void;
  onDetermineRemovePlant: (pid: number, col: number, row: number) => void;

  // sfx 反馈，没能量但是想种植高昂植物
  onEnergyInsufficient: () => void;
  onStarshardsInsufficient: () => void;
}

type SightLineReflectorPlant = PlantEntity & {
  canExtendSightLineFor?: (faction: Faction) => boolean;
};

export default class PlantsManager extends BaseManager {
  private static _instance: PlantsManager;

  public EventBus: EventBus<PlantsManagerEvent>;

  PlantsMap: Map<string, Array<PlantEntity>> = new Map();
  PlantsByLane: Map<number, Array<PlantEntity>> = new Map();
  SightLineReflectorsByLane: Map<number, Array<SightLineReflectorPlant>> = new Map();

  constructor() {
    super();

    this.PlantsMap = new Map();
    this.PlantsByLane = new Map();
    this.SightLineReflectorsByLane = new Map();
    this.EventBus = new EventBus<PlantsManagerEvent>();
  }

  public Load(): void {
    CursorManager.Instance.EventBus.on('onAttemptPlant', this.handleAttemptPlant);
    CursorManager.Instance.EventBus.on('onAttemptUseStarShards', this.handleAttemptUseStarShards);
    CursorManager.Instance.EventBus.on('onAttemptRemovePlant', this.handleAttemptRemovePlant);

    SyncManager.Instance.Eventbus.on('onRequestPlant', this.PlantCard);
    SyncManager.Instance.Eventbus.on('onRequestUseStarShards', this.LaunchStarShards);
    SyncManager.Instance.Eventbus.on('onRequestRemovePlant', this.UprootPlant);
  }

  public Reset() {
    CursorManager.Instance.EventBus.off('onAttemptPlant', this.handleAttemptPlant);
    CursorManager.Instance.EventBus.off('onAttemptUseStarShards', this.handleAttemptUseStarShards);
    CursorManager.Instance.EventBus.off('onAttemptRemovePlant', this.handleAttemptRemovePlant);
    SyncManager.Instance.Eventbus.off('onRequestPlant', this.PlantCard);
    SyncManager.Instance.Eventbus.off('onRequestUseStarShards', this.LaunchStarShards);
    SyncManager.Instance.Eventbus.off('onRequestRemovePlant', this.UprootPlant);
    this.PlantsMap.clear();
    this.PlantsByLane.clear();
    this.SightLineReflectorsByLane.clear();
    this.EventBus.removeAllListeners();
    this.scene = null;
  }

  public static get Instance(): PlantsManager {
    if (!this._instance) {
      this._instance = new PlantsManager();
    }
    return this._instance;
  }

  /** 快照对账：从容器移除植物（不重复扣资源/冷却）。 */
  public UnregisterPlant(plant: PlantEntity): void {
    const key = `${plant.col}-${plant.row}`;
    const list = this.PlantsMap.get(key);
    if (list) {
      const index = list.indexOf(plant);
      if (index >= 0) list.splice(index, 1);
      if (list.length === 0) this.PlantsMap.delete(key);
    }

    const lane = this.PlantsByLane.get(plant.row);
    if (lane) {
      const index = lane.indexOf(plant);
      if (index >= 0) lane.splice(index, 1);
      if (lane.length === 0) this.PlantsByLane.delete(plant.row);
    }

    const reflectors = this.SightLineReflectorsByLane.get(plant.row);
    if (reflectors) {
      const index = reflectors.indexOf(plant as unknown as typeof reflectors[number]);
      if (index >= 0) reflectors.splice(index, 1);
      if (reflectors.length === 0) this.SightLineReflectorsByLane.delete(plant.row);
    }
  }

  /** 快照恢复：用同一 pid/坐标重建植物，使其计时器组与快照对齐。 */
  public RebuildPlant(pid: number, col: number, row: number, level: number): PlantEntity | null {
    if (!this.scene) return null;
    const model = PlantLibrary.GetModel(pid);
    if (!model) return null;
    return model.createEntity(this.scene, col, row, level);
  }

  // 从管理器注册植物
  public RegisterPlant(plant: PlantEntity) {
    const key = `${plant.col}-${plant.row}`;
    if (!this.PlantsMap.has(key)) {
      this.PlantsMap.set(key, [plant]);
    } else {
      this.PlantsMap.get(key)?.push(plant);
    }

    const lane = plant.row;
    if (!this.PlantsByLane.has(lane)) {
      this.PlantsByLane.set(lane, [plant]);
    } else {
      this.PlantsByLane.get(lane)?.push(plant);
    }

    const reflector = plant as SightLineReflectorPlant;
    if (reflector.canExtendSightLineFor) {
      if (!this.SightLineReflectorsByLane.has(lane)) {
        this.SightLineReflectorsByLane.set(lane, [reflector]);
      } else {
        this.SightLineReflectorsByLane.get(lane)?.push(reflector);
      }
    }
  }

  // 从管理器注销植物
  public RegisterDestroy(plant: PlantEntity) {
    const key = `${plant.col}-${plant.row}`;
    if (this.PlantsMap.has(key)) {
      const list = this.PlantsMap.get(key);
      if (list) {
        const index = list.indexOf(plant);
        if (index >= 0) {
          list.splice(index, 1);
        }
        if (list.length === 0) {
          this.PlantsMap.delete(key);
        }
      }
    }

    const lanePlants = this.PlantsByLane.get(plant.row);
    if (lanePlants) {
      const index = lanePlants.indexOf(plant);
      if (index >= 0) {
        lanePlants.splice(index, 1);
      }
      if (lanePlants.length === 0) {
        this.PlantsByLane.delete(plant.row);
      }
    }

    const laneReflectors = this.SightLineReflectorsByLane.get(plant.row);
    if (laneReflectors) {
      const index = laneReflectors.indexOf(plant as SightLineReflectorPlant);
      if (index >= 0) {
        laneReflectors.splice(index, 1);
      }
      if (laneReflectors.length === 0) {
        this.SightLineReflectorsByLane.delete(plant.row);
      }
    }
  }

  public GetPlantsByLane(row: number): Array<PlantEntity> | undefined {
    return this.PlantsByLane.get(row);
  }

  public GetSightLineReflectorsByLane(row: number): Array<SightLineReflectorPlant> | undefined {
    return this.SightLineReflectorsByLane.get(row);
  }

  /**
   * 权威帧执行前的合法性检查。服务端只校验目标帧的格子冲突，玩家延迟不同
   * 时 A/B 可能分别排到相邻帧并在同一格种下两株植物；客户端必须在权威历史
   * 重放到该帧后，根据恢复出的实体/资源/冷却状态再校验一次。
   */
  public CanApplyAuthoritativeOperation(
    kind: "plant" | "removePlant" | "starShards",
    playerId: PlayerIdentify,
    pid: number,
    level: number,
    col: number,
    row: number,
    requireSelfResources: boolean,
  ): boolean {
    const isGiftPlant = playerId === 9961;
    const existedPlants = this.PlantsMap.get(`${col}-${row}`) || [];
    const targetPlant = existedPlants.find((plant) => plant.model.pid === pid);
    const authoritative = !CombatManager.Instance.isDesyncOffline();

    if (kind === "plant") {
      const model = PlantLibrary.GetModel(pid);
      if (!model) return false;
      const cost = model.cost.getValueAt(level);
      // 只有操作发起端能校验自己的资源；远端不持有发起者资源账本。
      if (requireSelfResources && !isGiftPlant
        && !ResourceManager.Instance.ActualEnergySufficient(cost, playerId)) {
        this.rejectAuthoritativeOperation(kind, playerId, pid, col, row, "energy insufficient");
        return false;
      }
      if (requireSelfResources && !isGiftPlant && playerId === ResourceManager.Instance.mineId) {
        if (!CardpileManager.Instance.isCardActuallyReloaded(pid) && !authoritative) {
          this.rejectAuthoritativeOperation(kind, playerId, pid, col, row, "card cooldown");
          return false;
        }
      }
      const targetGridProperty = GridManager.Instance.GetGridProperty(col, row);
      if (!targetGridProperty
        || !PlantHelper.CanPlantInGrid(existedPlants, pid, targetGridProperty, PlantLibrary.GetModel(pid))) {
        this.rejectAuthoritativeOperation(kind, playerId, pid, col, row, "grid occupied");
        return false;
      }
      return true;
    }

    if (!targetPlant) {
      this.rejectAuthoritativeOperation(kind, playerId, pid, col, row, "target missing");
      return false;
    }
    if (kind === "starShards"
      && requireSelfResources
      && !ResourceManager.Instance.ActualStarShardsSufficient(1, playerId)) {
      this.rejectAuthoritativeOperation(kind, playerId, pid, col, row, "star shards insufficient");
      return false;
    }
    return true;
  }

  private rejectAuthoritativeOperation(
    kind: string,
    playerId: PlayerIdentify,
    pid: number,
    col: number,
    row: number,
    reason: string,
  ): void {
    desyncDiagnostics.record("sync", "authoritative operation rejected by restored state", {
      kind,
      playerId,
      pid,
      col,
      row,
      reason,
      frameId: SyncManager.Instance.GetFrameID(),
    });
  }

  private canApplyAuthoritativeRequest(request: AuthoritativeOperationRequest): boolean {
    return this.CanApplyAuthoritativeOperation(
      request.kind,
      request.playerId,
      request.pid,
      request.level,
      request.col,
      request.row,
      request.playerId === ResourceManager.Instance.mineId,
    );
  }

  // 种植植物
  PlantCard = (request: AuthoritativeOperationRequest): OperationApplyResult => {
    if (!this.scene) return { ok: false, reason: "scene missing" };
    const { playerId, pid, level, col, row } = request;
    const isGiftPlant = playerId === 9961;
    // 联机权威帧路径：服务端已确认该操作，不能再拿本地卡槽/能量/占位状态
    // 二次拒绝，否则一端会静默跳过实体创建，另一端正常创建，下一帧立即分叉。
    // 分叉离线单机模式没有服务端确认，仍保留完整本地校验。
    const authoritative = !CombatManager.Instance.isDesyncOffline();
    // 种植
    const model = PlantLibrary.GetModel(pid);
    if (!model) {
      console.error(`[SpawnPlant] Failed to spawn: Plant with pid ${pid} does not exist.`);
      return { ok: false, reason: "plant model missing" };
    }

    // 如果playerId为我，cardpile是否有这张牌，以及是否正在冷却
    if (!authoritative && !isGiftPlant && playerId === ResourceManager.Instance.mineId) {
      if (!CardpileManager.Instance.isCardActuallyReloaded(pid)) {
        return { ok: false, reason: "card cooldown" };
      }
    }

    const cost = model.cost.getValueAt(level);
    if (!authoritative && !isGiftPlant && !ResourceManager.Instance.ActualEnergySufficient(cost, playerId)) {
      if (playerId === ResourceManager.Instance.mineId) {
        this.EventBus.emit('onEnergyInsufficient');
      }
      return { ok: false, reason: "energy insufficient" };
    }

    const existedPlants = this.PlantsMap.get(`${col}-${row}`) || [];
    const targetGridProperty = GridManager.Instance.GetGridProperty(col, row);

    // 如果格子属性不存在，默认不允许种植
    if (!targetGridProperty) return { ok: false, reason: "invalid grid" };

    if (authoritative
      && !this.canApplyAuthoritativeRequest(request)) {
      // 服务端已确认，但本地权威历史判定该操作非法；放弃落地，防止同格双植物。
      // 预演由 SyncManager 按操作最终成功/失败结果统一收口。
      return { ok: false, reason: "authoritative plant rejected" };
    }

    // 占位规则是本地输入校验；权威操作已经由发起端校验，不能再因另一端
    // 暂时的实体集合差异而拒绝落地。
    if (!authoritative
      && !PlantHelper.CanPlantInGrid(existedPlants, pid, targetGridProperty, PlantLibrary.GetModel(pid))) {
      return { ok: false, reason: "grid occupied" };
    }

    // 扣除资源，冷却等
    ResourceManager.Instance.EnsurePlayerResources(playerId);
    if (!isGiftPlant) {
      ResourceManager.Instance.UpdateEnergy(-cost, playerId);
    }
    if (!isGiftPlant && playerId === ResourceManager.Instance.mineId) {
      CardpileManager.Instance.reloadCard(pid);
      SoundCmd.PlayPlant('placePlant');
    }

    DeferredManager.Instance.defer(() => {
      if (!this.scene) return;
      // 一次性植物在确定性帧内直接结算效果，不创建 Entity / 物理体 / 存活定时器。
      if (model.isOneTimePlant) {
        model.applyInstantEffect(this.scene, col, row, level, model.faction);
        return;
      }
      // 基本规则：高级植物在这里统一替换 requiredBasePid 指定的基座并继承睡眠。
      PlantHelper.CreateEntityWithBaseReplacement(this.scene, col, row, level, model);
    });
    return { ok: true };
  }

  /** 关卡预设的赠送植物不经过网络，仍使用原有调用形状。 */
  PlantCardDirect = (
    playerId: PlayerIdentify,
    pid: number,
    level: number,
    col: number,
    row: number,
  ): OperationApplyResult => this.PlantCard({
    kind: "plant",
    playerId,
    pid,
    level,
    col,
    row,
    clientOpSeq: 0,
    cost: PlantLibrary.GetModel(pid)?.cost.getValueAt(level) ?? 0,
  });

  // 铲子移除植物
  private UprootPlant = (request: AuthoritativeOperationRequest): OperationApplyResult => {
    const { pid, col, row } = request;
    const authoritative = !CombatManager.Instance.isDesyncOffline();
    const target = (this.PlantsMap.get(`${col}-${row}`) ?? [])
      .find((plant) => plant.model.pid === pid);
    if (!target) return { ok: false, reason: "target missing" };
    if (authoritative && !this.canApplyAuthoritativeRequest(request)) {
      return { ok: false, reason: "authoritative remove rejected" };
    }
    // 铲除没有 playerId：接受任意存活植物，只按 pid/格校验权威历史。
    DeferredManager.Instance.defer(() => {
      const key = `${col}-${row}`;
      if (this.PlantsMap.has(key)) {
        const list = this.PlantsMap.get(key);
        if (list) {
          const index = list.findIndex(plant => plant.model.pid === pid);
          if (index >= 0) {
            const plantObj = list[index];
            plantObj.destroy();
            SoundCmd.PlayPlant('RemovePlant');
          }
        }
      }
    });
    return { ok: true };
  }

  // 启动星之碎片效果
  private LaunchStarShards = (request: AuthoritativeOperationRequest): OperationApplyResult => {
    const { playerId, pid, col, row } = request;
    const authoritative = !CombatManager.Instance.isDesyncOffline();
    if (authoritative
      && !this.canApplyAuthoritativeRequest(request)) {
      return { ok: false, reason: "authoritative star shards rejected" };
    }
    if (!authoritative && !ResourceManager.Instance.ActualStarShardsSufficient(1, playerId)) {
      return { ok: false, reason: "star shards insufficient" };
    }

    const key = `${col}-${row}`;
    if (this.PlantsMap.has(key)) {
      const list = this.PlantsMap.get(key);
      if (list) {
        const index = list.findIndex(plant => plant.model.pid === pid);
        if (index >= 0) {
          const plantObj = list[index];
          // 扣除资源
          ResourceManager.Instance.EnsurePlayerResources(playerId);
          ResourceManager.Instance.UpdateStarShards(-1, playerId);
          DeferredManager.Instance.defer(() => {
            plantObj.useStarShards();
          });

          return { ok: true };
        }
      }
    }
    return { ok: false, reason: "target missing" };
  }

  handleAttemptUseStarShards = (col: number, row: number, aspect: 'up' | 'down') => {
    const plants = this.PlantsMap.get(`${col}-${row}`) || [];
    // 与悬停预览共用同一份规则：看到哪个就打哪个。
    const targetPlant = PlantHelper.GetStarShardsTarget(plants, aspect);
    if (!targetPlant) return;
    // 如果星之碎片余量充足,则发动效果
    if (ResourceManager.Instance.StarShardsSufficient(1, 'mine')) {
      // 联机预演统一由 SyncManager 在请求成功入队后应用；这里重复预演会让
      // 失败路径只撤销一份，HUD 永久残留已撤销的花费。
      this.EventBus.emit('onDetermineUseStarShards', targetPlant.pid, col, row, 1);
    }
  }

  handleAttemptRemovePlant = (col: number, row: number, aspect: 'up' | 'down') => {
    const plants = this.PlantsMap.get(`${col}-${row}`) || [];
    // 与悬停高亮共用同一份规则：看到哪个就铲哪个。
    const targetPlant = PlantHelper.GetRemovePlantTarget(plants, aspect);
    if (!targetPlant) return;
    this.EventBus.emit('onDetermineRemovePlant', targetPlant.pid, col, row);
  }

  handleAttemptPlant = (col: number, row: number) => {
    const [pid, level] = CardpileManager.Instance.prePlantPid || [];
    if (pid === undefined || level === undefined) return;
    // cardpile是否有这张牌，以及是否正在冷却
    if (!CardpileManager.Instance.isCardDisplayReloaded(pid)) return;

    // 阳光是否存在
    const model = PlantLibrary.GetModel(pid);
    if (!model) {
      console.error(`[AttemptPlant] Failed to attempt plant: Plant with pid ${pid} does not exist.`);
      return;
    }
    const cost = model.cost.getValueAt(level);
    if (!ResourceManager.Instance.EnergySufficient(cost, 'mine')) {
      this.EventBus.emit('onEnergyInsufficient');
      return;
    }

    const existedPlants = this.PlantsMap.get(`${col}-${row}`) || [];
    const targetGridProperty = GridManager.Instance.GetGridProperty(col, row);

    // 如果格子属性不存在，默认不允许种植
    if (!targetGridProperty) return false;

    // 格子允许种植
    if (!PlantHelper.CanPlantInGrid(existedPlants, pid, targetGridProperty, model)) return;

    // 种植
    this.EventBus.emit('onDeterminePlant', pid, level, col, row, cost);
  }
}
