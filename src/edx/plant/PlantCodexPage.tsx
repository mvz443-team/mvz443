import { useMemo } from 'react';
import Pokedex from '../../components/menu/pokedex';
import { useLocaleMessages } from '../../hooks/useLocaleMessages';
import EdxPreviewHost from '../preview/EdxPreviewHost';
import type { EdxPreviewSelection } from '../preview/edxPreviewConfig';

interface Props {
  width: number;
  height: number;
  onBack: () => void;
}

interface PreviewItem {
  pid: number;
  level: number;
}

/**
 * 器械图鉴：完全沿用现有图鉴（列表 / 详情 / 升级材料），
 * 只在右栏标题上方插入 Phaser 实战预览。
 */
export default function PlantCodexPage({ width, height, onBack }: Props) {
  return (
    <Pokedex
      width={width}
      height={height}
      onBack={onBack}
      renderPreview={(item) => <PlantPreview item={item} />}
    />
  );
}

function PlantPreview({ item }: { item: PreviewItem | null }) {
  const { translate } = useLocaleMessages();
  // 选择对象必须稳定：每次渲染新建对象会让预览宿主重复下发选择。
  const selection = useMemo<EdxPreviewSelection | null>(
    () => (item ? { mode: 'plant', pid: item.pid, level: item.level } : null),
    [item?.pid, item?.level],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{
        color: '#9aa4aa',
        fontSize: '12px',
        marginBottom: '4px',
        letterSpacing: '1px',
        flex: '0 0 auto',
      }}>
        {translate('edx.plant_preview')}
      </div>
      <EdxPreviewHost selection={selection} style={{ flex: '1 1 auto', minHeight: 0 }} />
    </div>
  );
}
