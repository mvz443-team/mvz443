# DepthHelper 使用报告

`DepthHelper` 是游戏内所有 Phaser `depth` 计算的统一入口。业务代码不要再直接引用旧的 `src/utils/depth.ts`，也不要在调用点写 `baseDepth + 1`、`depth - 2`、`UI_CHROME_DEPTH + 2` 这类裸偏移。

统一使用：

```ts
import DepthHelper from "../utils/helper/DepthHelper";
```

路径按当前文件位置调整，但必须导入 `DepthHelper/index.ts` 暴露的入口，不直接导入 `Plant.ts`、`Mob.ts` 等子文件。

## 总体分层

Depth 的核心规则是：

- 战场对象按行分层，每行间隔 `10000`。
- 植物和障碍物使用行基础层 `+500`。
- 怪物使用行基础层 `+1000`，并支持 `offsetY` 微调同一行内的遮挡关系。
- 发射物使用更高的类型偏移：`bullet +100000`、`projectile +300000`、`laser +500000`。
- 局内 UI 从 `1900000` 开始。
- 菜单层为 `2000000`。
- 暂停菜单层为 `5000000`。

`Game` 场景使用 `DepthHelper.UI.threshold()` 作为 UI camera 的分层阈值。当前值为 `1900000`，低于该值的对象属于 battle 层，高于或等于该值的对象属于 UI 层。

## Core

文件：`Core.ts`

`Core` 只保存最基础的数学规则，通常不应被业务代码直接使用，除非是在新增新的 depth 分类。

| 方法 | 用途 |
|---|---|
| `lineBase(line)` | 获取行基础 depth，公式为 `(line + 1) * 10000` |
| `projectileTypeOffset(type)` | 获取发射物类型偏移 |
| `yOffsetAdjustment(offsetY)` | 将 y 偏移转为 depth 微调，公式为 `floor(offsetY * 15)` |
| `component(base, componentOffset, offsetY)` | 在 base 上叠加组件偏移和 y 偏移 |
| `sprite(line, componentOffset, offsetY)` | 从行号直接计算通用 sprite depth |

## Plant

文件：`Plant.ts`

植物和障碍物共用植物侧的基础层。基础值为：

```ts
DepthHelper.Plant.base(row)
```

即 `lineBase(row) + 500`。

| 方法 | 用途 | 相对 base |
|---|---|---:|
| `base(row)` | 植物/障碍物基础 depth | 行基础 `+500` |
| `body(baseDepth)` | 普通植物主体 | `+0` |
| `lilyBody(baseDepth)` | Lily 主体，低于普通植物 | `-2` |
| `dispenserBase(baseDepth)` | dispenser 类植物底座 | `-1` |
| `badge(baseDepth)` | 等级徽章 | `+1` |
| `sfx(baseDepth)` | 植物挂载类小特效 | `+1` |
| `shootBurst(baseDepth)` | 开火爆发动画 | `+2` |
| `part(baseDepth, part)` | 按 `PlantPart` 名称取局部层级 | 由 part 决定 |

使用示例：

```ts
const baseDepth = DepthHelper.Plant.base(row);
head.setDepth(DepthHelper.Plant.body(baseDepth));
badge.setDepth(DepthHelper.Plant.badge(baseDepth));
```

## Mob

文件：`Mob.ts`

怪物基础值为：

```ts
DepthHelper.Mob.base(row, offsetY)
```

即 `lineBase(row) + floor(offsetY * 15) + 1000`。怪物同一行内的视觉前后关系主要通过 `offsetY` 调整。

### 旧分件怪物

旧的 `zombie`、`golem`、`mutant` sprite 使用 `legacyPart(baseDepth, part)`。

| part | 相对 base | 用途 |
|---|---:|---|
| `backUpperArm` | `-1` | 突变体后侧上臂 |
| `backLowerArm` | `0` | 突变体后侧下臂 |
| `rightLeg` | `+1` | 右腿/后腿 |
| `leftLeg` | `+2` | 左腿/前腿 |
| `rightArm` | `+6` | 右臂 |
| `body` | `+7` | 身体 |
| `head` | `+8` | 头部 |
| `leftArm` | `+9` | 左臂 |
| `hand` | `+10` | 手持物 |
| `frontLowerArm` | `+11` | 突变体前侧下臂 |

### 怪物附件和特效

| 方法 | 用途 |
|---|---|
| `bodyText(bodyDepth)` | 伤害文本或符号，位于 body 上方 |
| `boatBack(baseDepth)` | 船后层 |
| `boatFront(baseDepth)` | 船前层 |
| `deathSmoke(baseDepth)` | 死亡烟雾 |
| `attachment(baseDepth, part)` | 标准附件，如护甲、盾、壳、傀儡特效 |
| `customAttachment(baseDepth, localDepth)` | 保留自定义局部层级的附件 |
| `starOrbitInitial(baseDepth)` | 星星碎片环绕初始层 |
| `starOrbitFrame(baseDepth, depthRatio)` | 星星碎片环绕动态层 |
| `centipedePart(baseDepth, part)` | 新版蜈蚣动画分件 |
| `deprecatedCentipedeJoint(localDepth)` | 旧版蜈蚣关节局部层 |
| `deprecatedCentipedeChild(baseDepth, localDepth)` | 旧版蜈蚣子对象最终层 |
| `sceneFlash()` | 蜈蚣技能全场闪白 |

使用示例：

