// 网络状态图标的唯一几何来源（纯数据，无框架依赖）。
// - React 侧：components/svgs/*Icon.tsx 把 primitives 渲染成 <svg>
// - Phaser 侧：game/ui/NetStatusBadge.ts 把同一份 primitives 画到 Graphics
// 只描述"画什么"，不承载任何网络/联机状态，颜色通过参数注入。

export const NET_ICON_VIEWBOX = 24;

/** 延迟档位：>200ms 红、>120ms 黄、<=120ms 绿；unknown 表示还没测到值 */
export type LatencyLevel = 'good' | 'warn' | 'bad' | 'unknown';

export type NetIconPrimitive =
  | { type: 'circle'; cx: number; cy: number; r: number; color: string; alpha?: number }
  | { type: 'ellipse'; cx: number; cy: number; rx: number; ry: number; width: number; color: string; alpha?: number }
  | { type: 'line'; x1: number; y1: number; x2: number; y2: number; width: number; color: string; alpha?: number }
  | { type: 'arc'; cx: number; cy: number; r: number; start: number; end: number; width: number; color: string; alpha?: number };

/** 三档延迟的颜色 */
export const LATENCY_LEVEL_COLORS: Record<Exclude<LatencyLevel, 'unknown'>, string> = {
  good: '#3ddc84',
  warn: '#f5c542',
  bad: '#ff5c5c',
};

/** 未点亮波浪 / 中性灰（掉线、离线图标） */
export const NET_ICON_MUTED = '#5d6672';
export const NET_ICON_NEUTRAL = '#9aa4b2';
export const NET_ICON_CONFLICT = '#ff5c5c';
export const NET_ICON_UP = '#60a5fa';
export const NET_ICON_DOWN = '#3ddc84';

/** 延迟 -> 档位，阈值与需求一致 */
export function resolveLatencyLevel(latencyMs: number | null | undefined): LatencyLevel {
  if (latencyMs === null || latencyMs === undefined || !Number.isFinite(latencyMs)) {
    return 'unknown';
  }
  if (latencyMs > 200) return 'bad';
  if (latencyMs > 120) return 'warn';
  return 'good';
}

/** wifi 波纹圆心放在左下角，波纹朝右上方张开 */
const WIFI_ORIGIN = { x: 4.2, y: 19.8 };
const WIFI_RADII = [5.4, 9.9, 14.4] as const;
const WIFI_START = -Math.PI / 2;
const WIFI_END = 0;

function wifiArcs(color: string, width = 2.1, alpha = 1): NetIconPrimitive[] {
  return WIFI_RADII.map((r) => ({
    type: 'arc' as const,
    cx: WIFI_ORIGIN.x,
    cy: WIFI_ORIGIN.y,
    r,
    start: WIFI_START,
    end: WIFI_END,
    width,
    color,
    alpha,
  }));
}

function wifiDot(color: string, alpha = 1, r = 1.5): NetIconPrimitive {
  return { type: 'circle', cx: WIFI_ORIGIN.x, cy: WIFI_ORIGIN.y, r, color, alpha };
}

export interface LatencyIconOptions {
  /** 覆盖已点亮波浪的颜色（默认按档位取色） */
  color?: string;
  /** 未点亮波浪的颜色 */
  mutedColor?: string;
}

/**
 * 延迟图标：一档只点亮最内侧波浪，三档三波全亮。
 * 三档分别是红（>200ms）/ 黄（>120ms）/ 绿（<=120ms）。
 */
export function latencyIconPrimitives(level: LatencyLevel, options: LatencyIconOptions = {}): NetIconPrimitive[] {
  const litCount = level === 'good' ? 3 : level === 'warn' ? 2 : level === 'bad' ? 1 : 0;
  const litColor = options.color ?? (level === 'unknown' ? NET_ICON_NEUTRAL : LATENCY_LEVEL_COLORS[level]);
  const mutedColor = options.mutedColor ?? NET_ICON_MUTED;
  const primitives: NetIconPrimitive[] = [wifiDot(litCount > 0 ? litColor : mutedColor, litCount > 0 ? 1 : 0.75)];
  wifiArcs(mutedColor, 2.1, 0.9).forEach((arc, index) => {
    if (index < litCount) {
      primitives.push({ ...arc, color: litColor, alpha: 1 });
    } else {
      primitives.push(arc);
    }
  });
  return primitives;
}

