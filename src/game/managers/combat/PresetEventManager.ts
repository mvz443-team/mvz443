import { setCentipedeHooks } from "../../presets/monster/centipede/centipede";
import DepthHelper from "../../utils/helper/DepthHelper";
import type { Game } from "../../scenes/Game";
import ResourceCmd from "../../utils/cmd/ResourceCmd";
import { BaseManager } from "../BaseManager";
import CombatManager from "../CombatManager";
import { PositionManager } from "../view/PositionManager";
import GridManager from "./GridManager";
import MobManager from "./MobManager";
import PlantsManager from "./PlantsManager";
import ResourceManager from "./ResourceManager";
import TickerManager, { FrameTimer } from "./TickerManager";
import { LOGICAL_BATTLE_HEIGHT, LOGICAL_BATTLE_WIDTH } from "../../../constants/gameLayout";
import { desyncDiagnostics } from "../../../utils/debug/desyncDiagnostics";
import { defaultRandom } from "../../../utils/random";
import { StageLibrary } from "../../stages/StageLibrary";
import { WATER_TILE_VARIANT_COUNT, waterTileTextureKey } from "../../stages/waterTiles";
import type {
  GridCell,
  GridCellArgs,
  LevelScript,
  LevelScriptContext,
  StageEventFlagKey,
} from "../../stages/types";
import { playCollapseSfx, playLightRemovalSfx } from "../../sfx/map/StageMapViewSfx";

/**
 * 预设事件管理：关卡脚本的通用调度器。
 *
 * 关卡特有逻辑（赠送植物、初始水路、波次事件等）全部在 `src/game/stages/**` 的
 * 关卡脚本里声明；本类只负责：
 * - 在权威帧的 onNewWave 回调里调用脚本的 onCombatStart / onWaveStart；
 * - 提供 LevelScriptContext（改格子、昼夜、停产能、事件标记、纯表现）；
 * - 维护自动产能、初始能量等所有关卡共用的基础设施。
 *
 * 事件标记（stage22Collapsed / stage36LightRemoved）为具名快照布尔，注册进
 * RuntimeStateBridge，随回滚/重连恢复；脚本通过 ctx.getFlag/setFlag 访问。
 */
export class PresetEventManager extends BaseManager {
  private static _instance: PresetEventManager;
  private onNewWaveHandler: ((waveId: number, isFlag: boolean) => void) | null = null;
  private autoEnergyTimer: FrameTimer | null = null;
  private autoEnergyStartTimer: FrameTimer | null = null;

  /** 关卡事件触发标记（具名快照布尔，进快照 + 跨端哈希）。 */
  public stage22Collapsed: boolean = false;
  public stage36LightRemoved: boolean = false;
  /**
   * 崩塌逻辑水格是否已由可恢复计时器改写（进快照 + 跨端哈希）。
   * 与 stage22Collapsed（表现标记）分离：动画先播，逻辑水格延迟 600ms 生效。
   */
  public stage22CollapseWater: boolean = false;

  /** 延迟崩塌逻辑水格的 timer kind，工厂回调与 args 均为 JSON 安全、可重建。 */
  private static readonly STAGE_COLLAPSE_WATER_TIMER = "preset.stageCollapseWater";

  /** 纯视图对象：水面覆盖层 + 暗场遮罩，不进快照，由标记/脚本驱动重建。 */
  private waterTileObjects: Phaser.GameObjects.GameObject[] = [];
  private waterTileSignature: string = "";
  private darkOverlays: Phaser.GameObjects.Rectangle[] = [];
  private cachedContext: LevelScriptContext | null = null;

  public static get Instance(): PresetEventManager {
    if (!this._instance) {
      this._instance = new PresetEventManager();
    }
    return this._instance;
  }

  /**
   * 加载预设事件
   */
  public Load(): void {
    // checkpoint rebuild 恢复全局 ticker 时需要重新构造自动产能回调??
    TickerManager.Instance.registerTimerFactory("preset.autoEnergy", (args) => {
      const delta = args && typeof args === "object" && !Array.isArray(args)
        ? Number((args as Record<string, unknown>).delta)
        : NaN;
      if (!Number.isFinite(delta)) return null;
      return { callback: () => this.autoGenerateEnergyTick(delta) };
    });
    TickerManager.Instance.registerTimerFactory("preset.autoEnergyStart", (args) => {
      if (!args || typeof args !== "object" || Array.isArray(args)) return null;
      const record = args as Record<string, unknown>;
      const delta = Number(record.delta);
      const intervalMs = Number(record.intervalMs);
      if (!Number.isFinite(delta) || !Number.isFinite(intervalMs)) return null;
      return { callback: () => this.beginAutoGenerateEnergy(intervalMs, delta) };
    });
    // 崩塌逻辑水格：从纯 JSON args 重建稳定回调，重连/回滚后不依赖闭包。
    TickerManager.Instance.registerTimerFactory(PresetEventManager.STAGE_COLLAPSE_WATER_TIMER, (args) => {
      const cells = PresetEventManager.parseCellArgs(args);
      if (!cells) return null;
      return { callback: () => this.applyStageCollapseWater(cells) };
    });
    // 监听 MobManager ??onNewWave 事件
    this.onNewWaveHandler = (waveId: number, isFlag: boolean) => {
      if (waveId === 0) {
        this.triggerCombatStartEvent();
      } else {
        this.triggerSpecifiedWaveEvent(waveId, isFlag);
      }
    };
    MobManager.Instance.EventBus.on('onNewWave', this.onNewWaveHandler);
  }

