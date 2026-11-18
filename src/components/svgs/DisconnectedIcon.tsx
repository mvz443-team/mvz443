// 掉线图标：灰色 wifi + 叉号，表示连接中断、正在尝试重连。
import type { CSSProperties } from 'react';
import NetIconPrimitives from './NetIconPrimitives';
import { NET_ICON_VIEWBOX, NET_ICON_NEUTRAL, disconnectedIconPrimitives } from './netIcons';

export interface DisconnectedIconProps {
  size?: number;
  /** 整体灰度，默认中性灰 */
  color?: string;
  title?: string;
  className?: string;
  style?: CSSProperties;
}

export default function DisconnectedIcon({
  size = 24,
  color = NET_ICON_NEUTRAL,
  title,
  className,
  style,
}: DisconnectedIconProps) {
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
      <NetIconPrimitives primitives={disconnectedIconPrimitives({ color })} />
    </svg>
  );
}