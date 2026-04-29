/**
 * 在这里放商店页面的控件
 */

import React, { useEffect, useState } from "react";
import Stuff from "../../constants/stuffs";
import { useLocaleMessages } from "../../hooks/useLocaleMessages";
import { getItemIcon } from "./assets";
import StuffList, { CurrentStuffs } from "./stuff_list";
import { IGoods, item } from "./types";


interface SidebarGoodsProps {
    good: IGoods,
    hasBought: boolean,
    priceFlash: boolean,
    isChosen: (key: number) => boolean,
    handleClick: (key: number) => void,
}

/**
 * 商品列表
 */
export function SidebarGoods({ good, hasBought, priceFlash, isChosen, handleClick }: SidebarGoodsProps) {
    const priceItems = good.getPriceStructure().items;
    const goldPrice = priceItems.find(item => item.type === 1)?.count ?? 0;
    const hasMaterialPrice = priceItems.some(item => item.type !== 1);
    const priceColor = priceFlash ? "#ff4040" : hasMaterialPrice ? "#ffd84a" : "#f6f6f6";

    return (<div
        style={{
            position: "relative",
            aspectRatio: "1 / 1.22",
            padding: "4px",
            background: isChosen(good.id) ? "#3f5360" : "#303030",
            border: isChosen(good.id) ? "2px solid #f4f4f4" : "1px solid #555",
            borderRadius: "6px",
            cursor: "pointer",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            alignItems: "center",
            overflow: "hidden",
            opacity: hasBought ? 0.48 : 1,
            transition: "border-color 0.15s, background 0.15s, opacity 0.15s"
        }}
        onClick={() => {
            handleClick(good.id);
        }}
        title={good.name}
    >
        <img
            src={good.icon}
            alt={good.name}
            style={{
                width: "100%",
                height: "70%",
                objectFit: "contain",
                filter: hasBought ? "grayscale(0.4)" : "none"
            }}
            draggable="false"
        />
        <div style={{
            color: priceColor,
            fontSize: "12px",
            fontWeight: 700,
            lineHeight: 1,
            textShadow: "0 1px 2px #000"
        }}>
            {goldPrice}${hasMaterialPrice ? "*" : ""}
        </div>
        {hasBought && (
            <div style={{
                position: "absolute",
                top: "3px",
                right: "4px",
                width: "18px",
                height: "18px",
                borderRadius: "50%",
                background: "#4dbf6a",
                color: "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "13px",
                fontWeight: 900
            }}>✓</div>
        )}
    </div>)
}


interface DetailGoodsProps {
    good: IGoods,
    canAfford: boolean,
    canPurchase: boolean,
    hasBought: boolean,

    priceItems: item[],
    myItems: item[],

    handlePurchase: (good: IGoods) => void,
}

export function DetailGoods({ good, canAfford, canPurchase, hasBought,
    priceItems, myItems, handlePurchase }: DetailGoodsProps) {
    const { translate } = useLocaleMessages();

    return (
        <div style={{ color: "#fff", paddingRight: "8px" }}>
            <div style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "16px",
                marginBottom: "16px",
                padding: "12px",
                background: "rgba(255, 255, 255, 0.05)",
                border: "1px solid rgba(255, 255, 255, 0.12)",
                borderRadius: "6px"
            }}>
                <button
                    disabled={hasBought || !canPurchase}
                    onClick={() => handlePurchase(good)}
                    style={{
                        flex: "0 0 auto",
                        padding: "10px 18px",
                        background: hasBought || !canPurchase ? "#666" : canAfford ? "#2178d6" : "#8b3a3a",
                        border: "none",
                        color: "#fff",
                        cursor: hasBought || !canPurchase ? "not-allowed" : "pointer",
                        borderRadius: "5px",
                        fontWeight: 700
                    }}
                >
                    {hasBought ? "Purchased" : !canAfford ? "Cannot Afford" : "Purchase"}
                </button>
                <div style={{ minWidth: 0, flex: 1 }}>
                    <StuffList
                        items={priceItems}
                        currentItems={myItems}
                        translate={translate}
                    />
                </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "14px", marginBottom: "14px" }}>
                <img
                    src={good.icon}
                    alt={good.name}
                    style={{ width: "76px", height: "76px", objectFit: "contain" }}
                    draggable="false"
                />
                <div>
                    <h2 style={{ margin: "0 0 6px", fontSize: "24px" }}>{good.name}</h2>
                    {!canPurchase && <span style={{
                        color: "#ff6a6a",
                        fontSize: "15px",
                        fontWeight: "bold"
                    }}>未解锁</span>}
                </div>
            </div>

            <p style={{ margin: 0, lineHeight: 1.6 }}>{good.description()}</p>
        </div>
    );
}



