import React from "react";
import { DetailGoods, PurchasedDetailGoods, SidebarGoods } from "./widget";
import type { Goods, GoodsSaveCtx } from "../../types/goods";
import { useLocaleMessages } from "../../hooks/useLocaleMessages";
import { shopKey } from "../../i18n/keys";

interface ShopListProps {
    goodsList: Goods[];
    selectedGoodId: number | null;
    priceFlashGoodId: number | null;
    saveCtx: GoodsSaveCtx;
    onGoodSelect: (id: number) => void;
}

interface ShopDetailProps {
    goodsList: Goods[];
    selectedGoodId: number | null;
    saveCtx: GoodsSaveCtx;
    onPurchase: (good: Goods) => void;
}

export function ShopList({
    goodsList,
    selectedGoodId,
    priceFlashGoodId,
    saveCtx,
    onGoodSelect,
}: ShopListProps) {
    const { translate } = useLocaleMessages();

    return (
        <div style={{
            height: "100%",
            overflowY: "auto",
            padding: "10px",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(92px, 1fr))",
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
                    {translate(shopKey("empty_goods"))}
                </div>
            ) : (
                goodsList.map(good => {
                    const hasBought = good.hasBought(saveCtx);
                    return (
                        <div key={good.id}>
                            <SidebarGoods
                                good={good}
                                saveCtx={saveCtx}
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
    saveCtx,
    onPurchase,
}: ShopDetailProps) {
    const { translate } = useLocaleMessages();
    const selectedGood = React.useMemo(() => {
        if (selectedGoodId === null) return null;
        return goodsList.find(g => g.id === selectedGoodId) ?? null;
    }, [goodsList, selectedGoodId]);

    return (
        <div
            key={selectedGoodId ?? "shop-detail-init"}
            className="detail-switch"
            style={{
                width: "100%",
                minHeight: "100%"
            }}
        >
            {selectedGoodId === null ? (
                <div className="shop-detail-hint">
                    <div className="shop-detail-hint-mark">◆</div>
                    <div>{translate(shopKey("select_good_hint"))}</div>
                </div>
            ) : selectedGood ? (
                selectedGood.hasBought(saveCtx) ? (
                    <PurchasedDetailGoods good={selectedGood} />
                ) : (
                    <DetailGoods
                        good={selectedGood}
                        saveCtx={saveCtx}
                        canAfford={selectedGood.canAfford(saveCtx)}
                        canPurchaseWithoutPrice={selectedGood.canPurchaseWithoutPrice(saveCtx)}
                        hasBought={selectedGood.hasBought(saveCtx)}
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
