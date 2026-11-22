import { DamageConstants } from "../../../../constants/game";
import DepthHelper from "../../../utils/helper/DepthHelper";
import { PhaserEventBus, PhaserEvents } from "../../../EventBus";
import { LOGICAL_BATTLE_HEIGHT, LOGICAL_BATTLE_WIDTH } from "../../../../constants/gameLayout";
import ObstacleManager from "../../../managers/combat/ObstacleManager";
import PlantsManager from "../../../managers/combat/PlantsManager";
import { PositionManager } from "../../../managers/view/PositionManager";
import type { MonsterDefinition } from "../../../models/entities/MonsterEntity";
import { BaseMonsterEntity, PresetMonsterModel } from "../../../models/entities/MonsterEntity";
import type { MonsterEntity } from "../../../models/entities/MonsterEntity";
import { Faction } from "../../../models/Enum";
import type { Game } from "../../../scenes/Game";
import { ArcSfx } from "../../../sfx/arc/ArcSfx";
import { CentipedeSkillSfx } from "../../../sfx/centipede/CentipedeSkillSfx";
import { DirtOutSfx } from "../../../sfx/dirt/DirtOutSfx";
import { ExplosionSfx } from "../../../sfx/explosion/ExplosionSfx";
import MobCmd from "../../../utils/cmd/MobCmd";
import ObstacleCmd from "../../../utils/cmd/ObstacleCmd";
import { PlantCmd } from "../../../utils/cmd/PlantCmd";
import SoundCmd from "../../../utils/cmd/SoundCmd";
import { SfxCmd } from "../../../utils/cmd/SfxCmd";
import { MineRockObstacleData } from "../../obstacle";
import { CentipedeAnimController } from "./centipede_anim";
import { CENTIPEDE_MINION_WIDTH_CELLS, CentipedeMinionData } from "./centipede_minion";
import type { JsonValue } from "../../../core/SimulationState";
import { DEFAULT_TICK_EVENT_NAMES } from "../../../core/logic/TickEvents";
import type { BaseEntity } from "../../../models/core/BaseEntity";

const PAUSE_BEFORE_SKILL_MS = 6000;
const SKILL_DURATION_MS = 4000;
const REPOSITION_ARC_DURATION_MS = 900;
const CHARGE_DURATION_MS = 700;
const HEALTH_TRIGGERS = [0.8, 0.6, 0.4, 0.2];
const HEALTH_FLASH_TRIGGER = 0.5;

type SkillIndex = 1 | 2 | 3;

export interface CentipedeHooks {
  onSpawn?: (entity: CentipedeEntity) => void;
  onHalfHealth?: (entity: CentipedeEntity) => void;
}

let pendingHooks: CentipedeHooks | null = null;
export function setCentipedeHooks(hooks: CentipedeHooks | null) {
  pendingHooks = hooks;
}

const CENTIPEDE_EVENTS = {
  Spawn: "CentipedeSpawn",
  Cycle: "CentipedeCycle",
  Disappear: "CentipedeDisappear",
  SkillStep: "CentipedeSkillStep",
  RockImpact: "CentipedeRockImpact",
  SummonSfx: "CentipedeSummonSfx",
  SpawnMinion: "CentipedeSpawnMinion",
  BlastImpact: "CentipedeBlastImpact",
  ChargeImpact: "CentipedeChargeImpact",
  RepositionDone: "CentipedeRepositionDone",
} as const;

const CENTIPEDE_TICK_EVENT_NAMES = [
  ...DEFAULT_TICK_EVENT_NAMES,
  ...Object.values(CENTIPEDE_EVENTS),
];

/** 蜈蚣的全部战斗决策（血量触发、四套技能、召唤、范围伤害）都在 Model。 */
export class CentipedeModel extends PresetMonsterModel {
  public override get tickEventNames(): readonly string[] {
    return CENTIPEDE_TICK_EVENT_NAMES;
  }

  constructor(def: MonsterDefinition) { super(def); }

  public override onCreate(_entity: MonsterEntity): void {
    this.tickmanager.schedule(CENTIPEDE_EVENTS.Spawn, 250);
  }

