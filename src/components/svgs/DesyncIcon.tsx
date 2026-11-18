// 不同步图标：git 分支拓扑 + 冲突叉号，表示联机状态发生分叉（desync）。
import type { CSSProperties } from 'react';
import NetIconPrimitives from './NetIconPrimitives';
import {
  NET_ICON_CONFLICT,
  NET_ICON_NEUTRAL,
  NET_ICON_VIEWBOX,
  desyncIconPrimitives,
} from './netIcons';

export interface DesyncIconProps {
  size?: number;
  /** 分支线条颜色 */
  branchColor?: string;
  /** 冲突叉号颜色 */
  conflictColor?: string;
  title?: string;
  className?: string;
  style?: CSSProperties;
}

export default function DesyncIcon({
  size = 24,
  branchColor = NET_ICON_NEUTRAL,
  conflictColor = NET_ICON_CONFLICT,
  title,
  className,
  style,
}: DesyncIconProps) {
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
      <NetIconPrimitives primitives={desyncIconPrimitives({ branchColor, conflictColor })} />
    </svg>
  );
}