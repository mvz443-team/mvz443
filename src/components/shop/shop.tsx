// src/components/ShopSelector.tsx
import React, { useRef } from 'react';
import { item, IGoods } from './types';
import { GameProgress, useSaveManager } from '../../context/save_ctx';
import NewGoodLists from './goods';
import { useSetState, useMount, useMemoizedFn } from 'ahooks';
import { ShopDetail, ShopList } from './shop_tab';
import { BackpackDetail, BackpackList, useBackpackSelection } from './backpack_tab';

interface ShopSelectorProps {
    width: number;
    height: number;
    onBack: () => void;
}

const ShopSelector: React.FC<ShopSelectorProps> = ({
    width,
    height,
    onBack,
}) => {
    const [state, setState] = useSetState({
        selectedGoodId: null as number | null,
        showInventory: false,
        priceFlashGoodId: null as number | null,
        forceUpdate: 0,
    });
    
    const purchasedIds = useRef<Set<number>>(new Set());
    const priceFlashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const gameManager = useSaveManager();

    const handlePurchaseCallback = useMemoizedFn(async (id: number) => {
        console.log(`Item ${id} purchased`);
        try {
            await gameManager.saveProgress();
            setState(s => ({ forceUpdate: s.forceUpdate + 1 }));
        } catch (error) {
            console.error('保存失败:', error);
        }
    });

    const goodsList: IGoods[] = React.useMemo(() =>
        NewGoodLists(purchasedIds.current, handlePurchaseCallback),
        [state.forceUpdate]
    );

    const getCurrentItems = useMemoizedFn((): item[] => {
        return Array.from(gameManager.currentProgress.items.values());
    });

    const getGoldAmount = useMemoizedFn((): number => {
        const goldItem = gameManager.currentProgress.items.get(1);
        return goldItem ? goldItem.count : 0;
    });

    const couldAfford = useMemoizedFn((good: IGoods): boolean => {
        const priceStructure = good.getPriceStructure();
        const currentItems = getCurrentItems();
        return priceStructure.items.every(priceItem => {
            const inventoryItem = currentItems.find(item => item.type === priceItem.type);
            return inventoryItem && inventoryItem.count >= priceItem.count;
        });
    });

    const canPurchase = useMemoizedFn((progress: GameProgress, good: IGoods): boolean => {
        return good.canPurchase(progress);
    });

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

    const handlePurchase = useMemoizedFn((good: IGoods) => {
        if (good.hasBought(good.id, gameManager.currentProgress)) return;
        if (!canPurchase(gameManager.currentProgress, good)) return;
        if (!couldAfford(good)) {
            flashUnaffordablePrice(good.id);
            return;
        }

        const priceStructure = good.getPriceStructure();
        priceStructure.items.forEach(priceItem => {
            gameManager.updateItemCount(priceItem.type, -priceItem.count);
        });

        good.afterBought(good.id, gameManager);
        handlePurchaseCallback(good.id);
    });

    const handleGoodSelect = useMemoizedFn((id: number) => {
        setState({ selectedGoodId: id });
    });

    useMount(() => {
        gameManager.loadProgress().then(() => {
            setState(s => ({ forceUpdate: s.forceUpdate + 1 }));
        }).catch(error => {
            console.error('加载失败:', error);
        });
    });

    const currentItems = getCurrentItems();
    const backpackSelection = useBackpackSelection(currentItems);

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
            display: "flex"
        }}>
            <div style={{
                width: "40%",
                minWidth: "320px",
                maxWidth: "520px",
                height: "100%",
                display: "flex",
                flexDirection: "column",
                borderRight: "1px solid #444",
                minHeight: 0
            }}>
                <div style={{
                    height: "58px",
                    minHeight: "58px",
                    borderBottom: "1px solid #444",
                    padding: "10px",
                    display: "flex",
                    alignItems: "center",
                    gap: "10px"
                }}>
                    <button
                        onClick={onBack}
                        style={{
                            padding: "6px 10px",
                            background: "#444",
                            border: "none",
                            color: "#fff",
                            cursor: "pointer",
                            borderRadius: "4px",
                            fontSize: "14px",
                            flex: "0 0 auto"
                        }}
                    >
                        Back
                    </button>

                    <button
                        onClick={() => {
                            setState(prevState => ({
                                showInventory: !prevState.showInventory,
                                selectedGoodId: null
                            }));
                        }}
                        style={{
                            padding: "6px 10px",
                            backgroundColor: state.showInventory ? "#72B063" : "#719AAC",
                            color: "#fff",
                            border: "none",
                            borderRadius: "4px",
                            fontSize: "14px",
                            cursor: "pointer",
                            flex: "0 0 auto"
                        }}
                    >
                        {state.showInventory ? "回到商店" : "显示背包"}
                    </button>

                    <div
                        onClick={() => {
                            setState({ selectedGoodId: null });
                        }}
                        style={{
                            marginLeft: "auto",
                            display: "flex",
                            justifyContent: "center",
                            alignItems: "center",
                            backgroundColor: "#444",
                            color: "#fff",
                            borderRadius: "4px",
                            padding: "6px 12px",
                            fontSize: "14px",
                            minWidth: "96px",
                            cursor: "pointer",
                            flex: "0 0 auto"
                        }}
                    >
                        <span style={{
                            color: "#ffd700",
                            fontSize: "16px",
                            fontWeight: "bold",
                        }}>
                            {getGoldAmount()}$
                        </span>
                    </div>
                </div>
                <div style={{
                    flex: 1,
                    minHeight: 0,
                    overflow: "hidden"
                }}>
                    {state.showInventory ? (
                        <BackpackList
                            myItems={currentItems}
                            selectedType={backpackSelection.selectedType}
                            selectedItem={backpackSelection.selectedItem}
                            onSelectType={backpackSelection.setSelectedType}
                        />
                    ) : (
                        <ShopList
                            goodsList={goodsList}
                            selectedGoodId={state.selectedGoodId}
                            priceFlashGoodId={state.priceFlashGoodId}
                            progress={gameManager.currentProgress}
                            onGoodSelect={handleGoodSelect}
                        />
                    )}
                </div>
            </div>

            <div
                style={{
                    flex: 1,
                    height: "100%",
                    minWidth: 0,
                    padding: "20px",
                    boxSizing: "border-box",
                    overflowY: state.showInventory ? "hidden" : "auto",
                    overflowX: "hidden",
                    scrollbarWidth: "thin",
                    scrollbarColor: "#888 #333",
                }}
            >
                {state.showInventory ? (
                    <BackpackDetail selectedItem={backpackSelection.selectedItem} />
                ) : (
                    <ShopDetail
                        goodsList={goodsList}
                        selectedGoodId={state.selectedGoodId}
                        progress={gameManager.currentProgress}
                        myItems={currentItems}
                        couldAfford={couldAfford}
                        canPurchase={canPurchase}
                        onPurchase={handlePurchase}
                    />
                )}
            </div>

            <style>
                {`
                    @keyframes frameFadeIn {
                        from { opacity: 0; transform: scale(0.95); }
                        to { opacity: 1; transform: scale(1); }
                    }
                    @keyframes detailSwitch {
                        from { opacity: 0; transform: translateY(8px); }
                        to { opacity: 1; transform: translateY(0); }
                    }
                    .detail-switch {
                        animation: detailSwitch 0.18s ease-out;
                    }
                    ::-webkit-scrollbar {
                        width: 8px;
                        height: 8px;
                    }
                    ::-webkit-scrollbar-track {
                        background: rgba(50, 50, 50, 0.5);
                        border-radius: 4px;
                    }
                    ::-webkit-scrollbar-thumb {
                        background: #666;
                        border-radius: 4px;
                    }
                    ::-webkit-scrollbar-thumb:hover {
                        background: #777;
                    }
                `}
            </style>
        </div >
    );
};

export default ShopSelector;
