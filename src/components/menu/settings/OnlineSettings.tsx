// 设置 → 联机：只负责"服务器连接"这一件事
// 房间的创建与加入已经移动到选择关卡页面

import { useEffect, useMemo, useState } from 'react';
import { useSaveManager } from '../../../context/save_ctx';
import { useLocaleMessages } from '../../../hooks/useLocaleMessages';
import BackendWS from '../../../utils/net/sync';
import { normalizeServerAddress } from '../../../utils/net/lobby';
import { PRESET_SERVERS, serverStatus } from '../../../utils/net/server_status';

const CUSTOM_SERVER_VALUE = '__custom__';
const USERNAME_MAX_LENGTH = 16;

const inputStyle: React.CSSProperties = {
  padding: '5px',
  background: 'rgba(255, 255, 255, 0.1)',
  border: '1px solid #666',
  color: '#ddd',
  width: '100%',
  borderRadius: '3px',
  boxSizing: 'border-box',
};

const buttonStyle: React.CSSProperties = {
  padding: '5px 15px',
  background: 'none',
  border: '1px solid #666',
  color: '#ddd',
  cursor: 'pointer',
  transition: 'all 0.3s ease',
  whiteSpace: 'nowrap',
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: '16px',
  padding: '10px 0',
  borderBottom: '1px solid rgba(100, 100, 100, 0.3)',
};

const controlStyle: React.CSSProperties = {
  width: '260px',
  textAlign: 'right',
  flex: '0 0 auto',
};

function sanitizeLatencyInput(value: string): string {
  const digits = value.replace(/[^\d]/g, '');
  if (!digits) {
    return '0';
  }
  return String(Math.min(60000, Number(digits)));
}