  /**
   * 游戏开始时触发 (waveId = 0)
   */
  private triggerCombatStartEvent(): void {
    if (!this.scene) {
      console.warn('PresetEventManager: scene is not set. Cannot trigger combat start event.');
      return;
    }
    console.log('Combat start event triggered at wave 0');
    // wave 0 是一局的权威起点：回滚重放或跨局重启时都应清空地图事件标记与上下文。
    this.stage22Collapsed = false;
    this.stage22CollapseWater = false;
    this.stage36LightRemoved = false;
    this.cachedContext = null;
    TickerManager.Instance.removeTimersByKind(PresetEventManager.STAGE_COLLAPSE_WATER_TIMER);

    GridManager.Instance.initGridProperties();

    this.setInitialEnergy(this.scene.stageData.energy);
    // dayOrNight 触发自动产能
    CombatManager.Instance.combatStatus.dayOrNight = this.scene.stageData.stageScript.dayOrNight === 2 ?
      false : true;
    if (CombatManager.Instance.combatStatus.dayOrNight) {
      this.startAutoGenerateEnergy(17000, 25000, 25);
    }

    const ctx = this.getContext();
    if (ctx) this.getScript()?.onCombatStart?.(ctx);
  }

  /**
   * 特定波数触发的事??
   *
   * 由 MobManager 在固定权威帧 emit 的 onNewWave 驱动，两端一致。
   * 关卡脚本的 onWaveStart 必须幂等：回滚重放时 onNewWave 会再次触发。
   */
  private triggerSpecifiedWaveEvent(waveId: number, isFlag: boolean): void {
    void isFlag;
    const script = this.getScript();
    if (!script?.onWaveStart) return;
    const ctx = this.getContext();
    if (ctx) script.onWaveStart(ctx, waveId);
  }

  /**
   * 从脚本 + 快照标记重建地图事件视图。在 render 更新里每帧调用（幂等、廉价），
   * 也在事件触发与 checkpoint 恢复后调用，保证回滚/重连后表现与状态一致。
   */
  public syncStageMapView(): void {
    const script = this.getScript();
    if (!script?.syncView) return;
    const ctx = this.getContext();
    if (ctx) script.syncView(ctx);
  }

  /**
   * checkpoint 恢复后的钩子：把视图对齐到快照标记。
   * 只重建视图，不改逻辑状态：dayOrNight 与产能 timer 各有独立快照源，
   * 由 SimulationState 统一恢复。
   */
  public applyRestoredStageMapState(): void {
    this.syncStageMapView();
  }

  /** 取当前关卡的脚本（未加载则返回 null）。 */
  private getScript(): LevelScript | null {
    const stageId = this.scene?.params?.level;
    if (!stageId) return null;
    return StageLibrary.getLoaded(stageId)?.script ?? null;
  }

