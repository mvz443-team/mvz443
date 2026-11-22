import { useEffect, useState } from 'react';
import LevelSelect from './menu/levelSelect';
import { CodexFrame } from '../edx';
import Settings from './menu/settings';
import { GameParams } from '../game/models/GameParams';
import { publicUrl } from '../utils/browser';
import { useDeviceType } from '../hooks/useDeviceType';
import { onlineStateManager, OnlineStateManager } from '../store/OnlineStateManager';
import {
  PhaserEventBus,
  PhaserEvents
} from '../game/EventBus';
import Shop, { InventoryPanel } from './shop/shop';
import { Backpack, BookOpen, Info, Settings as SettingsIcon, Store } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useLocaleMessages } from '../hooks/useLocaleMessages';
import GlobalRoomListener from './GlobalRoomListener';
import { useSaveManager } from '../context/save_ctx';
import { joinRoom, leaveRoomRemotely, normalizeServerAddress, queryMyRoom } from '../utils/net/lobby';
import BackendWS from '../utils/net/sync';
import { showAlert, showConfirm } from '../utils/uiDialog';

// Docs site lives on Vercel (kept off gh-pages so it doesn't fight the game deploy).
// Override per environment with VITE_DOCS_URL if the project's domain changes.
const docsBaseUrl = (
  (import.meta.env.VITE_DOCS_URL as string | undefined) || 'https://mvz443-team.github.io/docs/'
).replace(/\/$/, '');

interface Props {
  width: number,
  height?: number,
  sceneRef: any,
  setGameParams: (gameParams: GameParams) => void,
  gameStart: () => void,
  /** PostGame 后回到原房间：直接进入关卡页并展开联机等待房间侧边栏。 */
  initialRoomView?: boolean,
};

