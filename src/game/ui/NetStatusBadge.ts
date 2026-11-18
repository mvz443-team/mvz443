// 战斗画面左上角的网络状态徽标：纯渲染，不参与任何联机逻辑。
// 图标几何来自 components/svgs/netIcons，这里只负责把同一份 primitives 画到 Phaser Graphics 上，
// 保证 React 侧（设置页）与 Phaser 侧（战斗场景）看到的是同一套图形。
import type { NetIconPrimitive } from '../../components/svgs/netIcons';
import {
  NET_ICON_VIEWBOX,
  desyncIconPrimitives,
  disconnectedIconPrimitives,
  latencyIconPrimitives,
  offlineIconPrimitives,
  resolveLatencyLevel,
} from '../../components/svgs/netIcons';

export type NetBadgeState =
  | { kind: 'latency'; latencyMs: number }
  | { kind: 'reconnecting' }
  | { kind: 'desync' }
  | { kind: 'offline' };

function hexToInt(color: string): number {
  const normalized = color.startsWith('#') ? color.slice(1) : color;
  const value = Number.parseInt(normalized, 16);
  return Number.isFinite(value) ? value : 0xffffff;
}

function stateKey(state: NetBadgeState): string {
  if (state.kind === 'latency') {
    // 图形只随档位变化，同一档内不必重绘
    return `latency:${resolveLatencyLevel(state.latencyMs)}`;
  }
  return state.kind;
}

function primitivesFor(state: NetBadgeState): NetIconPrimitive[] {
  switch (state.kind) {
    case 'latency':
      return latencyIconPrimitives(resolveLatencyLevel(state.latencyMs));
    case 'reconnecting':
      return disconnectedIconPrimitives();
    case 'desync':
      return desyncIconPrimitives();
    case 'offline':
    default:
      return offlineIconPrimitives();
  }
}

export default class NetStatusBadge {
  private readonly graphics: Phaser.GameObjects.Graphics;
  private readonly boxSize: number;
  private lastKey: string | null = null;

  constructor(scene: Phaser.Scene, x: number, y: number, boxSize: number, depth: number) {
    this.boxSize = Math.max(16, Math.round(boxSize));
    this.graphics = scene.add.graphics({ x, y }).setDepth(depth);
  }

  public update(state: NetBadgeState): void {
    const key = stateKey(state);
    if (key === this.lastKey) {
      return;
    }
    this.lastKey = key;
    this.draw(primitivesFor(state));
  }

  public destroy(): void {
    this.graphics.destroy();
    this.lastKey = null;
  }

  private draw(primitives: NetIconPrimitive[]): void {
    const g = this.graphics;
    const size = this.boxSize;
    g.clear();

    // 半透明底衬，避免图标和战斗画面混在一起
    g.fillStyle(0x000000, 0.35);
    g.fillRoundedRect(0, 0, size, size, Math.round(size * 0.22));

    const iconSize = size * 0.74;
    const scale = iconSize / NET_ICON_VIEWBOX;
    const offset = (size - iconSize) / 2;

    for (const primitive of primitives) {
      const alpha = primitive.alpha ?? 1;
      const color = hexToInt(primitive.color);
      switch (primitive.type) {
        case 'circle':
          g.fillStyle(color, alpha);
          g.fillCircle(offset + primitive.cx * scale, offset + primitive.cy * scale, Math.max(0.6, primitive.r * scale));
          break;
        case 'ellipse':
          g.lineStyle(Math.max(1, primitive.width * scale), color, alpha);
          g.strokeEllipse(
            offset + primitive.cx * scale,
            offset + primitive.cy * scale,
            primitive.rx * 2 * scale,
            primitive.ry * 2 * scale,
          );
          break;
        case 'line': {
          const width = Math.max(1, primitive.width * scale);
          g.lineStyle(width, color, alpha);
          g.lineBetween(
            offset + primitive.x1 * scale,
            offset + primitive.y1 * scale,
            offset + primitive.x2 * scale,
            offset + primitive.y2 * scale,
          );
          // Graphics 不支持圆头端点，用小圆点补齐
          g.fillStyle(color, alpha);
          g.fillCircle(offset + primitive.x1 * scale, offset + primitive.y1 * scale, width / 2);
          g.fillCircle(offset + primitive.x2 * scale, offset + primitive.y2 * scale, width / 2);
          break;
        }
        case 'arc': {
          const width = Math.max(1, primitive.width * scale);
          const cx = offset + primitive.cx * scale;
          const cy = offset + primitive.cy * scale;
          const r = primitive.r * scale;
          g.lineStyle(width, color, alpha);
          g.beginPath();
          g.arc(cx, cy, r, primitive.start, primitive.end, false);
          g.strokePath();
          g.fillStyle(color, alpha);
          g.fillCircle(cx + Math.cos(primitive.start) * r, cy + Math.sin(primitive.start) * r, width / 2);
          g.fillCircle(cx + Math.cos(primitive.end) * r, cy + Math.sin(primitive.end) * r, width / 2);
          break;
        }
        default:
          break;
      }
    }
  }
}