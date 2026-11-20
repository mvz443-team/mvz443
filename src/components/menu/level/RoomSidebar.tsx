// 关卡页的联机侧边栏：房间列表 / 等待房间
// 列表模式宽度与右侧描述栏一致；进入房间后展开为整屏等待房间

import React, { useEffect, useState } from 'react';
import { Lock, User, Users, X } from 'lucide-react';
import { useSaveManager } from '../../../context/save_ctx';
import { useLocaleMessages } from '../../../hooks/useLocaleMessages';
import { onlineStateManager } from '../../../store/OnlineStateManager';
import EnumGameStage from '../../../utils/net/game_state';
import BackendWS from '../../../utils/net/sync';
import {
  createRoom,
  DEFAULT_ROOM_NAME,
  joinRoom,
  leaveRoomRemotely,
  normalizeRoomKey,
  normalizeRoomName,
  resolveRoomName,
  ROOM_KEY_MAX_LENGTH,
  ROOM_NAME_MAX_LENGTH,
  RoomInfo,
} from '../../../utils/net/lobby';
import { SendChooseMap, SendKickPlayer, SendReady, SendUpdateRoom } from '../../../utils/net/room';
import { PeerInfo, ROOM_CAPACITY } from '../../../types/online';
import { PhaserEventBus, PhaserEvents } from '../../../game/EventBus';
import { showAlert, showConfirm } from '../../../utils/uiDialog';

export type StageSummary = {
  light: string;
  rows: number;
  waves: number;
  threat: string;
};

interface Props {
  chapterId: number;
  stageId: number;
  stageName: string;
  stageSummary: StageSummary | null;
  rooms: RoomInfo[] | null;
  serverAddress: string;
  onRefresh: () => void | Promise<void>;
  onClose: () => void;
}

type RoomState = {
  inRoom: boolean;
  roomName: string;
  peers: PeerInfo[];
  myId: number;
  lordId: number;
};

function readRoomState(): RoomState {
  const inRoom = BackendWS.isRoomSessionMode()
    && onlineStateManager.getCurrentGameStage() === EnumGameStage.InLobby;
  return {
    inRoom,
    roomName: onlineStateManager.getRoomMeta().roomName,
    peers: onlineStateManager.getRoomPeersData() ?? [],
    myId: onlineStateManager.getRoomInfo().myId,
    lordId: onlineStateManager.getRoomInfo().lordId,
  };
}

const inputStyle: React.CSSProperties = {
  padding: '6px 8px',
  background: 'rgba(255, 255, 255, 0.08)',
  border: '1px solid #555',
  color: '#eee',
  borderRadius: '3px',
  boxSizing: 'border-box',
};

const iconButtonStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '22px',
  height: '22px',
  padding: 0,
  background: 'none',
  border: 'none',
  color: '#888',
  cursor: 'pointer',
};

const actionButtonStyle: React.CSSProperties = {
  padding: '6px 16px',
  background: 'linear-gradient(45deg, #4CAF50, #45a049)',
  border: 'none',
  color: '#fff',
  cursor: 'pointer',
  borderRadius: '3px',
  whiteSpace: 'nowrap',
};

