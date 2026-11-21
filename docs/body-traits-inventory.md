# 体态现状清单（tiny / flying / void）

> 规则与判定入口见 [body-traits.md](./body-traits.md)。
> 本文档按 preset 逐个列出**自身体态**与**衍生投射物/召唤物体态**。
> `✓` = true，`—` = false（不占据 / 不能到达该层）。
> 本清单反映提交时的代码状态，新增或修改 preset 时请同步更新。

## 1. 投射物目录（先看这张表，再看各个 preset 的衍生条目）

| 投射物 Model | hitKind | tiny | flying | void | 说明 |
| --- | --- | --- | --- | --- | --- |
| `ArrowModel` / `MutantYAxisArrowModel` | bullet | — | 由配置 | — | 箭矢，默认只能打普通地面目标 |
| `SnowBallModel` | bullet | 由配置 | — | — | 雪球，短距离；小发射器发射时 `tiny: true` 以命中潜水僵尸 |
| `BombSnowBallModel` / `FireBallModel` | bullet | — | — | — | 雪球命中/销毁后产生 `ExplosionModel` |
| `HFireWorkModel` / `ATAirHFireWorkModel` | bullet | — | — | — | 火箭本体是子弹，销毁时产生爆炸 |
| `MineCartModel` | bullet | ✓ | — | — | 矿车，`tiny: true`，超杀伤害 |
| `ExplosionModel` | explosion | ✓ | ✓ | — | 爆炸覆盖低矮与空中层 |
| `LaserModel` | laser | ✓ | 由配置 | — | 激光默认覆盖低矮层，对空需显式 `flying: true` |

## 2. 植物

植物只需要 `tiny`（低矮）；植物不会飞行，也不会进入虚空。

| pid | preset | tiny | flying | void | 备注 |
| --- | --- | --- | --- | --- | --- |
| 1 | `dispenser` 发射器 | — | — | — | |
| 2 | `furnace` 熔炉 | — | — | — | 不攻击，只产红石 |
| 3 | `obsidian` 黑曜石 | — | — | — | 不攻击，只有护甲 |
| 4 | `tnt_mines` TNT 地雷 | ✓ | — | — | 低矮 |
| 5 | `small_dispenser` 小发射器 | ✓ | — | — | 低矮 |
| 6 | `lily` 睡莲 | ✓ | — | — | 低矮 |
| 7 | `tnt` 瞬炸 TNT | — | — | — | |
| 8 | `generator` 生物质发电机 | — | — | — | 不攻击 |
| 9 | `pumkin` 阴森南瓜头 | — | — | — | |
| 10 | `magic_powder` 魔术粉 | — | — | — | 一次性 |
| 11 | `pumkin_wan` 广域南瓜派 | — | — | — | |
| 12 | `ice_bomb` 寒冰炸弹 | — | — | — | 一次性 |
| 13 | `triple_dispenser` 三线发射器 | — | — | — | |
| 14 | `at_dispenser` 反坦克炮台 | — | — | — | |
| 15 | `elastic_putin` 弹性布丁 | — | — | — | 只反弹，不产生伤害物 |
| 16 | `double_dispenser` 双向发射器 | — | — | — | |
| 17 | `glow_powder` 萤石粉 | — | — | — | 不攻击 |
| 18 | `bouncing_anvil` 蹦蹦铁砧 | — | — | — | |
| 19 | `pumpkin_passport` 南瓜护照 | ✓ | — | — | 低矮护盾植物，替同格植物挡伤害 |
| 20 | `balloon_tnt` 气球TNT | 充气中 ✓ / 充满 — | — | — | 充满后升空，只被飞行怪物引爆 |

### 2.1 植物衍生的射击物 / 召唤物

- **1 `dispenser`**
  - `ArrowModel`（普通射击 50 发起步；星碎暴力射击）— tiny — / flying — / void —
- **2 `furnace`**：无衍生。
- **3 `obsidian`**：无衍生。
- **4 `tnt_mines`**
  - `ExplosionModel`（自身爆炸）— tiny ✓ / flying ✓ / void —
  - 星碎召唤 2 个同款 `TntMinesModel` 分身 — tiny ✓ / flying — / void —
- **5 `small_dispenser`**
  - `SnowBallModel` — tiny ✓（创建参数显式传入，用于打潜行潜水僵尸）/ flying — / void —
  - 星碎 `FireBallModel`（bullet）— tiny — / flying — / void —
    - 其销毁爆炸 `ExplosionModel` — tiny ✓ / flying ✓ / void —
- **6 `lily`**
  - 星碎生成 `LilyModel`（3x3 水域）— tiny ✓ / flying — / void —