  public override handleTickEvent(
    eventName: string,
    args: JsonValue = null,
    timerId?: number,
  ): void {
    const entity = this.host as CentipedeEntity | null;
    if (!entity) return;

    switch (eventName) {
      case CENTIPEDE_EVENTS.Spawn:
        entity.notifySpawnHooks();
        this.beginCycle(entity);
        return;
      case CENTIPEDE_EVENTS.Cycle:
        this.runSkillCycle(entity);
        return;
      case CENTIPEDE_EVENTS.Disappear:
        this.beginDisappear(entity);
        return;
      case CENTIPEDE_EVENTS.RockImpact:
        this.rockImpact(entity, numberArg(args, "col", entity.col), numberArg(args, "row", entity.row));
        return;
      case CENTIPEDE_EVENTS.SummonSfx: {
        const row = numberArg(args, "row", entity.row);
        entity.playSummonEffects(row);
        this.tickmanager.schedule(CENTIPEDE_EVENTS.SpawnMinion, 450, { args: { row } });
        return;
      }
      case CENTIPEDE_EVENTS.SpawnMinion:
        MobCmd.Spawn(
          CentipedeMinionData.mid, entity.scene,
          PositionManager.Instance.Col_Number - 1,
          numberArg(args, "row", entity.row), -10,
        );
        return;
      case CENTIPEDE_EVENTS.BlastImpact:
        this.blastImpact(entity, numberArg(args, "col", entity.col), numberArg(args, "row", entity.row));
        return;
      case CENTIPEDE_EVENTS.ChargeImpact:
        this.chargeImpact(
          entity,
          numberArg(args, "startCol", entity.col),
          numberArg(args, "targetCol", entity.col),
          numberArg(args, "row", entity.row),
        );
        return;
      case CENTIPEDE_EVENTS.RepositionDone:
        this.finishReposition(
          entity,
          numberArg(args, "col", entity.col),
          numberArg(args, "row", entity.row),
        );
        return;
      default:
        super.handleTickEvent(eventName, args, timerId);
    }
  }

  /** Entity 受伤后由这里决定是否闪屏、触发技能。 */
  public checkHealthTriggers(entity: CentipedeEntity): void {
    const ratio = entity.currentHealth / Math.max(1, entity.maxHealth);
    if (!this.flashTriggered && ratio <= HEALTH_FLASH_TRIGGER) {
      this.flashTriggered = true;
      entity.playSceneFlash();
      entity.notifyHalfHealthHooks();
    }
    for (const trigger of HEALTH_TRIGGERS) {
      if (ratio <= trigger && !this.hpTriggers.includes(trigger)) {
        this.hpTriggers.push(trigger);
        this.castSkill0(entity);
      }
    }
  }

  private beginCycle(entity: CentipedeEntity): void {
    if (entity.currentHealth <= 0 || this.isDying) return;
    entity.stopMove();
    this.tickmanager.schedule(CENTIPEDE_EVENTS.Cycle, PAUSE_BEFORE_SKILL_MS);
  }

  private runSkillCycle(entity: CentipedeEntity): void {
    if (entity.currentHealth <= 0 || this.isDying) return;
    const skill = this.pickSkill();
    this.lastSkill = skill;
    if (skill === 1) this.castSkill1(entity);
    else if (skill === 2) this.castSkill2(entity);
    else this.castSkill3(entity);

    this.tickmanager.schedule(CENTIPEDE_EVENTS.Disappear, SKILL_DURATION_MS);
  }

  private pickSkill(): SkillIndex {
    const candidates: SkillIndex[] = ([1, 2, 3] as SkillIndex[]).filter((s) => s !== this.lastSkill);
    const idx = Math.floor(MobCmd.DeterministicRandom(0, candidates.length));
    return candidates[Math.min(idx, candidates.length - 1)];
  }