export function PurchasedDetailGoods(good: IGoods) {
    return (
        <div style={{ color: "#fff" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "14px", marginBottom: "14px" }}>
                <img
                    src={good.icon}
                    alt={good.name}
                    style={{ width: "76px", height: "76px", objectFit: "contain", opacity: 0.75 }}
                    draggable="false"
                />
                <h2 style={{ margin: 0 }}>{good.name}</h2>
            </div>
            <p style={{ lineHeight: 1.6 }}>{good.description()}</p>
        </div>
    );
}

interface initDetailProps {
    myItems: item[],
}


export function InitDetail({ myItems }: initDetailProps) {
    const { translate } = useLocaleMessages();

    return (<div
        style={{
            minHeight: "100%",
            padding: "4px",
            color: "#fff",
            fontSize: "14px",
        }}
    >
        <div style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            marginBottom: "14px"
        }}>
            <img
                src={getItemIcon(1)}
                alt="gold"
                style={{ width: "38px", height: "38px", objectFit: "contain" }}
                draggable="false"
            />
            <h2 style={{ margin: 0, fontSize: "22px" }}>材料背包</h2>
        </div>
        {CurrentStuffs(myItems, translate)}
    </div>)
}

interface InventoryViewProps {
    myItems: item[],
}

export function InventoryView({ myItems }: InventoryViewProps) {
    const { translate } = useLocaleMessages();
    const [selectedType, setSelectedType] = useState<number | null>(myItems[0]?.type ?? null);
    const selectedItem = myItems.find(item => item.type === selectedType) ?? myItems[0] ?? null;

    useEffect(() => {
        if (myItems.length === 0) {
            setSelectedType(null);
            return;
        }
        if (!myItems.some(item => item.type === selectedType)) {
            setSelectedType(myItems[0].type);
        }
    }, [myItems, selectedType]);

    return (
        <div style={{
            height: "100%",
            color: "#fff",
            display: "flex",
            flexDirection: "column",
            gap: "12px"
        }}>
            <div style={{
                height: "70%",
                overflowY: "auto",
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(58px, 1fr))",
                alignContent: "start",
                gap: "8px",
                padding: "4px",
                scrollbarWidth: "thin",
                scrollbarColor: "#888 #333"
            }}>
                {myItems.length === 0 ? (
                    <div style={{ color: "#999", padding: "16px" }}>背包为空</div>
                ) : myItems.map(item => {
                    const isSelected = selectedItem?.type === item.type;
                    const name = Stuff(item.type, translate);
                    return (
                        <button
                            key={item.type}
                            onClick={() => setSelectedType(item.type)}
                            title={name}
                            style={{
                                position: "relative",
                                height: "58px",
                                border: isSelected ? "2px solid #fff" : "1px solid #555",
                                borderRadius: "6px",
                                background: isSelected ? "#3f5360" : "#303030",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                cursor: "pointer",
                                padding: 0
                            }}
                        >
                            <img
                                src={getItemIcon(item.type)}
                                alt={name}
                                style={{ width: "38px", height: "38px", objectFit: "contain" }}
                                draggable="false"
                            />
                            <span style={{
                                position: "absolute",
                                right: "4px",
                                bottom: "2px",
                                color: "#fff",
                                fontSize: "11px",
                                fontWeight: 700,
                                textShadow: "0 1px 2px #000"
                            }}>{item.count}</span>
                        </button>
                    );
                })}
            </div>

            <div style={{
                height: "30%",
                minHeight: 0,
                borderTop: "1px solid #444",
                paddingTop: "12px",
                display: "flex",
                gap: "14px",
                alignItems: "center",
                overflow: "hidden"
            }}>
                {selectedItem ? (
                    <>
                        <img
                            src={getItemIcon(selectedItem.type)}
                            alt={Stuff(selectedItem.type, translate)}
                            style={{ width: "72px", height: "72px", objectFit: "contain" }}
                            draggable="false"
                        />
                        <div style={{ minWidth: 0 }}>
                            <h2 style={{ margin: "0 0 8px", fontSize: "22px" }}>
                                {Stuff(selectedItem.type, translate)}
                            </h2>
                            <div style={{ color: "#d6d6d6", fontSize: "15px" }}>数量: {selectedItem.count}</div>
                            <div style={{ color: "#9e9e9e", fontSize: "13px", marginTop: "4px" }}>Type ID: {selectedItem.type}</div>
                        </div>
                    </>
                ) : (
                    <div style={{ color: "#999" }}>没有可显示的物品</div>
                )}
            </div>
        </div>
    );
}

