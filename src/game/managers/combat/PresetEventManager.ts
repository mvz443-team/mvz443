import { setCentipedeHooks } from "../../presets/monster/centipede/centipede";
import DepthHelper from "../../utils/helper/DepthHelper";
import type { Game } from "../../scenes/Game";
import { GainEnergySfx } from "../../sfx/energy/GainEnergySfx";
import { SfxCmd } from "../../utils/cmd/SfxCmd";
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
import type {
  GridCell,
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

  /** 纯视图对象：水面覆盖层 + 暗场遮罩，不进快照，由标记/脚本驱动重建。 */
  private waterTileLayer: Phaser.GameObjects.Graphics | null = null;
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
    this.stage36LightRemoved = false;
    this.cachedContext = null;

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
    if (key === "lightsOut") return this.stage36LightRemoved;
    return false;
  }

  private setFlag(key: StageEventFlagKey, value: boolean): void {
    if (key === "collapse") this.stage22Collapsed = value;
    else if (key === "lightsOut") this.stage36LightRemoved = value;
  }

  /** 按脚本要求重建/回收水面替代贴图（幂等，纯表现）。 */
  private syncWaterTiles(cells: readonly GridCell[], visible: boolean): void {
    if (!this.scene) return;
    if (!visible) {
      if (this.waterTileLayer) {
        this.waterTileLayer.destroy();
        this.waterTileLayer = null;
      }
      this.waterTileSignature = "";
      return;
    }
    const signature = cells.map((c) => `${c.col}-${c.row}`).join(",");
    if (this.waterTileLayer && this.waterTileSignature === signature) return;
    if (this.waterTileLayer) {
      this.waterTileLayer.destroy();
      this.waterTileLayer = null;
    }
    this.rebuildWaterTileLayer(cells);
    this.waterTileSignature = signature;
  }

  /** 用逐格 Graphics 画出崩塌后的水面替代贴图（水色 + 波纹描边），纯表现。 */
  private rebuildWaterTileLayer(cells: readonly GridCell[]): void {
    if (!this.scene) return;
    const size = PositionManager.Instance.getGridSize();
    const offset = PositionManager.Instance.getGridOffset();
    const g = this.scene.add.graphics().setDepth(DepthHelper.Scene.presetImage());
    for (const cell of cells) {
      const x = offset.x + cell.col * size.width;
      const y = offset.y + cell.row * size.height;
      g.fillStyle(0x1f5a80, 0.78);
      g.fillRect(x, y, size.width, size.height);
      g.lineStyle(2, 0x5ac8e0, 0.55);
      g.strokeRect(x + 2, y + 2, size.width - 4, size.height - 4);
      g.lineStyle(1, 0x9fe8ff, 0.4);
      g.lineBetween(x + size.width * 0.2, y + size.height * 0.42,
        x + size.width * 0.8, y + size.height * 0.42);
      g.lineBetween(x + size.width * 0.3, y + size.height * 0.62,
        x + size.width * 0.7, y + size.height * 0.62);
    }
    this.waterTileLayer = g;
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
    this.stage22Collapsed = false;
    this.stage36LightRemoved = false;
    this.cachedContext = null;
    this.waterTileLayer?.destroy();
    this.waterTileLayer = null;
    this.waterTileSignature = "";
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
    this.playAutoGenerateEnergySfx();
    ResourceManager.Instance.UpdateEnergy(+delta, 'all');
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

  private playAutoGenerateEnergySfx() {
    if (!this.scene) {
      return;
    }

    const pos = PositionManager.Instance;
    const gridBounds = pos.getGridBounds();
    const centerX = gridBounds.x + pos.GRID_SIZEX * 0.5
      + defaultRandom() * Math.max(0, gridBounds.width - pos.GRID_SIZEX);
    const centerY = gridBounds.y + pos.GRID_SIZEY * 0.35
      + defaultRandom() * Math.max(0, gridBounds.height - pos.GRID_SIZEY * 0.7);

    SfxCmd.Create(GainEnergySfx, {
      scene: this.scene,
      x: centerX,
      y: centerY,
      size: "medium",
    });
  }
}