const RoomSidebar: React.FC<Props> = ({
  chapterId,
  stageId,
  stageName,
  stageSummary,
  rooms,
  serverAddress,
  onRefresh,
  onClose,
}) => {
  const saveManager = useSaveManager();
  const { translate } = useLocaleMessages();

  const [roomState, setRoomState] = useState<RoomState>(readRoomState);
  const [createName, setCreateName] = useState('');
  const [createKey, setCreateKey] = useState('');
  const [pendingRoom, setPendingRoom] = useState<RoomInfo | null>(null);
  const [joinKeyInput, setJoinKeyInput] = useState('');
  const [nameDraft, setNameDraft] = useState('');
  const [keyDraft, setKeyDraft] = useState('');

  useEffect(() => {
    const sync = () => setRoomState(readRoomState());
    sync();
    PhaserEventBus.on(PhaserEvents.RoomInfo, sync);
    onlineStateManager.onGameStageUpdate(sync);
    onlineStateManager.onOnlineModeUpdate(sync);
    return () => {
      PhaserEventBus.off(PhaserEvents.RoomInfo, sync);
      onlineStateManager.removeGameStageUpdateListener(sync);
      onlineStateManager.removeOnlineModeUpdateListener(sync);
    };
  }, []);

  // 房间名/密码草稿跟随服务端广播
  useEffect(() => {
    setNameDraft(roomState.roomName);
  }, [roomState.roomName]);

  useEffect(() => {
    if (roomState.inRoom) {
      setKeyDraft(onlineStateManager.getConnectionKey());
    }
  }, [roomState.inRoom]);

  const username = saveManager.getOnlineConfig().username;
  const isLord = roomState.myId === roomState.lordId;
  const myPeer = roomState.peers.find((peer) => peer.id === roomState.myId);
  const isReady = Boolean(myPeer?.ready);
  // 房主不准备：只要其他成员全部准备，就能按下“开始”。
  const otherPeers = roomState.peers.filter((peer) => peer.id !== roomState.myId);
  const canStart = otherPeers.every((peer) => Boolean(peer.ready));
  // 老服务端/mock 没有 seat 字段时，退回按数组下标占位。
  const peersHaveSeat = roomState.peers.some((peer) => typeof peer.seat === 'number');

  const ensureServer = (): boolean => {
    if (!serverAddress) {
      void showAlert(translate('menu.online_need_server'));
      return false;
    }
    return true;
  };

  const handleCreateRoom = () => {
    if (!ensureServer()) {
      return;
    }
    createRoom({
      baseUrl: serverAddress,
      roomName: resolveRoomName(createName),
      key: createKey,
      chapterId,
      stageId,
      username,
    });
  };

  const doJoin = (room: RoomInfo, key: string) => {
    joinRoom({
      baseUrl: serverAddress,
      roomId: room.room_id,
      key,
      chapterId,
      stageId,
      username,
    });
    setPendingRoom(null);
    setJoinKeyInput('');
  };

  const handleRoomClick = (room: RoomInfo) => {
    if (room.player_count >= ROOM_CAPACITY) {
      void showAlert(translate('menu.online_room_full'));
      return;
    }
    if (!ensureServer()) {
      return;
    }
    if (room.need_key) {
      setPendingRoom(room);
      setJoinKeyInput('');
      return;
    }
    doJoin(room, '');
  };

  const handleToggleReady = () => {
    if (isLord) {
      return;
    }
    SendReady(!isReady);
  };

  const handleLeave = async () => {
    const confirmed = await showConfirm(translate('menu.online_leave_confirm'));
    if (!confirmed) {
      return;
    }
    const roomId = onlineStateManager.getRoomInfo().roomId;
    // 先让服务端同步移除席位，再断开 WS：否则列表刷新会拿到注销前的快照。
    BackendWS.cancelReconnect();
    await leaveRoomRemotely(serverAddress, username, false, { roomId });
    BackendWS.closeConnection();
    onlineStateManager.resetAllState();
    setRoomState(readRoomState());
    await onRefresh();
    // 房间销毁从管理器移除是异步的，补一次刷新清掉可能的“幽灵房间”。
    window.setTimeout(() => void onRefresh(), 500);
  };

  const handleKick = async (playerId: number) => {
    const confirmed = await showConfirm(translate('menu.online_kick_confirm'));
    if (!confirmed) {
      return;
    }
    SendKickPlayer(playerId);
  };

  const commitRoomInfo = (nextName: string, nextKey: string) => {
    SendUpdateRoom(nextName || roomState.roomName, nextKey);
  };

  const panelWidth = roomState.inRoom ? '100%' : '70%';

  return (
    <div data-testid={roomState.inRoom ? 'waiting-room' : undefined} style={{
      position: 'absolute',
      right: 0,
      top: 0,
      width: panelWidth,
      height: '100%',
      background: 'linear-gradient(135deg, rgba(18, 18, 18, 0.98) 0%, rgba(32, 32, 32, 0.98) 100%)',
      borderLeft: '1px solid rgba(100, 100, 100, 0.45)',
      boxShadow: '-8px 0 20px rgba(0, 0, 0, 0.45)',
      display: 'flex',
      flexDirection: 'column',
      transition: 'width 0.25s ease',
      zIndex: 20,
      color: '#ddd',
    }}>
      {roomState.inRoom ? (
        <>
          {/* 等待房间头部 */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            padding: '14px 18px',
            borderBottom: '1px solid rgba(100, 100, 100, 0.35)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
              <span style={{ fontSize: '18px', color: '#fff', whiteSpace: 'nowrap' }}>
                {translate('menu.online_waiting_room')}
              </span>
              <span style={{ fontSize: '13px', color: '#9aa7ae' }}>#{onlineStateManager.getRoomInfo().roomId}</span>
            </div>
            <button style={{ ...actionButtonStyle, background: 'none', border: '1px solid #666', color: '#ddd' }} onClick={handleLeave}>
              {translate('menu.online_back_to_lobby')}
            </button>
          </div>

          {/* 房间名 / 密码 */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            padding: '12px 18px',
            borderBottom: '1px solid rgba(100, 100, 100, 0.2)',
            flexWrap: 'wrap',
          }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px' }}>
              <span style={{ color: '#9aa7ae' }}>{translate('menu.online_room_name')}</span>
              <input
                type="text"
                value={nameDraft}
                maxLength={ROOM_NAME_MAX_LENGTH}
                disabled={!isLord}
                onChange={(event) => setNameDraft(normalizeRoomName(event.target.value))}
                onBlur={() => {
                  const next = normalizeRoomName(nameDraft) || roomState.roomName;
                  setNameDraft(next);
                  if (next !== roomState.roomName) {
                    commitRoomInfo(next, keyDraft);
                  }
                }}
                style={{ ...inputStyle, width: '120px', opacity: isLord ? 1 : 0.7 }}
              />
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px' }}>
              <Lock size={14} color="#9aa7ae" />
              <span style={{ color: '#9aa7ae' }}>{translate('menu.online_room_password')}</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                <input
                  type="text"
                  value={keyDraft}
                  maxLength={ROOM_KEY_MAX_LENGTH}
                  disabled={!isLord}
                  placeholder={translate('menu.online_room_password_none')}
                  onChange={(event) => {
                    const next = normalizeRoomKey(event.target.value);
                    setKeyDraft(next);
                    BackendWS.key = next;
                    commitRoomInfo(nameDraft || roomState.roomName, next);
                  }}
                  style={{ ...inputStyle, width: '100px', opacity: isLord ? 1 : 0.7 }}
                />
                {isLord && keyDraft.length > 0 && (
                  <button
                    style={iconButtonStyle}
                    title={translate('menu.online_clear_password')}
                    onClick={() => {
                      setKeyDraft('');
                      BackendWS.key = '';
                      commitRoomInfo(nameDraft || roomState.roomName, '');
                    }}
                  >
                    <X size={14} />
                  </button>
                )}
              </span>
            </label>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginLeft: 'auto', fontSize: '13px', color: '#9aa7ae' }}>
              <span>{stageName}</span>
              {stageSummary && (
                <>
                  <span>· {stageSummary.light}</span>
                  <span>· {translate('menu.level_rows', { count: stageSummary.rows })}</span>
                  <span>· {translate('menu.level_wave_summary', { count: stageSummary.waves, threat: stageSummary.threat })}</span>
                </>
              )}
            </div>
          </div>

          {/* 玩家方框 */}
          <div style={{
            flex: 1,
            display: 'grid',
            gridTemplateColumns: `repeat(${ROOM_CAPACITY}, 1fr)`,
            gap: '16px',
            padding: '18px',
            minHeight: 0,
          }}>
            {Array.from({ length: ROOM_CAPACITY }, (_, slot) => slot).map((slot) => {
              // 服务端按固定座位号分配席位；老服务端/mock 无 seat 时退回数组下标。
              const peer = roomState.peers.find((entry) => entry.seat === slot)
                ?? (!peersHaveSeat ? roomState.peers[slot] : undefined);
              const isMe = peer?.id === roomState.myId;
              const isOwner = peer?.id === roomState.lordId;
              return (
                <div
                  key={slot}
                  style={{
                    position: 'relative',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '10px',
                    border: peer ? '1px solid rgba(0, 204, 255, 0.5)' : '1px dashed rgba(120, 120, 120, 0.5)',
                    background: peer ? 'rgba(0, 204, 255, 0.06)' : 'rgba(255, 255, 255, 0.02)',
                    borderRadius: '6px',
                    fontSize: peer ? '20px' : '15px',
                    color: peer ? '#fff' : '#7a7a7a',
                  }}
                >
                  <span style={{ position: 'absolute', top: '10px', left: '12px', fontSize: '12px', color: '#6b7f8a' }}>
                    #{slot}
                  </span>
                  {peer ? (
                    <>
                      <User size={44} color={peer.ready ? '#22c55e' : '#8fa6b2'} />
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span>{peer.name || `player${peer.id}`}</span>
                        {isMe && <span style={{ fontSize: '12px', color: '#00ccff' }}>{translate('menu.online_me')}</span>}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}>
                        {isOwner && <span style={{ color: '#f5c542' }}>{translate('menu.online_lord')}</span>}
                        <span style={{ color: peer.ready ? '#22c55e' : '#9aa7ae' }}>
                          {peer.ready ? translate('menu.online_ready_done') : translate('menu.online_ready_waiting')}
                        </span>
                      </div>
                      {isLord && !isMe && (
                        <button
                          style={{
                            position: 'absolute',
                            top: '10px',
                            right: '10px',
                            padding: '3px 10px',
                            background: 'none',
                            border: '1px solid #b91c1c',
                            color: '#ef4444',
                            cursor: 'pointer',
                            borderRadius: '3px',
                            fontSize: '12px',
                          }}
                          onClick={() => handleKick(peer.id)}
                        >
                          {translate('menu.online_kick')}
                        </button>
                      )}
                    </>
                  ) : (
                    <>
                      <Users size={40} color="#4a4a4a" />
                      <span>{translate('menu.online_waiting_player')}</span>
                    </>
                  )}
                </div>
              );
            })}
          </div>

          {/* 底部操作 */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            padding: '14px 18px',
            borderTop: '1px solid rgba(100, 100, 100, 0.35)',
          }}>
            <div style={{ fontSize: '13px', color: '#9aa7ae' }}>
              {translate(isLord ? 'menu.online_start_hint' : 'menu.online_ready_hint')}
            </div>
            {isLord ? (
              <button
                style={{
                  ...actionButtonStyle,
                  minWidth: '160px',
                  padding: '10px 20px',
                  background: canStart ? 'linear-gradient(45deg, #4CAF50, #45a049)' : 'none',
                  border: canStart ? 'none' : '1px solid #555',
                  color: canStart ? '#fff' : '#777',
                  cursor: canStart ? 'pointer' : 'not-allowed',
                }}
                disabled={!canStart}
                onClick={() => SendChooseMap(chapterId, stageId)}
              >
                {translate('menu.online_start')}
              </button>
            ) : (
              <button
                style={{
                  ...actionButtonStyle,
                  minWidth: '160px',
                  padding: '10px 20px',
                  background: isReady ? 'none' : 'linear-gradient(45deg, #4CAF50, #45a049)',
                  border: isReady ? '1px solid #666' : 'none',
                  color: isReady ? '#ddd' : '#fff',
                }}
                onClick={handleToggleReady}
              >
                {isReady ? translate('menu.online_cancel_ready') : translate('menu.online_ready')}
              </button>
            )}
          </div>
        </>
      ) : (
        <>
          {/* 房间列表头部 */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            padding: '14px 18px',
            borderBottom: '1px solid rgba(100, 100, 100, 0.35)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
              <span style={{ fontSize: '18px', color: '#fff', whiteSpace: 'nowrap' }}>
                {translate('menu.online_multiplayer')}
              </span>
              <span style={{ fontSize: '13px', color: '#9aa7ae', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {stageName}
              </span>
            </div>
            <button
              style={{ ...actionButtonStyle, background: 'none', border: '1px solid #666', color: '#ddd' }}
              onClick={onClose}
            >
              {translate('menu.back')}
            </button>
          </div>

          {/* 创建房间 */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            padding: '12px 18px',
            borderBottom: '1px solid rgba(100, 100, 100, 0.2)',
            flexWrap: 'wrap',
          }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px' }}>
              <span style={{ color: '#9aa7ae' }}>{translate('menu.online_room_name')}</span>
              <input
                type="text"
                value={createName}
                maxLength={ROOM_NAME_MAX_LENGTH}
                placeholder={DEFAULT_ROOM_NAME}
                onChange={(event) => setCreateName(normalizeRoomName(event.target.value))}
                style={{ ...inputStyle, width: '120px' }}
              />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px' }}>
              <Lock size={14} color="#9aa7ae" />
              <span style={{ color: '#9aa7ae' }}>{translate('menu.online_room_password')}</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                <input
                  type="text"
                  value={createKey}
                  maxLength={ROOM_KEY_MAX_LENGTH}
                  placeholder={translate('menu.online_room_password_none')}
                  onChange={(event) => setCreateKey(normalizeRoomKey(event.target.value))}
                  style={{ ...inputStyle, width: '100px' }}
                />
                {createKey.length > 0 && (
                  <button
                    style={iconButtonStyle}
                    title={translate('menu.online_clear_password')}
                    onClick={() => setCreateKey('')}
                  >
                    <X size={14} />
                  </button>
                )}
              </span>
            </label>
            <button
              style={{
                ...actionButtonStyle,
                marginLeft: 'auto',
              }}
              onClick={handleCreateRoom}
            >
              {translate('menu.online_create_room')}
            </button>
          </div>

          {/* 房间列表 */}
          <div style={{
            flex: 1,
            overflowY: 'auto',
            padding: '14px 18px',
            scrollbarWidth: 'thin',
            scrollbarColor: '#666 #333',
          }}>
            {!serverAddress ? (
              <div style={{ color: '#9aa7ae', fontSize: '14px' }}>{translate('menu.online_need_server')}</div>
            ) : rooms === null ? (
              <div style={{ color: '#9aa7ae', fontSize: '14px' }}>{translate('common.loading')}</div>
            ) : rooms.length === 0 ? (
              <div style={{ color: '#9aa7ae', fontSize: '14px' }}>{translate('menu.online_no_room')}</div>
            ) : (
              <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '12px',
              }}>
                {rooms.map((room) => (
                  <button
                    key={room.room_id}
                    onClick={() => handleRoomClick(room)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '10px',
                      padding: '12px 14px',
                      background: 'rgba(255, 255, 255, 0.04)',
                      border: '1px solid rgba(100, 100, 100, 0.5)',
                      borderRadius: '4px',
                      color: '#ddd',
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                    onMouseOver={(event) => {
                      event.currentTarget.style.borderColor = '#00ccff';
                      event.currentTarget.style.background = 'rgba(0, 204, 255, 0.08)';
                    }}
                    onMouseOut={(event) => {
                      event.currentTarget.style.borderColor = 'rgba(100, 100, 100, 0.5)';
                      event.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)';
                    }}
                  >
                    <span style={{
                      fontSize: '15px',
                      color: '#fff',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {room.room_name}
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: '0 0 auto' }}>
                      {Array.from({ length: ROOM_CAPACITY }, (_, index) => index).map((index) => (
                        <User
                          key={index}
                          size={16}
                          color={index < room.player_count ? '#00ccff' : '#4a4a4a'}
                          style={{ opacity: index < room.player_count ? 1 : 0.45 }}
                        />
                      ))}
                      {room.need_key && <Lock size={14} color="#f5c542" />}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* 密码弹窗 */}
      {pendingRoom && (
        <div style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.6)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 30,
        }}>
          <div style={{
            minWidth: '300px',
            padding: '20px',
            background: '#242424',
            border: '1px solid #555',
            borderRadius: '6px',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
          }}>
            <div style={{ fontSize: '16px', color: '#fff' }}>
              {translate('menu.online_password_required', { name: pendingRoom.room_name })}
            </div>
            <input
              type="text"
              autoFocus
              value={joinKeyInput}
              maxLength={ROOM_KEY_MAX_LENGTH}
              placeholder={translate('menu.online_room_password')}
              onChange={(event) => setJoinKeyInput(normalizeRoomKey(event.target.value))}
              style={{ ...inputStyle, width: '100%' }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  doJoin(pendingRoom, joinKeyInput);
                }
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                style={{ ...actionButtonStyle, background: 'none', border: '1px solid #666', color: '#ddd' }}
                onClick={() => setPendingRoom(null)}
              >
                {translate('common.cancel')}
              </button>
              <button style={actionButtonStyle} onClick={() => doJoin(pendingRoom, joinKeyInput)}>
                {translate('menu.online_join')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RoomSidebar;
