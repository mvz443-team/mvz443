# Preset 模拟测试

覆盖 `src/game/presets/plant` 与 `src/game/presets/monster` 下全部 preset：

- plant：20 个文件，逐级覆盖 Lv1–Lv9 的普通效果与星之碎片效果。
- mob：20 个文件，覆盖基础数值、攻击节奏、装备、技能与 Boss 阶段。

## 运行

```powershell
npm run test:presets
```

该命令会加载 `test/harness/register.mjs`，直接驱动真实 preset Model、
`LevelScaledValue`、`EntityTickManager` 与装备 mixin；Phaser、Entity、
Manager、Cmd 使用测试替身。逻辑统一按 50ms/帧推进，与游戏平衡帧一致。

## 文件约定

每个 `*.mjs` 文件头包含：

- 描述：对应 preset 的 `*_description` 行为。
- 验收路径：测试如何驱动 Model、需要观察哪些 Cmd/状态。
- 预期结果：等级阈值、伤害、数量、时序等可验收结果。
- 为什么：对应源码中的公式、阈值或状态机分支。

## 实现与描述对齐说明

测试按描述验收；下列容易误读的时序和计数已在实现与测试中统一：

- `EntityTickManager.repeat` 表示总触发次数，不是“额外次数”。
  星碎总数已对齐描述：Dispenser 50 发、TripleDispenser 240 发、
  DoubleDispenser 35 发前方箭、PumpkinWan 5 次爆炸。
- `startAt` 是提前量，不是首次延迟。首次触发时间 =
  `delay - startAt`。例如 ATDispenser 1050ms 触发、1250ms 发射；
  PumpkinWan 使用 `schedule(2000, { startAt: 200, repeat: 5 })`，
  爆炸发生在 1800/3800/5800/7800/9800ms。
- `DoubleDispenser` 的星碎前方箭固定为 35 发，不会在 7 级因普通攻击的
  追加箭被动翻倍；后方烟花仍为 5 发。
- `IceBomb` Lv1 每条激光伤害为 15；冻结与减速两条激光合计 30，
  源码注释中的“30”指合计伤害，不是单条激光。夜间种植立即触发；
  白天种植（睡眠）不立即生效；星碎技能仅在睡眠时生效。
- `Generator` 是光敏作物，阳光强烈时处于睡眠：睡眠产能 1–2 级 3、
  3–6 级 4、7–9 级 6；清醒产能 1–6 级 5、7–9 级 8。3 级只提高
  阳光强烈（睡眠）时的效率，7 级才提高全天候效率。
- `TNT` 7 级起首次爆炸后原地保留 3 秒，随后二次爆炸并销毁；
  1–6 级仍在首次爆炸后 50ms 销毁。
- `Pumpkin` 的 5 级加速攻击是阈值效果：1–4 级攻击间隔 1950ms，
  5–9 级固定为 1462.5ms；9 级另外给激光附加 3s 减速。
- 发射器/三头发射器的星碎状态 `inBruteShoot` 是 Model 字段并进入快照；
  Entity 通过只读 getter 读取，`syncViewFromModel()` 按该状态恢复头部后坐姿态，
  回滚/重连后不会丢失星碎渲染。
- 静态配置与快照分离：植物配置在实体初始化时迁入非枚举 `config`；
  怪物配置来自不可变 `MonsterDefinition`；`tickEventNames` 是原型 getter。
  三者都不进入 `snapshotModel()`，但 getter API 保持不变。
- 中型怪物（僵尸/骷髅/卫道士/唤魔者）共用 `MediumMonsterModel` / `MediumMonsterEntity`：
  `head` / `mainHand` / `offHand` 装备槽 + `mount` 字段；伤害路由为
  `mount → offHand → head → body`。木盾只挡正面 bullet；laser/explosion
  同时伤害木盾和本体；头部破碎默认溢出，`immuneOverkill` 可丢弃超杀。
  武器耐久：axe 450、pickaxe 20、bow 300，每次命中/射击 -1。
  怪物 `baseAttackDamage` 是空手近战伤害，主手 `weaponDamage` 在可用时叠加；
  武器破碎后只保留 `baseAttackDamage`。
- `BalloonTntClone` 是星之碎片召唤物，继承 `PresetMonsterModel` / `MonsterEntity`，
  不属于中型怪物，也不参与中型装备/伤害路由。