  private beginDisappear(entity: CentipedeEntity): void {
    if (entity.currentHealth <= 0 || this.isDying) return;
    this.isHidden = true;
    const newRow = Math.floor(MobCmd.DeterministicRandom(0, PositionManager.Instance.Row_Number));
    const clamped = Phaser.Math.Clamp(newRow, 0, PositionManager.Instance.Row_Number - 1);
    const newCol = PositionManager.Instance.Col_Number - 1;
    // 弧形换位只是表现；权威 col/row 与循环推进必须由固定逻辑帧的 tick 事件落地。
    entity.playArcReposition(newCol, clamped);
    this.tickmanager.schedule(CENTIPEDE_EVENTS.RepositionDone, REPOSITION_ARC_DURATION_MS, {
      args: { col: newCol, row: clamped },
    });
  }

  private finishReposition(entity: CentipedeEntity, newCol: number, newRow: number): void {
    if (entity.currentHealth <= 0 || this.isDying) return;
    entity.applyArcReposition(newCol, newRow);
    this.isHidden = false;
    this.beginCycle(entity);
  }

  private castSkill0(entity: CentipedeEntity): void {
    MobCmd.AnnounceBossSkill(entity.scene, "centipede", "mine_rock");
    entity.playSkillSfx("mine");

    const colNum = PositionManager.Instance.Col_Number;
    const rowNum = PositionManager.Instance.Row_Number;
    const minCol = 5;
    const candidateCols: number[] = [];
    for (let c = minCol; c < colNum; c++) candidateCols.push(c);
    const col = candidateCols[Math.floor(MobCmd.DeterministicRandom(0, candidateCols.length))] ?? minCol;
    const row = Math.min(rowNum - 2, Math.floor(MobCmd.DeterministicRandom(0, rowNum - 1)));

    const targetPos = PositionManager.Instance.getPlantBottomCenter(col, row + 1);
    entity.playArc(targetPos.x, targetPos.y - PositionManager.Instance.GRID_SIZEY * 5, targetPos.x, targetPos.y,
      "sfxCentipedeOrb", 1100, 0);
    this.tickmanager.schedule(CENTIPEDE_EVENTS.RockImpact, 1100, { args: { col, row } });
  }

  private rockImpact(entity: CentipedeEntity, col: number, row: number): void {
    if (ObstacleManager.Instance.HasObstacle(col, row) || ObstacleManager.Instance.HasObstacle(col, row + 1)) return;
    for (const r of [row, row + 1]) {
      const plants = PlantsManager.Instance.PlantsMap.get(`${col}-${r}`) ?? [];
      for (const plant of [...plants]) PlantCmd.DealDamage(plant, DamageConstants.SECKILL / 2, entity);
    }
    ObstacleCmd.createInGrid(MineRockObstacleData.oid, entity.scene, col, row, {
      hp: 300,
      faction: Faction.ZOMBIE,
      summoner: entity,
    });
  }

  private castSkill1(entity: CentipedeEntity): void {
    MobCmd.AnnounceBossSkill(entity.scene, "centipede", "charge");
    entity.playSkillSfx("charge");
    const startCol = entity.col;
    const row = entity.row;
    const targetCol = Math.max(2, startCol - 5);
    // 冲锋动画只在表现层播放；落地坐标与伤害由 ChargeImpact tick 事件结算，
    // 不能挂在 Tween onComplete 上（渲染帧率不同会让结算帧漂移）。
    entity.playCharge(startCol, targetCol, row);
    this.tickmanager.schedule(CENTIPEDE_EVENTS.ChargeImpact, CHARGE_DURATION_MS, {
      args: { startCol, targetCol, row },
    });
  }

  private chargeImpact(entity: CentipedeEntity, startCol: number, targetCol: number, row: number): void {
    if (entity.currentHealth <= 0 || this.isDying) return;
    entity.applyChargeEnd(targetCol, row);

    const minCol = Math.min(startCol, targetCol);
    const maxCol = Math.max(startCol, targetCol);
    const cells: { col: number; row: number }[] = [];
    for (let c = minCol; c <= maxCol; c++) cells.push({ col: c, row });
    MobCmd.DamagePlantsInCells(cells, DamageConstants.SECKILL / 2);

    const sideRows = [row - 1, row + 1].filter((r) => r >= 0 && r < PositionManager.Instance.Row_Number);
    for (const sr of sideRows) {
      const sideCells: { col: number; row: number }[] = [];
      for (let c = minCol; c <= maxCol; c++) sideCells.push({ col: c, row: sr });
      MobCmd.DamagePlantsInCells(sideCells, 100);
    }
  }

