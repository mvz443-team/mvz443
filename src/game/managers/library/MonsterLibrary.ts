import { MonsterModel } from "../../models/MonsterModel";
import {
  BalloonCapZombieData,
  BalloonTntCloneData,
  BalloonZombieData,
  CapZombieData,
  CentipedeData,
  CentipedeMinionData,
  EvokerData,
  HelmetZombieData,
  MinerHelmetZombieData,
  MinerZombieData,
  MutantData,
  ObsidianGolemData,
  SkeletonBowData,
  SkeletonData,
  StickZombieData,
  TurtleSkeletonBowData,
  TurtleZombieData,
  VindicatorData,
  VindicatorSoliderData,
  WardenData,
  ZombieData,
  BoatZombieData,
  BoatCapZombieData,
  BoatHelmetZombieData,
  BoatTurtleZombieData,
  BoatSkeletonBowZombieData,
  DivingZombieData,
  DolphinRiderZombieData,
} from "../../presets/monster";

export class MonsterLibrary {
  private static models: Map<number, MonsterModel> = new Map();

  public static get Models() {
    return this.models;
  }

  public static Initialize() {
    if (this.models.size > 0) return;

    this.Register(ZombieData);
    this.Register(CapZombieData);
    this.Register(HelmetZombieData);
    this.Register(MinerZombieData);
    this.Register(MinerHelmetZombieData);
    this.Register(SkeletonData);
    this.Register(SkeletonBowData);
    this.Register(StickZombieData);
    this.Register(EvokerData);
    this.Register(VindicatorData);
    this.Register(VindicatorSoliderData);
    this.Register(ObsidianGolemData);
    this.Register(WardenData);
    this.Register(TurtleZombieData);
    this.Register(MutantData);
    this.Register(TurtleSkeletonBowData);
    this.Register(CentipedeData);
    this.Register(CentipedeMinionData);
    this.Register(BalloonZombieData);
    this.Register(BalloonCapZombieData);
    // 水生木船僵尸：只在第 4 波起的水路行出没（前 3 波 waterWays 被排除）。
    this.Register(BoatZombieData);
    this.Register(BoatCapZombieData);
    this.Register(BoatHelmetZombieData);
    this.Register(BoatTurtleZombieData);
    this.Register(BoatSkeletonBowZombieData);
    this.Register(DivingZombieData);
    this.Register(DolphinRiderZombieData);
    // 星之碎片召唤物：weight 为 0，永远不会进入出怪池。
    this.Register(BalloonTntCloneData);

    console.log(`[MonsterLibrary] Initialized ${this.models.size} Monsters.`);
  }

  private static Register(model: MonsterModel) {
    if (this.models.has(model.mid)) {
      console.warn(`[MonsterLibrary] MID ${model.mid} is already registered!`);
      return;
    }
    this.models.set(model.mid, model);
  }

  public static GetModel(mid: number): MonsterModel | undefined {
    return this.models.get(mid);
  }
}
