// 设置 → 联机：用图标替代原来的"已连接 · 35ms"文本。
// - 已连接：延迟 wifi 图标（按 120/200ms 阈值三档变色）+ 上行/下行明细
// - 未连接/连接中：离线（地球+叉）图标
// 明细里的 "(+xx)" 是用户在下方输入框里设置的额外延迟，不参与链路测量。
// 说明：链路只测到一次往返 RTT（不含额外延迟），单向值按对称链路估算。
import { useLocaleMessages } from '../../hooks/useLocaleMessages';
import type { ServerConnectionState } from '../../utils/net/server_status';
import { LatencyArrowIcon, LatencyIcon, OfflineIcon } from '../svgs';
import { NET_ICON_DOWN, NET_ICON_UP, resolveLatencyLevel } from '../svgs/netIcons';

export interface NetLatencyStatusProps {
  state: ServerConnectionState;
  /** 不带额外延迟的往返延迟（ms），未测到时为 null */
  roundTripMs: number | null;
  /** 用户设置的输入（上行）额外延迟 */
  inputExtraMs?: number;
  /** 用户设置的接收（下行）额外延迟 */
  receiveExtraMs?: number;
  iconSize?: number;
}

export default function NetLatencyStatus({
  state,
  roundTripMs,
  inputExtraMs = 0,
  receiveExtraMs = 0,
  iconSize = 30,
}: NetLatencyStatusProps) {
  const { translate } = useLocaleMessages();
  const connected = state === 'connected' && roundTripMs !== null;
  // 图标反映玩家实际感受到的延迟：链路 RTT + 额外延迟
  const effectiveMs = connected ? roundTripMs + inputExtraMs + receiveExtraMs : null;
  const level = resolveLatencyLevel(effectiveMs);
  const upMs = roundTripMs === null ? null : Math.round(roundTripMs / 2);
  const downMs = roundTripMs === null || upMs === null ? null : Math.max(0, roundTripMs - upMs);

  const label = state === 'connected'
    ? translate('menu.settings_connected')
    : state === 'connecting'
      ? translate('menu.settings_connecting')
      : translate('menu.settings_offline');

  return (
    <div
      data-testid="net-latency-status"
      data-latency-state={state}
      data-latency-level={connected ? level : 'offline'}
      style={{ display: 'flex', alignItems: 'center', gap: '10px' }}
    >
      {connected ? (
        <LatencyIcon
          latencyMs={effectiveMs}
          size={iconSize}
          title={`${translate('menu.settings_probe_hint')} ${roundTripMs}ms`}
        />
      ) : (
        <OfflineIcon
          size={iconSize}
          title={state === 'connecting' ? translate('menu.settings_connecting') : translate('menu.settings_offline')}
        />
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
        <span style={{ fontSize: '14px', color: connected ? '#e6ecf3' : '#888' }}>{label}</span>
        {connected && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '12px', fontVariantNumeric: 'tabular-nums' }}>
            <span
              title={translate('menu.settings_latency_up')}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', color: NET_ICON_UP }}
            >
              <LatencyArrowIcon direction="up" size={11} />
              {upMs}ms
              {inputExtraMs > 0 && <span style={{ opacity: 0.7 }}>(+{inputExtraMs})</span>}
            </span>
            <span
              title={translate('menu.settings_latency_down')}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', color: NET_ICON_DOWN }}
            >
              <LatencyArrowIcon direction="down" size={11} />
              {downMs}ms
              {receiveExtraMs > 0 && <span style={{ opacity: 0.7 }}>(+{receiveExtraMs})</span>}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}