import { setCentipedeHooks } from "../../presets/monster/centipede/centipede";
import DepthHelper from "../../utils/helper/DepthHelper";
import { DispenserData } from "../../presets/plant/chapter1/dispenser";
import { FurnaceData } from "../../presets/plant/chapter1/furnace";
import type { Game } from "../../scenes/Game";
import { GainEnergySfx } from "../../sfx/energy/GainEnergySfx";
import { PlantCmd } from "../../utils/cmd/PlantCmd";
import { SfxCmd } from "../../utils/cmd/SfxCmd";
import { StageDataRecords } from "../library/ChapterLibrary";
import { BaseManager } from "../BaseManager";
import CombatManager from "../CombatManager";
import { PositionManager } from "../view/PositionManager";
import GridManager from "./GridManager";
import MobManager from "./MobManager";
import PlantsManager from "./PlantsManager";
import ResourceManager from "./ResourceManager";
import TickerManager, { FrameTimer } from "./TickerManager";
import { LOGICAL_BATTLE_HEIGHT, LOGICAL_BATTLE_WIDTH } from "../../../constants/gameLayout";
import { SmallDispenserData } from "../../presets/plant/chapter1/small_dispenser";
import { GeneratorData } from "../../presets/plant/chapter1/generator";
import { LilyData } from "../../presets/plant/chapter1/lily";

/**
 * 预设事件管理器
 * 负责预设事件的加载、管理和重置
 */
export class PresetEventManager extends BaseManager {
  private static _instance: PresetEventManager;
  private onNewWaveHandler: ((waveId: number, isFlag: boolean) => void) | null = null;
  private autoEnergyTimer: FrameTimer | null = null;

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
    // 监听 MobManager 的 onNewWave 事件
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
    // 实现游戏开始时的预设事件处理逻辑
    GridManager.Instance.initGridProperties();
    const stageId = this.scene.params.level || 0;
    const chapterId = StageDataRecords[stageId].chapterId;

    this.setInitialEnergy(this.scene.stageData.energy);
    // dayOrNight 触发自动产能
    CombatManager.Instance.combatStatus.dayOrNight = this.scene.stageData.stageScript.dayOrNight === 2 ?
      false : true;
    if (CombatManager.Instance.combatStatus.dayOrNight) {
      this.startAutoGenerateEnergy(17000, 25000, 25);
    }

