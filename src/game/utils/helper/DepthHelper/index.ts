import { CoreDepth } from "./Core";
import { MobDepth } from "./Mob";
import { PlantDepth } from "./Plant";
import { ProjectileDepth } from "./Projectile";
import { SceneDepth } from "./Scene";
import { SfxDepth } from "./Sfx";
import { UIDepth } from "./UI";

export * from "./Core";
export * from "./Mob";
export * from "./Plant";
export * from "./Projectile";
export * from "./Scene";
export * from "./Sfx";
export * from "./UI";

const DepthHelper = {
  Core: CoreDepth,
  Mob: MobDepth,
  Plant: PlantDepth,
  Projectile: ProjectileDepth,
  Scene: SceneDepth,
  Sfx: SfxDepth,
  UI: UIDepth,
};

export default DepthHelper;
export { DepthHelper };
