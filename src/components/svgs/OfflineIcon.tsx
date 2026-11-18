// 离线图标：地球 + 叉号，表示当前在离线模式下游玩（没有连上服务器）。
import type { CSSProperties } from 'react';
import NetIconPrimitives from './NetIconPrimitives';
import { NET_ICON_NEUTRAL, NET_ICON_VIEWBOX, offlineIconPrimitives } from './netIcons';

export interface OfflineIconProps {
  size?: number;
  /** 地球线条颜色 */
  globeColor?: string;
  /** 叉号颜色 */
  crossColor?: string;
  title?: string;
  className?: string;
  style?: CSSProperties;
}

export default function OfflineIcon({
  size = 24,
  globeColor = NET_ICON_NEUTRAL,
  crossColor = '#d5dbe5',
  title,
  className,
  style,
}: OfflineIconProps) {
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
      <NetIconPrimitives primitives={offlineIconPrimitives({ globeColor, crossColor })} />
    </svg>
  );
}