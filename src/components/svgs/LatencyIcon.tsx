// 延迟 wifi 图标：从左下角向右上张开的三段波浪。
// 一档（>200ms）只点亮最内侧波浪（红），二档（>120ms）点亮两段（黄），三档（<=120ms）三段全亮（绿）。
import type { CSSProperties } from 'react';
import NetIconPrimitives from './NetIconPrimitives';
import {
  NET_ICON_VIEWBOX,
  latencyIconPrimitives,
  resolveLatencyLevel,
  type LatencyLevel,
} from './netIcons';

export interface LatencyIconProps {
  /** 直接给定延迟值（ms），内部按 120 / 200 阈值换算档位 */
  latencyMs?: number | null;
  /** 也可以直接指定档位，优先级高于 latencyMs */
  level?: LatencyLevel;
  size?: number;
  /** 覆盖点亮波浪的颜色 */
  color?: string;
  /** 覆盖未点亮波浪的颜色 */
  mutedColor?: string;
  title?: string;
  className?: string;
  style?: CSSProperties;
}

export default function LatencyIcon({
  latencyMs,
  level,
  size = 24,
  color,
  mutedColor,
  title,
  className,
  style,
}: LatencyIconProps) {
  const resolved = level ?? resolveLatencyLevel(latencyMs);
  return (
    <svg
      viewBox={`0 0 ${NET_ICON_VIEWBOX} ${NET_ICON_VIEWBOX}`}
      width={size}
      height={size}
      className={className}
      style={style}
      role="img"
      aria-label={title}
      data-latency-level={resolved}
    >
      <NetIconPrimitives primitives={latencyIconPrimitives(resolved, { color, mutedColor })} />
    </svg>
  );
}