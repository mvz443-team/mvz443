import { useMemo } from 'react';
import Pokedex from '../../components/menu/pokedex';
import EdxPreviewHost from '../preview/EdxPreviewHost';
import type { EdxPreviewSelection } from '../preview/edxPreviewConfig';

interface Props {
  width: number;
  height: number;
  onBack: () => void;
  /** 打开背包卡片页并聚焦指定卡片。 */
  onOpenInventory?: (pid: number) => void;
}

interface PreviewItem {
  pid: number;
  level: number;
}

/**
 * 器械图鉴：完全沿用现有图鉴（列表 / 详情 / 升级材料），
 * 只在右栏标题上方插入 Phaser 实战预览。
 */
export default function PlantCodexPage({ width, height, onBack, onOpenInventory }: Props) {
  return (
    <Pokedex
      width={width}
      height={height}
      onBack={onBack}
      renderPreview={(item) => <PlantPreview item={item} />}
      onOpenInventory={onOpenInventory}
    />
  );
}

function PlantPreview({ item }: { item: PreviewItem | null }) {
  // 选择对象必须稳定：每次渲染新建对象会让预览宿主重复下发选择。
  const selection = useMemo<EdxPreviewSelection | null>(
    () => (item ? { mode: 'plant', pid: item.pid, level: item.level } : null),
    [item?.pid, item?.level],
  );

  // 不渲染标题行，预览直接占满右栏顶部槽位。
  return <EdxPreviewHost selection={selection} style={{ flex: '1 1 auto', minHeight: 0 }} />;
}
