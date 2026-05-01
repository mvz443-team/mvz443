import { useRef } from 'react';
import { useCreation, useMemoizedFn, useUpdateEffect, useSetState } from 'ahooks';
import { useSaveManager } from '../../context/save_ctx';
import { publicUrl } from '../../utils/browser';
import { item } from '../shop/types';
import StuffList from '../shop/stuff_list';
import { getUpgradeMaterials, MaterialRequirement } from '../../game/utils/sqlite/materials';
import { useLocaleMessages } from '../../hooks/useLocaleMessages';
import { cardKey } from '../../i18n/keys';
import { PlantLibrary } from '../../game/managers/library/PlantLibrary';
import LevelBadge from '../widget/levelBadge';
import { useDeviceType } from '../../hooks/useDeviceType';

interface Props {
  width: number;
  height?: number;
  onBack: () => void;
}

interface PokedexItem {
  pid: number;
  nameKey: string;
  descriptionKey: string;
  image: string;
  level: number;
}

export default function Pokedex({ width, height, onBack }: Props) {
  if (height === undefined) {
    height = width * 3 / 4;
  }

  const [state, setState] = useSetState({
    pokedexItems: new Map<number, PokedexItem>(),
    selectedItemPid: null as number | null,
    animationClass: '',
    upgradeMaterials: [] as MaterialRequirement[],
    loadingMaterials: false,
    selectedItem: null as PokedexItem | null,
  });

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
          descriptionKey: plantModel.descriptionKey,
          image: `${publicUrl}/assets/card/${plantModel.texturePath}.png`,
          level: plant.level,
        });
      });
    return tmpMap;
  }, [plants]);

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

  // 加载升级材料
  useUpdateEffect(() => {
    if (!state.selectedItem) {
      setState({ upgradeMaterials: [] });
      return;
    }

    setState({ loadingMaterials: true });
    getUpgradeMaterials(state.selectedItem.pid, state.selectedItem.level)
      .then(mats => setState({ upgradeMaterials: mats }))
      .catch(err => {
        console.error('加载升级材料失败', err);
        setState({ upgradeMaterials: [] });
      })
      .finally(() => setState({ loadingMaterials: false }));
  }, [state.selectedItem]);

  const getCurrentItems = useMemoizedFn((): item[] => {
    return Array.from(saveManager.currentProgress.items.values());
  });

  const canUpgrade = useMemoizedFn((): boolean => {
    if (state.loadingMaterials || !state.selectedItem) return false;
    const currentItems = getCurrentItems();
    const currentMap = new Map(currentItems.map(i => [i.type, i.count]));
    return state.upgradeMaterials.length > 0 && state.upgradeMaterials.every(mat => (currentMap.get(mat.type) || 0) >= mat.count);
  });

  const handleUpgrade = useMemoizedFn(async () => {
    // 防止动画过渡中点击或重复点击
    if (isAnimating.current || !state.selectedItem || !canUpgrade()) return;

    // 使用状态中保存的 selectedItem，而不是每次重新查找
    const { pid, level } = state.selectedItem;

    state.upgradeMaterials.forEach(mat => {
      saveManager.updateItemCount(mat.type, -mat.count);
    });

    const plantIndex = plants.findIndex(p => p.pid === pid && p.level === level);
    if (plantIndex !== -1) {
      // 更新植物等级
      plants[plantIndex].level += 1;
      try {
        await saveManager.saveProgress();
      } catch (error) {
        console.error('保存失败:', error);
      }

      // 更新项目列表
      const newLevel = level + 1;

      // 更新pokedexItems集合中的对应项
      setState(prev => {
        const newMap = new Map(prev.pokedexItems);
        if (newMap.has(pid)) {
          const item = newMap.get(pid)!;
          newMap.set(pid, { ...item, level: newLevel });
        }
        return { pokedexItems: newMap };
      });

      // 直接更新选中项，只更新level值
      setState(prev => ({
        selectedItem: prev.selectedItem ? {
          ...prev.selectedItem,
          level: newLevel
        } : null
      }));
    }
  });

  // 选择一个新的项目（已修改）
  const selectItem = useMemoizedFn((pid: number) => {
    // 如果点击的是当前已选中的项目，不做任何处理
    if (pid === state.selectedItemPid) return;

    // 即使动画正在进行中，也允许选择新项目
    // 之前的动画会被新的动画取消
    setState({ selectedItemPid: pid });
  });

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
            }}>图鉴</h2>
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
                    <>
                      <LevelBadge level={item.level} />
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
                    </>
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
          height: "100%",
          boxSizing: "border-box",
          padding: isMobile ? "16px" : "20px",
          color: "#ddd",
          background: "rgba(30, 30, 30, 0.9)",
          display: 'flex',
          flexDirection: 'column'
        }}>
          <div className={state.animationClass} style={{
            position: "relative",
            width: "100%",
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            scrollbarWidth: "thin",
            scrollbarColor: "#888 #333",
          }}>
            <h2 style={{ marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              {state.selectedItem ? (
                <>
                  <span>{translate(cardKey(state.selectedItem.nameKey))}</span>
                  <LevelBadge level={state.selectedItem.level} className="level-badge--inline" />
                </>
              ) : '未选择'}
            </h2>

            {state.selectedItem ? (
              <>
                <div style={{ whiteSpace: 'pre-wrap', marginBottom: '16px' }}>
                  {translate(cardKey(state.selectedItem.descriptionKey))}
                </div>
                <hr style={{ borderColor: '#666', margin: '16px 0' }} />
                <div>
                  <h3 style={{ margin: '0 0 12px 0' }}>
                    升级到 LV.{state.selectedItem.level + 1}
                  </h3>
                  {/* 材料列表 */}
                  <StuffList
                    items={state.upgradeMaterials}
                    currentItems={getCurrentItems()}
                    translate={translate}
                  />

                  {/* 升级按钮 - 使用新的handleUpgrade函数，不依赖selected参数 */}
                  <button
                    onClick={handleUpgrade}
                    disabled={!canUpgrade()}
                    style={{
                      padding: '10px 24px',
                      marginTop: '16px',
                      border: 'none',
                      borderRadius: '4px',
                      background: canUpgrade() ? '#007bff' : '#555',
                      color: '#fff',
                      cursor: canUpgrade() ? 'pointer' : 'not-allowed',
                      opacity: state.loadingMaterials ? 0.6 : 1,
                    }}
                  >
                    {state.loadingMaterials ? '加载中...' : (canUpgrade() ? '升级' : '材料不足')}
                  </button>
                </div>
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