```ts
this.baseDepth = DepthHelper.Mob.base(row, this.offsetY);
this.head.setDepth(DepthHelper.Mob.legacyPart(this.baseDepth, "head"));
shield.setDepth(DepthHelper.Mob.attachment(this.baseDepth, "shield"));
```

## Projectile

文件：`Projectile.ts`

发射物层级整体高于植物和怪物。

| 方法 | 用途 |
|---|---|
| `base(type, line, offsetY, componentOffset)` | 通用发射物 depth |
| `bullet(line, offsetY)` | bullet 类型 |
| `bulletColumn(col)` | 当前 BulletEntity/Minecart 使用列号计算的兼容接口 |
| `projectile(line, offsetY)` | projectile 类型 |
| `laser(line, offsetY)` | laser 类型 |
| `sprite(baseDepth)` | 发射物主体 |
| `trail(baseDepth)` | 发射物尾迹 |
| `arc()` | 抛物线 SFX 的默认层 |
| `centipedeSkill()` | 蜈蚣技能 projectile 层 |

使用示例：

```ts
this.baseDepth = DepthHelper.Projectile.bulletColumn(col);
trail.setDepth(DepthHelper.Projectile.trail(this.baseDepth));
laser.setDepth(DepthHelper.Projectile.laser(row));
```

## Sfx

文件：`Sfx.ts`

SFX 分类用于非实体主体的视觉效果。

| 方法 | 用途 |
|---|---|
| `passthrough(depth)` | 接受调用方明确传入的 depth |
| `explosion()` | 大范围爆炸动画层，当前为 `DepthHelper.UI.inGame(-100)` |
| `dirtOut(row)` | 出土动画层，等于植物基础层 |
| `starBurstParticle(baseDepth)` | 星星碎片爆发粒子 |
| `starBurstGlow(baseDepth)` | 星星碎片爆发光圈 |

使用示例：

```ts
anime.setDepth(DepthHelper.Sfx.explosion());
glow.setDepth(DepthHelper.Sfx.starBurstGlow(baseDepth));
```

## UI

文件：`UI.ts`

局内 UI 使用 `1900000 + order * 1000`。能用语义方法时优先使用语义方法，不要在调用点传裸 order。

| 方法 | depth | 用途 |
|---|---:|---|
| `threshold()` | `1900000` | UI camera 分层阈值 |
| `plantingPreview()` | `1895000` | 种植预览，仍属于 battle 层 |
| `debugWorld()` | `1890000` | debug 物理线，仍属于 battle 层 |
| `cursorTool()` | `1950000` | 鼠标 pickaxe/starshards sprite |
| `waitingText()` | `1960000` | 等待文本 |
| `debugFrameText()` | `1961000` | frame debug 文本 |
| `chrome()` | `1980000` | UI chrome 基础层 |
| `chromeLane()` | `1980001` | mobile card lane 辅助线 |
| `chromeContainer()` | `1980001` | bottom bar 容器 |
| `chromeControl()` | `1980002` | card、energy、tool 控件 |
| `menu()` | `2000000` | 菜单层 |
| `bossSkillAnnounce()` | `1999999` | boss 技能提示 |
| `broadcast()` | `2000000` | 大波提示 |
| `pauseMenu()` | `5000000` | 暂停菜单 |
| `menuLayerBehind(amount)` | `2000000 - amount` | 菜单下方的特殊 UI |
| `inGame(order)` | `1900000 + order * 1000` | 兜底接口 |
| `unimportant(order)` | `1000 + order` | 极低优先级局内元素 |

使用示例：

```ts
this.uiDepthThreshold = DepthHelper.UI.threshold();
cursor.setDepth(DepthHelper.UI.cursorTool());
menu.setDepth(DepthHelper.UI.pauseMenu());
```

## Scene

文件：`Scene.ts`

场景级 depth 用于背景、预设事件遮罩、GameOver 等不属于具体战斗实体的对象。

| 方法 | depth | 用途 |
|---|---:|---|
| `background()` | `2` | Game 背景 |
| `presetOverlay()` | `2` | 预设事件遮罩 |
| `presetImage()` | `3` | 预设事件图片 |
| `gameOverText()` | `100` | GameOver 文本 |

## 新增 Depth 的规则

1. 新 depth 必须先判断所属范围：`Plant`、`Mob`、`Projectile`、`Sfx`、`UI`、`Scene`。
2. 如果是已有实体的局部层级，优先扩展对应的 part 类型和 offset map。
3. 如果是一次性但有语义的层级，新增具名方法，例如 `someSkillFlash()`。
4. 调用点不要直接写 `+ 1`、`- 2` 或硬编码数值。
5. 外部代码只从 `DepthHelper/index.ts` 导入。

## 常见选择

- 植物主体：`DepthHelper.Plant.body(baseDepth)`
- 植物开火动画：`DepthHelper.Plant.shootBurst(baseDepth)`
- 植物徽章：`DepthHelper.Plant.badge(baseDepth)`
- 怪物基础层：`DepthHelper.Mob.base(row, offsetY)`
- 旧怪物身体分件：`DepthHelper.Mob.legacyPart(baseDepth, "body")`
- 怪物护盾/壳：`DepthHelper.Mob.attachment(baseDepth, "shield" | "shell")`
- 子弹主体：`DepthHelper.Projectile.sprite(baseDepth)`
- 子弹尾迹：`DepthHelper.Projectile.trail(baseDepth)`
- 爆炸动画：`DepthHelper.Sfx.explosion()`
- 局内 UI 控件：`DepthHelper.UI.chromeControl()`
- 暂停菜单：`DepthHelper.UI.pauseMenu()`
