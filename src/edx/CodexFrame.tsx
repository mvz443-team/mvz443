import { useState } from 'react';
import { useLocaleMessages } from '../hooks/useLocaleMessages';
import PlantCodexPage from './plant/PlantCodexPage';
import ZombieCodexPage from './zombie/ZombieCodexPage';
import StageCodexPage from './stage/StageCodexPage';

interface Props {
  width: number;
  height?: number;
  onBack: () => void;
  /** 打开背包卡片页并聚焦指定卡片。 */
  onOpenInventory?: (pid: number) => void;
}

type CodexView = 'home' | 'plants' | 'zombie' | 'map';

const CODE_BORDER = '2px solid #444';
const PANEL_BACKGROUND = 'linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%)';

/**
 * 「图鉴」入口。
 *
 * 主视觉左侧是返回按钮与「器械图鉴」大入口，右侧自上下分别是地图图鉴、僵尸图鉴。
 * 三个子页各自独立，避免把三种完全不同的展示塞进一个组件。
 */
export default function CodexFrame({ width, height, onBack, onOpenInventory }: Props) {
  if (height === undefined) {
    height = width * 3 / 4;
  }
  const { translate } = useLocaleMessages();
  const [view, setView] = useState<CodexView>('home');

  if (view === 'plants') {
    return (
      <PlantCodexPage
        width={width}
        height={height}
        onBack={() => setView('home')}
        onOpenInventory={onOpenInventory}
      />
    );
  }
  if (view === 'zombie') {
    return <ZombieCodexPage width={width} height={height} onBack={() => setView('home')} />;
  }
  if (view === 'map') {
    return <StageCodexPage width={width} height={height} onBack={() => setView('home')} />;
  }

  return (
    <div style={{
      width: `${width}px`,
      height: `${height}px`,
      background: PANEL_BACKGROUND,
      position: 'relative',
      overflow: 'hidden',
      border: CODE_BORDER,
      boxShadow: '0 0 15px rgba(0, 0, 0, 0.5)',
      animation: 'frameFadeIn 0.5s ease-out',
      display: 'flex',
      padding: '3%',
      boxSizing: 'border-box',
      gap: '3%',
    }}>
      <div style={{
        flex: '1.6 1 0',
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
      }}>
        <div>
          <button
            style={{
              padding: '6px 16px',
              background: '#444',
              border: 'none',
              color: '#fff',
              cursor: 'pointer',
              borderRadius: '4px',
              fontSize: '14px',
            }}
            onClick={onBack}
          >
            {translate('edx.back')}
          </button>
        </div>

        <CodexEntry
          title={translate('edx.plants')}
          hint={translate('edx.plants_hint')}
          accent="#4fa3c7"
          onClick={() => setView('plants')}
          hero
          glyph="⚙"
        />
      </div>

      <div style={{
        flex: '1 1 0',
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
      }}>
        <CodexEntry
          title={translate('edx.map')}
          hint={translate('edx.map_hint')}
          accent="#6f9c4a"
          onClick={() => setView('map')}
          glyph="▦"
        />
        <CodexEntry
          title={translate('edx.zombie')}
          hint={translate('edx.zombie_hint')}
          accent="#b0605a"
          onClick={() => setView('zombie')}
          glyph="☠"
        />
      </div>
    </div>
  );
}

interface EntryProps {
  title: string;
  hint: string;
  accent: string;
  glyph: string;
  onClick: () => void;
  hero?: boolean;
}

function CodexEntry({ title, hint, accent, glyph, onClick, hero }: EntryProps) {
  return (
    <button
      onClick={onClick}
      onMouseOver={(event) => {
        event.currentTarget.style.borderColor = accent;
        event.currentTarget.style.boxShadow = `0 0 18px ${accent}66`;
      }}
      onMouseOut={(event) => {
        event.currentTarget.style.borderColor = '#555';
        event.currentTarget.style.boxShadow = 'none';
      }}
      style={{
        flex: '1 1 0',
        minHeight: 0,
        width: '100%',
        cursor: 'pointer',
        background: 'rgba(40, 44, 48, 0.85)',
        border: '2px solid #555',
        borderRadius: '8px',
        color: '#e6e6e6',
        textAlign: hero ? 'center' : 'left',
        padding: hero ? '24px' : '18px 20px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: hero ? 'center' : 'stretch',
        gap: '10px',
        transition: 'border-color 0.2s, box-shadow 0.2s',
      }}
    >
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: hero ? 'center' : 'flex-start',
        gap: '12px',
      }}>
        <span style={{
          width: hero ? '44px' : '36px',
          height: hero ? '44px' : '36px',
          flex: '0 0 auto',
          borderRadius: '6px',
          background: `${accent}33`,
          color: accent,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: hero ? '24px' : '20px',
          fontWeight: 700,
        }}>{glyph}</span>
        <span style={{
          fontSize: hero ? '30px' : '22px',
          fontWeight: 800,
          letterSpacing: '1px',
        }}>{title}</span>
      </div>
      <div style={{ color: '#9aa4aa', fontSize: '13px', lineHeight: 1.5 }}>{hint}</div>
    </button>
  );
}
