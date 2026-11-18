// 等待权威帧：三道 wifi 波浪依次点亮，CSS 动画循环播放。
import type { CSSProperties } from 'react';
import NetIconPrimitives from './NetIconPrimitives';
import { NET_ICON_VIEWBOX, waitingIconPrimitives } from './netIcons';

export interface WaitingIconProps {
  size?: number;
  title?: string;
  className?: string;
  style?: CSSProperties;
}

export default function WaitingIcon({ size = 24, title, className, style }: WaitingIconProps) {
  return (
    <svg
      viewBox={`0 0 ${NET_ICON_VIEWBOX} ${NET_ICON_VIEWBOX}`}
      width={size}
      height={size}
      className={['waiting-wifi-icon', className].filter(Boolean).join(' ')}
      style={style}
      role="img"
      aria-label={title ?? 'waiting for authoritative frame'}
    >
      <g className="waiting-wifi-arc-0"><NetIconPrimitives primitives={[waitingIconPrimitives(0)[1]]} /></g>
      <g className="waiting-wifi-arc-1"><NetIconPrimitives primitives={[waitingIconPrimitives(1)[2]]} /></g>
      <g className="waiting-wifi-arc-2"><NetIconPrimitives primitives={[waitingIconPrimitives(2)[3]]} /></g>
      <circle cx={4.2} cy={19.8} r={1.5} fill="#f5c542" />
      <style>{`
        .waiting-wifi-arc-0,.waiting-wifi-arc-1,.waiting-wifi-arc-2 { opacity: .45; }
        @keyframes mvz-waiting-wave-0 { 0%,33% { opacity: 1; } 34%,100% { opacity: .45; } }
        @keyframes mvz-waiting-wave-1 { 0%,33% { opacity: .45; } 34%,66% { opacity: 1; } 67%,100% { opacity: .45; } }
        @keyframes mvz-waiting-wave-2 { 0%,66% { opacity: .45; } 67%,100% { opacity: 1; } }
        .waiting-wifi-arc-0 { animation: mvz-waiting-wave-0 1.2s steps(1,end) infinite; }
        .waiting-wifi-arc-1 { animation: mvz-waiting-wave-1 1.2s steps(1,end) infinite; }
        .waiting-wifi-arc-2 { animation: mvz-waiting-wave-2 1.2s steps(1,end) infinite; }
      `}</style>
    </svg>
  );
}
