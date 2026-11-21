import type { PlantModel } from "../../models/PlantModel";
import { registerPlantStackRole } from "../../utils/helper/PlantTargeting";
import { Chapter1Plants } from "../../presets/plant/chapter1";
import { Chapter2Plants } from "../../presets/plant/chapter2";

const AllPlants = [...Chapter1Plants, ...Chapter2Plants];

export class PlantLibrary {
  // 存储所有的植物蓝图
  private static models: Map<number, PlantModel> = new Map();

  // 游戏初始化时调用一次，把所有写好的植物注册进去
  public static Initialize() {
    if (this.models.size > 0) return; // 防止重复初始化

    for (const plant of AllPlants) {
      this.Register(plant);
      registerPlantStackRole(plant.pid, plant.stackRole);
    }

    // this.Register(PeashooterData);
    // ... 注册其他植物

    console.log(`[PlantLibrary] Initialized ${this.models.size} plants.`);
  }

  // 注册单个植物
  private static Register(model: PlantModel) {
    if (this.models.has(model.pid)) {
      console.warn(`[PlantLibrary] PID ${model.pid} is already registered!`);
      return;
    }
    this.models.set(model.pid, model);
  }

  // 根据 pid 获取蓝图
  public static GetModel(pid: number): PlantModel | undefined {
    return this.models.get(pid);
  }

  public static GetAllModels(): PlantModel[] {
    return Array.from(this.models.values());
  }
}