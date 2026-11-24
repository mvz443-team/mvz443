import { useEffect, useRef, useState } from 'react';
import { useCreation, useMemoizedFn, useUpdateEffect, useSetState } from 'ahooks';
import { useSaveManager } from '../../context/save_ctx';
import { publicUrl } from '../../utils/browser';
import { useLocaleMessages } from '../../hooks/useLocaleMessages';
import { cardKey } from '../../i18n/keys';
import { cardBaseName, cardTextKey } from '../../i18n/cardText';
import { PlantLibrary } from '../../game/managers/library/PlantLibrary';
import type { PlantModel } from '../../game/models/PlantModel';
import { useDeviceType } from '../../hooks/useDeviceType';
import CardStatsPanel from '../shop/card_stats';
import CardAdvanceList from '../shop/card_advance_list';

interface Props {
  width: number;
  height?: number;
  onBack: () => void;
  /**
   * 右栏标题上方的额外内容（图鉴的 Phaser 预览）。
   * 传 null 表示当前没有选中项。
   */
  renderPreview?: (item: { pid: number; level: number } | null) => React.ReactNode;
  /** 打开背包卡片页并聚焦指定卡片；不传则不渲染入口按钮。 */
  onOpenInventory?: (pid: number) => void;
}

interface PokedexItem {
  pid: number;
  nameKey: string;
  image: string;
  level: number;
  model: PlantModel;
}

