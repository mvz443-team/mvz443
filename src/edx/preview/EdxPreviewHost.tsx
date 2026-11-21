import { useEffect, useLayoutEffect, useRef, type CSSProperties } from 'react';
import type Phaser from 'phaser';
import { createEdxPreviewGame } from './createEdxPreviewGame';
import {
  EDX_PREVIEW_SELECTION_KEY,
  EDX_PREVIEW_VIEW_HEIGHT,
  EDX_PREVIEW_VIEW_WIDTH,
  type EdxPreviewSelection,
} from './edxPreviewConfig';

interface Props {
  selection: EdxPreviewSelection | null;
  style?: CSSProperties;
}

/**
 * 图鉴右栏的 Phaser 预览容器。
 *
 * 一个容器一个 Phaser.Game；切换图鉴条目只改 registry 里的选择，
 * 由场景自己清场重建，不重建游戏实例、不重新加载素材。
 *
 * 画布容器必须是绝对定位的定尺寸盒子：Phaser 的 FIT 缩放会把 canvas 的 CSS
 * 尺寸写回 DOM，若参与父级 flex 的最小内容计算，会反向把右栏撑宽。
 * 尺寸由调用方通过 style 给出（高度必须是确定的）。
 */
export default function EdxPreviewHost({ selection, style }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const selectionRef = useRef<EdxPreviewSelection | null>(selection);
  selectionRef.current = selection;

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const game = createEdxPreviewGame(container, selectionRef.current);
    gameRef.current = game;

    // 父容器尺寸由 CSS 决定，FIT 缩放要等下一帧才拿得到真实宽高。
    const frame = window.requestAnimationFrame(() => game.scale?.refresh());
    const observer = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => game.scale?.refresh())
      : null;
    observer?.observe(container);

    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      gameRef.current = null;
      // destroy(true) 会触发场景 SHUTDOWN/DESTROY，预览场景在那里清空全局单例。
      game.destroy(true);
    };
  }, []);

  useEffect(() => {
    gameRef.current?.registry.set(EDX_PREVIEW_SELECTION_KEY, selection);
  }, [selection]);

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        minHeight: 0,
        borderRadius: '6px',
        border: '1px solid #3a4a52',
        overflow: 'hidden',
        background: '#0d1117',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        ...style,
      }}
    >
      <div
        ref={containerRef}
        style={{
          height: '100%',
          aspectRatio: `${EDX_PREVIEW_VIEW_WIDTH} / ${EDX_PREVIEW_VIEW_HEIGHT}`,
          maxWidth: '100%',
        }}
      />
    </div>
  );
}
