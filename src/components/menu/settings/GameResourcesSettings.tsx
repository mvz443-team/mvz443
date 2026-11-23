import { useRef, useState } from 'react';
import { useLocaleMessages } from '../../../hooks/useLocaleMessages';
import { useGameResources } from '../../../hooks/useGameResources';
import {
  clearBundle,
  finishUpdate,
  formatBytes,
  precacheBundle,
  type BundleId,
  type DownloadProgress,
} from '../../../utils/cache/gameResources';

type BundleKey = 'core' | 'bgm' | 'illustrations';

export default function GameResourcesSettings() {
  const status = useGameResources();
  const { translate } = useLocaleMessages();
  const [busy, setBusy] = useState<BundleKey | null>(null);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);

  const run = async (bundle: BundleKey, action: 'download' | 'clear') => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(bundle);
    setError(null);
    setProgress(null);
    try {
      if (action === 'download') {
        await precacheBundle(bundle, setProgress);
        await finishUpdate();
      } else {
        await clearBundle(bundle);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      busyRef.current = false;
      setBusy(null);
      setProgress(null);
    }
  };

  const percent = progress && progress.total > 0
    ? Math.round((progress.done / progress.total) * 100)
    : 0;

  if (status.loading) {
    return <div style={{ color: '#aaa' }}>{translate('resources.checking')}</div>;
  }

  if (!import.meta.env.PROD) {
    return (
      <div style={{ color: '#aaa', lineHeight: 1.6 }}>
        {translate('resources.settings_dev')}
      </div>
    );
  }

  if (!status.manifest) {
    return (
      <div style={{ color: '#aaa', lineHeight: 1.6 }}>
        {translate('resources.settings_unavailable')}
        {status.error ? ` (${status.error})` : ''}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ fontSize: '13px', color: '#9fe8ff', lineHeight: 1.6 }}>
        {translate('resources.settings_version', { version: status.manifest.version })}
      </div>

      {(['core', 'bgm', 'illustrations'] as BundleKey[]).map((bundle) => {
        const info = status[bundle];
        const isBusy = busy === bundle;
        const ready = info.ready;
        return (
          <div key={bundle} style={{
            border: '1px solid rgba(100, 100, 100, 0.5)',
            borderRadius: '5px',
            padding: '14px',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: '16px', color: '#fff' }}>
                  {translate(`resources.bundle_${bundle as BundleId}`)}
                </div>
                <div style={{ fontSize: '12px', color: '#aaa', marginTop: '4px' }}>
                  {translate(ready ? 'resources.state_ready' : 'resources.state_missing')}
                  {' · '}
                  {formatBytes(info.bytes)}
                  {info.total > 0 && ` (${info.cached}/${info.total})`}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  style={buttonStyle}
                  disabled={busyRef.current}
                  onClick={() => void run(bundle, 'download')}
                >
                  {translate(ready ? 'resources.update' : 'resources.download')}
                </button>
                {bundle !== 'core' && (
                  <button
                    style={{ ...buttonStyle, borderColor: '#a44' }}
                    disabled={busyRef.current || !ready}
                    onClick={() => void run(bundle, 'clear')}
                  >
                    {translate('resources.remove')}
                  </button>
                )}
              </div>
            </div>
            {isBusy && (
              <div style={{ marginTop: '10px' }}>
                <div style={{ height: '8px', background: '#333', borderRadius: '4px', overflow: 'hidden' }}>
                  <div style={{
                    height: '100%',
                    width: `${percent}%`,
                    background: 'linear-gradient(90deg, #0099cc, #00ccff)',
                  }} />
                </div>
                <div style={{ fontSize: '12px', color: '#aaa', marginTop: '4px' }}>
                  {progress ? `${progress.done}/${progress.total}` : '...'}
                </div>
              </div>
            )}
          </div>
        );
      })}

      {error && (
        <div style={{ fontSize: '13px', color: '#ff8a80', lineHeight: 1.5 }}>
          {translate('resources.error')}: {error}
        </div>
      )}
      <div style={{ fontSize: '12px', color: '#888', lineHeight: 1.6 }}>
        {translate('resources.settings_hint')}
      </div>
    </div>
  );
}

const buttonStyle: React.CSSProperties = {
  padding: '6px 14px',
  background: 'rgba(255, 255, 255, 0.06)',
  border: '1px solid #00ccff',
  borderRadius: '4px',
  color: '#ddd',
  cursor: 'pointer',
  fontSize: '13px',
};