export default function Pokedex({ width, height, onBack, renderPreview, onOpenInventory }: Props) {
  if (height === undefined) {
    height = width * 3 / 4;
  }

  const [state, setState] = useSetState({
    pokedexItems: new Map<number, PokedexItem>(),
    selectedItemPid: null as number | null,
    animationClass: '',
    selectedItem: null as PokedexItem | null,
  });

  // 预览等级：默认跟随卡片当前等级，点击 1-9 按钮可查看任意等级数据。
  const [viewLevel, setViewLevel] = useState<number | null>(null);

  // 新增：下一个将要显示的项目（在动画完成后才会显示）
  const nextItemRef = useRef<PokedexItem | null>(null);

  // 跟踪是否正在进行动画
  const isAnimating = useRef(false);
  // 新增：用于跟踪和取消动画定时器
  const animationTimersRef = useRef<{ main?: number, enter?: number, finish?: number }>({});

  const saveManager = useSaveManager();
  const { translate } = useLocaleMessages();
  const deviceType = useDeviceType();

  const plants = saveManager.currentProgress.plants;

  const isMobile = deviceType === 'mobile';
  // 左侧图鉴固定每排 5 个，卡片宽度随容器自适应。
  const itemsPerRow = 5;
  // 使用 useCreation 来管理 pokedexItems
  const pokedexItems = useCreation(() => {
    const tmpMap = new Map<number, PokedexItem>();
    plants.sort((a, b) => a.pid - b.pid)
      .map((plant) => {
        const plantModel = PlantLibrary.GetModel(plant.pid);
        if (!plantModel) {
          console.warn(`Plant model not found for pid ${plant.pid}`);
          return null;
        }
        tmpMap.set(plant.pid, {
          pid: plant.pid,
          nameKey: plantModel.nameKey,
          image: `${publicUrl}/assets/card/${plantModel.texturePath}.png`,
          level: plant.level,
          model: plantModel,
        });
      });
    return tmpMap;
  }, [plants]);

  // 带预览时默认选中第一个器械：否则右栏只剩一个空场地，看不出任何东西。
  const autoSelected = useRef(false);
  useEffect(() => {
    if (!renderPreview || autoSelected.current) return;
    const first = pokedexItems.keys().next();
    if (first.done) return;
    autoSelected.current = true;
    setState({ selectedItemPid: first.value });
  }, [pokedexItems, renderPreview, setState]);

  // 清除所有动画定时器的辅助函数
  const clearAnimationTimers = useMemoizedFn(() => {
    if (animationTimersRef.current.main) {
      clearTimeout(animationTimersRef.current.main);
    }
    if (animationTimersRef.current.enter) {
      clearTimeout(animationTimersRef.current.enter);
    }
    if (animationTimersRef.current.finish) {
      clearTimeout(animationTimersRef.current.finish);
    }
    animationTimersRef.current = {};
  });

  // 修改：处理选中项目变化的逻辑
  useUpdateEffect(() => {
    if (state.selectedItemPid === null) return;

    // 清除任何正在进行的动画定时器
    clearAnimationTimers();

    // 查找将要显示的新项目，但先不设置到selectedItem
    const nextItem = pokedexItems.get(state.selectedItemPid) || null;
    nextItemRef.current = nextItem;

    // 如果当前没有选中项，说明是首次选择，直接设置
    if (!state.selectedItem) {
      setState({ selectedItem: nextItem });
      return;
    }

    // 开始退出动画
    isAnimating.current = true;
    setState({ animationClass: 'slide-out' });

    // 等待退出动画完成后，更新显示内容并开始进入动画
    animationTimersRef.current.main = window.setTimeout(() => {
      // 更新当前显示的项目为下一个项目
      setState({ selectedItem: nextItemRef.current });

      // 延迟一小段时间后开始进入动画，确保DOM已更新
      animationTimersRef.current.enter = window.setTimeout(() => {
        setState({ animationClass: 'slide-in' });

        // 在进入动画完成后标记动画结束
        animationTimersRef.current.finish = window.setTimeout(() => {
          isAnimating.current = false;
        }, 400); // 匹配slide-in动画持续时间
      }, 50);

    }, 300); // 匹配slide-out动画持续时间

    return () => clearAnimationTimers();
  }, [state.selectedItemPid, pokedexItems]);

  // 选择一个新的项目（已修改）
  const selectItem = useMemoizedFn((pid: number) => {
    // 如果点击的是当前已选中的项目，不做任何处理
    if (pid === state.selectedItemPid) return;

    // 即使动画正在进行中，也允许选择新项目
    // 之前的动画会被新的动画取消
    setState({ selectedItemPid: pid });
  });

  // 切换卡片时，预览等级回到该卡片自己的当前等级。
  useEffect(() => {
    setViewLevel(state.selectedItem ? state.selectedItem.level : null);
  }, [state.selectedItem?.pid, state.selectedItem?.level]);

  const activeLevel = viewLevel ?? state.selectedItem?.level ?? 1;

  // 图鉴预览固定在右栏顶部（标题上方），不随详情内容滚动。
  const previewSlot = renderPreview
    ? renderPreview(
      state.selectedItem
        ? { pid: state.selectedItem.pid, level: activeLevel }
        : null,
    )
    : null;

  // 文案按区块拆开：简介 / 星之碎片技能 / 背景故事；缺失的区块返回空串后不渲染。
  const selectedBase = state.selectedItem ? cardBaseName(state.selectedItem.nameKey) : '';
  const selectedBrief = selectedBase ? translate(cardTextKey.brief(selectedBase), { defaultValue: '' }) : '';
  const selectedSkill = selectedBase ? translate(cardTextKey.starshards(selectedBase), { defaultValue: '' }) : '';
  const selectedStory = selectedBase ? translate(cardTextKey.story(selectedBase), { defaultValue: '' }) : '';

  return (
    <div style={{
      width: `${width}px`,
      height: `${height}px`,
      background: "linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%)",
      position: "relative",
      overflow: "hidden",
      border: "2px solid #444",
      boxShadow: "0 0 15px rgba(0, 0, 0, 0.5)",
      animation: "frameFadeIn 0.5s ease-out",
      whiteSpace: "pre-wrap",
      display: "flex",
      flexDirection: "column"
    }}>
      <div style={{
        flex: 1,
        minHeight: 0,
        display: "flex"
      }}>
        <div style={{
          width: "40%",
          minWidth: "300px",
          height: "100%",
          boxSizing: "border-box",
          borderRight: "1px solid #444",
          padding: "10px",
          display: "flex",
          flexDirection: 'column',
          gap: '8px',
        }}>
          <div style={{
            height: "52px",
            minHeight: "52px",
            borderBottom: "1px solid #444",
            padding: "6px 4px",
            display: "flex",
            alignItems: "center",
            gap: "8px"
          }}>
            <button
              style={{
                padding: "6px 10px",
                background: "#444",
                border: "none",
                color: "#fff",
                cursor: "pointer",
                borderRadius: "4px",
                fontSize: "14px"
              }}
              onClick={onBack}
            >
              {translate('menu.back')}
            </button>
            <h2 style={{
              margin: 0,
              color: "#ddd",
              fontSize: "18px",
              fontWeight: 700
            }}>{translate('edx.plants')}</h2>
            {onOpenInventory && state.selectedItemPid !== null ? (
              <button
                style={{
                  marginLeft: 'auto',
                  padding: '6px 10px',
                  background: 'rgba(79,163,199,.16)',
                  border: '1px solid #4fa3c7',
                  color: '#9fd4ea',
                  cursor: 'pointer',
                  borderRadius: '4px',
                  fontSize: '12px',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                }}
                onClick={() => onOpenInventory(state.selectedItemPid as number)}
              >
                {translate('edx.view_in_backpack')}
              </button>
            ) : null}
          </div>

          <div style={{
            flex: 1,
            minHeight: 0,
            display: 'grid',
            gridTemplateColumns: `repeat(${itemsPerRow}, minmax(0, 1fr))`,
            alignContent: "start",
            gap: "8px",
            overflowY: 'auto',
            scrollbarWidth: 'thin',
            scrollbarColor: '#888 #333',
          }}>
            {Array.from(pokedexItems.keys()).map((pid) => {
              const item = pokedexItems.get(pid);
              const isChosen = pid === state.selectedItemPid;

              return (
                <div
                  key={pid}
                  style={{
                    boxSizing: 'border-box',
                    position: "relative",
                    width: '100%',
                    minWidth: 0,
                    aspectRatio: "1 / 1.22",
                    textAlign: 'center',
                    cursor: 'pointer',
                    background: isChosen ? "#3f5360" : "#303030",
                    border: isChosen ? "2px solid #f4f4f4" : "1px solid #555",
                    borderRadius: "6px",
                    padding: '4px',
                    transition: 'border-color 0.15s, background 0.15s',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    overflow: "hidden"
                  }}
                  onClick={() => selectItem(pid)}
                  title={item ? translate(cardKey(item.nameKey)) : undefined}
                >
                  {item && (
                    <img
                      src={item.image}
                      alt={translate(cardKey(item.nameKey))}
                      style={{
                        width: "100%",
                        height: "70%",
                        objectFit: "contain"
                      }}
                      draggable="false"
                    />
                  )}
                  <div style={{
                    color: "#ddd",
                    fontSize: "12px",
                    fontWeight: 700,
                    lineHeight: 1,
                    maxWidth: "100%",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    textShadow: "0 1px 2px #000"
                  }}>
                    {item ? translate(cardKey(item.nameKey)) : ""}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div style={{
          flex: 1,
          minWidth: 0,
          height: "100%",
          boxSizing: "border-box",
          // 底部留白收窄，让下方详情滚动区尽量贴到面板底边。
          padding: isMobile ? "16px 16px 10px" : "20px 20px 10px",
          color: "#ddd",
          background: "rgba(30, 30, 30, 0.9)",
          display: 'flex',
          flexDirection: 'column'
        }}>
          {previewSlot ? (
            <div style={{
              marginBottom: '10px',
              flex: '0 0 50%',
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
            }}>
              {previewSlot}
            </div>
          ) : null}
          <div className={state.animationClass} style={{
            position: "relative",
            width: "100%",
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            scrollbarWidth: "thin",
            scrollbarColor: "#888 #333",
          }}>
            <div className="pokedex-detail-head">
              <h2>
                {state.selectedItem ? translate(cardKey(state.selectedItem.nameKey)) : '未选择'}
              </h2>
            </div>

            {state.selectedItem ? (
              <>
                {selectedBrief ? (
                  <div className="pokedex-brief">{selectedBrief}</div>
                ) : null}
                {selectedSkill ? (
                  <div className="pokedex-section">
                    <span className="pokedex-section-label">{translate('shop.card_section_skill')}</span>
                    <div>{selectedSkill}</div>
                  </div>
                ) : null}
                {selectedStory ? (
                  <div className="pokedex-story">{selectedStory}</div>
                ) : null}
                <CardStatsPanel
                  model={state.selectedItem.model}
                  level={activeLevel}
                  title={translate('shop.card_stats_base')}
                  headerRight={(
                    <div className="pokedex-levels">
                      {Array.from({ length: 9 }, (_, index) => index + 1).map(level => (
                        <button
                          key={level}
                          type="button"
                          className={`pokedex-level-btn ${level === activeLevel ? 'active' : ''}`}
                          onClick={() => setViewLevel(level)}
                        >
                          {level}
                        </button>
                      ))}
                    </div>
                  )}
                />
                <CardAdvanceList base={selectedBase} unlockedLevel={activeLevel} />
              </>
            ) : (
              <div style={{ paddingTop: '40px', textAlign: 'center', color: '#888' }}>
                请选择左侧项目查看详情
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 样式定义（修复格式问题） */}
      <style>
        {`
                    @keyframes frameFadeIn {
                        from { opacity: 0; transform: scale(0.95); }
                        to { opacity: 1; transform: scale(1); }
                    }

                    /* 从下往上滑出的动画 */
                    @keyframes slideOut {
                        0% { transform: translateY(0); opacity: 1; }
                        100% { transform: translateY(-20px); opacity: 0; }
                    }

                    /* 从下往上滑入的动画 */
                    @keyframes slideIn {
                        0% { transform: translateY(100%); opacity: 0; }
                        100% { transform: translateY(0); opacity: 1; }
                    }

                    .slide-out {
                        animation: slideOut 0.3s cubic-bezier(0.4, 0, 0.2, 1) forwards;
                    }
                    
                    .slide-in {
                        animation: slideIn 0.4s cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
                    }

                    .pokedex-brief {
                        white-space: pre-wrap;
                        margin-bottom: 14px;
                        color: #ededed;
                        line-height: 1.6;
                    }

                    .pokedex-section {
                        margin-bottom: 14px;
                        padding-left: 10px;
                        border-left: 3px solid #e0b46e;
                        color: #dedede;
                        line-height: 1.6;
                    }

                    .pokedex-section-label {
                        display: block;
                        color: #e0b46e;
                        font-size: 12px;
                        font-weight: 800;
                        letter-spacing: .08em;
                        margin-bottom: 2px;
                    }

                    .pokedex-story {
                        white-space: pre-wrap;
                        margin-bottom: 16px;
                        padding: 10px 12px;
                        border-radius: 6px;
                        background: rgba(255,255,255,.04);
                        color: #9fa8b3;
                        font-size: 13px;
                        line-height: 1.7;
                    }

                    .pokedex-detail-head {
                        display: flex;
                        align-items: center;
                        flex-wrap: wrap;
                        gap: 8px 12px;
                        margin-bottom: 10px;
                    }

                    .pokedex-detail-head h2 {
                        margin: 0;
                        flex: 1 1 auto;
                        min-width: 0;
                    }

                    .pokedex-levels {
                        display: flex;
                        flex-wrap: wrap;
                        gap: 4px;
                        flex: 0 0 auto;
                        margin-left: auto;
                    }

                    .pokedex-level-btn {
                        width: 26px;
                        height: 26px;
                        padding: 0;
                        border: 1px solid #555;
                        border-radius: 4px;
                        background: #111;
                        color: #8a9099;
                        font-size: 13px;
                        font-weight: 700;
                        line-height: 1;
                        cursor: pointer;
                        transition: background .15s, color .15s, border-color .15s;
                    }

                    .pokedex-level-btn:hover {
                        border-color: #b98a2e;
                        color: #d8c39a;
                    }

                    .pokedex-level-btn.active {
                        background: #b98a2e;
                        border-color: #d9a94a;
                        color: #fff;
                        box-shadow: 0 0 6px rgba(217, 169, 74, .5);
                    }

                    /* 滚动条样式美化 */
                    ::-webkit-scrollbar {
                        width: 8px;
                    }
                    
                    ::-webkit-scrollbar-track {
                        background: rgba(30, 30, 30, 0.5);
                        border-radius: 4px;
                    }
                    
                    ::-webkit-scrollbar-thumb {
                        background: #666;
                        border-radius: 4px;
                    }
                    
                    ::-webkit-scrollbar-thumb:hover {
                        background: #888;
                    }

                    .badge-wrapper {
                        position: absolute;
                        top: 2px;
                        left: 2px;
                        width: 24px;
                        height: 24px;
                        z-index: 5;
                        pointer-events: none;
                        transition: transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);
                    }

                    .badge-body {
                        width: 100%;
                        height: 100%;
                        position: relative;
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        overflow: hidden;
                    }

                    .badge-body::after {
                        content: '';
                        position: absolute;
                        inset: 0;
                        background: linear-gradient(135deg, rgba(255, 255, 255, 0.7) 0%, rgba(255, 255, 255, 0) 40%, rgba(0, 0, 0, 0) 60%, rgba(0, 0, 0, 0.3) 100%);
                        pointer-events: none;
                        z-index: 2;
                    }

                    .sweep-light {
                        position: absolute;
                        top: -50%;
                        left: -50%;
                        width: 200%;
                        height: 200%;
                        background: linear-gradient(to right, rgba(255, 255, 255, 0) 0%, rgba(255, 255, 255, 0.8) 50%, rgba(255, 255, 255, 0) 100%);
                        transform: rotate(45deg) translateX(-100%);
                        animation: badgeSweep 3.5s infinite cubic-bezier(0.4, 0, 0.2, 1);
                        z-index: 3;
                        pointer-events: none;
                    }

                    .badge-text {
                        font-size: 13px;
                        font-weight: 900;
                        line-height: 1;
                        letter-spacing: -0.5px;
                        font-family: 'Arial Black', Impact, 'Segoe UI', sans-serif;
                        position: relative;
                        z-index: 4;
                    }

                    .shape-star {
                        clip-path: polygon(50% 4%, 70% 32%, 96% 42%, 76% 68%, 82% 96%, 50% 82%, 18% 96%, 24% 68%, 4% 42%, 30% 32%);
                    }

                    .shape-diamond {
                        clip-path: polygon(15% 10%, 85% 10%, 100% 45%, 50% 98%, 0% 45%);
                    }

                    .shape-star .badge-text {
                        transform: translateY(1px);
                    }

                    .shape-diamond .badge-text {
                        transform: translateY(-1px);
                    }

                    .badge-wrapper:not(.level-badge--inline) .shape-star .badge-text {
                        transform: translate(-0.8px, 1px);
                    }

                    .badge-wrapper:not(.level-badge--inline) .shape-diamond .badge-text {
                        transform: translate(-0.8px, -1px);
                    }

                    .shadow-brown {
                        filter: drop-shadow(0 1.5px 0 #3e1c00) drop-shadow(0 -1.5px 0 #3e1c00) drop-shadow(1.5px 0 0 #3e1c00) drop-shadow(-1.5px 0 0 #3e1c00) drop-shadow(0 3px 4px rgba(0, 0, 0, 0.6));
                    }

                    .bg-tier1 {
                        background: radial-gradient(circle at 50% 50%, #ffe845 0%, #ffaa00 40%, #853c00 100%);
                    }

                    .text-tier1 {
                        color: #4a2200;
                        text-shadow: 0 1px 0 rgba(255, 255, 255, 0.4);
                    }

                    .shadow-black {
                        filter: drop-shadow(0 1.5px 0 #000) drop-shadow(0 -1.5px 0 #000) drop-shadow(1.5px 0 0 #000) drop-shadow(-1.5px 0 0 #000) drop-shadow(0 3px 4px rgba(0, 0, 0, 0.6));
                    }

                    .bg-tier2 {
                        background: radial-gradient(circle at 50% 50%, #ffffff 0%, #b0b0b0 40%, #222222 100%);
                    }

                    .text-tier2 {
                        color: #111111;
                        text-shadow: 0 1px 1px rgba(255, 255, 255, 0.8);
                    }

                    .shadow-blue {
                        filter: drop-shadow(0 1.5px 0 #003a8c) drop-shadow(0 -1.5px 0 #003a8c) drop-shadow(1.5px 0 0 #003a8c) drop-shadow(-1.5px 0 0 #003a8c) drop-shadow(0 0 8px #00aaff);
                    }

                    .bg-tier3 {
                        background: radial-gradient(circle at 50% 40%, #7dedff 0%, #c4f4ff 45%, #ffffff 100%);
                    }

                    .text-tier3 {
                        color: #ffffff;
                        text-shadow: -1px -1px 0 #004bb5, 1px -1px 0 #004bb5, -1px 1px 0 #004bb5, 1px 1px 0 #004bb5, 0 2px 2px rgba(0, 0, 0, 0.5);
                    }

                    .shadow-pink {
                        filter: drop-shadow(0 1.5px 0 #8c0054) drop-shadow(0 -1.5px 0 #8c0054) drop-shadow(1.5px 0 0 #8c0054) drop-shadow(-1.5px 0 0 #8c0054) drop-shadow(0 0 9px #ff33aa);
                    }

                    .bg-tier4 {
                        background: radial-gradient(circle at 50% 40%, #ff5ce6 0%, #ffbcf1 45%, #ffffff 100%);
                    }

                    .text-tier4 {
                        color: #ff33aa;
                        text-shadow: -1px -1px 0 #ffffff, 1px -1px 0 #ffffff, -1px 1px 0 #ffffff, 1px 1px 0 #ffffff, 0 2px 0 #a1005a, 0 3px 3px rgba(0, 0, 0, 0.5);
                    }

                    @keyframes badgeSweep {
                        0% { transform: rotate(45deg) translateX(-100%); }
                        20% { transform: rotate(45deg) translateX(100%); }
                        100% { transform: rotate(45deg) translateX(100%); }
                    }

                    .level-badge--inline {
                        position: relative;
                        top: auto;
                        left: auto;
                        flex: 0 0 auto;
                    }
                `}
      </style>
    </div>
  );
}