  private castSkill2(entity: CentipedeEntity): void {
    MobCmd.AnnounceBossSkill(entity.scene, "centipede", "summon");
    entity.playSkillSfx("summon");
    const rowNum = PositionManager.Instance.Row_Number;
    const pool = Array.from({ length: rowNum }, (_, i) => i);
    const picked: number[] = [];
    while (picked.length < 3 && pool.length > 0) {
      const idx = Math.floor(MobCmd.DeterministicRandom(0, pool.length));
      picked.push(pool.splice(Math.min(idx, pool.length - 1), 1)[0]);
    }
    picked.forEach((row, i) => {
      this.tickmanager.schedule(CENTIPEDE_EVENTS.SummonSfx, 200 + i * 250, { args: { row } });
    });
  }

  private castSkill3(entity: CentipedeEntity): void {
    MobCmd.AnnounceBossSkill(entity.scene, "centipede", "blast");
    entity.playSkillSfx("blast");
    const usableCols = [3, 4, 5];
    const pool = [...usableCols];
    const targets: number[] = [];
    while (targets.length < 2 && pool.length > 0) {
      const idx = Math.floor(MobCmd.DeterministicRandom(0, pool.length));
      targets.push(pool.splice(Math.min(idx, pool.length - 1), 1)[0]);
    }
    const rowNum = PositionManager.Instance.Row_Number;
    targets.forEach((tCol, i) => {
      const tRow = Math.min(rowNum - 1, Math.floor(MobCmd.DeterministicRandom(0, rowNum)));
      const targetPos = PositionManager.Instance.getPlantBottomCenter(tCol, tRow);
      const arcDuration = 900 + i * 100;
      entity.playArc(entity.x, entity.y - PositionManager.Instance.GRID_SIZEY * 0.5,
        targetPos.x, targetPos.y, "sfxCentipedeOrb", arcDuration, 220);
      this.tickmanager.schedule(CENTIPEDE_EVENTS.BlastImpact, arcDuration, {
        args: { col: tCol, row: tRow },
      });
    });
  }

  private blastImpact(entity: CentipedeEntity, tCol: number, tRow: number): void {
    const center = PositionManager.Instance.getGridCenter(tCol, tRow);
    SfxCmd.Create(ExplosionSfx, {
      scene: entity.scene,
      x: center.x,
      y: center.y,
      totalWidth: PositionManager.Instance.GRID_SIZEX * 3,
      totalHeight: PositionManager.Instance.GRID_SIZEY * 3,
      leftWidth: PositionManager.Instance.GRID_SIZEX * 1.5,
      downHeight: PositionManager.Instance.GRID_SIZEY * 1.5,
      baseSize: PositionManager.Instance.GRID_SIZEX,
    });
    const cells: { col: number; row: number }[] = [];
    for (let dc = -1; dc <= 1; dc++) {
      for (let dr = -1; dr <= 1; dr++) cells.push({ col: tCol + dc, row: tRow + dr });
    }
    MobCmd.DamagePlantsInCells(cells, 500);
  }
}

function numberArg(args: JsonValue, key: string, fallback: number): number {
  if (args && typeof args === "object" && !Array.isArray(args)) {
    const value = (args as Record<string, JsonValue>)[key];
    if (typeof value === "number") return value;
  }
  return fallback;
}

export class CentipedeEntity extends BaseMonsterEntity {
  declare public model: CentipedeModel;
  private hooks: CentipedeHooks | null;
  declare private lastSkill: SkillIndex | 0;
  declare private hpTriggers: number[];
  declare private flashTriggered: boolean;
  declare private isHidden: boolean;

  public constructor(scene: Game, col: number, row: number, model: CentipedeModel, waveID: number) {
    super(scene, col, row, model, waveID);
    this.lastSkill = 0;
    this.hpTriggers = [];
    this.flashTriggered = false;
    this.isHidden = false;
    this.hooks = pendingHooks;
    pendingHooks = null;

    PhaserEventBus.emit(PhaserEvents.BossHealth, { health: 100 });
    SoundCmd.CoverBgm("bgm1");
  }