  /** 构建并缓存关卡脚本上下文（每局/每次 Reset 后重建）。 */
  private getContext(): LevelScriptContext | null {
    if (!this.scene) return null;
    if (this.cachedContext) return this.cachedContext;
    const scene = this.scene;
    const pos = PositionManager.Instance;
    const ctx: LevelScriptContext = {
      stageId: scene.params.level,
      rows: pos.Row_Number,
      cols: pos.Col_Number,
      giftPlant: (pid, level, col, row) => {
        PlantsManager.Instance.PlantCardDirect(9961, pid, level, col, row);
      },
      fillRowWater: (row) => {
        for (let col = 0; col < pos.Col_Number; col++) {
          GridManager.Instance.setSingleGridProperty(col, row, { type: "water" });
        }
      },
      setCellWater: (col, row) => {
        GridManager.Instance.setSingleGridProperty(col, row, { type: "water" });
      },
      scheduleCellWater: (cells, delayMs) => this.scheduleCellWater(cells, delayMs),
      addDarkOverlay: (alpha) => {
        const rect = scene.add.rectangle(
          LOGICAL_BATTLE_WIDTH / 2, LOGICAL_BATTLE_HEIGHT / 2,
          LOGICAL_BATTLE_WIDTH, LOGICAL_BATTLE_HEIGHT, 0x000000, alpha,
        ).setDepth(DepthHelper.Scene.presetOverlay());
        this.darkOverlays.push(rect);
      },
      setDayOrNight: (day) => {
        CombatManager.Instance.combatStatus.dayOrNight = day;
      },
      stopAutoEnergy: () => this.stopAutoGenerateEnergy(),
      registerBossHooks: (hooks) => setCentipedeHooks(hooks),
      playCollapseVisual: (cells) => playCollapseSfx(scene, cells),
      playLightFlicker: (count) => playLightRemovalSfx(scene, count),
      syncWaterTiles: (cells, visible) => this.syncWaterTiles(cells, visible),
      getFlag: (key) => this.getFlag(key),
      setFlag: (key, value) => this.setFlag(key, value),
    };
    this.cachedContext = ctx;
    return ctx;
  }

  private getFlag(key: StageEventFlagKey): boolean {
    if (key === "collapse") return this.stage22Collapsed;
    if (key === "collapseWater") return this.stage22CollapseWater;
    if (key === "lightsOut") return this.stage36LightRemoved;
    return false;
  }

  private setFlag(key: StageEventFlagKey, value: boolean): void {
    if (key === "collapse") this.stage22Collapsed = value;
    else if (key === "collapseWater") this.stage22CollapseWater = value;
    else if (key === "lightsOut") this.stage36LightRemoved = value;
  }

  /** 校验 timer 快照里的格子参数，防止脏数据写进 GridManager。 */
  private static parseCellArgs(args: unknown): GridCellArgs | null {
    if (!Array.isArray(args)) return null;
    const cells: Array<{ col: number; row: number }> = [];
    for (const item of args) {
      if (!item || typeof item !== "object") return null;
      const { col, row } = item as Record<string, unknown>;
      if (!Number.isInteger(col) || !Number.isInteger(row)) return null;
      cells.push({ col: col as number, row: row as number });
    }
    return cells;
  }

  /**
   * 关卡脚本入口：延迟把若干格改成水格。
   * 用带 snapshot 的 delayedCall，timer 状态与 args 进快照/哈希；重连时走工厂重建。
   * 不使用 startAt（会把回调包成不可重建的闭包），不使用 localOnly。
   */
  private scheduleCellWater(cells: readonly GridCell[], delayMs: number): void {
    const args: GridCellArgs = cells.map(({ col, row }) => ({ col, row }));
    TickerManager.Instance.delayedCall({
      delay: delayMs,
      callback: () => this.applyStageCollapseWater(args),
      snapshot: { kind: PresetEventManager.STAGE_COLLAPSE_WATER_TIMER, args },
    });
  }

  /** timer 到点后的稳定回调：写格子 + 置逻辑标记。工厂重建后指向同一方法。 */
  private applyStageCollapseWater(cells: GridCellArgs): void {
    for (const { col, row } of cells) {
      GridManager.Instance.setSingleGridProperty(col, row, { type: "water" });
    }
    this.stage22CollapseWater = true;
  }

  /** 按脚本要求重建/回收水面替代贴图（幂等，纯表现）。 */
  private syncWaterTiles(cells: readonly GridCell[], visible: boolean): void {
    if (!this.scene) return;
    if (!visible) {
      this.destroyWaterTiles();
      return;
    }
    const signature = cells.map((c) => `${c.col}-${c.row}`).join(",");
    if (this.waterTileObjects.length > 0 && this.waterTileSignature === signature) return;
    this.destroyWaterTiles();
    this.rebuildWaterTileLayer(cells);
    this.waterTileSignature = signature;
  }

  private destroyWaterTiles(): void {
    for (const obj of this.waterTileObjects) obj.destroy();
    this.waterTileObjects = [];
    this.waterTileSignature = "";
  }

  /** 已加载的水面贴图变种纹理 key（静态资源，由关卡 PreloadData.waterTiles 提供）。 */
  private collectWaterTileTextures(): string[] {
    if (!this.scene) return [];
    const keys: string[] = [];
    for (let i = 0; i < WATER_TILE_VARIANT_COUNT; i++) {
      const key = waterTileTextureKey(i);
      if (this.scene.textures.exists(key)) keys.push(key);
    }
    return keys;
  }

