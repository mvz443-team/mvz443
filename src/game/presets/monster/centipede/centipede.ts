import { SECKILL } from "../../../../../public/constants";
import { PhaserEventBus, PhaserEvents } from "../../../EventBus";
import ObstacleManager from "../../../managers/combat/ObstacleManager";
import PlantsManager from "../../../managers/combat/PlantsManager";
import { PositionManager } from "../../../managers/view/PositionManager";
import { BaseMonsterEntity, PresetMonsterModel } from "../../../models/entities/MonsterEntity";
import { Faction } from "../../../models/Enum";
import { ColorBlockAnimController } from "../../../models/monster/anims/ColorBlockAnimController";
import type { Game } from "../../../scenes/Game";
import { ArcSfx } from "../../../sfx/arc/ArcSfx";
import { DirtOutSfx } from "../../../sfx/dirt/DirtOutSfx";
import { ExplosionSfx } from "../../../sfx/explosion/ExplosionSfx";
import MobCmd from "../../../utils/cmd/MobCmd";
import ObstacleCmd from "../../../utils/cmd/ObstacleCmd";
import { PlantCmd } from "../../../utils/cmd/PlantCmd";
import { SfxCmd } from "../../../utils/cmd/SfxCmd";
import { announceBossSkill } from "../../../utils/skill_announce";
import { MineRockObstacleData } from "../../obstacle";
import { CentipedeMinionData } from "./centipede_minion";

const PAUSE_BEFORE_SKILL_MS = 6000;
const SKILL_DURATION_MS = 4000;
const HIDDEN_DURATION_MS = 3000;
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
    scene.musical.coverCurrent("bgm1");

    this.tickmanager.delayedCall({
      delay: 250,
      callback: () => {
        this.hooks?.onSpawn?.(this);
        this.beginCycle();
      }
    });
  }

  protected createAnimController() {
    const size = PositionManager.Instance.getZombieDisplaySize();
    return new ColorBlockAnimController(this.scene, this.x, this.y, {
      width: size.sizeX * 1.4,
      height: size.sizeY * 1.4,
      fillColor: 0x4b2350,
      strokeColor: 0xc46af0,
      strokeWidth: 3,
    });
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
    this.scene.musical.backToDump();
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
    const { width, height } = this.scene.scale;
    const flash = this.scene.add.rectangle(width / 2, height / 2, width, height, 0xffffff, 1)
      .setDepth(900000)
      .setAlpha(0);
    this.scene.tweens.add({
      targets: flash,
      alpha: 1,
      duration: 200,
      yoyo: true,
      onComplete: () => flash.destroy(),
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
    const ctrl = this.animController as ColorBlockAnimController;
    ctrl.getRect().setVisible(false);
    ctrl.isInAnim = true;

    this.tickmanager.delayedCall({
      delay: HIDDEN_DURATION_MS,
      callback: () => {
        if (this.currentHealth <= 0 || this.isDying) return;
        const newRow = Math.floor(MobCmd.DeterministicRandom(0, PositionManager.Instance.Row_Number));
        const clamped = Phaser.Math.Clamp(newRow, 0, PositionManager.Instance.Row_Number - 1);
        const newCol = PositionManager.Instance.Col_Number - 1;

        const bodyPos = PositionManager.Instance.getZombieBodyCenter(newCol, clamped);
        const viewPos = PositionManager.Instance.getZombieBottomCenter(newCol, clamped);
        this.col = newCol;
        this.row = clamped;
        this.x = viewPos.x;
        this.y = viewPos.y;
        this.rigidBody?.setTranslation(bodyPos, true);
        this.animController.updatePosition(viewPos.x + this.offsetX, viewPos.y + this.offsetY);
        ctrl.getRect().setVisible(true);
        ctrl.isInAnim = false;
        this.isHidden = false;

        this.beginCycle();
      }
    });
  }

  private pickSkill(): SkillIndex {
    const candidates: SkillIndex[] = ([1, 2, 3] as SkillIndex[]).filter((s) => s !== this.lastSkill);
    const idx = Math.floor(MobCmd.DeterministicRandom(0, candidates.length));
    return candidates[Math.min(idx, candidates.length - 1)];
  }

  private castSkill0(): void {
    announceBossSkill(this.scene, "skill_mine_rock");
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
      texture: "starshards",
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
            PlantCmd.DealDamage(plant, SECKILL / 2, this);
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
    const startCol = this.col;
    const targetCol = Math.max(2, startCol - 5);
    const targetRow = this.row;
    const targetX = PositionManager.Instance.getZombieBottomCenter(targetCol, targetRow).x;
    const dashDuration = 700;

    const ctrl = this.animController as ColorBlockAnimController;
    const rect = ctrl.getRect();
    ctrl.isInAnim = true;
    this.scene.tweens.add({
      targets: rect,
      x: targetX,
      duration: dashDuration,
      ease: "Cubic.easeInOut",
    });

    this.tickmanager.delayedCall({
      delay: dashDuration,
      callback: () => {
        ctrl.isInAnim = false;
        if (this.currentHealth <= 0) return;
        this.col = targetCol;
        if (this.rigidBody) {
          const bodyPos = PositionManager.Instance.getZombieBodyCenter(targetCol, targetRow);
          this.rigidBody.setTranslation(bodyPos, true);
        }
        const viewPos = PositionManager.Instance.getZombieBottomCenter(targetCol, targetRow);
        this.animController.updatePosition(viewPos.x + this.offsetX, viewPos.y + this.offsetY);

        const minCol = Math.min(startCol, targetCol);
        const maxCol = Math.max(startCol, targetCol);
        const cells: { col: number; row: number }[] = [];
        for (let c = minCol; c <= maxCol; c++) cells.push({ col: c, row: targetRow });
        MobCmd.DamagePlantsInCells(cells, SECKILL / 2);

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
    const rowNum = PositionManager.Instance.Row_Number;
    const colSpawn = PositionManager.Instance.Col_Number;
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
            col: colSpawn - 1,
            row,
            size: { sizeX: PositionManager.Instance.GRID_SIZEX * 1.2, sizeY: PositionManager.Instance.GRID_SIZEY * 1.0 },
          });

          this.tickmanager.delayedCall({
            delay: 450,
            callback: () => {
              MobCmd.Spawn(CentipedeMinionData.mid, this.scene, colSpawn, row, -10);
            }
          });
        }
      });
    });
  }

  private castSkill3(): void {
    announceBossSkill(this.scene, "skill_blast");
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
        texture: "anime/explosion",
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