  protected createAnimController() { return new CentipedeAnimController(this.scene, this.x, this.y); }
  public override startMove(): void { this.stopMove(); }

  public override takeDamage(amount: number, dealer?: BaseEntity, source?: BaseEntity): void {
    if (this.isDying || this.currentHealth <= 0 || this.isHidden) return;
    super.takeDamage(amount, dealer, source);
    if (this.currentHealth > 0) {
      MobCmd.EmitBossHealth(this);
      this.model.checkHealthTriggers(this);
    }
  }

  public override destroy(): void {
    PhaserEventBus.emit(PhaserEvents.BossHealth, { health: -1 });
    SoundCmd.BackToPreviousBgm();
    super.destroy();
  }

  public notifySpawnHooks(): void { this.hooks?.onSpawn?.(this); }
  public notifyHalfHealthHooks(): void { this.hooks?.onHalfHealth?.(this); }

  // --- 视图能力：只播放表现，不决定战斗结果 ---------------------------------

  private getCentipedeAnim(): CentipedeAnimController {
    return this.animController as CentipedeAnimController;
  }

  public playSkillSfx(kind: "mine" | "charge" | "summon" | "blast", x = this.x, y = this.y): void {
    this.getCentipedeAnim().playSkillPose(kind);
    SfxCmd.Create(CentipedeSkillSfx, {
      scene: this.scene,
      x,
      y: y - PositionManager.Instance.GRID_SIZEY * 0.55,
      kind,
    });
  }

  public playSceneFlash(): void {
    const flash = this.scene.add.rectangle(
      LOGICAL_BATTLE_WIDTH / 2, LOGICAL_BATTLE_HEIGHT / 2,
      LOGICAL_BATTLE_WIDTH, LOGICAL_BATTLE_HEIGHT, 0xffffff, 1,
    )
      .setDepth(DepthHelper.Mob.sceneFlash())
      .setAlpha(0);
    this.scene.tweens.add({ targets: flash, alpha: 1, duration: 200, yoyo: true, onComplete: () => flash.destroy() });
  }

  public playArc(x1: number, y1: number, x2: number, y2: number, texture: string, duration: number, arcHeight: number): void {
    SfxCmd.Create(ArcSfx, { scene: this.scene, x1, y1, x2, y2, texture, duration, arcHeight });
  }

  public playCharge(startCol: number, targetCol: number, row: number): void {
    const startPos = PositionManager.Instance.getZombieBottomCenter(startCol, row);
    const targetViewPos = PositionManager.Instance.getZombieBottomCenter(targetCol, row);

    this.setVelocityX(0);
    const ctrl = this.getCentipedeAnim();
    ctrl.isInAnim = true;
    ctrl.startLegSwing();
    SfxCmd.Create(CentipedeSkillSfx, {
      scene: this.scene,
      x: (startPos.x + targetViewPos.x) / 2,
      y: targetViewPos.y - PositionManager.Instance.GRID_SIZEY * 0.3,
      kind: "charge",
      width: Math.abs(startPos.x - targetViewPos.x),
      height: PositionManager.Instance.GRID_SIZEY * 0.9,
    });

    const state = { x: startPos.x };
    let nextDustX = startPos.x - PositionManager.Instance.GRID_SIZEX * 0.75;
    this.scene.tweens.add({
      targets: state,
      x: targetViewPos.x,
      duration: CHARGE_DURATION_MS,
      ease: "Quad.easeIn",
      // 只驱动表现位置与尘土：权威 col/x/y、刚体与伤害由 Model 的 ChargeImpact
      // tick 事件在固定逻辑帧落地，避免渲染帧率影响回滚/联机结果。
      onUpdate: () => {
        this.animController.updatePosition(state.x + this.offsetX, startPos.y + this.offsetY);
        if (state.x <= nextDustX) {
          SfxCmd.Create(CentipedeSkillSfx, {
            scene: this.scene,
            x: state.x,
            y: startPos.y - PositionManager.Instance.GRID_SIZEY * 0.3,
            kind: "charge",
            width: PositionManager.Instance.GRID_SIZEX,
            height: PositionManager.Instance.GRID_SIZEY * 0.8,
          });
          nextDustX -= PositionManager.Instance.GRID_SIZEX * 0.75;
        }
      },
      onComplete: () => {
        ctrl.stopLegSwing();
        ctrl.isInAnim = false;
      },
    });
  }

