# 星之碎片交互（对齐 PvZ2 能量豆）与护盾植物

## 1. PvZ2 能量豆（Plant Food）的用户体验调研

调研来源：360 百科「能量豆」条目、萌娘百科「植物大战僵尸2/可收集物」、
多家攻略站的能量豆使用说明。

可复用的交互结论：

1. **拾取进槽位**：击杀带绿光的僵尸掉落，拾取后进入底部的能量豆槽（国际版上限 5）。
2. **两种等效操作**：把能量豆从槽位**拖到**植物身上，或者**点选**能量豆再点植物。
3. **一次一个目标**：单颗能量豆只作用于一个植物，作用后立即消耗。
4. **目标要看得见**：必须有明确的"这一下会给谁"的反馈，落地后目标植物播放专属演出，
   其它植物毫无反应。没有可作用目标时不会消耗。
5. **底座不抢目标**：睡莲、花盆这类承载物只是底座，能量豆默认落在它上面的植物；
   南瓜头（Pumpkin）这种"包裹型护盾"是例外——它自己也能吃能量豆，
   玩家要把它和内部植物区分开，靠的是"点外壳还是点内部植物"。

本作支持**点选**与**拖放**两种等效操作（第 2~5 条同样适用）：

- 点选：`StarShardsPanelView` → `CursorManager` 跟随指针 → 点格子；
- 拖放：按住星之碎片槽位直接拖到植物上松手（`CursorManager.beginCardDragPress`）。

## 2. 我们落地的交互

| PvZ2 行为 | 本作实现 |
| --- | --- |
| 点选能量豆后指针跟随 | `CursorManager.starSprite` 缓动跟随（已有） |
| 拖拽星之碎片到植物身上 | **新增**：卡槽按下登记候选拖拽，位移超过阈值后接管选中态，松手走与点选完全相同的落地路径 |
| 悬浮显示"将作用于谁" | 目标植物白色加色发光 + 白色描边呼吸（`CursorManager.updateTargetHighlight`） |
| 预览与生效必须一致 | 预览与 `PlantsManager.handleAttemptUseStarShards` 共用 `PlantHelper.GetStarShardsTarget` |
| 没有合法目标不强给 | 目标为 `null` 时清掉高亮，点击也不会扣碎片 |
| 一次一个目标 | 单次 `LaunchStarShards` 只作用于一个 `pid` |

## 3. 同格多植物的目标规则

规则集中在 `src/game/utils/helper/PlantTargeting.ts` 的 `pickStarShardsTarget()`，
零依赖纯函数，预览、执行、测试共用同一份：

```
角色                识别方式                说明
承载物 carrier       pid 6(睡莲) / 100(船)   只是底座，永远不是默认目标
内部植物 inner       非 carrier、非 shield   真正干活的植物
护盾植物 shield      pid 19(南瓜护照)        包在内部植物外面的壳
```

选择顺序（`aspect` = 鼠标落在格子上半区还是下半区）：

| 格子内容 | `up`（上半区 / 内部植物可见区） | `down`（下半区 / 外壳） |
| --- | --- | --- |
| 护照 + 植物 + 睡莲 | 内部植物 | 护照 |
| 护照 + 睡莲 | 睡莲 | 护照 |
| 护照 + 植物 | 内部植物 | 护照 |
| 只有护照 | 护照 | 护照 |
| 只有植物 + 睡莲 | 植物 | 植物 |
| 只有睡莲 | 睡莲（兜底） | 睡莲（兜底） |
| 空 / 全灭 | `null` | `null` |

这与 PvZ2「点内部植物给内部植物、点南瓜壳给南瓜头」一致，而且因为**预览会高亮**，
玩家在按下鼠标之前就能确认目标，不会出现"给了不想给的植物"。

铲除（镐子）仍然走 `PlantHelper.GetHighestPriorityPlant`：`down` 先铲护盾、`up` 先铲内部植物。

## 4. 护盾植物机制

`SHIELD_PLANT_PIDS = [19]`（`PlantTargeting.ts`），`PlantHelper.SHIELD_PLANT` 直接引用它。

- **种在同一格**：`CanPlantInGrid` 已有分支允许护盾植物叠在任意非护盾植物上，且同格只能有一个护盾。
- **伤害路由**：`PlantEntity.takeDamage()` → `PlantModel.redirectDamageToShield()` →
  `pickShieldPlant()` 找同格存活护盾 → 伤害转给护盾，内部植物不结算（音效也只响一次）。
  护盾植物自身不会再转发，避免递归。
- **区域伤害不挡**：`MobCmd.DamagePlantsInCells/Area` 是逐株直接调用 `takeDamage`，
  所以 AoE 会同时打到护盾与内部植物（与 PvZ 的爆炸一致）。
- **渲染**：护盾植物是独立实体，`DepthHelper.Plant.shieldShell(baseDepth)` = `baseDepth + 1`，
  固定画在内部植物之上；贴图顶部留出开口，内部植物仍然可见。

## 5. 南瓜护照（pid 19）

- 低矮（`tiny = true`）+ 护盾植物，2500 血、125 能量、不攻击、冷却 25s。
- 星之碎片：`PlantCmd.SetHealth(entity, maxHealth)` 回满 + `isSpiky = true`；
  已尖刺时只回血（不再播放激活动画）。
- 尖刺状态下每次受到**近战**伤害（有 `dealer`、无 `source`）返还
  `floor(realDamage * 0.5)` 给伤害源；带投射物来源（子弹/激光/爆炸）的伤害不返还。
- `isSpiky` 是 Model 普通字段，进快照；回滚后 `syncViewFromModel()` 用帧 1/0 恢复外观。