export default function DocFrame({ width, height, setGameParams, gameStart, initialRoomView }: Props) {
  if (height === undefined) {
    height = width * 3 / 4;
  }

  // 状态管理
  const [currentView, setCurrentView] = useState(initialRoomView ? 'levels' : 'main'); // main, levels, pokedex, shop, inventory, about
  const navItems = [
    { key: 'menu.shop', icon: Store, view: 'shop' },
    { key: 'menu.inventory', icon: Backpack, view: 'inventory' },
    { key: 'menu.pokedex', icon: BookOpen, view: 'pokedex' },
    { key: 'menu.settings', icon: SettingsIcon, view: 'settings' },
    { key: 'menu.about', icon: Info, view: 'about' },
  ] as const;

  const [skipToParams, setSkipToParams] = useState(false);
  const [chosenStage, setChosenStage] = useState<number | null>(null);
  const [islord, setIslord] = useState(false);
  const { translate } = useLocaleMessages();

  const VERSION = import.meta.env.VITE_APP_VERSION ?? 'develop';
  const commitVersion = import.meta.env.VITE_APP_COMMIT ?? 'local';
  const deviceType = useDeviceType();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const saveManager = useSaveManager();

  // 主页“开始游戏”：先向服务器确认自己是否仍在某个房间里。
  const handleStartGame = async () => {
    const config = saveManager.getOnlineConfig();
    const address = normalizeServerAddress(config.serverAddr);
    if (address && config.username) {
      let membership: Awaited<ReturnType<typeof queryMyRoom>> = null;
      try {
        membership = await queryMyRoom(address, config.username);
      } catch (error) {
        // 服务器不可达 / 证书未信任：查询请求失败，不能沿用可能残留的本地房间会话。
        console.error('Query user room failed:', error);
        BackendWS.cancelReconnect();
        BackendWS.closeConnection();
        onlineStateManager.resetAllState();
        void showAlert(translate('menu.settings_server_unreachable'));
        return;
      }
      if (membership) {
        const reconnect = await showConfirm(translate('menu.online_reconnect_message'), {
          title: translate('menu.online_reconnect_title'),
          confirmText: translate('menu.online_reconnect_confirm'),
          cancelText: translate('menu.online_reconnect_cancel'),
        });
        if (reconnect) {
          BackendWS.cancelReconnect();
          BackendWS.closeConnection();
          joinRoom({
            baseUrl: address,
            roomId: membership.roomId,
            myId: membership.myId,
            key: membership.key,
            reconnect: true,
            username: config.username,
            chapterId: membership.chapterId,
            stageId: membership.stageId,
          });
          setCurrentView('levels');
          return;
        }
        BackendWS.cancelReconnect();
        await leaveRoomRemotely(address, config.username, false, { roomId: membership.roomId });
        BackendWS.closeConnection();
        onlineStateManager.resetAllState();
        void showAlert(translate('menu.online_reconnect_left'));
      }
    }
    setCurrentView('levels');
  };

  useEffect(() => {
    // 处理从其他页面跳转过来的自动选图
    const autoSelectStage = searchParams.get('autoSelectStage');
    const fromPage = searchParams.get('fromPage');

    if (autoSelectStage && fromPage) {
      const stageId = parseInt(autoSelectStage);
      if (stageId > 0) {
        console.log('🎮 检测到自动选图参数，从', decodeURIComponent(fromPage), '跳转，进入选卡界面，关卡:', stageId);
        setChosenStage(stageId);
        setSkipToParams(true);
        setCurrentView('levels');

        // 清除URL参数
        setSearchParams({});
      }
    }
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    // 监听房间信息和身份变化
    const handleLobbyJoinSuccess = (event: any) => {
      // 成功加入房间，确定身份
      const { myId } = event;
      const onlineManager = OnlineStateManager.getInstance();
      const lordId = onlineManager.getRoomInfo().lordId;
      setIslord(myId === lordId);
    };

    const handleRoomChooseMap = (event: any) => {
      // 房主选择了地图，非房主需要跳转到选卡界面
      const onlineManager = OnlineStateManager.getInstance();
      const myId = onlineManager.getRoomInfo().myId;
      const lordId = onlineManager.getRoomInfo().lordId;

      if (myId !== lordId) {
        // 非房主，跳转到选卡界面
        const { stageId } = event;
        if (stageId && stageId > 0) {
          console.log('非房主收到选图消息，跳转到选卡界面:', stageId);
          setChosenStage(stageId);
          setSkipToParams(true);
          setCurrentView('levels');
        }
      }
    };

    const handleRoomAllReady = (event: any) => {
      // 所有玩家准备就绪，进入加载阶段，应该启动游戏
      console.log('所有玩家准备就绪，即将开始加载阶段:', event);
      // 触发游戏开始 - 调用传入的gameStart函数
      if (gameStart) {
        console.log('触发游戏开始...');
        gameStart();
      }
    };

    const handleRoomAllSync = () => {
      // 重连回到 InGame 时服务端单播 roomAllSync；此时需要挂载 Phaser 让 LoadScene 直接进战局。
      if (gameStart) {
        gameStart();
      }
    };

    const handleReturnToLobby = () => {
      console.log('🔁 服务端确认返回等待房间，回到关卡页');
      setSkipToParams(false);
      setChosenStage(null);
      setCurrentView('levels');
    };

    // 通过EventBus监听事件
    PhaserEventBus.on(PhaserEvents.LobbyJoinSuccess, handleLobbyJoinSuccess);
    PhaserEventBus.on(PhaserEvents.RoomChooseMap, handleRoomChooseMap);
    PhaserEventBus.on(PhaserEvents.RoomAllReady, handleRoomAllReady);
    PhaserEventBus.on(PhaserEvents.RoomAllSync, handleRoomAllSync);
    PhaserEventBus.on(PhaserEvents.ReturnToLobby, handleReturnToLobby);

    return () => {
      PhaserEventBus.off(PhaserEvents.LobbyJoinSuccess, handleLobbyJoinSuccess);
      PhaserEventBus.off(PhaserEvents.RoomChooseMap, handleRoomChooseMap);
      PhaserEventBus.off(PhaserEvents.RoomAllReady, handleRoomAllReady);
      PhaserEventBus.off(PhaserEvents.RoomAllSync, handleRoomAllSync);
      PhaserEventBus.off(PhaserEvents.ReturnToLobby, handleReturnToLobby);
    };
  }, []);

  // 主菜单组件
  const MainMenu = () => {
    const handleNavClick = (view: string) => {
      if (view === 'settings') {
        navigate(`${publicUrl}/settings`);
      } else {
        setCurrentView(view);
      }
    };

    return (
      <div
        className={`mm-root ${deviceType === 'mobile' ? 'mm-mobile' : ''}`}
        style={{
          width: `${width}px`,
          height: `${height}px`,
          backgroundImage: `url("${publicUrl}/assets/intro.jpg")`,
          backgroundRepeat: 'no-repeat',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          position: "relative",
          overflow: "hidden",
          border: "2px solid #444",
          boxShadow: "0 0 15px rgba(0, 0, 0, 0.5)",
          animation: "frameFadeIn 0.5s ease-out"
        }}
      >
        <div className="mm-vignette" />
        <div className="mm-glow" />

        <div className="mm-brand">
          <div className="mm-brand-eyebrow">MVZ 443</div>
          <div className="mm-brand-title">{translate('menu.homepage_title')}</div>
          <div className="mm-brand-line" />
        </div>

        {/* 左侧唯一主入口：开始冒险 */}
        <button className="mm-start" onClick={() => void handleStartGame()}>
          <span className="mm-start-frame" />
          <span className="mm-start-kicker">ADVENTURE</span>
          <span className="mm-start-title">{translate('menu.start_adventure')}</span>
          <span className="mm-start-sub">{translate('menu.start_adventure_hint')}</span>
          <span className="mm-start-arrow">›</span>
        </button>

        {/* 右下角导航 */}
        <nav className="mm-nav">
          {navItems.map(({ key, icon: Icon, view }) => (
            <button key={key} className="mm-nav-item" onClick={() => handleNavClick(view)}>
              <Icon size={15} strokeWidth={1.8} />
              <span>{translate(key)}</span>
            </button>
          ))}
        </nav>
        <div className="mm-version">
          {translate('menu.homepage_version')}: v{VERSION} - COMMIT {commitVersion}
        </div>
        <div className="mm-copyright">© 2025 scarletborder.cn</div>

        {currentView === 'about' && (
          <div className="mm-overlay">
            <div className="mm-overlay-panel">
              <button className="mm-overlay-back" onClick={() => setCurrentView('main')}>
                {translate('menu.back')}
              </button>
              <h2 className="mm-overlay-title">{translate('menu.about')}</h2>
              <div className="mm-overlay-links">
                <a href={`${docsBaseUrl}/game-docs/`} target="_blank" rel="noopener noreferrer">
                  {translate('menu.docs')}
                </a>
                <a href={`${docsBaseUrl}/update-logs/`} target="_blank" rel="noopener noreferrer">
                  {translate('menu.updates')}
                </a>
              </div>
              <div className="mm-overlay-warning">{translate('menu.homepage_text')}</div>
              <div className="mm-overlay-text">
                {translate('menu.about_text', { VERSION, commitVersion })}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  // 根据当前视图渲染不同内容
  return (
    <div style={{ position: 'relative', width: `${width}px`, height: `${height}px` }}>
      <GlobalRoomListener
        setCurrentView={setCurrentView}
        setSkipToParams={setSkipToParams}
        setChosenStage={setChosenStage}
      />
      {currentView === 'main' || currentView === 'about' ? <MainMenu /> : null}
      {currentView === 'levels' && <LevelSelect width={width} height={height} onBack={() => setCurrentView('main')}
        startGame={gameStart} setGameParams={setGameParams} skipToParams={skipToParams} chosenStage={chosenStage || undefined}
        initialRoomView={initialRoomView}
      />}
      {currentView === 'pokedex' && <CodexFrame width={width} height={height} onBack={() => setCurrentView('main')} />}
      {currentView === 'shop' && <Shop width={width} height={height} onBack={() => setCurrentView('main')} />}
      {currentView === 'inventory' && <InventoryPanel width={width} height={height} onBack={() => setCurrentView('main')} />}
      {currentView === 'settings' && <Settings width={width} height={height} onBack={() => setCurrentView('main')} />}

      <style>
        {`
          @keyframes frameFadeIn {
            from { opacity: 0; transform: scale(0.98); }
            to { opacity: 1; transform: scale(1); }
          }
          @keyframes frameFadeOut {
            from { opacity: 1; transform: scale(1); }
            to { opacity: 0; transform: scale(0.98); }
          }

          .mm-root { font-family: "Segoe UI", "Microsoft YaHei", sans-serif; color: #f5f5f5; }
          .mm-vignette {
            position: absolute; inset: 0; pointer-events: none;
            background: linear-gradient(90deg, rgba(6,8,12,.86) 0%, rgba(6,8,12,.42) 34%, rgba(6,8,12,.12) 64%, rgba(6,8,12,.62) 100%),
                        linear-gradient(0deg, rgba(6,8,12,.88) 0%, rgba(6,8,12,0) 48%);
          }
          .mm-glow {
            position: absolute; left: -12%; top: 18%; width: 46%; height: 62%; pointer-events: none;
            background: radial-gradient(ellipse at center, rgba(190,58,76,.30), rgba(190,58,76,0) 68%);
          }
          .mm-brand { position: absolute; left: 5%; top: 7%; pointer-events: none; }
          .mm-brand-eyebrow { color: #dcae66; font-size: 11px; letter-spacing: .5em; font-weight: 700; }
          .mm-brand-title {
            margin-top: 8px; font-size: clamp(22px, 3vw, 42px); font-weight: 900; letter-spacing: .04em;
            text-shadow: 0 3px 14px rgba(0,0,0,.8);
          }
          .mm-brand-line {
            margin-top: 14px; width: 92px; height: 2px;
            background: linear-gradient(90deg, #dcae66, rgba(220,174,102,0));
          }
          .mm-start {
            position: absolute; left: 5%; top: 30%;
            width: clamp(200px, 22%, 280px); height: clamp(150px, 28%, 260px);
            display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px;
            background: linear-gradient(155deg, rgba(126,30,45,.94), rgba(34,12,20,.94));
            border: 1px solid rgba(224,176,102,.55); border-radius: 3px;
            box-shadow: 0 20px 45px rgba(0,0,0,.5), inset 0 0 0 1px rgba(255,255,255,.05);
            color: #fff; cursor: pointer; overflow: hidden;
            transition: transform .22s ease, box-shadow .22s ease, border-color .22s ease;
          }
          .mm-start-frame { position: absolute; inset: 7px; border: 1px solid rgba(224,176,102,.28); pointer-events: none; }
          .mm-start-kicker { color: #e6c07d; font-size: 11px; letter-spacing: .42em; font-weight: 700; }
          .mm-start-title { font-size: clamp(24px, 2.2vw, 32px); font-weight: 900; letter-spacing: .1em; white-space: nowrap; text-shadow: 0 3px 10px rgba(0,0,0,.7); }
          .mm-start-sub { color: #d7c4c7; font-size: 12px; letter-spacing: .08em; text-align: center; padding: 0 18px; }
          .mm-start-arrow { position: absolute; right: 18px; bottom: 10px; color: #e6c07d; font-size: 26px; line-height: 1; }
          .mm-start:hover { transform: translateY(-5px); border-color: #f0c884; box-shadow: 0 26px 55px rgba(0,0,0,.55), 0 0 34px rgba(214,92,92,.32); }
          .mm-nav { position: absolute; right: 3%; bottom: 32px; display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
          .mm-nav-item {
            display: flex; align-items: center; gap: 6px; padding: 9px 14px;
            background: rgba(16,20,26,.76); border: 1px solid rgba(255,255,255,.16); border-radius: 3px;
            color: #dcdcdc; font-size: 13px; cursor: pointer; backdrop-filter: blur(6px);
            transition: border-color .2s ease, color .2s ease, background .2s ease, transform .2s ease;
          }
          .mm-nav-item:hover { border-color: #e0b46e; color: #fff; background: rgba(126,30,45,.72); transform: translateY(-2px); }
          .mm-version { position: absolute; left: 5%; bottom: 54px; text-align: left; color: #b8b8b8; font-size: 12px; letter-spacing: .02em; }
          .mm-copyright { position: absolute; left: 5%; bottom: 28px; text-align: left; color: #8b8b8b; font-size: 12px; }
          .mm-overlay { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(6,8,12,.72); backdrop-filter: blur(8px); padding: 4%; }
          .mm-overlay-panel {
            width: min(720px, 92%); max-height: 92%; overflow: auto; padding: 18px 24px;
            background: linear-gradient(150deg, rgba(32,26,30,.97), rgba(16,18,24,.97));
            border: 1px solid rgba(224,176,102,.4); border-radius: 4px;
            box-shadow: 0 24px 60px rgba(0,0,0,.6); color: #e6e6e6;
            scrollbar-width: thin; scrollbar-color: #777 #333;
          }
          .mm-overlay-back { padding: 6px 14px; background: #3a3a3a; border: none; border-radius: 3px; color: #fff; cursor: pointer; font-size: 13px; }
          .mm-overlay-title { margin: 10px 0 8px; font-size: 22px; color: #f0c884; letter-spacing: .08em; }
          .mm-overlay-links { display: flex; gap: 18px; flex-wrap: wrap; margin-bottom: 10px; }
          .mm-overlay-links a { color: #7cc7e8; text-decoration: underline; font-size: 14px; }
          .mm-overlay-warning {
            margin: 0 0 10px; padding: 8px 10px; white-space: pre-wrap; line-height: 1.5;
            border-left: 3px solid #dcae66; background: rgba(220,174,102,.10);
            color: #e8d5b0; font-size: 12px;
          }
          .mm-overlay-text { white-space: pre-wrap; line-height: 1.6; font-size: 13px; user-select: text; }
          .mm-mobile .mm-nav-item { padding: 7px 9px; font-size: 11px; }
          .mm-mobile .mm-start { width: 160px; height: 170px; }
        `}
      </style>
    </div>
  );
}
