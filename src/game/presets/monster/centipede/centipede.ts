import { DamageConstants } from "../../../../constants/game";
import DepthHelper from "../../../utils/helper/DepthHelper";
import { PhaserEventBus, PhaserEvents } from "../../../EventBus";
import { LOGICAL_BATTLE_HEIGHT, LOGICAL_BATTLE_WIDTH } from "../../../../constants/gameLayout";
import ObstacleManager from "../../../managers/combat/ObstacleManager";
import PlantsManager from "../../../managers/combat/PlantsManager";
import { PositionManager } from "../../../managers/view/PositionManager";
import { BaseMonsterEntity, PresetMonsterModel } from "../../../models/entities/MonsterEntity";
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
import { announceBossSkill } from "../../../utils/skill_announce";
import { MineRockObstacleData } from "../../obstacle";
import { CentipedeAnimController } from "./centipede_anim";
import { CENTIPEDE_MINION_WIDTH_CELLS, CentipedeMinionData } from "./centipede_minion";

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

export class CentipedeEntity extends BaseMonsterEntity {
  private hooks: CentipedeHooks | null;
  private lastSkill: SkillIndex | 0 = 0;
  private hpTriggers = new Set<number>();
  private flashTriggered = false;
  private isHidden = false;

  public constructor(scene: Game, col: number, row: number, model: PresetMonsterModel, waveID: number) {
    super(scene, col, row, model, waveID);
    this.hooks = pendingHooks;
    pendingHooks = null;

    PhaserEventBus.emit(PhaserEvents.BossHealth, { health: 100 });
    SoundCmd.CoverBgm("bgm1");

    this.tickmanager.delayedCall({
      delay: 250,
      callback: () => {
        this.hooks?.onSpawn?.(this);
        this.beginCycle();
      }
    });
  }

  protected createAnimController() {
    return new CentipedeAnimController(this.scene, this.x, this.y);
  }

  public override startMove(): void {
    this.stopMove();
  }

  public override takeDamage(amount: number, dealer?: any, source?: any): void {
    if (this.isDying || this.currentHealth <= 0 || this.isHidden) return;
    super.takeDamage(amount, dealer, source);
    if (this.currentHealth > 0) {
      MobCmd.EmitBossHealth(this);
      this.checkHealthTriggers();
    }
  }

  public override destroy(): void {
    PhaserEventBus.emit(PhaserEvents.BossHealth, { health: -1 });
    SoundCmd.BackToPreviousBgm();
    super.destroy();
  }

  private checkHealthTriggers(): void {
    const ratio = this.currentHealth / this.maxHealth;

    if (!this.flashTriggered && ratio <= HEALTH_FLASH_TRIGGER) {
      this.flashTriggered = true;
      this.playSceneFlash();
      this.hooks?.onHalfHealth?.(this);
    }

    for (const trigger of HEALTH_TRIGGERS) {
      if (ratio <= trigger && !this.hpTriggers.has(trigger)) {
        this.hpTriggers.add(trigger);
        this.castSkill0();
      }
    }
  }

  private playSceneFlash(): void {
    const width = LOGICAL_BATTLE_WIDTH;
    const height = LOGICAL_BATTLE_HEIGHT;
    const flash = this.scene.add.rectangle(width / 2, height / 2, width, height, 0xffffff, 1)
      .setDepth(DepthHelper.Mob.sceneFlash())
      .setAlpha(0);
    this.scene.tweens.add({
      targets: flash,
      alpha: 1,
      duration: 200,
      yoyo: true,
      onComplete: () => flash.destroy(),
    });
  }

  private getCentipedeAnim(): CentipedeAnimController {
    return this.animController as CentipedeAnimController;
  }

  private playSkillSfx(kind: "mine" | "charge" | "summon" | "blast", x = this.x, y = this.y): void {
    this.getCentipedeAnim().playSkillPose(kind);
    SfxCmd.Create(CentipedeSkillSfx, {
      scene: this.scene,
      x,
      y: y - PositionManager.Instance.GRID_SIZEY * 0.55,
      kind,
    });
  }

  private beginCycle(): void {
    if (this.currentHealth <= 0 || this.isDying) return;
    this.stopMove();
    this.tickmanager.delayedCall({
      delay: PAUSE_BEFORE_SKILL_MS,
      callback: () => this.runSkillCycle(),
    });
  }

