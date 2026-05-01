import React from "react";
import { GameProgress } from "../../context/save_ctx";
import { DetailGoods, InitDetail, PurchasedDetailGoods, SidebarGoods } from "./widget";
import { IGoods, item } from "./types";

interface ShopListProps {
    goodsList: IGoods[];
    selectedGoodId: number | null;
    priceFlashGoodId: number | null;
    progress: GameProgress;
    onGoodSelect: (id: number) => void;
}

interface ShopDetailProps {
    goodsList: IGoods[];
    selectedGoodId: number | null;
    progress: GameProgress;
    myItems: item[];
    couldAfford: (good: IGoods) => boolean;
    canPurchase: (progress: GameProgress, good: IGoods) => boolean;
    onPurchase: (good: IGoods) => void;
}

export function ShopList({
    goodsList,
    selectedGoodId,
    priceFlashGoodId,
    progress,
    onGoodSelect,
}: ShopListProps) {
    return (
        <div style={{
            height: "100%",
            overflowY: "auto",
            padding: "10px",
            display: "grid",
            gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
            alignContent: "start",
            gap: "8px",
            scrollbarWidth: "thin",
            scrollbarColor: "#888 #333",
        }}>
            {goodsList.length === 0 ? (
                <div style={{
                    gridColumn: "1 / -1",
                    padding: "20px",
                    textAlign: "center",
                    color: "#888",
                    fontSize: "14px"
                }}>
                    道具列表为空
                </div>
            ) : (
                goodsList.map(good => {
                    const hasBought = good.hasBought(good.id, progress);
                    return (
                        <div key={good.id}>
                            <SidebarGoods
                                good={good}
                                hasBought={hasBought}
                                priceFlash={priceFlashGoodId === good.id}
                                isChosen={(key: number) => key === selectedGoodId}
                                handleClick={onGoodSelect}
                            />
                        </div>
                    );
                })
            )}
        </div>
    );
}

export function ShopDetail({
    goodsList,
    selectedGoodId,
    progress,
    myItems,
    couldAfford,
    canPurchase,
    onPurchase,
}: ShopDetailProps) {
    const selectedGood = React.useMemo(() => {
        if (selectedGoodId === null) return null;
        return goodsList.find(g => g.id === selectedGoodId) ?? null;
    }, [goodsList, selectedGoodId]);

    return (
        <div
            key={selectedGoodId ?? "inventory-preview"}
            className="detail-switch"
            style={{
                width: "100%",
                minHeight: "100%"
            }}
        >
            {selectedGoodId === null ? (
                <InitDetail myItems={myItems} />
            ) : selectedGood ? (
                selectedGood.hasBought(selectedGood.id, progress) ? (
                    <PurchasedDetailGoods {...selectedGood} />
                ) : (
                    <DetailGoods
                        good={selectedGood}
                        canAfford={couldAfford(selectedGood)}
                        canPurchase={canPurchase(progress, selectedGood)}
                        hasBought={selectedGood.hasBought(selectedGood.id, progress)}
                        priceItems={selectedGood.getPriceStructure().items}
                        myItems={myItems}
                        handlePurchase={onPurchase}
                    />
                )
            ) : null}
        </div>
    );
}

export default function ShopTab(props: ShopListProps & ShopDetailProps) {
    return (
        <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
            <div style={{ width: "40%", minWidth: "300px", height: "100%", borderRight: "1px solid #444" }}>
                <ShopList {...props} />
            </div>
            <div
                style={{
                    flex: 1,
                    height: "100%",
                    padding: "20px",
                    overflowY: "auto",
                    overflowX: "hidden",
                    scrollbarWidth: "thin",
                    scrollbarColor: "#888 #333",
                }}
            >
                <ShopDetail {...props} />
            </div>
        </div>
    );
}