  /** 冲锋落地：由 Model 在固定逻辑帧调用，写入权威坐标并同步刚体与视图。 */
  public applyChargeEnd(targetCol: number, row: number): void {
    const targetViewPos = PositionManager.Instance.getZombieBottomCenter(targetCol, row);
    this.col = targetCol;
    this.row = row;
    this.x = targetViewPos.x;
    this.y = targetViewPos.y;
    this.rigidBody?.setTranslation(PositionManager.Instance.getZombieBodyCenter(targetCol, row), true);
    this.animController.updatePosition(targetViewPos.x + this.offsetX, targetViewPos.y + this.offsetY);
    const ctrl = this.getCentipedeAnim();
    ctrl.stopLegSwing();
    ctrl.isInAnim = false;
  }

  public playSummonEffects(row: number): void {
    const spawnCol = PositionManager.Instance.Col_Number - 1;
    SfxCmd.Create(DirtOutSfx, {
      scene: this.scene,
      col: spawnCol,
      row,
      size: {
        sizeX: PositionManager.Instance.GRID_SIZEX * CENTIPEDE_MINION_WIDTH_CELLS,
        sizeY: PositionManager.Instance.GRID_SIZEY * 1.0,
      },
    });
    const ringPos = PositionManager.Instance.getZombieBottomCenter(spawnCol, row);
    SfxCmd.Create(CentipedeSkillSfx, {
      scene: this.scene,
      x: ringPos.x,
      y: ringPos.y - PositionManager.Instance.GRID_SIZEY * 0.35,
      kind: "summon",
      width: PositionManager.Instance.GRID_SIZEX * CENTIPEDE_MINION_WIDTH_CELLS,
      height: PositionManager.Instance.GRID_SIZEY,
    });
  }

  /** 弧形换位表现：只播放位移与动画，权威 col/row 由 Model 的 tick 事件落地。 */
  public playArcReposition(newCol: number, newRow: number): void {
    const ctrl = this.getCentipedeAnim();
    ctrl.isInAnim = true;
    const from = { x: this.x + this.offsetX, y: this.y + this.offsetY };
    const toViewPos = PositionManager.Instance.getZombieBottomCenter(newCol, newRow);
    const to = { x: toViewPos.x + this.offsetX, y: toViewPos.y + this.offsetY };
    const arcHeight = PositionManager.Instance.GRID_SIZEY * 1.45;
    ctrl.startArc(from, to, REPOSITION_ARC_DURATION_MS, arcHeight, undefined, () => {
      ctrl.isInAnim = false;
    });
  }

  /** 弧形换位落地：由 Model 在固定逻辑帧调用，写入权威坐标并同步刚体与视图。 */
  public applyArcReposition(newCol: number, newRow: number): void {
    const ctrl = this.getCentipedeAnim();
    const toViewPos = PositionManager.Instance.getZombieBottomCenter(newCol, newRow);
    const bodyPos = PositionManager.Instance.getZombieBodyCenter(newCol, newRow);
    this.col = newCol;
    this.row = newRow;
    this.x = toViewPos.x;
    this.y = toViewPos.y;
    this.rigidBody?.setTranslation(bodyPos, true);
    this.animController.updatePosition(toViewPos.x + this.offsetX, toViewPos.y + this.offsetY);
    ctrl.isInAnim = false;
  }
}

export const CentipedeData = new CentipedeModel({
  mid: 17,
  nameKey: "Centipede",
  level: 999,
  weight: () => 0,
  leastWaveID: 0,
  rank: "boss",
  buffImmune: true,
  habitats: ["ground", "water"],
  canDrown: false,
  maxHealth: 20000,
  baseSpeed: 0,
  baseAttackDamage: 0,
  attackInterval: 1200,
  couldCarryStarShards: false,
  createEntity: (scene, col, row, model, waveID) => new CentipedeEntity(scene, col, row, model as CentipedeModel, waveID),
});