- **7 `tnt`**
  - `ExplosionModel`（首次爆炸）— tiny ✓ / flying ✓ / void —
  - Lv7+ 延迟二次爆炸 `ExplosionModel` — tiny ✓ / flying ✓ / void —
- **8 `generator`**：无衍生（只产能量、唤醒周围植物）。
- **9 `pumkin`**
  - `LaserModel`（隐形激光，4.6 格）— tiny ✓ / flying — / void —
  - 星碎三行 `LaserModel`（12 格）— tiny ✓ / flying — / void —
- **10 `magic_powder`**
  - `LaserModel`（1.2 格，`flying: true`）— tiny ✓ / flying ✓ / void —
- **11 `pumkin_wan`**
  - `LaserModel`（3x3→5x5 多行）— tiny ✓ / flying = Lv5+ / void —
  - 星碎持续爆炸 `ExplosionModel` — tiny ✓ / flying ✓ / void —
- **12 `ice_bomb`**
  - 冻结 `LaserModel`（全行，8000ms，`flying: true`）— tiny ✓ / flying ✓ / void —
  - 减速 `LaserModel`（全行，5000ms，`flying: true`）— tiny ✓ / flying ✓ / void —
- **13 `triple_dispenser`**
  - `ArrowModel` ×3 行 — tiny — / flying — / void —
  - 星碎 `MutantYAxisArrowModel` ×240（三行扇形）— tiny — / flying — / void —
- **14 `at_dispenser`**
  - `HFireWorkModel`（bullet）— tiny — / flying — / void —
    - 销毁爆炸 `ExplosionModel` — tiny ✓ / flying ✓ / void —
  - 星碎 `ATAirHFireWorkModel`（bullet）— tiny — / flying — / void —
    - 销毁时 5 处 `ExplosionModel` — tiny ✓ / flying ✓ / void —
- **15 `elastic_putin`**：无伤害衍生（只把己方子弹 `reverseVelocityX()`）。
- **16 `double_dispenser`**
  - 前/后 `ArrowModel` — tiny — / flying — / void —
  - 后方 `HFireWorkModel`（bullet）— tiny — / flying — / void —
    - 销毁爆炸 `ExplosionModel` — tiny ✓ / flying ✓ / void —
- **17 `glow_powder`**：无衍生（只唤醒睡眠植物）。
- **18 `bouncing_anvil`**
  - 落地 `LaserModel`（0.8→1.5 格）— tiny ✓ / flying — / void —
  - 星碎分身 `LaserModel`（`flying: true`）— tiny ✓ / flying ✓ / void —
- **20 `balloon_tnt` 气球TNT**
  - 星碎分身 `BalloonTntCloneData`（mid 21，PLANT 阵营飞行单位，200 血）— tiny — / flying ✓ / void —
  - 本体升空后 `tiny = false`（非低矮），但 `flying` 仍为 false：地面僵尸可以啃掉它
- **19 `pumpkin_passport` 南瓜护照**
  - 无衍生投射物；尖刺反伤是直接调用伤害源的 `takeDamage`（不算投射物）
  - 自身 `tiny = true`，地面子弹打不到；护盾路由见 `docs/star-shards-and-shield-plants.md`

## 3. 怪物

绝大多数怪物不占据低矮层；潜水僵尸（mid 27）在潜行时 `tiny = true`，攻击时抬起为 false。
`void` 目前没有 preset 使用，只有数据模型保留了 `isDefaultInVoid` 开关。