  private runSkillCycle(): void {
    if (this.currentHealth <= 0 || this.isDying) return;

    const skill = this.pickSkill();
    this.lastSkill = skill;

    if (skill === 1) this.castSkill1();
    else if (skill === 2) this.castSkill2();
    else if (skill === 3) this.castSkill3();

    this.tickmanager.delayedCall({
      delay: SKILL_DURATION_MS,
      callback: () => this.disappearAndReposition(),
    });
  }

  private disappearAndReposition(): void {
    if (this.currentHealth <= 0 || this.isDying) return;

    this.isHidden = true;
    const ctrl = this.getCentipedeAnim();
    ctrl.isInAnim = true;

    const newRow = Math.floor(MobCmd.DeterministicRandom(0, PositionManager.Instance.Row_Number));
    const clamped = Phaser.Math.Clamp(newRow, 0, PositionManager.Instance.Row_Number - 1);
    const newCol = PositionManager.Instance.Col_Number - 1;
    const from = { x: this.x + this.offsetX, y: this.y + this.offsetY };
    const toViewPos = PositionManager.Instance.getZombieBottomCenter(newCol, clamped);
    const to = { x: toViewPos.x + this.offsetX, y: toViewPos.y + this.offsetY };
    const arcHeight = PositionManager.Instance.GRID_SIZEY * 1.45;

    ctrl.startArc(from, to, REPOSITION_ARC_DURATION_MS, arcHeight, undefined, () => {
      if (this.currentHealth <= 0 || this.isDying) return;
      const bodyPos = PositionManager.Instance.getZombieBodyCenter(newCol, clamped);
      this.col = newCol;
      this.row = clamped;
      this.x = toViewPos.x;
      this.y = toViewPos.y;
      this.rigidBody?.setTranslation(bodyPos, true);
      this.animController.updatePosition(to.x, to.y);
      ctrl.isInAnim = false;
      this.isHidden = false;
      this.beginCycle();
    });
  }

  private pickSkill(): SkillIndex {
    const candidates: SkillIndex[] = ([1, 2, 3] as SkillIndex[]).filter((s) => s !== this.lastSkill);
    const idx = Math.floor(MobCmd.DeterministicRandom(0, candidates.length));
    return candidates[Math.min(idx, candidates.length - 1)];
  }

  private castSkill0(): void {
    announceBossSkill(this.scene, "skill_mine_rock");
    this.playSkillSfx("mine");
    const colNum = PositionManager.Instance.Col_Number;
    const rowNum = PositionManager.Instance.Row_Number;
    const minCol = 5;
    const candidateCols: number[] = [];
    for (let c = minCol; c < colNum; c++) candidateCols.push(c);

    const col = candidateCols[Math.floor(MobCmd.DeterministicRandom(0, candidateCols.length))] ?? minCol;
    const row = Math.min(rowNum - 2, Math.floor(MobCmd.DeterministicRandom(0, rowNum - 1)));

    const targetPos = PositionManager.Instance.getPlantBottomCenter(col, row + 1);
    const arcDuration = 1100;

    SfxCmd.Create(ArcSfx, {
      scene: this.scene,
      x1: targetPos.x,
      y1: targetPos.y - PositionManager.Instance.GRID_SIZEY * 5,
      x2: targetPos.x,
      y2: targetPos.y,
      texture: "sfxCentipedeOrb",
      duration: arcDuration,
      arcHeight: 0,
    });

    this.tickmanager.delayedCall({
      delay: arcDuration,
      callback: () => {
        if (ObstacleManager.Instance.HasObstacle(col, row) || ObstacleManager.Instance.HasObstacle(col, row + 1)) return;

        for (const r of [row, row + 1]) {
          const plants = PlantsManager.Instance.PlantsMap.get(`${col}-${r}`) ?? [];
          for (const plant of [...plants]) {
            PlantCmd.DealDamage(plant, DamageConstants.SECKILL / 2, this);
          }
        }

        ObstacleCmd.createInGrid(MineRockObstacleData.oid, this.scene, col, row, {
          hp: 300,
          faction: Faction.ZOMBIE,
          summoner: this,
        });
      },
    });
  }

