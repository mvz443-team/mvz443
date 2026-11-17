# Preset 模拟测试

覆盖 `src/game/presets/plant` 与 `src/game/presets/monster` 下全部 preset：

- plant：17 个文件，逐级覆盖 Lv1–Lv9 的普通效果与星之碎片效果。
- mob：18 个文件，覆盖基础数值、攻击节奏、装备、技能与 Boss 阶段。

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

## 已确认的实现/描述差异

测试按当前真实行为断言，并在对应文件中注明原因：

- `EntityTickManager.repeat` 表示总触发次数，部分星碎数量比描述少 1：
  Dispenser 49 发、TripleDispenser 236 发、PumpkinWan 4 次爆炸、
  DoubleDispenser 34 发（Lv1–6）。
- `DoubleDispenser` 星碎在 Lv7+ 会因 `shootFrontArrow` 的等级加成把前方箭
  从 34 发提升到 68 发。
- `IceBomb` Lv1 实际伤害为 15；源码注释写的“1–4 级 30”与实现不一致。
- `startAt` 是提前量，不是首次延迟：ATDispenser 1050ms 触发、1250ms 发射；
  PumpkinWan 星碎首次爆炸在 200ms；Evoker 首次召唤在 4000ms。
- `Generator` 通过 `ResourceManager.UpdateEnergy` 产能；睡眠产能代码在 5 级
  就切到 6，而注释写的是 3–6 级 4、7+ 级 6。
