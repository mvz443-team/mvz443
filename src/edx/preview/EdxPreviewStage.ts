import RAPIER from "@dimforge/rapier2d-deterministic-compat";
import { Scene } from "phaser";
import DepthHelper from "../../game/utils/helper/DepthHelper";
import CombatManager from "../../game/managers/CombatManager";
import GridManager from "../../game/managers/combat/GridManager";
import MobManager from "../../game/managers/combat/MobManager";
import ObstacleManager from "../../game/managers/combat/ObstacleManager";
import PlantsManager from "../../game/managers/combat/PlantsManager";
import ResourceManager from "../../game/managers/combat/ResourceManager";
import TickerManager from "../../game/managers/combat/TickerManager";
import { BaseManager } from "../../game/managers/BaseManager";
import { DeferredManager } from "../../game/managers/DeferredManager";
import { PlantLibrary } from "../../game/managers/library/PlantLibrary";
import { MonsterLibrary } from "../../game/managers/library/MonsterLibrary";
import { PositionManager } from "../../game/managers/view/PositionManager";
import { BaseEntity } from "../../game/models/core/BaseEntity";
import type { MonsterEntity } from "../../game/models/entities/MonsterEntity";
import type { PlantEntity } from "../../game/models/entities/PlantEntity";
import type { GameParams } from "../../game/models/GameParams";
import { updateAllTickManagers } from "../../game/core/logic/EntityTickManager";
import { logicEvents } from "../../game/core/logic/LogicEvents";
import MobCmd from "../../game/utils/cmd/MobCmd";
import { ProjectileCmd } from "../../game/utils/cmd/ProjectileCmd";
import type { Game } from "../../game/scenes/Game";
import { getRapierTimestepSeconds } from "../../constants/physics";
import type { StageData } from "../../types/stage";
import {
  EDX_PREVIEW_COLS,
  EDX_PREVIEW_FRAME_INTERVAL_MS,
  EDX_PREVIEW_MONSTER_RESPAWN_FRAMES,
  EDX_PREVIEW_PADDING,
  EDX_PREVIEW_PLANT_COL,
  EDX_PREVIEW_PLANT_RESPAWN_FRAMES,
  EDX_PREVIEW_PLANT_ROW,
  EDX_PREVIEW_ROWS,
  EDX_PREVIEW_SANDBAG_COL,
  EDX_PREVIEW_SANDBAG_PID,
  EDX_PREVIEW_SELECTION_KEY,
  EDX_PREVIEW_SPAWN_COL,
  EDX_PREVIEW_VIEW_HEIGHT,
  EDX_PREVIEW_VIEW_WIDTH,
  EDX_PREVIEW_ZOMBIE_MID,
  isSameSelection,
  type EdxPreviewSelection,
} from "./edxPreviewConfig";

export const EDX_PREVIEW_STAGE_KEY = "EdxPreviewStage";

/** 变现场景需要的最小 GameParams：Entity / Manager 会读 gameSettings。 */
function createPreviewParams(): GameParams {
  return {
    level: 0,
    plants: [],
    gold: 0,
    gameExit: () => { },
    deviceType: "pc",
    gameSettings: {
      isBluePrint: false,
      basicDebug: false,
      isBgm: false,
      isSoundAudio: false,
      showCardLevelInGame: false,
      bgmVolume: 0,
      soundAudioVolume: 0,
    },
  };
}

/** 变现场景需要的最小 StageData：ResourceManager 读 energy，MobManager 读 stageScript。 */
function createPreviewStageData(): StageData {
  return {
    chapterId: 0,
    levelId: 0,
    nameKey: "",
    descriptionKey: "",
    rows: EDX_PREVIEW_ROWS,
    type: 0,
    stageScript: {
      first_wave_id: 0,
      total_waves: 0,
      base_difficulty: 0,
      difficulty_limit: 0,
      phase1_end: 0,
      phase2_end: 0,
      dayOrNight: 0,
      flagWaves: [],
      AllowedMobs: [],
      globalRatio: [],
      bossInsert: [],
    },
    onWin: { unLock: [], unLockPlant: [] },
    energy: 0,
    rewards: [],
    load: { bgimg: [], bgm: [] },
  };
}

