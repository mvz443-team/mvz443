# 体态标签：tiny / flying / void

> 适用代码：`src/game/core/logic/BodyTraits.ts`、`src/game/core/logic/LogicModel.ts`、
> `src/game/models/projectiles/ProjectileModels.ts`、`src/game/models/entities/SightLineEntity.ts`

## 1. 为什么需要这一层

怪物有"飞行"和"虚空"两种体态，植物有"低矮"体态，投射物也有能不能打到它们的区别。
过去这些判定散落在 `couldAttackFlying`、`skipTiny`、`includeTiny`、`includeFlying`、
`Entity.isTiny` 上，规则重复实现了 4 份，很容易漂移。

现在统一为三个标签，全部放在 `LogicModel` 上：

| 字段 | 目标的含义 | 投射物/射线/召唤物的含义 |
| --- | --- | --- |
| `tiny` | 低矮贴地层（低矮植物、贴地障碍） | 能命中低矮目标 |
| `flying` | 空中层（飞行中的僵尸） | 能命中空中目标 |
| `inVoid` | 虚空层 | 能命中虚空目标 |

三个字段都是普通布尔值，自动进入 Model 快照与跨端哈希，回滚/重连后不会丢。

## 2. 唯一判定入口

```ts
// src/game/core/logic/BodyTraits.ts
canReachBody(reach: BodyLayers, body: BodyLayers): boolean
readBodyLayers(target: unknown): BodyLayers   // 优先读 target.model
```

规则只有一条：**目标占据的每一层，攻击方都必须能到达。**

- 目标 `flying = true`，攻击方 `flying = false` → 打不到。
- 目标 `tiny = true`，攻击方 `tiny = false` → 打不到。
- 目标 `inVoid = true`，攻击方 `inVoid = false` → 打不到。
- 攻击方多出来的触及能力不影响命中（能打空的投射物同时能打地面）。

调用点：

- `ProjectileModel.canHit(target)`：子弹 / 爆炸 / 激光共用的碰撞过滤。
- `SightLineEntity` 的 `reach`：植物射击判定线（"有没有目标可以开枪"）。
- `MonsterModel.canStartAttack(target)`：僵尸普攻目标选择。

任何新增的"能不能打到它"的判断都必须走这三个入口，禁止再写 `if (isFlying)` 之类的分支。

## 3. 怎么声明

### 3.1 目标（怪物 / 植物 / 障碍）

```ts
export class BalloonZombieModel extends FlyingMonsterModel {
  // 飞行中的气球僵尸：flying = true，落地后置回 false
}

export class LilyModel extends PlantModel {
  constructor() {
    super();
    this.tiny = true;   // 低矮植物
  }
}
```

注意：**不要**在 Entity 上写 `public tiny = false` 之类的字段。同名字段必须
`declare`，否则会遮蔽 Model 访问器，状态不进快照（见 AGENTS.md 第 3 节）。

### 3.2 投射物 / 射线 / 召唤物

Model 上直接声明能力位；也可以在 `ProjectileCmd.Create()` 的配置里覆盖：

```ts
export class LaserModel extends ProjectileModel<...> {
  public override tiny = true;      // 激光能打低矮目标（历史行为）
  public override hitKind = "laser";
}

ProjectileCmd.CreateLaser(scene, x, row, {
  damage: 100,
  faction,
  flying: true,   // 这一发可以打空中
});
```

配置字段与 Model 字段一一对应：`tiny` / `flying` / `inVoid`。

### 3.3 命中类型 `hitKind`

`ProjectileModel.hitKind` 描述"这是什么伤害"，供载具 / 护甲等外层受体区分：

| hitKind | 来源 |
| --- | --- |
| `bullet` | `BulletModel` 及全部子弹派生类（箭、雪球、烟花、矿车、拦截弹） |
| `laser` | `LaserModel` |
| `explosion` | `ExplosionModel` |

读取入口：`readProjectileHitKind(source)`。近战、环境伤害等非投射物来源返回 `null`。

## 4. 迁移对照表

| 旧写法 | 新写法 |
| --- | --- |
| `MonsterModel.isFlying` | `flying`（`LogicModel` 字段） |
| `MonsterModel.isInVoid` | `inVoid` |
| `PlantModel.isTiny` | `tiny` |
| `CombatEntity.isTiny` / `PlantEntity.isTiny = ...` | 删除，统一读 `model.tiny` |
| `ProjectileModel.couldAttackFlying` | `ProjectileModel.flying` |
| `ProjectileModel.skipTiny` | `ProjectileModel.tiny`（语义取反，默认 `false`） |
| `BulletConfig.couldAttackFlying` | `BulletConfig.flying` |
| `BulletConfig.skipTiny: false` | `BulletConfig.tiny: true` |
| `SightLineOptions.includeTiny/includeFlying` | `SightLineOptions.reach: { tiny, flying, inVoid }` |
| `if (target.model.isFlying) return` | `if (!model.canHit(target)) return` |

## 5. 现状统计

见 [体态现状清单](./body-traits-inventory.md)：逐个列出 plant / 怪物 / obstacle
以及它们衍生的射击物、召唤物的三种状态。
