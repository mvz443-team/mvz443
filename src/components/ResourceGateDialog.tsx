import { useEffect, useRef, useState } from 'react';
import { useLocaleMessages } from '../hooks/useLocaleMessages';
import { useGameResources } from '../hooks/useGameResources';
import {
  finishUpdate,
  formatBytes,
  precacheBundle,
  type BundleId,
  type DownloadProgress,
} from '../utils/cache/gameResources';

/**
 * 首屏强制资源选择：每次打开网页先检查最小资源，
 * 缺失或版本过期时以不可关闭的弹窗要求二选一。
 */
export default function ResourceGateDialog() {
  const status = useGameResources();
  const { translate } = useLocaleMessages();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') event.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  if (status.loading) {
    return (
      <div style={overlayStyle}>
        <div style={{ color: '#9fe8ff', fontSize: '16px' }}>
          {translate('resources.checking')}
        </div>
      </div>
    );
  }

  if (!status.gateRequired) return null;

  const extraBytes = status.manifest
    ? status.bgm.bytes + status.illustrations.bytes
    : 0;

  const download = async (withExtra: boolean) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setProgress(null);
    try {
      await precacheBundle('core', setProgress);
      if (withExtra) {
        await precacheBundle('bgm', setProgress);
        await precacheBundle('illustrations', setProgress);
      }
      await finishUpdate();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      busyRef.current = false;
      setBusy(false);
      setProgress(null);
    }
  };

  const percent = progress && progress.total > 0
    ? Math.round((progress.done / progress.total) * 100)
    : 0;
  const bundleLabel = progress
    ? translate(`resources.bundle_${progress.bundle as BundleId}`)
    : '';

  return (
    <div style={overlayStyle}>
      <div role="dialog" aria-modal="true" style={{
        width: 'min(92vw, 560px)',
        padding: '26px 28px',
        background: 'linear-gradient(135deg, #242424, #151515)',
        border: '1px solid rgba(0, 204, 255, 0.55)',
        borderRadius: '10px',
        boxShadow: '0 18px 60px rgba(0, 0, 0, 0.7)',
        color: '#eee',
        display: 'flex',
        flexDirection: 'column',
        gap: '18px',
      }}>
        <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#00ccff' }}>
          {translate('resources.gate_title')}
        </div>
        <div style={{ fontSize: '14px', lineHeight: 1.7, color: '#dbe8ee' }}>
          {translate('resources.gate_message')}
          <div style={{ marginTop: '10px', fontSize: '13px', color: '#9fe8ff' }}>
            {translate('resources.gate_versions', {
              version: status.manifest?.version ?? translate('resources.unknown'),
            })}
          </div>
        </div>

        {busy && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ fontSize: '13px', color: '#ddd' }}>
              {translate('resources.downloading')} {bundleLabel} · {percent}%
            </div>
            <div style={{ height: '10px', background: '#333', borderRadius: '5px', overflow: 'hidden' }}>
              <div style={{
                width: `${percent}%`,
                height: '100%',
                background: 'linear-gradient(90deg, #0099cc, #00ccff)',
                transition: 'width 0.15s linear',
              }} />
            </div>
            {progress && (
              <div style={{ fontSize: '12px', color: '#aaa' }}>
                {progress.done}/{progress.total} · {formatBytes(progress.bytes)}
              </div>
            )}
          </div>
        )}

        {error && (
          <div style={{ fontSize: '13px', color: '#ff8a80', lineHeight: 1.5 }}>
            {translate('resources.error')}: {error}
          </div>
        )}

        {!busy && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <button
              style={choiceStyle}
              onClick={() => void download(false)}
            >
              <span>{translate('resources.core_only')}</span>
              <span style={{ fontSize: '12px', color: '#9fe8ff' }}>
                {formatBytes(status.core.bytes)}
              </span>
            </button>
            <button
              style={{ ...choiceStyle, borderColor: '#00ccff' }}
              onClick={() => void download(true)}
            >
              <span>{translate('resources.core_and_extra')}</span>
              <span style={{ fontSize: '12px', color: '#9fe8ff' }}>
                + {formatBytes(extraBytes)}
              </span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0, 0, 0, 0.86)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 20000,
};

const choiceStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '14px 18px',
  background: 'rgba(255, 255, 255, 0.06)',
  border: '1px solid #666',
  borderRadius: '6px',
  color: '#fff',
  fontSize: '15px',
  cursor: 'pointer',
  textAlign: 'left',
};