- 潜水僵尸氧气面罩是 `head` 槽：100 血、`absorbRatio=0.1`，小伤害按
  10% 面罩 / 90% 本体分摊；面罩破碎后按头部溢出规则进入本体。
  面罩视觉仍由 `DivingZombieEntity` 的潜水镜/呼吸管自定义图层负责，槽位标记
  `viewless`，不会重复创建通用装备 sprite。
- `PumpkinWan` 是高级植物，必须种在阴森南瓜头上（`requiredBasePid=9`）；
  普通激光覆盖以自身为中心的 3x3，9 级扩大到 5x5
  （前后各 2.5 格、上下各 2 行）；星碎爆炸范围不随等级扩大，
  植物死亡后仍会完成已排队的 5 次爆炸。
- 高级植物替换基座后，无论基座睡醒都会继承其睡眠状态
  （`PlantCmd.SetSleeping`）：南瓜头·晚上继承阴森南瓜头，反坦克分发器继承发射器。
  替换只作用于 `requiredBasePid` 指定的基座，同格睡莲/护盾保持原状态；
  测试用 `spawnPlantWithBaseRule()` 走与 `PlantsManager.PlantCard` 相同的
  `PlantHelper.CreateEntityWithBaseReplacement`。
- `ElasticPutin` 的反弹判定在 Model：只反弹己方、可反弹且自身清醒时的
  子弹；闪电窗口内会为带附魔接口的箭追加 `lightning`。
- 星之碎片的目标规则集中在 `src/game/utils/helper/PlantTargeting.ts`：
  承载物（睡莲/船）永远不是默认目标，护盾植物靠 `aspect='down'` 选中，
  测试直接 import 该纯函数断言选择结果。
- 种植地块限制写在 `PlantModel.allowedPlantSlots`（白名单，`null` = 不限）：
  TNT 地雷配 `['ground']`，因此不能种在水面/睡莲上；气球TNT 不限制。
- 放置方式写在 `PlantModel.placementRule`：`overlayAny` 忽略同格占用（魔术粉），
  `overlayExisting` 必须种在已有存活植物上（萤石粉）。
- 一次性植物用 `isOneTimePlant` + `applyInstantEffect()`：种植同帧结算，
  不创建 Entity / 物理体；测试用 `applyInstantPlant()` 驱动，不要用 `spawnPlant()`。
- 气球TNT 的充气阶段与引爆判定在 Model：`inflateStage` 0/1/2，升空后只被
  `flying` 怪物**碰撞**引爆，充满瞬间只做一次补判（不轮询）；星碎分身是
  mid 21 的 PLANT 阵营召唤物（waveID=-10，不计击杀），接触判定同样走碰撞事件。
- TNT 地雷同样是碰撞为主：出土瞬间做一次补判（`checkContactOnce`），
  飞行单位从上方经过不再进入 pending 队列。
- 手杖僵尸改为判定线起跳：从身体中心沿移动方向 0.7 格内检测植物，
  命中后固定飞 1.4 格，落地用 `PlantHelper.GetPlantsInGrid` 补判脚下植物。
- 护盾植物（`SHIELD_PLANT_PIDS`）会替同格植物吸收伤害：
  `PlantEntity.takeDamage → PlantModel.redirectDamageToShield`，测试替身已同步这条路由。
- 气球僵尸（mid 19）与气球帽子僵尸（mid 20）的飞行载具只有 1 点血：
  `bullet` 命中时载具吸收全部伤害（本体不掉血），`laser` / `explosion`
  命中时载具爆炸且本体照常结算；载具破碎后 `flying = false`。
  体态判定统一走 `BodyTraits.canReachBody()`，飞行中的气球僵尸只有带
  `flying` 的投射物/判定线能命中。
- `BouncingAnvil` 的警戒线为种植中心左右各 1.4 格，只响应地面、非飞行、
  非虚空敌人；起跳时锁定目标中心，300ms 后落地生成隐形激光。
  Lv1–Lv4 激光长 0.8 格，Lv5 起为 1.5 格并显示左侧分身；
  按倭瓜原型，落地后铁砧碎裂。星之碎片召唤 1–2 道分身攻击全场血量最高的
  两个敌人，每个目标受到 2 次伤害；星碎伤害区域固定为中心 0.8 格、
  不随等级变化；分身悬空 300ms 后落地，无敌人时一道分身原地起跳后返回，
  且不消耗本体。