export interface DisconnectedIconOptions {
  /** 波纹与叉的灰度，整体保持灰色 */
  color?: string;
}

/** 掉线/重连图标：灰色 wifi 加一个叉 */
export function disconnectedIconPrimitives(options: DisconnectedIconOptions = {}): NetIconPrimitive[] {
  const color = options.color ?? NET_ICON_NEUTRAL;
  return [
    wifiDot(color, 0.9),
    ...wifiArcs(color, 2.1, 0.5).slice(0, 2),
    { type: 'line', x1: 12.6, y1: 2.6, x2: 20.4, y2: 10.4, width: 2.6, color },
    { type: 'line', x1: 20.4, y1: 2.6, x2: 12.6, y2: 10.4, width: 2.6, color },
  ];
}

export interface DesyncIconOptions {
  branchColor?: string;
  conflictColor?: string;
}

/** 不同步：git 分支拓扑 + 冲突叉号 */
export function desyncIconPrimitives(options: DesyncIconOptions = {}): NetIconPrimitive[] {
  const branch = options.branchColor ?? NET_ICON_NEUTRAL;
  const conflict = options.conflictColor ?? NET_ICON_CONFLICT;
  return [
    // 主干
    { type: 'line', x1: 5.6, y1: 7.4, x2: 5.6, y2: 15.2, width: 2, color: branch },
    // 分叉：从主干斜向上分出另一条支线
    { type: 'line', x1: 5.6, y1: 10.4, x2: 9.6, y2: 8, width: 2, color: branch },
    { type: 'line', x1: 9.6, y1: 8, x2: 14, y2: 6.6, width: 2, color: branch },
    // 提交点：主干两端 + 分支末端
    { type: 'circle', cx: 5.6, cy: 5.2, r: 2.2, color: branch },
    { type: 'circle', cx: 5.6, cy: 17.4, r: 2.2, color: branch },
    { type: 'circle', cx: 16.2, cy: 6, r: 2.2, color: branch },
    // 分支汇合处的冲突叉号
    { type: 'line', x1: 13.6, y1: 15.4, x2: 19.8, y2: 21.6, width: 2.4, color: conflict },
    { type: 'line', x1: 19.8, y1: 15.4, x2: 13.6, y2: 21.6, width: 2.4, color: conflict },
  ];
}

export interface OfflineIconOptions {
  globeColor?: string;
  crossColor?: string;
}

/** 离线：地球加一个叉 */
export function offlineIconPrimitives(options: OfflineIconOptions = {}): NetIconPrimitive[] {
  const globe = options.globeColor ?? NET_ICON_NEUTRAL;
  const cross = options.crossColor ?? '#d5dbe5';
  return [
    { type: 'ellipse', cx: 10.6, cy: 11.6, rx: 8, ry: 8, width: 2, color: globe },
    { type: 'ellipse', cx: 10.6, cy: 11.6, rx: 3.7, ry: 8, width: 1.8, color: globe, alpha: 0.85 },
    { type: 'line', x1: 2.6, y1: 11.6, x2: 18.6, y2: 11.6, width: 1.8, color: globe, alpha: 0.85 },
    { type: 'line', x1: 13.4, y1: 13.6, x2: 20.4, y2: 20.6, width: 2.9, color: cross },
    { type: 'line', x1: 20.4, y1: 13.6, x2: 13.4, y2: 20.6, width: 2.9, color: cross },
  ];
}

export type ArrowDirection = 'up' | 'down';

export interface ArrowIconOptions {
  color?: string;
}

/** 上行/下行箭头（延迟明细用） */
export function arrowIconPrimitives(direction: ArrowDirection, options: ArrowIconOptions = {}): NetIconPrimitive[] {
  const color = options.color ?? NET_ICON_UP;
  const mirror = direction === 'down';
  // 箭头默认朝上，下行时沿水平中线镜像
  const toY = (y: number) => (mirror ? NET_ICON_VIEWBOX - y : y);
  return [
    { type: 'line', x1: 12, y1: toY(19.4), x2: 12, y2: toY(5.2), width: 2.2, color },
    { type: 'line', x1: 6.6, y1: toY(10.4), x2: 12, y2: toY(4.6), width: 2.2, color },
    { type: 'line', x1: 17.4, y1: toY(10.4), x2: 12, y2: toY(4.6), width: 2.2, color },
  ];
}