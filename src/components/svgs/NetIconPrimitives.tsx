// 把 netIcons 里的 primitives 渲染成 SVG 子元素，供各个图标组件复用。
import type { NetIconPrimitive } from './netIcons';

function arcPath(primitive: Extract<NetIconPrimitive, { type: 'arc' }>): string {
  const { cx, cy, r, start, end } = primitive;
  const x0 = cx + Math.cos(start) * r;
  const y0 = cy + Math.sin(start) * r;
  const x1 = cx + Math.cos(end) * r;
  const y1 = cy + Math.sin(end) * r;
  const largeArc = Math.abs(end - start) > Math.PI ? 1 : 0;
  return `M ${x0} ${y0} A ${r} ${r} 0 ${largeArc} 1 ${x1} ${y1}`;
}

export default function NetIconPrimitives({ primitives }: { primitives: NetIconPrimitive[] }) {
  return (
    <>
      {primitives.map((primitive, index) => {
        switch (primitive.type) {
          case 'circle':
            return (
              <circle
                key={index}
                cx={primitive.cx}
                cy={primitive.cy}
                r={primitive.r}
                fill={primitive.color}
                opacity={primitive.alpha ?? 1}
              />
            );
          case 'ellipse':
            return (
              <ellipse
                key={index}
                cx={primitive.cx}
                cy={primitive.cy}
                rx={primitive.rx}
                ry={primitive.ry}
                fill="none"
                stroke={primitive.color}
                strokeWidth={primitive.width}
                opacity={primitive.alpha ?? 1}
              />
            );
          case 'line':
            return (
              <line
                key={index}
                x1={primitive.x1}
                y1={primitive.y1}
                x2={primitive.x2}
                y2={primitive.y2}
                stroke={primitive.color}
                strokeWidth={primitive.width}
                strokeLinecap="round"
                opacity={primitive.alpha ?? 1}
              />
            );
          case 'arc':
            return (
              <path
                key={index}
                d={arcPath(primitive)}
                fill="none"
                stroke={primitive.color}
                strokeWidth={primitive.width}
                strokeLinecap="round"
                opacity={primitive.alpha ?? 1}
              />
            );
          default:
            return null;
        }
      })}
    </>
  );
}