/**
 * 图鉴用的最小战斗场景。
 *
 * 只复用真实战斗的 Model / Entity / Cmd / Manager，用一个本地固定步循环推进，
 * 不接网络、不接波次、不接卡槽：
 *
 * - 一个独立的 Phaser.Game，画布只框住 5x3 的网格；
 * - 器械永远种在中间行第 2 格，僵尸从最右一列的 3 个格刷新；
 * - 离开画面（相机可视矩形）的实体立即销毁，并由循环补种/补刷，永远跑下去；
 * - 切换选择时整场清空重建，不重启 Phaser.Game、不重新加载素材。
 */
export class EdxPreviewStage extends Scene {
  public rapierWorld!: RAPIER.World;
  public rapierEventQueue!: RAPIER.EventQueue;
  public params: GameParams = createPreviewParams();
  public stageData: StageData = createPreviewStageData();
  public innerSettings = createPreviewParams().gameSettings;
  /**
   * `MobCmd.AnnounceBossSkill` 的定位锚点（真实对局里是倍速文字）。
   *
   * 播报文本的坐标完全由它决定：`x = speedText.x`、`y = speedText.y + 高度 + 6`，
   * 且文本自身 origin 是 (1, 0)。预览相机是滚动过的，若留空，
   * `AnnounceBossSkill` 会退回场景坐标 (camera.width - 10, 60)，
   * 那是可视区上方的世界坐标，播报会画到画面外（蜈蚣等 Boss 看起来像没播报）。
   * 这里放一个不可见的锚点，把播报固定到可视区右上角。
   */
  public speedText!: Phaser.GameObjects.Text;

  private managers: BaseManager[] = [];
  private gridLayer: Phaser.GameObjects.Graphics | null = null;
  private tileLayer: Phaser.GameObjects.Graphics | null = null;
  private announceAnchor: Phaser.GameObjects.Text | null = null;

  private selection: EdxPreviewSelection | null = null;
  private pendingSelection: EdxPreviewSelection | null = null;
  private ready = false;
  private hasTornDown = false;

  private logicFrame = 0;
  private elapsedMs = 0;

  private laneMonsters: Array<MonsterEntity | null> = [];
  private laneRespawnFrames: number[] = [];
  private plantRespawnFrames = 0;
  private sandbagSpawned = false;

  constructor() {
    super(EDX_PREVIEW_STAGE_KEY);
  }

  public init(data?: { selection?: EdxPreviewSelection | null }): void {
    this.pendingSelection = data?.selection ?? null;
  }

