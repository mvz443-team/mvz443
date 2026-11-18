// 全局网络提示：
// - 重连中徽标：显示“重连中 · 第 N 次”，带 data-testid 供 UI 测试断言
// - Toast：消费 RoomError / RoomClosed / DesyncOfflineMode 事件，
//   替代原先散落在 net 层的 alert()

import { useEffect, useState } from 'react';
import { PhaserEventBus, PhaserEvents } from '../game/EventBus';
import BackendWS from '../utils/net/sync';
import DisconnectedIcon from './svgs/DisconnectedIcon';

type NetworkToast = {
  id: number;
  message: string;
  kind: 'error' | 'closed' | 'info';
};

let toastSeq = 0;

export default function NetworkStatusOverlay() {
  const [network, setNetwork] = useState(() => ({
    reconnecting: BackendWS.isReconnecting(),
    reconnectAttempt: BackendWS.getReconnectAttempt(),
    latencyMs: BackendWS.getAverageLatencyMs(),
  }));
  const [toasts, setToasts] = useState<NetworkToast[]>([]);

  useEffect(() => {
    const onStatus = (status: { reconnecting: boolean; reconnectAttempt: number; latencyMs: number | null }) => {
      setNetwork({
        reconnecting: status.reconnecting,
        reconnectAttempt: status.reconnectAttempt,
        latencyMs: status.latencyMs,
      });
    };
    const pushToast = (message: string, kind: NetworkToast['kind']) => {
      const id = ++toastSeq;
      setToasts((current) => [...current, { id, message, kind }]);
      window.setTimeout(() => {
        setToasts((current) => current.filter((toast) => toast.id !== id));
      }, 8000);
    };

    const onError = (event: { message: string }) => pushToast(event.message, 'error');
    const onClosed = (event: { message: string }) => pushToast(event.message, 'closed');
    const onDesync = (event: { message: string }) => pushToast(event.message, 'error');

    PhaserEventBus.on(PhaserEvents.OnlineNetworkStatus, onStatus);
    PhaserEventBus.on(PhaserEvents.RoomError, onError);
    PhaserEventBus.on(PhaserEvents.RoomClosed, onClosed);
    PhaserEventBus.on(PhaserEvents.DesyncOfflineMode, onDesync);
    // 订阅时同步一次当前状态（避免事件先于组件挂载）
    onStatus({
      reconnecting: BackendWS.isReconnecting(),
      reconnectAttempt: BackendWS.getReconnectAttempt(),
      latencyMs: BackendWS.getAverageLatencyMs(),
    });

    return () => {
      PhaserEventBus.off(PhaserEvents.OnlineNetworkStatus, onStatus);
      PhaserEventBus.off(PhaserEvents.RoomError, onError);
      PhaserEventBus.off(PhaserEvents.RoomClosed, onClosed);
      PhaserEventBus.off(PhaserEvents.DesyncOfflineMode, onDesync);
    };
  }, []);

  return (
    <>
      {network.reconnecting && (
        <div
          data-testid="reconnect-badge"
          data-reconnect-attempt={network.reconnectAttempt}
          style={{
            position: 'fixed',
            top: 10,
            left: 10,
            zIndex: 10001,
            padding: '8px 14px',
            borderRadius: 4,
            background: 'rgba(180, 90, 10, 0.9)',
            color: '#fff',
            fontSize: 13,
            pointerEvents: 'none',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <DisconnectedIcon size={18} color="#eceff4" />
          <span>网络中断，正在重连（第 {network.reconnectAttempt} 次）…</span>
        </div>
      )}
      <div
        data-testid="network-toasts"
        style={{ position: 'fixed', bottom: 12, left: 12, zIndex: 10002, display: 'flex', flexDirection: 'column', gap: 8 }}
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            data-testid="network-toast"
            data-kind={toast.kind}
            style={{
              maxWidth: 420,
              padding: '10px 14px',
              borderRadius: 4,
              background: toast.kind === 'error' ? 'rgba(160,30,30,0.92)' : 'rgba(30,30,30,0.92)',
              color: '#fff',
              fontSize: 13,
              boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
            }}
          >
            {toast.message}
          </div>
        ))}
      </div>
    </>
  );
}
