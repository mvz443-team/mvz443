/**
 * edx（图鉴）模块入口。
 *
 * 目录结构：
 * - `CodexFrame`：图鉴分类主视觉（器械 / 地图 / 僵尸）。
 * - `plant/`：器械图鉴页（复用旧 pokedex，右栏顶部插入 Phaser 预览）。
 * - `zombie/`：僵尸图鉴页（列表 + 数值 + Phaser 行动预览）。
 * - `stage/`：地图图鉴页（读关卡配置画地形）。
 * - `data/`：图鉴数据源（僵尸文案、关卡配置读取）。
 * - `preview/`：独立的 Phaser 预览场景与 React 宿主。
 */
export { default as CodexFrame } from './CodexFrame';
export { default as PlantCodexPage } from './plant/PlantCodexPage';
export { default as ZombieCodexPage } from './zombie/ZombieCodexPage';
export { default as StageCodexPage } from './stage/StageCodexPage';
export { default as EdxPreviewHost } from './preview/EdxPreviewHost';
