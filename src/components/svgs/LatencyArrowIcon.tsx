// 上行/下行箭头，配合延迟明细显示（上行蓝、下行绿）。
import type { CSSProperties } from 'react';
import NetIconPrimitives from './NetIconPrimitives';
import {
  NET_ICON_DOWN,
  NET_ICON_UP,
  NET_ICON_VIEWBOX,
  arrowIconPrimitives,
  type ArrowDirection,
} from './netIcons';

export interface LatencyArrowIconProps {
  /** up = 上行，down = 下行 */
  direction: ArrowDirection;
  size?: number;
  /** 不传时：上行蓝、下行绿 */
  color?: string;
  title?: string;
  className?: string;
  style?: CSSProperties;
}

export default function LatencyArrowIcon({
  direction,
  size = 12,
  color,
  title,
  className,
  style,
}: LatencyArrowIconProps) {
  const resolvedColor = color ?? (direction === 'up' ? NET_ICON_UP : NET_ICON_DOWN);
  return (
    <svg
      viewBox={`0 0 ${NET_ICON_VIEWBOX} ${NET_ICON_VIEWBOX}`}
      width={size}
      height={size}
      className={className}
      style={style}
      role="img"
      aria-label={title}
    >
      <NetIconPrimitives primitives={arrowIconPrimitives(direction, { color: resolvedColor })} />
    </svg>
  );
}