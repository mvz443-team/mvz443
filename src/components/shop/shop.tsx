// src/components/ShopSelector.tsx
import React, { useRef, useState } from 'react';
import type { Goods, GoodsItem, GoodsSaveCtx, ShopCategory } from '../../types/goods';
import { useSaveManager } from '../../context/save_ctx';
import NewGoodLists from './goods';
import { useSetState, useMount, useMemoizedFn } from 'ahooks';
import { ShopDetail, ShopList } from './shop_tab';
import BackpackTab from './backpack_tab';
import { useLocaleMessages } from '../../hooks/useLocaleMessages';
import { shopKey } from '../../i18n/keys';
import { ArrowUpFromLine, ChevronLeft, ChevronRight, Coins, FlaskConical, Layers, Package } from 'lucide-react';

interface ShopSelectorProps {
    width: number;
    height: number;
    onBack: () => void;
}

const PRIMARY_CATEGORIES = [
    { id: 'material' as const, icon: Package, accent: '#c8954a', descKey: 'shop.category_material_desc' },
    { id: 'card' as const, icon: Layers, accent: '#4fa3c7', descKey: 'shop.category_card_desc' },
    { id: 'upgrade' as const, icon: ArrowUpFromLine, accent: '#9a7fd0', descKey: 'shop.category_upgrade_desc' },
];

const ALL_CATEGORIES: ShopCategory[] = ['material', 'card', 'upgrade', 'dev'];

function GoldBadge({ amount }: { amount: number }) {
    return (
        <div className="shop-gold" title="Gold">
            <Coins size={16} />
            <span>{amount}$</span>
        </div>
    );
}