  /** 逐格铺水面贴图：每格从已加载的静态变种里随机挑一个（纯渲染，允许 Math.random）。 */
  private rebuildWaterTileLayer(cells: readonly GridCell[]): void {
    if (!this.scene) return;
    const size = PositionManager.Instance.getGridSize();
    const offset = PositionManager.Instance.getGridOffset();
    const depth = DepthHelper.Scene.presetImage();
    const textures = this.collectWaterTileTextures();
    for (const cell of cells) {
      const centerX = offset.x + (cell.col + 0.5) * size.width;
      const centerY = offset.y + (cell.row + 0.5) * size.height;
      if (textures.length > 0) {
        const key = textures[Math.floor(Math.random() * textures.length)];
        this.waterTileObjects.push(
          this.scene.add.image(centerX, centerY, key)
            .setDisplaySize(size.width, size.height)
            .setDepth(depth),
        );
      } else {
        // 兜底：纹理未加载时用纯色块。
        this.waterTileObjects.push(
          this.scene.add.rectangle(centerX, centerY, size.width, size.height, 0x1f5a80, 0.78)
            .setDepth(depth),
        );
      }
    }
  }

  /**
   * 重置预设事件状??
   */
  public Reset(): void {
    if (this.onNewWaveHandler) {
      MobManager.Instance.EventBus.off('onNewWave', this.onNewWaveHandler);
      this.onNewWaveHandler = null;
    }
    this.stopAutoGenerateEnergy();
    setCentipedeHooks(null);
    TickerManager.Instance.removeTimersByKind(PresetEventManager.STAGE_COLLAPSE_WATER_TIMER);
    this.stage22Collapsed = false;
    this.stage22CollapseWater = false;
    this.stage36LightRemoved = false;
    this.cachedContext = null;
    this.destroyWaterTiles();
    for (const overlay of this.darkOverlays) overlay.destroy();
    this.darkOverlays = [];
    this.scene = null;
  }

  // 自动产能设置
  private startAutoGenerateEnergy(startAtMs: number, intervalMs: number, delta: number) {
    this.stopAutoGenerateEnergy();
    // 首次产能前是“一次性延迟”，之后才是循环；拆成两??timer 是为??
    // 让任意帧??checkpoint 都能用纯数据工厂精确重建（TickerManager ??
    // startAt 包装回调依赖闭包，rebuild 时无法恢复）??
    this.autoEnergyStartTimer = TickerManager.Instance.delayedCall({
      delay: startAtMs,
      snapshot: { kind: "preset.autoEnergyStart", args: { intervalMs, delta } },
      callback: () => this.beginAutoGenerateEnergy(intervalMs, delta),
    });
  }

  private beginAutoGenerateEnergy(intervalMs: number, delta: number): void {
    this.autoEnergyStartTimer = null;
    // checkpoint rebuild 后旧句柄可能指向??id 的新 timer，必须按 kind 取消??
    TickerManager.Instance.removeTimersByKind("preset.autoEnergy");
    this.autoEnergyTimer = TickerManager.Instance.addEvent({
      delay: intervalMs,
      loop: true,
      snapshot: { kind: "preset.autoEnergy", args: { delta } },
      callback: () => this.autoGenerateEnergyTick(delta),
    });
    this.autoGenerateEnergyTick(delta);
  }

  private autoGenerateEnergyTick(delta: number): void {
    // 随机世界坐标起点；动画立即播、到账由可恢复全局计时器延迟。
    const pos = PositionManager.Instance;
    const gridBounds = pos.getGridBounds();
    const centerX = gridBounds.x + pos.GRID_SIZEX * 0.5
      + defaultRandom() * Math.max(0, gridBounds.width - pos.GRID_SIZEX);
    const centerY = gridBounds.y + pos.GRID_SIZEY * 0.35
      + defaultRandom() * Math.max(0, gridBounds.height - pos.GRID_SIZEY * 0.7);
    ResourceCmd.AddEnergyToAllWithAnim(+delta, {
      origin: { x: centerX, y: centerY },
      energySize: "medium",
    });
  }

  private stopAutoGenerateEnergy() {
    TickerManager.Instance.removeTimersByKind("preset.autoEnergy");
    TickerManager.Instance.removeTimersByKind("preset.autoEnergyStart");
    this.autoEnergyTimer = null;
    this.autoEnergyStartTimer = null;
  }

  // 初始能量
  private setInitialEnergy(initialEnergy: number) {
    desyncDiagnostics.record("resources", "preset initial energy", {
      initialEnergy,
      before: ResourceManager.Instance.CaptureCanonicalResourceState(),
    });
    // 初始能量必须是幂等赋值：RoomGameStart ??wave 0 预设事件都可能触发，
    // 用增量会重复叠加，导致不同客户端事件顺序不同就出现资源分叉??
    ResourceManager.Instance.SetInitialEnergy(+initialEnergy);
  }

}