| mid | preset | tiny | flying | void | 备注 |
| --- | --- | --- | --- | --- | --- |
| 1 | `zombie` 僵尸 | — | — | — | |
| 2 | `cap_zombie` 帽子僵尸 | — | — | — | 护甲由 helmet mixin 管 |
| 3 | `helmet_zombie` 钢盔僵尸 | — | — | — | |
| 4 | `miner_zombie` 矿工僵尸 | — | — | — | 镐子 weapon |
| 5 | `miner_helmet_zombie` 矿工钢盔僵尸 | — | — | — | helmet + weapon |
| 6 | `skeleton` 骷髅 | — | — | — | |
| 7 | `skeleton_bow` 骷髅弓手 | — | — | — | |
| 8 | `stick_zombie` 手杖僵尸 | — | **动态** | — | 撑杆跳期间 `flying = true`，落地恢复 |
| 9 | `evoker` 唤魔者 | — | — | — | |
| 10 | `vindicator` 卫道士 | — | — | — | |
| 11 | `vindicator_solider` 盾卫道士 | — | — | — | shield + weapon |
| 12 | `obsidian_golem` 黑曜石傀儡（Boss） | — | — | — | |
| 13 | `warden` 监守者（Boss） | — | — | — | |
| 14 | `turtle_zombie` 龟甲僵尸 | — | — | — | helmet |
| 15 | `mutant` 突变体（Boss） | — | — | — | |
| 16 | `turtle_skeleton_bow` 龟壳骷髅弓手 | — | — | — | shield + weapon |
| 17 | `centipede` 蜈蚣（Boss） | — | — | — | |
| 18 | `centipede_minion` 蜈蚣幼虫 | — | — | — | |
| 19 | `balloon_zombie` 气球僵尸 | — | **载具在架时 ✓** | — | 气球爆掉后 `flying = false` |
| 20 | `balloon_cap_zombie` 气球帽子僵尸 | — | **载具在架时 ✓** | — | 载具 + 帽子僵尸 |
| 21 | `balloon_tnt_clone` 气球TNT分身（召唤物） | — | ✓ | — | PLANT 阵营，不进波次/不计击杀 |
| 22–26 | `boat_*_zombie` 木船僵尸系列 | — | — | — | 水生通行域，始终挂木船表现 |
| 27 | `diving_zombie` 潜水僵尸 | **动态** | — | — | 潜行 tiny=true / 攻击 tiny=false；需 tiny 投射物命中 |
| 28 | `dolphin_rider_zombie` 海豚骑乘僵尸 | — | — | — | 坐骑 20 血，坐姿腿固定 20°；水生通行域 |

### 3.1 怪物衍生的射击物 / 召唤物

- **1 `zombie` / 2 `cap_zombie` / 3 `helmet_zombie` / 4 `miner_zombie` / 5 `miner_helmet_zombie` /
  6 `skeleton` / 10 `vindicator` / 11 `vindicator_solider` / 14 `turtle_zombie` / 15 `mutant`
  ：只有近战，无衍生投射物。
- **7 `skeleton_bow`**
  - `ArrowModel`（320 速，70 伤害）— tiny — / flying — / void —
- **8 `stick_zombie`**：无衍生投射物（撑杆跳由 tick 事件结算）。
- **9 `evoker`**
  - 召唤 `vindicator`（mid 10，四方各 1）— tiny — / flying — / void —
- **12 `obsidian_golem`**
  - 召唤 `vindicator_solider`（mid 11，第 7 列）— tiny — / flying — / void —
  - `ObstacleCmd` 生成 `ObsidianObstacleData`（oid 1）— tiny — / flying — / void —
  - 砸击植物走 `PlantCmd.DealDamage`，不产生投射物
- **13 `warden`**
  - `LaserModel`（音波爆发，13 格，1000 伤害）— tiny ✓ / flying — / void —
  - 召唤 `miner_zombie`（mid 4）+ `miner_helmet_zombie`（mid 5）— 近战，无投射物
- **16 `turtle_skeleton_bow`**
  - `ArrowModel`（90 伤害，龟壳破碎后 5 连发）— tiny — / flying — / void —
- **17 `centipede`**
  - 召唤 `centipede_minion`（mid 18，三行）— tiny — / flying — / void —
  - `ObstacleCmd` 生成 `MineRockObstacleData`（oid 2）— tiny — / flying — / void —
  - 冲锋/爆炸伤害走 `MobCmd.DamagePlantsInCells`，不产生投射物
- **18 `centipede_minion`**：近战，无衍生。
- **19 `balloon_zombie`**（新增）
  - 飞行载具（气球）：`vehicleHealth = 1`，进快照；只在 `flying = true` 时生效
  - 无投射物；落地后按普通僵尸攻击
- **20 `balloon_cap_zombie`**（新增）
  - 飞行载具同上；容纳的僵尸是 `cap_zombie`（`attach/cap` 370 护甲）

## 4. 障碍

| oid | preset | tiny | flying | void | 备注 |
| --- | --- | --- | --- | --- | --- |
| 1 | `obsidian` 黑曜石柱 | — | — | — | 只阻挡，无衍生 |
| 2 | `mine_rock` 落石 | — | — | — | 额外占 `row + 1`；死亡掉落星碎 |

## 5. 待确认 / 已知边界

1. 气球僵尸飞行中不会被地面判定线选中，只有 `flying` 的植物（广域南瓜派 Lv5+、
   魔术粉、寒冰炸弹、蹦蹦铁砧星碎）能命中；这是 `flying` 规则的直接结果。
2. `void` 目前只有数据结构，没有 preset 使用；一旦出现虚空僵尸，只有显式
   `inVoid: true` 的投射物能命中，植物则需要 `reach: { inVoid: true }`。
3. `tiny` 对植物的含义是"低矮"，对投射物的含义是"可命中低矮"；两者共用同一个
   字段名但方向不同，实现里只通过 `canReachBody()` 组合，避免歧义。