    // dispatch stage or chapter
    if (chapterId === 1) {
      this.Chapter1Dispatch(this.scene, stageId);
    }
  }

  /**
   * 特定波数触发的事件
   */
  private triggerSpecifiedWaveEvent(waveId: number, isFlag: boolean): void {
    console.log(`Specified wave event triggered at wave ${waveId}, isFlag: ${isFlag}`);
    // 实现特定波数的预设事件处理逻辑
  }

  /**
   * 重置预设事件状态
   */
  public Reset(): void {
    // 移除事件监听
    if (this.onNewWaveHandler) {
      MobManager.Instance.EventBus.off('onNewWave', this.onNewWaveHandler);
      this.onNewWaveHandler = null;
    }
    this.stopAutoGenerateEnergy();
    setCentipedeHooks(null);
    this.scene = null;
  }

  // 自动产能设置
  private startAutoGenerateEnergy(startAtMs: number, intervalMs: number, delta: number) {
    this.stopAutoGenerateEnergy();
    this.autoEnergyTimer = TickerManager.Instance.addEvent({
      delay: intervalMs,
      loop: true,
      startAt: startAtMs,
      callback: () => {
        this.playAutoGenerateEnergySfx();
        ResourceManager.Instance.UpdateEnergy(+delta, 'all');
      }
    });
  }

  private stopAutoGenerateEnergy() {
    this.autoEnergyTimer?.remove();
    this.autoEnergyTimer = null;
  }

  // 初始能量
  private setInitialEnergy(initialEnergy: number) {
    ResourceManager.Instance.UpdateEnergy(+initialEnergy, 'all');
  }

  private playAutoGenerateEnergySfx() {
    if (!this.scene) {
      return;
    }

    const pos = PositionManager.Instance;
    const gridBounds = pos.getGridBounds();
    const centerX = gridBounds.x + pos.GRID_SIZEX * 0.5
      + Math.random() * Math.max(0, gridBounds.width - pos.GRID_SIZEX);
    const centerY = gridBounds.y + pos.GRID_SIZEY * 0.35
      + Math.random() * Math.max(0, gridBounds.height - pos.GRID_SIZEY * 0.7);

    SfxCmd.Create(GainEnergySfx, {
      scene: this.scene,
      x: centerX,
      y: centerY,
      size: "medium",
    });
  }

  Chapter1Dispatch(game: Game, stageId: number) {
    // 第一章的
    const width = LOGICAL_BATTLE_WIDTH;
    const height = LOGICAL_BATTLE_HEIGHT;


    if (stageId === 1) {
      PlantsManager.Instance.PlantCard(9961, DispenserData.pid, 1, 0, 0);
      PlantsManager.Instance.PlantCard(9961, DispenserData.pid, 1, 0, 4);
      PlantsManager.Instance.PlantCard(9961, FurnaceData.pid, 1, 1, 1);
      PlantsManager.Instance.PlantCard(9961, FurnaceData.pid, 1, 1, 2);
      PlantsManager.Instance.PlantCard(9961, FurnaceData.pid, 1, 1, 3);
    }

    if (stageId === 2) {
      PlantsManager.Instance.PlantCard(9961, FurnaceData.pid, 1, 1, 1);
      PlantsManager.Instance.PlantCard(9961, FurnaceData.pid, 1, 1, 2);
      PlantsManager.Instance.PlantCard(9961, FurnaceData.pid, 1, 1, 3);
    }

    if (stageId === 3) {
      //darker
      game.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0.3).setDepth(DepthHelper.Scene.presetOverlay());

      PlantsManager.Instance.PlantCard(9961, SmallDispenserData.pid, 1, 4, 1);
      PlantsManager.Instance.PlantCard(9961, SmallDispenserData.pid, 1, 4, 2);
    }

    if (stageId === 4) {
      game.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0.5).setDepth(DepthHelper.Scene.presetOverlay());
      PlantsManager.Instance.PlantCard(9961, GeneratorData.pid, 1, 5, 1);
      PlantsManager.Instance.PlantCard(9961, GeneratorData.pid, 1, 5, 4);
    }

    if (stageId === 5 || stageId === 8) {
      game.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0.5).setDepth(DepthHelper.Scene.presetOverlay());
      // row:2, 3  = water
      for (let col = 0; col < PositionManager.Instance.Col_Number; col++) {
        GridManager.Instance.setSingleGridProperty(col, 2, { type: 'water' });
        GridManager.Instance.setSingleGridProperty(col, 3, { type: 'water' });
      }
      PlantsManager.Instance.PlantCard(9961, LilyData.pid, 1, 0, 2);
      PlantsManager.Instance.PlantCard(9961, LilyData.pid, 1, 0, 3);
      PlantsManager.Instance.PlantCard(9961, LilyData.pid, 1, 1, 2);
      PlantsManager.Instance.PlantCard(9961, LilyData.pid, 1, 1, 3);
    }

    if (stageId === 6) {
      game.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0.5).setDepth(DepthHelper.Scene.presetOverlay());
    }

    if (stageId === 7) {
      game.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0.5).setDepth(DepthHelper.Scene.presetOverlay());

      PlantsManager.Instance.PlantCard(9961, SmallDispenserData.pid, 1, 4, 1);
      PlantsManager.Instance.PlantCard(9961, SmallDispenserData.pid, 1, 4, 2);
      PlantsManager.Instance.PlantCard(9961, FurnaceData.pid, 1, 1, 1);
      PlantsManager.Instance.PlantCard(9961, FurnaceData.pid, 1, 1, 2);
    }

    if (stageId === 9) {
      setCentipedeHooks({
        onSpawn: () => {
          // 关卡开局即自动产能；boss 出场时停产
          this.stopAutoGenerateEnergy();
          game.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0.5).setDepth(DepthHelper.Scene.presetOverlay());
        },
        onHalfHealth: () => {
          // 到达 50% 血量时再恢复
          // this.startAutoGenerateEnergy(0, 20000, 25);
        }
      });
    }




    // // 绘制阴影表格
    // // stage1 黑色
    // if (game.params.level === 1) {
    //   for (let row = 0; row < PositionManager.Instance.Row_Number; row++) {
    //     // game.grid[row] = [];
    //     for (let col = 0; col < PositionManager.Instance.Col_Number; col++) {
    //       const { x, y } = PositionManager.Instance.getGridTopLeft(col, row);
    //       const rect = game.add.rectangle(x, y, PositionManager.Instance.GRID_SIZEX,
    //         PositionManager.Instance.GRID_SIZEY, 0x000000, 0.12)
    //         .setOrigin(0, 0).setDepth(DepthHelper.Scene.presetImage());
    //       rect.setStrokeStyle(1, 0xffffff, 0.1);
    //     }
    //   }
    // }

    // stage 4,5 手动暗淡
  }


}