const ShopSelector: React.FC<ShopSelectorProps> = ({
    width,
    height,
    onBack,
}) => {
    const [state, setState] = useSetState({
        selectedGoodId: null as number | null,
        activeCategory: null as ShopCategory | null,
        priceFlashGoodId: null as number | null,
        forceUpdate: 0,
    });

    const purchasedIds = useRef<Set<number>>(new Set());
    const priceFlashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const gameManager = useSaveManager();
    const { translate } = useLocaleMessages();

    const handlePurchaseCallback = useMemoizedFn(async (id: number) => {
        console.log(`Item ${id} purchased`);
        try {
            await gameManager.saveProgress();
            setState(s => ({ forceUpdate: s.forceUpdate + 1 }));
        } catch (error) {
            console.error('保存失败:', error);
        }
    });

    const goodsList: Goods[] = React.useMemo(() => NewGoodLists(), []);

    const saveCtx: GoodsSaveCtx = React.useMemo(() => ({
        gameProgress: gameManager.currentProgress,
        gameManager,
        purchasedIds: purchasedIds.current,
    }), [gameManager, state.forceUpdate]);

    const getGoldAmount = useMemoizedFn((): number => {
        const goldItem = gameManager.currentProgress.items.get(1);
        return goldItem ? goldItem.count : 0;
    });

    const categoryGoods = React.useMemo(
        () => goodsList.filter(good => good.category === state.activeCategory),
        [goodsList, state.activeCategory],
    );

    const flashUnaffordablePrice = useMemoizedFn((goodId: number) => {
        if (priceFlashTimer.current) {
            clearTimeout(priceFlashTimer.current);
        }
        setState({ priceFlashGoodId: goodId });
        priceFlashTimer.current = setTimeout(() => {
            setState({ priceFlashGoodId: null });
            priceFlashTimer.current = null;
        }, 1000);
    });

    const handlePurchase = useMemoizedFn((good: Goods) => {
        if (!good.canPurchaseWithoutPrice(saveCtx)) return;
        if (!good.canPurchase(saveCtx)) {
            flashUnaffordablePrice(good.id);
            return;
        }

        const priceStructure = good.getPrice(saveCtx);
        priceStructure.items.forEach(priceItem => {
            gameManager.updateItemCount(priceItem, -priceItem.count);
        });

        good.afterBought(saveCtx);
        handlePurchaseCallback(good.id);
    });

    const handleGoodSelect = useMemoizedFn((id: number) => {
        setState({ selectedGoodId: id });
    });

    const handleCategorySelect = useMemoizedFn((category: ShopCategory) => {
        setState({ activeCategory: category, selectedGoodId: null });
    });

    useMount(() => {
        gameManager.loadProgress().then(() => {
            setState(s => ({ forceUpdate: s.forceUpdate + 1 }));
        }).catch(error => {
            console.error('加载失败:', error);
        });
    });

    const categoryName = (category: ShopCategory) => translate(shopKey(`category_${category}`));

    return (
        <div className="shop-root" style={{
            width: `${width}px`,
            height: `${height}px`,
            position: "relative",
            overflow: "hidden",
            border: "2px solid #444",
            boxShadow: "0 0 15px rgba(0, 0, 0, 0.5)",
            animation: "frameFadeIn 0.5s ease-out",
            display: "flex",
            flexDirection: "column",
        }}>
            <header className="shop-header">
                <button className="shop-back" onClick={() => {
                    if (state.activeCategory) {
                        setState({ activeCategory: null, selectedGoodId: null });
                    } else {
                        onBack();
                    }
                }}>
                    <ChevronLeft size={16} />
                    {translate(shopKey("back"))}
                </button>
                <div className="shop-title">
                    {translate(shopKey("title"))}
                    {state.activeCategory && <span className="shop-title-sub"> / {categoryName(state.activeCategory)}</span>}
                </div>
                {state.activeCategory && (
                    <nav className="shop-nav">
                        {ALL_CATEGORIES.map(category => (
                            <button
                                key={category}
                                className={`shop-nav-item ${state.activeCategory === category ? 'active' : ''} ${category === 'dev' ? 'dev' : ''}`}
                                onClick={() => handleCategorySelect(category)}
                            >
                                {categoryName(category)}
                            </button>
                        ))}
                    </nav>
                )}
                <GoldBadge amount={getGoldAmount()} />
            </header>

            {state.activeCategory === null ? (
                <div className="shop-overview">
                    <div className="shop-overview-head">
                        <h1>{translate(shopKey("title"))}</h1>
                        <p>{translate(shopKey("overview_hint"))}</p>
                    </div>
                    <div className="shop-category-grid">
                        {PRIMARY_CATEGORIES.map(({ id, icon: Icon, accent, descKey }) => (
                            <button
                                key={id}
                                className="shop-category-card"
                                style={{ '--shop-accent': accent } as React.CSSProperties}
                                onClick={() => handleCategorySelect(id)}
                            >
                                <span className="shop-category-icon"><Icon size={26} strokeWidth={1.8} /></span>
                                <span className="shop-category-name">{categoryName(id)}</span>
                                <span className="shop-category-desc">{translate(descKey)}</span>
                                <span className="shop-category-count">
                                    {translate(shopKey("category_count"), { count: goodsList.filter(good => good.category === id).length })}
                                </span>
                                <span className="shop-category-go"><ChevronRight size={20} /></span>
                            </button>
                        ))}
                    </div>
                    <div className="shop-dev-row">
                        <span className="shop-dev-hint">{translate(shopKey("dev_hint"))}</span>
                        <button className="shop-dev-card" onClick={() => handleCategorySelect('dev')}>
                            <FlaskConical size={15} />
                            {translate(shopKey("category_dev"))}
                            <ChevronRight size={15} />
                        </button>
                    </div>
                </div>
            ) : (
                <div className="shop-body">
                    <div className="shop-goods">
                        <ShopList
                            goodsList={categoryGoods}
                            selectedGoodId={state.selectedGoodId}
                            priceFlashGoodId={state.priceFlashGoodId}
                            saveCtx={saveCtx}
                            onGoodSelect={handleGoodSelect}
                        />
                    </div>
                    <div className="shop-detail">
                        <ShopDetail
                            goodsList={categoryGoods}
                            selectedGoodId={state.selectedGoodId}
                            saveCtx={saveCtx}
                            onPurchase={handlePurchase}
                        />
                    </div>
                </div>
            )}

            <style>
                {`
                  .shop-root {
                    font-family: "Segoe UI", "Microsoft YaHei", sans-serif; color: #eee;
                    background: linear-gradient(135deg, #16181e 0%, #242833 100%);
                  }
                  .shop-header {
                    flex: 0 0 auto; display: flex; align-items: center; gap: 12px;
                    padding: 10px 16px; border-bottom: 1px solid rgba(255,255,255,.1);
                    background: linear-gradient(90deg, rgba(126,30,45,.38), rgba(18,20,26,.6));
                  }
                  .shop-back {
                    display: flex; align-items: center; gap: 4px; padding: 7px 12px;
                    background: rgba(0,0,0,.3); border: 1px solid rgba(255,255,255,.16);
                    border-radius: 3px; color: #ddd; font-size: 13px; cursor: pointer;
                  }
                  .shop-back:hover { border-color: #e0b46e; color: #fff; }
                  .shop-title { font-size: 17px; font-weight: 800; letter-spacing: .08em; white-space: nowrap; }
                  .shop-title-sub { color: #e0b46e; font-size: 14px; }
                  .shop-nav { margin-left: auto; display: flex; gap: 6px; }
                  .shop-nav-item {
                    padding: 7px 13px; border: 1px solid rgba(255,255,255,.15);
                    background: rgba(0,0,0,.25); color: #c9c9c9; border-radius: 3px;
                    cursor: pointer; font-size: 13px; transition: all .18s ease;
                  }
                  .shop-nav-item:hover { border-color: #e0b46e; color: #fff; }
                  .shop-nav-item.active { border-color: #e0b46e; color: #fff; background: rgba(126,30,45,.62); }
                  .shop-nav-item.dev { opacity: .72; font-size: 12px; }
                  .shop-gold {
                    display: flex; align-items: center; gap: 6px; padding: 7px 13px;
                    background: rgba(0,0,0,.35); border: 1px solid rgba(224,176,102,.45);
                    border-radius: 3px; color: #ffd86b; font-weight: 800; font-size: 15px;
                    white-space: nowrap;
                  }
                  .shop-overview { flex: 1; min-height: 0; display: flex; flex-direction: column; padding: 3% 4%; overflow: auto; }
                  .shop-overview-head h1 { margin: 0 0 6px; font-size: clamp(24px, 3vw, 38px); letter-spacing: .12em; }
                  .shop-overview-head p { margin: 0 0 14px; color: #a9b0bb; font-size: 13px; }
                  .shop-category-grid { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 14px; }
                  .shop-category-card {
                    position: relative; min-height: 174px; padding: 16px; overflow: hidden;
                    display: flex; flex-direction: column; align-items: flex-start; gap: 12px;
                    border: 1px solid var(--shop-accent); border-radius: 6px;
                    background: linear-gradient(160deg, rgba(255,255,255,.07), rgba(0,0,0,.28));
                    color: #f0f0f0; text-align: left; cursor: pointer;
                    transition: transform .2s ease, box-shadow .2s ease;
                  }
                  .shop-category-card::after {
                    content: ''; position: absolute; right: -34px; bottom: -46px;
                    width: 150px; height: 150px; border-radius: 50%;
                    background: var(--shop-accent); opacity: .10; pointer-events: none;
                  }
                  .shop-category-card:hover { transform: translateY(-5px); box-shadow: 0 18px 40px rgba(0,0,0,.45), 0 0 22px var(--shop-accent); }
                  .shop-category-icon {
                    width: 36px; height: 36px; display: flex; align-items: center; justify-content: center;
                    border-radius: 6px; background: rgba(255,255,255,.08); color: var(--shop-accent);
                  }
                  .shop-category-name { font-size: 20px; font-weight: 800; letter-spacing: .06em; }
                  .shop-category-desc { color: #aeb6c0; font-size: 12px; line-height: 1.5; }
                  .shop-category-count { margin-top: auto; color: #7f8996; font-size: 12px; }
                  .shop-category-go { position: absolute; right: 14px; top: 14px; color: var(--shop-accent); }
                  .shop-dev-row { margin-top: auto; padding-top: 12px; display: flex; align-items: center; justify-content: flex-end; gap: 14px; }
                  .shop-dev-hint { color: #7f8996; font-size: 12px; }
                  .shop-dev-card {
                    display: flex; align-items: center; gap: 8px; padding: 9px 16px;
                    border: 1px dashed rgba(176,96,90,.6); border-radius: 3px;
                    background: rgba(176,96,90,.12); color: #e3b3ae; font-size: 13px; cursor: pointer;
                  }
                  .shop-dev-card:hover { background: rgba(176,96,90,.25); color: #fff; }
                  .shop-body { flex: 1; min-height: 0; display: flex; }
                  .shop-goods { width: 42%; min-width: 280px; max-width: 560px; height: 100%; border-right: 1px solid rgba(255,255,255,.1); }
                  .shop-detail { flex: 1; min-width: 0; height: 100%; padding: 20px; box-sizing: border-box; overflow-y: auto; scrollbar-width: thin; scrollbar-color: #888 #333; }
                  @keyframes detailSwitch {
                    from { opacity: 0; transform: translateY(8px); }
                    to { opacity: 1; transform: translateY(0); }
                  }
                  .detail-switch { animation: detailSwitch 0.18s ease-out; }
                  .shop-detail-hint {
                    display: flex; flex-direction: column; align-items: center; justify-content: center;
                    height: 100%; min-height: 260px; gap: 14px; color: #8e97a3; font-size: 14px;
                  }
                  .shop-detail-hint-mark { font-size: 40px; color: rgba(224,176,102,.35); }
                  .goods-owned-badge {
                    display: inline-block; padding: 3px 8px; border-radius: 3px;
                    background: rgba(77,191,106,.18); color: #9ad7a9; font-size: 12px; font-weight: 700;
                  }
                  @media (max-width: 820px) {
                    .shop-category-grid { grid-template-columns: 1fr; }
                    .shop-category-card { min-height: 140px; }
                    .shop-nav-item { padding: 6px 8px; font-size: 11px; }
                    .shop-goods { width: 45%; min-width: 200px; }
                  }
                `}
            </style>
        </div>
    );
};