  private castSkill1(): void {
    announceBossSkill(this.scene, "skill_charge");
    this.playSkillSfx("charge");
    const startCol = this.col;
    const targetCol = Math.max(2, startCol - 5);
    const targetRow = this.row;
    const startPos = PositionManager.Instance.getZombieBottomCenter(startCol, targetRow);
    const targetViewPos = PositionManager.Instance.getZombieBottomCenter(targetCol, targetRow);

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
      onUpdate: () => {
        this.x = state.x;
        this.y = startPos.y;
        this.rigidBody?.setTranslation(PositionManager.Instance.getZombieBodyCenterByBottom(this.x, this.y), true);
        this.animController.updatePosition(this.x + this.offsetX, this.y + this.offsetY);
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
        if (this.currentHealth <= 0) return;
        this.col = targetCol;
        this.x = targetViewPos.x;
        this.y = targetViewPos.y;
        this.rigidBody?.setTranslation(PositionManager.Instance.getZombieBodyCenter(targetCol, targetRow), true);
        this.animController.updatePosition(targetViewPos.x + this.offsetX, targetViewPos.y + this.offsetY);
        ctrl.stopLegSwing();
        ctrl.isInAnim = false;

        const minCol = Math.min(startCol, targetCol);
        const maxCol = Math.max(startCol, targetCol);
        const cells: { col: number; row: number }[] = [];
        for (let c = minCol; c <= maxCol; c++) cells.push({ col: c, row: targetRow });
        MobCmd.DamagePlantsInCells(cells, DamageConstants.SECKILL / 2);

        const sideRows = [targetRow - 1, targetRow + 1].filter((r) => r >= 0 && r < PositionManager.Instance.Row_Number);
        for (const sr of sideRows) {
          const sideCells: { col: number; row: number }[] = [];
          for (let c = minCol; c <= maxCol; c++) sideCells.push({ col: c, row: sr });
          MobCmd.DamagePlantsInCells(sideCells, 100);
        }
      },
    });
  }

  private castSkill2(): void {
    announceBossSkill(this.scene, "skill_summon");
    this.playSkillSfx("summon");
    const rowNum = PositionManager.Instance.Row_Number;
    const spawnCol = PositionManager.Instance.Col_Number - 1;
    const allRows = Array.from({ length: rowNum }, (_, i) => i);
    const picked: number[] = [];
    const pool = [...allRows];
    while (picked.length < 3 && pool.length > 0) {
      const idx = Math.floor(MobCmd.DeterministicRandom(0, pool.length));
      picked.push(pool.splice(Math.min(idx, pool.length - 1), 1)[0]);
    }

    picked.forEach((row, i) => {
      this.tickmanager.delayedCall({
        delay: 200 + i * 250,
        callback: () => {
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

          this.tickmanager.delayedCall({
            delay: 450,
            callback: () => {
              MobCmd.Spawn(CentipedeMinionData.mid, this.scene, spawnCol, row, -10);
            }
          });
        }
      });
    });
  }

  private castSkill3(): void {
    announceBossSkill(this.scene, "skill_blast");
    this.playSkillSfx("blast");
    const usableCols: number[] = [];
    for (let c = 3; c <= 5; c++) usableCols.push(c);

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

      SfxCmd.Create(ArcSfx, {
        scene: this.scene,
        x1: this.x,
        y1: this.y - PositionManager.Instance.GRID_SIZEY * 0.5,
        x2: targetPos.x,
        y2: targetPos.y,
        texture: "sfxCentipedeOrb",
        duration: arcDuration,
        arcHeight: 220,
      });

      this.tickmanager.delayedCall({
        delay: arcDuration,
        callback: () => {
          const center = PositionManager.Instance.getGridCenter(tCol, tRow);
          SfxCmd.Create(ExplosionSfx, {
            scene: this.scene,
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
            for (let dr = -1; dr <= 1; dr++) {
              cells.push({ col: tCol + dc, row: tRow + dr });
            }
          }
          MobCmd.DamagePlantsInCells(cells, 500);
        }
      });
    });
  }
}

export const CentipedeData = new PresetMonsterModel({
  mid: 17,
  nameKey: "Centipede",
  level: 999,
  weight: () => 0,
  leastWaveID: 0,
  rank: "boss",
  maxHealth: 20000,
  baseSpeed: 0,
  attackDamage: 0,
  attackInterval: 1200,
  couldCarryStarShards: false,
  createEntity: (scene, col, row, model, waveID) => new CentipedeEntity(scene, col, row, model, waveID),
});