export default function OnlineSettings() {
  const saveManager = useSaveManager();
  const { translate } = useLocaleMessages();

  const [onlineConfig, setOnlineConfig] = useState(() => saveManager.getOnlineConfig());
  const [status, setStatus] = useState(() => ({
    state: serverStatus.getState(),
    latency: serverStatus.getLatency(),
  }));
  const [connecting, setConnecting] = useState(false);
  const [selectedServer, setSelectedServer] = useState<string>(() => {
    const current = normalizeServerAddress(saveManager.getOnlineConfig().serverAddr);
    const known = [
      ...PRESET_SERVERS.map((preset) => preset.address),
      ...saveManager.getOnlineConfig().customServers,
    ];
    return current && known.includes(current) ? current : (current ? CUSTOM_SERVER_VALUE : PRESET_SERVERS[0].address);
  });
  const [customServerInput, setCustomServerInput] = useState<string>(() => {
    const current = normalizeServerAddress(saveManager.getOnlineConfig().serverAddr);
    const known = [
      ...PRESET_SERVERS.map((preset) => preset.address),
      ...saveManager.getOnlineConfig().customServers,
    ];
    return current && !known.includes(current) ? current : '';
  });
  const [sendLatencyInput, setSendLatencyInput] = useState(String(BackendWS.getDebugLatencyConfig().sendLatencyMs));
  const [receiveLatencyInput, setReceiveLatencyInput] = useState(String(BackendWS.getDebugLatencyConfig().receiveLatencyMs));

  useEffect(() => {
    const unsubscribe = serverStatus.subscribe(() => {
      setStatus({ state: serverStatus.getState(), latency: serverStatus.getLatency() });
    });
    return unsubscribe;
  }, []);

  // 进入页面时恢复存档里的服务器地址并开始探测
  useEffect(() => {
    void serverStatus.attach(saveManager.getOnlineConfig().serverAddr);
  }, [saveManager]);

  const serverOptions = useMemo(() => {
    const options = PRESET_SERVERS.map((preset) => ({
      value: preset.address,
      label: `${translate(preset.labelKey)} · ${preset.address}`,
    }));
    onlineConfig.customServers.forEach((address) => {
      options.push({ value: address, label: address });
    });
    options.push({ value: CUSTOM_SERVER_VALUE, label: translate('menu.settings_server_custom') });
    return options;
  }, [onlineConfig.customServers, translate]);

  const statusLabel = status.state === 'connected'
    ? `${translate('menu.settings_connected')}${status.latency !== null ? ` · ${status.latency}ms` : ''}`
    : status.state === 'connecting'
      ? translate('menu.settings_connecting')
      : translate('menu.settings_offline');
  const statusColor = status.state === 'connected' ? '#22c55e' : status.state === 'connecting' ? '#f59e0b' : '#888';

  const handleUsernameChange = (value: string) => {
    const next = value.slice(0, USERNAME_MAX_LENGTH);
    setOnlineConfig(saveManager.updateOnlineConfig({ username: next }));
  };

  const handleConnect = async () => {
    if (BackendWS.isRoomSessionMode()) {
      alert(translate('menu.online_leave_first'));
      return;
    }
    const address = normalizeServerAddress(
      selectedServer === CUSTOM_SERVER_VALUE ? customServerInput : selectedServer
    );
    if (!address) {
      alert(translate('menu.settings_server_required'));
      return;
    }

    setConnecting(true);
    const result = await serverStatus.connect(address);
    setConnecting(false);

    if (!result.ok) {
      if (result.failure === 'cert') {
        // 自签证书：引导用户在新标签页手动信任
        const openTrustPage = window.confirm(translate('menu.settings_cert_hint'));
        if (openTrustPage) {
          window.open(`https://${address}/list`, '_blank');
        }
        return;
      }
      alert(`${translate('menu.settings_server_unreachable')}：${result.message ?? result.failure}`);
      return;
    }

    if (selectedServer === CUSTOM_SERVER_VALUE) {
      saveManager.addCustomServer(address);
    }
    setOnlineConfig(saveManager.updateOnlineConfig({ serverAddr: address }));
  };

  const handleDisconnect = () => {
    if (BackendWS.isRoomSessionMode()) {
      BackendWS.closeConnection();
    }
    serverStatus.disconnect();
  };

  return (
    <div style={{
      marginBottom: '30px',
      border: '1px solid rgba(100, 100, 100, 0.5)',
      padding: '15px',
      borderRadius: '5px'
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '15px',
        gap: '12px'
      }}>
        <div>
          <h3 style={{ color: '#fff', margin: 0 }}>{translate('menu.settings_online_settings')}</h3>
          <div style={{ fontSize: '12px', color: '#aaa', marginTop: '4px' }}>
            {translate('menu.settings_probe_hint_t')}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', color: statusColor }}>
          <span style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            background: statusColor,
            boxShadow: `0 0 6px ${statusColor}`
          }} />
          <span>{statusLabel}</span>
        </div>
      </div>

      <div style={{ ...rowStyle, borderBottom: '1px solid rgba(100, 100, 100, 0.3)' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '16px', color: '#fff' }}>{translate('menu.settings_online_username')}</div>
          <div style={{ fontSize: '12px', color: '#aaa' }}>{translate('menu.settings_online_username_t')}</div>
        </div>
        <div style={controlStyle}>
          <input
            type="text"
            value={onlineConfig.username}
            maxLength={USERNAME_MAX_LENGTH}
            onChange={(event) => handleUsernameChange(event.target.value)}
            style={inputStyle}
          />
        </div>
      </div>

      <div style={rowStyle}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '16px', color: '#fff' }}>{translate('menu.settings_server_address')}</div>
          <div style={{ fontSize: '12px', color: '#aaa' }}>{translate('menu.settings_server_address_t')}</div>
        </div>
        <div style={{ ...controlStyle, width: '340px', display: 'flex', gap: '8px', alignItems: 'center' }}>
          <select
            value={selectedServer}
            onChange={(event) => setSelectedServer(event.target.value)}
            style={{ ...inputStyle, flex: 1 }}
          >
            {serverOptions.map((option) => (
              <option key={option.value} value={option.value} style={{ background: '#333', color: '#ddd' }}>
                {option.label}
              </option>
            ))}
          </select>
          <button style={buttonStyle} onClick={handleConnect} disabled={connecting}>
            {connecting ? translate('menu.settings_connecting') : translate('menu.settings_connect')}
          </button>
        </div>
      </div>

      {selectedServer === CUSTOM_SERVER_VALUE && (
        <div style={rowStyle}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '16px', color: '#fff' }}>{translate('menu.settings_server_custom_address')}</div>
            <div style={{ fontSize: '12px', color: '#aaa' }}>{translate('menu.settings_server_custom_address_t')}</div>
          </div>
          <div style={controlStyle}>
            <input
              type="text"
              value={customServerInput}
              placeholder="127.0.0.1:28080"
              onChange={(event) => setCustomServerInput(normalizeServerAddress(event.target.value))}
              style={inputStyle}
            />
          </div>
        </div>
      )}

      <div style={rowStyle}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '16px', color: '#fff' }}>{translate('menu.settings_disconnect')}</div>
          <div style={{ fontSize: '12px', color: '#aaa' }}>{translate('menu.settings_disconnect_t')}</div>
        </div>
        <div style={controlStyle}>
          <button style={buttonStyle} onClick={handleDisconnect}>
            {translate('menu.settings_disconnect')}
          </button>
        </div>
      </div>

      <div style={{ ...rowStyle, borderBottom: 'none' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '16px', color: '#fff' }}>{translate('menu.settings_debug_send_latency')}</div>
          <div style={{ fontSize: '12px', color: '#aaa' }}>{translate('menu.settings_debug_latency_t')}</div>
        </div>
        <div style={controlStyle}>
          <input
            type="text"
            value={sendLatencyInput}
            placeholder="0"
            onChange={(event) => {
              const next = sanitizeLatencyInput(event.target.value);
              setSendLatencyInput(next);
              BackendWS.setDebugSendLatencyMs(Number(next));
            }}
            style={inputStyle}
          />
        </div>
      </div>

      <div style={{ ...rowStyle, borderBottom: 'none' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '16px', color: '#fff' }}>{translate('menu.settings_debug_receive_latency')}</div>
          <div style={{ fontSize: '12px', color: '#aaa' }}>{translate('menu.settings_debug_latency_t')}</div>
        </div>
        <div style={controlStyle}>
          <input
            type="text"
            value={receiveLatencyInput}
            placeholder="0"
            onChange={(event) => {
              const next = sanitizeLatencyInput(event.target.value);
              setReceiveLatencyInput(next);
              BackendWS.setDebugReceiveLatencyMs(Number(next));
            }}
            style={inputStyle}
          />
        </div>
      </div>
    </div>
  );
}