/** 独立的背包界面：商店与背包分离后由主菜单直接进入。 */
export function InventoryPanel({ width, height, onBack }: ShopSelectorProps) {
    const gameManager = useSaveManager();
    const { translate } = useLocaleMessages();
    const [forceUpdate, setForceUpdate] = useState(0);

    useMount(() => {
        gameManager.loadProgress().then(() => setForceUpdate(value => value + 1)).catch(error => {
            console.error('加载失败:', error);
        });
    });

    const currentItems: GoodsItem[] = React.useMemo(
        () => Array.from(gameManager.currentProgress.items.values()),
        // forceUpdate 触发重新读取存档
        [gameManager, forceUpdate],
    );
    const goldItem = gameManager.currentProgress.items.get(1);

    return (
        <div className="shop-root" style={{
            width: `${width}px`,
            height: `${height}px`,
            position: 'relative',
            overflow: 'hidden',
            border: '2px solid #444',
            boxShadow: '0 0 15px rgba(0, 0, 0, 0.5)',
            animation: 'frameFadeIn 0.5s ease-out',
            display: 'flex',
            flexDirection: 'column',
        }}>
            <header className="shop-header">
                <button className="shop-back" onClick={onBack}>
                    <ChevronLeft size={16} />
                    {translate(shopKey('back'))}
                </button>
                <div className="shop-title">{translate(shopKey('inventory_title'))}</div>
                <GoldBadge amount={goldItem ? goldItem.count : 0} />
            </header>
            <div style={{ flex: 1, minHeight: 0, padding: '16px', boxSizing: 'border-box' }}>
                <BackpackTab myItems={currentItems} />
            </div>
            <style>
                {`
                  .shop-root {
                    font-family: "Segoe UI", "Microsoft YaHei", sans-serif; color: #eee;
                    background: linear-gradient(135deg, #16181e 0%, #242833 100%);
                  }
                  .shop-header {
                    flex: 0 0 auto; display: flex; align-items: center; gap: 12px;
                    padding: 10px 16px; border-bottom: 1px solid rgba(255,255,255,.1);
                    background: linear-gradient(90deg, rgba(126,30,45,.38), rgba(18,20,26,.6));
                  }
                  .shop-back {
                    display: flex; align-items: center; gap: 4px; padding: 7px 12px;
                    background: rgba(0,0,0,.3); border: 1px solid rgba(255,255,255,.16);
                    border-radius: 3px; color: #ddd; font-size: 13px; cursor: pointer;
                  }
                  .shop-back:hover { border-color: #e0b46e; color: #fff; }
                  .shop-title { font-size: 17px; font-weight: 800; letter-spacing: .08em; white-space: nowrap; }
                  .shop-gold {
                    display: flex; align-items: center; gap: 6px; padding: 7px 13px;
                    background: rgba(0,0,0,.35); border: 1px solid rgba(224,176,102,.45);
                    border-radius: 3px; color: #ffd86b; font-weight: 800; font-size: 15px;
                    white-space: nowrap; margin-left: auto;
                  }
                `}
            </style>
        </div>
    );
}

export default ShopSelector;
