/**
 * 在这里放商店页面的控件
 */

import React from "react";
import { useLocaleMessages } from "../../hooks/useLocaleMessages";
import { useDeviceType } from "../../hooks/useDeviceType";
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
    const deviceType = useDeviceType();
    const isMobile = deviceType === 'mobile';

    return (
        <div style={{ color: "#fff", paddingRight: "8px" }}>
            <div style={{
                display: "flex",
                flexDirection: isMobile ? "column" : "row",
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
                        width: isMobile ? "100%" : "auto",
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
                <div style={{ minWidth: 0, flex: 1, width: isMobile ? "100%" : undefined }}>
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