  public create(): void {
    this.hasTornDown = false;
    this.ready = false;
    this.logicFrame = 0;
    this.elapsedMs = 0;
    this.selection = null;
    this.laneMonsters = [];
    this.laneRespawnFrames = [];
    this.plantRespawnFrames = 0;
    this.sandbagSpawned = false;
    this.announceAnchor = null;

    this.cameras.main.setBackgroundColor("#0d1117");
    this.buildStaticView();

    const registrySelection = this.registry.get(EDX_PREVIEW_SELECTION_KEY) as EdxPreviewSelection | null;
    this.pendingSelection = registrySelection ?? this.pendingSelection;
    this.registry.events.on(
      `changedata-${EDX_PREVIEW_SELECTION_KEY}`,
      this.handleRegistrySelectionChanged,
      this,
    );

    void this.bootstrap();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.teardownSession, this);
    this.events.once(Phaser.Scenes.Events.DESTROY, this.teardownSession, this);
  }

  private handleRegistrySelectionChanged(
    _parent: unknown,
    value: EdxPreviewSelection | null,
  ): void {
    this.applySelection(value ?? null);
  }

  /** React 侧调用：切换图鉴条目。同一选择不会重建场景。 */
  public applySelection(selection: EdxPreviewSelection | null): void {
    if (this.hasTornDown) return;
    if (!this.ready) {
      this.pendingSelection = selection;
      return;
    }
    if (isSameSelection(this.selection, selection)) return;
    this.rebuild(selection);
  }

  // --- 初始化 ---------------------------------------------------------------

  private async bootstrap(): Promise<void> {
    await RAPIER.init();
    // React StrictMode 会挂载→卸载→再挂载；等待 WASM 期间场景可能已被销毁。
    if (this.hasTornDown) return;

    PositionManager.Instance.setStageGrid(1, EDX_PREVIEW_ROWS, EDX_PREVIEW_COLS, { deviceType: "pc" });
    PositionManager.Instance.setSceneViewportSize(
      EDX_PREVIEW_VIEW_WIDTH,
      EDX_PREVIEW_VIEW_HEIGHT,
      "pc",
    );

    this.rapierWorld = new RAPIER.World({ x: 0, y: 0 });
    this.rapierWorld.timestep = getRapierTimestepSeconds(EDX_PREVIEW_FRAME_INTERVAL_MS);
    this.rapierEventQueue = new RAPIER.EventQueue(true);

    this.setupManagers();

    // 预览永远是“昼夜闭灯”状态：光敏作物在白天会睡眠，图鉴里看不到任何行为。
    CombatManager.Instance.combatStatus.dayOrNight = false;

    ProjectileCmd.setScene(this.asGame());
    this.focusCamera();
    this.createAnnounceAnchor();

    this.ready = true;
    this.rebuild(this.pendingSelection);
  }

  private setupManagers(): void {
    const scene = this.asGame();
    this.managers = [
      DeferredManager.Instance,
      GridManager.Instance,
      MobManager.Instance,
      ObstacleManager.Instance,
      PlantsManager.Instance,
      ResourceManager.Instance,
      TickerManager.Instance,
      PositionManager.Instance,
    ];
    for (const manager of this.managers) {
      manager.setScene(scene);
      manager.Load();
    }
  }

  private focusCamera(): void {
    const camera = this.cameras.main;
    camera.setZoom(1);
    // 网格本身按 7 行居中，3 行时 offsetY 偏下；这里直接把镜头对准网格所在的矩形。
    camera.setScroll(
      PositionManager.Instance.gridOffsetX - EDX_PREVIEW_PADDING,
      PositionManager.Instance.gridOffsetY - EDX_PREVIEW_PADDING,
    );
  }

  /**
   * 给 `MobCmd.AnnounceBossSkill` 一个落在可视区内的锚点。
   * 用世界坐标计算（相机是滚动过的），保证播报出现在预览画面右上角而不是画面外。
   */
  private createAnnounceAnchor(): void {
    if (this.announceAnchor) return;
    const camera = this.cameras.main;
    const anchor = this.add.text(
      camera.scrollX + EDX_PREVIEW_VIEW_WIDTH - 8,
      camera.scrollY + 6,
      "",
      { fontSize: "1px", color: "#000000" },
    );
    anchor.setOrigin(1, 0).setVisible(false).setDepth(DepthHelper.UI.bossSkillAnnounce());
    this.announceAnchor = anchor;
    this.speedText = anchor;
  }

  // --- 场景内容 -------------------------------------------------------------

  private buildStaticView(): void {
    this.tileLayer = this.add.graphics().setDepth(DepthHelper.Scene.background());
    this.gridLayer = this.add.graphics().setDepth(DepthHelper.Scene.background() + 1);
  }

  /** 按当前选择重建整场：清空所有实体 → 重置网格 → 重新种植/刷怪。 */
  private rebuild(selection: EdxPreviewSelection | null): void {
    this.despawnAllEntities();
    this.tweens.killAll();
    this.selection = selection;
    this.laneMonsters = [];
    this.laneRespawnFrames = [];
    this.plantRespawnFrames = 0;
    this.sandbagSpawned = false;

    this.applyGridProperties();
    this.drawGrid();

    if (!selection) return;

    const laneCount = this.laneCount();
    for (let lane = 0; lane < laneCount; lane += 1) {
      this.laneMonsters.push(null);
      this.laneRespawnFrames.push(0);
    }

    if (selection.mode === "plant") {
      this.spawnPlant(selection);
      // 三个格子立刻各来一只，之后按“该格空了就补”维持 3 只。
      for (let lane = 0; lane < laneCount; lane += 1) {
        this.spawnMonsterInLane(lane);
      }
      return;
    }

    this.spawnSandbag();
    this.spawnMonsterInLane(0);
  }

  private applyGridProperties(): void {
    GridManager.Instance.initGridProperties();
    const selection = this.selection;
    if (selection?.mode !== "plant" || typeof selection.pid !== "number") return;
    const model = PlantLibrary.GetModel(selection.pid);
    const slots = model?.allowedPlantSlots ?? null;
    // 只能种在水面的器械（睡莲等）在预览里把目标格改成水面，否则永远种不下去。
    if (slots && slots.includes("water") && !slots.includes("ground")) {
      GridManager.Instance.setSingleGridProperty(
        EDX_PREVIEW_PLANT_COL,
        EDX_PREVIEW_PLANT_ROW,
        { type: "water" },
      );
    }
  }

  private drawGrid(): void {
    const tiles = this.tileLayer;
    const lines = this.gridLayer;
    if (!tiles || !lines) return;
    tiles.clear();
    lines.clear();

    const offset = PositionManager.Instance.getGridOffset();
    const size = PositionManager.Instance.getGridSize();
    const width = size.width * EDX_PREVIEW_COLS;
    const height = size.height * EDX_PREVIEW_ROWS;

    for (let row = 0; row < EDX_PREVIEW_ROWS; row += 1) {
      for (let col = 0; col < EDX_PREVIEW_COLS; col += 1) {
        const property = GridManager.Instance.GetGridProperty(col, row);
        const x = offset.x + col * size.width;
        const y = offset.y + row * size.height;
        const color = property?.type === "water" ? 0x1f5a80 : 0x3a4a33;
        const alpha = (col + row) % 2 === 0 ? 1 : 0.88;
        tiles.fillStyle(color, alpha);
        tiles.fillRect(x, y, size.width, size.height);
      }
    }

    lines.lineStyle(1, 0x8dffd6, 0.28);
    for (let col = 0; col <= EDX_PREVIEW_COLS; col += 1) {
      const x = offset.x + col * size.width;
      lines.lineBetween(x, offset.y, x, offset.y + height);
    }
    for (let row = 0; row <= EDX_PREVIEW_ROWS; row += 1) {
      const y = offset.y + row * size.height;
      lines.lineBetween(offset.x, y, offset.x + width, y);
    }
    lines.lineStyle(2, 0x8dffd6, 0.55);
    lines.strokeRect(offset.x, offset.y, width, height);
  }

  private laneCount(): number {
    if (this.selection?.mode === "monster") return 1;
    return EDX_PREVIEW_ROWS;
  }

  private laneRow(lane: number): number {
    if (this.selection?.mode === "monster") return EDX_PREVIEW_PLANT_ROW;
    return lane;
  }

  private spawnPlant(selection: EdxPreviewSelection): void {
    if (selection.mode !== "plant" || typeof selection.pid !== "number") return;
    const level = selection.level ?? 1;
    // 高级器械（反坦克炮台 / 广域南瓜派）只能种在基座上，
    // 预览里先补一株基座，否则 CanPlantInGrid 会直接拒绝。
    this.ensureBasePlant(selection.pid);
    const result = PlantsManager.Instance.PlantCardDirect(
      9961,
      selection.pid,
      level,
      EDX_PREVIEW_PLANT_COL,
      EDX_PREVIEW_PLANT_ROW,
    );
    if (!result.ok) {
      console.warn(`[EdxPreview] 无法在预览中种植 pid=${selection.pid}: ${result.reason}`);
    }
  }

  private ensureBasePlant(pid: number): void {
    const basePid = PlantLibrary.GetModel(pid)?.requiredBasePid ?? null;
    if (basePid === null) return;
    const cellKey = `${EDX_PREVIEW_PLANT_COL}-${EDX_PREVIEW_PLANT_ROW}`;
    const cell = PlantsManager.Instance.PlantsMap.get(cellKey);
    if (cell?.some((plant: PlantEntity) => plant.pid === basePid && plant.IsAlive)) {
      return;
    }
    PlantsManager.Instance.PlantCardDirect(
      9961,
      basePid,
      1,
      EDX_PREVIEW_PLANT_COL,
      EDX_PREVIEW_PLANT_ROW,
    );
  }

  /** 僵尸图鉴的沙包：高血量、不还手的护盾器械，用来展示怪物的啃咬节奏。 */
  private spawnSandbag(): void {
    if (PlantLibrary.GetModel(EDX_PREVIEW_SANDBAG_PID) === undefined) return;
    const result = PlantsManager.Instance.PlantCardDirect(
      9961,
      EDX_PREVIEW_SANDBAG_PID,
      1,
      EDX_PREVIEW_SANDBAG_COL,
      EDX_PREVIEW_PLANT_ROW,
    );
    this.sandbagSpawned = result.ok;
    if (!result.ok) {
      console.warn(`[EdxPreview] 沙包种植失败: ${result.reason}`);
    }
  }

  private spawnMonsterInLane(lane: number): void {
    const selection = this.selection;
    if (!selection) return;
    const mid = selection.mode === "monster" ? selection.mid : EDX_PREVIEW_ZOMBIE_MID;
    if (typeof mid !== "number" || MonsterLibrary.GetModel(mid) === undefined) {
      return;
    }
    const row = this.laneRow(lane);
    // waveID < 0：不计击杀、不推进波次，纯展示用。
    MobCmd.Spawn(mid, this.asGame(), EDX_PREVIEW_SPAWN_COL, row, -10, (entity) => {
      this.laneMonsters[lane] = entity;
    });
  }

  // --- 固定步循环 -----------------------------------------------------------

  public update(_time: number, delta: number): void {
    if (!this.ready || this.hasTornDown) return;

    this.elapsedMs = Math.min(this.elapsedMs + Math.min(delta, 250), 500);
    let steps = 0;
    while (this.elapsedMs >= EDX_PREVIEW_FRAME_INTERVAL_MS && steps < 4) {
      this.stepOnce();
      this.elapsedMs -= EDX_PREVIEW_FRAME_INTERVAL_MS;
      steps += 1;
    }

    // 逻辑步之外的纯表现插值：位置由刚体决定，这里只做平滑。
    const alpha = Math.min(this.elapsedMs / EDX_PREVIEW_FRAME_INTERVAL_MS, 1);
    this.rapierWorld?.bodies.forEach((rigidBody) => {
      const entity = rigidBody.userData;
      if (entity instanceof BaseEntity) {
        entity.stepMove(alpha);
      }
    });
  }

  /** 一个权威固定步，顺序与 CombatManager.advanceAuthoritativeStep 保持一致。 */
  private stepOnce(): void {
    this.logicFrame += 1;
    logicEvents.setFrame(this.logicFrame);
    TickerManager.Instance.Update();
    updateAllTickManagers(TickerManager.Instance.currentFrame, TickerManager.Instance.frameInterval);
    DeferredManager.Instance.flush();

    this.rapierWorld.step(this.rapierEventQueue);
    this.rapierEventQueue.drainCollisionEvents((handle1, handle2, started) => {
      if (started) this.handleCollision(handle1, handle2);
    });

    this.rapierWorld.bodies.forEach((rigidBody) => {
      const entity = rigidBody.userData;
      if (entity instanceof BaseEntity) {
        entity.stepUpdate();
        entity.updateView(rigidBody.translation());
      }
    });

    DeferredManager.Instance.flush();
    this.cullOutsideView();
    this.maintainLoop();
  }

  public handleCollision(handle1: number, handle2: number): void {
    const colliderA = this.rapierWorld.getCollider(handle1);
    const colliderB = this.rapierWorld.getCollider(handle2);
    if (!colliderA || !colliderB) return;
    const bodyA = colliderA.parent();
    const bodyB = colliderB.parent();
    if (!bodyA || !bodyB) return;
    const entityA = bodyA.userData as BaseEntity;
    const entityB = bodyB.userData as BaseEntity;
    if (!entityA || !entityB) return;
    entityA.onCollision({
      sourceEntity: entityA,
      targetEntity: entityB,
      sourceCollider: colliderA,
      targetCollider: colliderB,
    });
    entityB.onCollision({
      sourceEntity: entityB,
      targetEntity: entityA,
      sourceCollider: colliderB,
      targetCollider: colliderA,
    });
  }

  /** 相机可视矩形（zoom = 1，无旋转）。 */
  private getViewBounds() {
    const camera = this.cameras.main;
    return {
      left: camera.scrollX,
      right: camera.scrollX + camera.width,
      top: camera.scrollY,
      bottom: camera.scrollY + camera.height,
    };
  }

  /** 出屏即销毁：任何实体移动到画面外都直接清理，不再参与逻辑。 */
  private cullOutsideView(): void {
    const view = this.getViewBounds();
    const doomed: BaseEntity[] = [];
    this.rapierWorld.bodies.forEach((rigidBody) => {
      const entity = rigidBody.userData;
      if (!(entity instanceof BaseEntity)) return;
      if (entity.x < view.left || entity.x > view.right
        || entity.y < view.top || entity.y > view.bottom) {
        doomed.push(entity);
      }
    });
    for (const entity of doomed) {
      entity.destroy();
    }
  }

  /** 无限循环：器械被啃掉就补种，某一格空出来就补刷怪物。 */
  private maintainLoop(): void {
    const selection = this.selection;
    if (!selection) return;

    if (selection.mode === "plant" && this.isPlantCellEmpty()) {
      this.plantRespawnFrames = this.plantRespawnFrames <= 0
        ? EDX_PREVIEW_PLANT_RESPAWN_FRAMES
        : this.plantRespawnFrames - 1;
      if (this.plantRespawnFrames <= 0) {
        this.spawnPlant(selection);
      }
    } else {
      this.plantRespawnFrames = 0;
    }

    if (selection.mode === "monster" && this.isSandbagGone()) {
      this.spawnSandbag();
    }

    for (let lane = 0; lane < this.laneMonsters.length; lane += 1) {
      const current = this.laneMonsters[lane];
      if (current && current.IsAlive) {
        this.laneRespawnFrames[lane] = 0;
        continue;
      }
      this.laneRespawnFrames[lane] = this.laneRespawnFrames[lane] <= 0
        ? EDX_PREVIEW_MONSTER_RESPAWN_FRAMES
        : this.laneRespawnFrames[lane] - 1;
      if (this.laneRespawnFrames[lane] <= 0) {
        this.spawnMonsterInLane(lane);
      }
    }
  }

  /** 只看“被展示的那株器械”是否还活着；基座植物活着不代表主体还在。 */
  private isPlantCellEmpty(): boolean {
    const pid = this.selection?.pid;
    if (typeof pid !== "number") return true;
    const plants = PlantsManager.Instance.PlantsMap.get(
      `${EDX_PREVIEW_PLANT_COL}-${EDX_PREVIEW_PLANT_ROW}`,
    );
    if (!plants) return true;
    return !plants.some(
      (plant: PlantEntity) => plant.pid === pid && plant.IsAlive && plant.currentHealth > 0,
    );
  }

  private isSandbagGone(): boolean {
    if (!this.sandbagSpawned) return true;
    const plants = PlantsManager.Instance.PlantsMap.get(
      `${EDX_PREVIEW_SANDBAG_COL}-${EDX_PREVIEW_PLANT_ROW}`,
    );
    if (!plants) return true;
    return !plants.some((plant: PlantEntity) => plant.IsAlive && plant.currentHealth > 0);
  }

  // --- 清理 -----------------------------------------------------------------

  private despawnAllEntities(): void {
    const entities: BaseEntity[] = [];
    this.rapierWorld?.bodies.forEach((rigidBody) => {
      const entity = rigidBody.userData;
      if (entity instanceof BaseEntity) entities.push(entity);
    });
    for (const entity of entities) {
      // 静默销毁：不触发 Model 死亡/掉落/击杀统计，切换条目时不污染新一场。
      entity.destroySilently();
    }
    DeferredManager.Instance.flush();

    // 静默销毁不会走 Manager 的注销回调，这里统一清空容器。
    PlantsManager.Instance.PlantsMap.clear();
    PlantsManager.Instance.PlantsByLane.clear();
    PlantsManager.Instance.SightLineReflectorsByLane.clear();
    MobManager.Instance.MobsByLane.clear();
    ObstacleManager.Instance.ObstaclesMap.clear();
    ObstacleManager.Instance.ObstaclesByLane.clear();
    // clearProjectiles 会把模块级的 activeScene 置空，重建前必须重新绑回本场景，
    // 否则清场之后植物再也发不出子弹。
    ProjectileCmd.clearProjectiles(this.asGame());
    ProjectileCmd.setScene(this.asGame());
    DeferredManager.Instance.flush();

    // 播报文本是场景子对象，会被下面的“清空子对象”一并销毁；
    // 必须先让 MobCmd 丢掉缓存，否则下一次 Boss 技能会写到一个已销毁的 Text 上。
    MobCmd.ResetBossSkillAnnounce(this.asGame());

    const keep = new Set<Phaser.GameObjects.GameObject>();
    if (this.tileLayer) keep.add(this.tileLayer);
    if (this.gridLayer) keep.add(this.gridLayer);
    if (this.announceAnchor) keep.add(this.announceAnchor);
    for (const child of [...this.children.list]) {
      if (keep.has(child as Phaser.GameObjects.GameObject)) continue;
      child.destroy();
    }
    this.laneMonsters = this.laneMonsters.map(() => null);
  }

  /** Phaser 场景关闭时把全局单例恢复成“没有战局”的状态，避免污染真正的对局。 */
  private teardownSession(): void {
    if (this.hasTornDown) return;
    this.hasTornDown = true;
    this.ready = false;

    this.registry.events.off(
      `changedata-${EDX_PREVIEW_SELECTION_KEY}`,
      this.handleRegistrySelectionChanged,
      this,
    );
    this.despawnAllEntities();

    ProjectileCmd.clearProjectiles(this.asGame());
    ProjectileCmd.setScene(null as unknown as Game);
    DeferredManager.Instance.Reset();
    logicEvents.reset();

    for (const manager of this.managers) {
      if (manager.getScene() === this.asGame()) {
        manager.Reset();
      }
    }
    this.managers = [];

    CombatManager.Instance.combatStatus.dayOrNight = true;

    // 预览 Game 会被整块销毁，物理世界也要一起释放，避免反复开关图鉴泄漏 WASM 内存。
    try {
      this.rapierWorld?.free();
    } catch {
      // 世界可能已被释放，忽略。
    }
  }

  /** Entity / Cmd 的参数类型是 Game；预览场景 duck-type 提供它们需要的成员。 */
  private asGame(): Game {
    return this as unknown as Game;
  }
}
