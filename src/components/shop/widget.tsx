/**
 * 在这里放商店页面的控件
 */

import React from "react";
import { useLocaleMessages } from "../../hooks/useLocaleMessages";
import { goodsKey, shopKey, stuffKey } from "../../i18n/keys";
import { publicAssetUrl } from "../../utils/browser";
import StuffList, { CurrentStuffs } from "./stuff_list";
import {
    goodsItemIconKey,
    goodsItemName,
    unknownGoodsItemIconKey,
    type Goods,
    type GoodsCondition,
    type GoodsItem,
    type GoodsSaveCtx,
} from "../../types/goods";
import { Check, Coins, Layers2, LockKeyhole, Package, ShoppingBag } from "lucide-react";


interface SidebarGoodsProps {
    good: Goods,
    saveCtx: GoodsSaveCtx,
    hasBought: boolean,
    priceFlash: boolean,
    isChosen: (key: number) => boolean,
    handleClick: (key: number) => void,
}

/**
 * 商品列表
 */
export function SidebarGoods({ good, saveCtx, hasBought, priceFlash, isChosen, handleClick }: SidebarGoodsProps) {
    const { translate } = useLocaleMessages();
    const name = translate(goodsKey(good.nameKey));
    const iconUrl = publicAssetUrl(good.iconKey);
    const priceItems = good.getPrice(saveCtx).items;
    const goldPrice = priceItems.find(item => item.id === 1)?.count ?? 0;
    const hasMaterialPrice = priceItems.some(item => item.id !== 1);
    const priceColor = priceFlash ? "#ff4040" : hasMaterialPrice ? "#ffd84a" : "#f6f6f6";
    const locked = !hasBought && !good.canPurchaseWithoutPrice(saveCtx);

    return (<div
        style={{
            position: "relative",
            aspectRatio: "1 / 1.22",
            padding: "4px",
            background: isChosen(good.id) ? "#3f5360" : "#2c2f36",
            border: isChosen(good.id) ? "2px solid #f0c884" : "1px solid #555",
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
        title={name}
    >
        <img
            src={iconUrl}
            alt={name}
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
        {locked && (
            <div style={{
                position: "absolute",
                top: "3px",
                left: "4px",
                padding: "2px 5px",
                borderRadius: "3px",
                background: "rgba(160,54,54,.9)",
                color: "#fff",
                display: "flex",
                alignItems: "center",
                gap: "3px",
                whiteSpace: "nowrap",
                fontSize: "10px"
            }}>
                <LockKeyhole size={10} />
                {translate(shopKey("locked_badge"))}
            </div>
        )}
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


function conditionIcon(condition: GoodsCondition) {
    switch (condition.type) {
        case 'level': return <LockKeyhole size={14} />;
        case 'slots': return <Layers2 size={14} />;
        case 'gold': return <Coins size={14} />;
        case 'material': return <Package size={14} />;
    }
}

function conditionText(
    condition: GoodsCondition,
    translate: (key: string, params?: Record<string, string | number>) => string,
): string {
    const suffix = condition.met ? '_met' : '';
    switch (condition.type) {
        case 'level':
            return translate(shopKey(`condition_level${suffix}`), { level: condition.levelId });
        case 'slots':
            return translate(shopKey(`condition_slots${suffix}`), {
                current: condition.current,
                required: condition.required,
            });
        case 'gold':
            return translate(shopKey(`condition_gold${suffix}`), {
                current: condition.current,
                required: condition.required,
            });
        case 'material': {
            const items = condition.items
                .map(entry => `${goodsItemName(entry.item, translate)} ${entry.current}/${entry.required}`)
                .join('、');
            return translate(shopKey(`condition_material${suffix}`), { items });
        }
    }
}

/** 逐行展示购买条件；未满足项置顶并高亮。 */
export function ConditionList({ conditions }: { conditions: GoodsCondition[] }) {
    const { translate } = useLocaleMessages();
    const ordered = [...conditions].sort((a, b) => Number(a.met) - Number(b.met));

    return (
        <div className="goods-conditions">
            <div className="goods-section-title">{translate(shopKey("conditions_title"))}</div>
            {ordered.map((condition, index) => (
                <div key={index} className={`condition-row ${condition.met ? 'met' : 'unmet'}`}>
                    <span className="condition-icon">
                        {condition.met ? <Check size={13} /> : conditionIcon(condition)}
                    </span>
                    <span className="condition-text">{conditionText(condition, translate)}</span>
                    {!condition.met && (
                        <span className="condition-tag">{translate(shopKey("condition_unmet"))}</span>
                    )}
                </div>
            ))}
            <style>
                {`
                  .goods-conditions { margin: 8px 0; }
                  .goods-section-title {
                    color: #e0b46e; font-size: 13px; font-weight: 800; letter-spacing: .12em;
                    padding-bottom: 4px; margin-bottom: 6px; border-bottom: 1px solid rgba(255,255,255,.12);
                  }
                  .condition-row {
                    display: flex; align-items: center; gap: 9px; padding: 5px 9px; margin-bottom: 4px;
                    border-radius: 4px; font-size: 13px; line-height: 1.4;
                  }
                  .condition-row.unmet { background: rgba(150,48,48,.16); border: 1px solid rgba(220,90,90,.35); color: #ffc9c9; }
                  .condition-row.met { background: rgba(60,120,80,.12); border: 1px solid rgba(110,190,130,.22); color: #bcd9c4; }
                  .condition-icon { display: flex; align-items: center; opacity: .9; }
                  .condition-text { flex: 1; }
                  .condition-tag {
                    flex: 0 0 auto; padding: 2px 6px; border-radius: 3px;
                    background: rgba(220,90,90,.25); color: #ffd7d7; font-size: 11px;
                  }
                `}
            </style>
        </div>
    );
}

interface DetailGoodsProps {
    good: Goods,
    saveCtx: GoodsSaveCtx,
    canAfford: boolean,
    canPurchaseWithoutPrice: boolean,
    hasBought: boolean,
    handlePurchase: (good: Goods) => void,
}

export function DetailGoods({ good, saveCtx, canAfford, canPurchaseWithoutPrice, hasBought,
    handlePurchase }: DetailGoodsProps) {
    const { translate } = useLocaleMessages();
    const name = translate(goodsKey(good.nameKey));
    const description = translate(goodsKey(good.descriptionKey));
    const iconUrl = publicAssetUrl(good.iconKey);
    const unmetConditions = good.getConditions(saveCtx).filter(condition => !condition.met);
    const goldUnmet = unmetConditions.some(condition => condition.type === 'gold');
    const materialUnmet = unmetConditions.some(condition => condition.type === 'material');
    const unaffordableText = goldUnmet && materialUnmet
        ? translate(shopKey("resource_insufficient"))
        : goldUnmet
            ? translate(shopKey("gold_insufficient"))
            : translate(shopKey("cannot_afford"));
    const purchaseText = hasBought
        ? translate(shopKey("purchased"))
        : !canPurchaseWithoutPrice
            ? translate(shopKey("locked"))
            : !canAfford
                ? unaffordableText
                : translate(shopKey("purchase"));
    const unmetCount = unmetConditions.length;

    return (
        <div className="goods-detail">
            <div className="goods-hero">
                <div className="goods-hero-icon">
                    <img src={iconUrl} alt={name} draggable="false" />
                </div>
                <div className="goods-hero-meta">
                    <div className="goods-category">{translate(shopKey(`category_${good.category}`))}</div>
                    <h2>{name}</h2>
                    {!canPurchaseWithoutPrice && (
                        <span className="goods-locked-badge">{translate(shopKey("locked_badge"))}</span>
                    )}
                </div>
            </div>
            <p className="goods-desc">{description}</p>
            <ConditionList conditions={good.getConditions(saveCtx)} />
            <button
                disabled={hasBought || !canPurchaseWithoutPrice}
                onClick={() => handlePurchase(good)}
                className={`goods-buy ${canAfford && canPurchaseWithoutPrice && !hasBought ? 'ready' : ''}`}
                title={unmetCount > 0 ? translate(shopKey("condition_unmet_hint"), { count: unmetCount }) : undefined}
            >
                <ShoppingBag size={16} />
                {purchaseText}
            </button>
            <style>
                {`
                  .goods-detail { color: #fff; padding-right: 8px; }
                  .goods-hero {
                    display: flex; align-items: center; gap: 12px; padding: 10px;
                    background: linear-gradient(135deg, rgba(126,30,45,.28), rgba(255,255,255,.04));
                    border: 1px solid rgba(224,176,102,.28); border-radius: 6px;
                  }
                  .goods-hero-icon {
                    width: 64px; height: 64px; flex: 0 0 auto; border-radius: 6px;
                    background: rgba(0,0,0,.3); display: flex; align-items: center; justify-content: center;
                  }
                  .goods-hero-icon img { width: 56px; height: 56px; object-fit: contain; }
                  .goods-hero-meta { min-width: 0; }
                  .goods-category { color: #e0b46e; font-size: 12px; letter-spacing: .16em; font-weight: 700; }
                  .goods-hero-meta h2 { margin: 8px 0; font-size: 26px; letter-spacing: .04em; }
                  .goods-locked-badge {
                    display: inline-block; padding: 3px 8px; border-radius: 3px;
                    background: rgba(160,54,54,.8); color: #fff; font-size: 12px; font-weight: 700;
                  }
                  .goods-desc { margin: 8px 0 0; line-height: 1.5; color: #d6d6d6; font-size: 14px; }
                  .goods-buy {
                    display: inline-flex; align-items: center; gap: 8px; padding: 9px 22px;
                    border: 1px solid rgba(255,255,255,.16); border-radius: 4px;
                    background: #5a5a5a; color: #e8e8e8; font-size: 15px; font-weight: 800; cursor: not-allowed;
                  }
                  .goods-buy.ready {
                    background: linear-gradient(135deg, #a83244, #7a1f30);
                    border-color: #e0b46e; color: #fff; cursor: pointer;
                    box-shadow: 0 8px 20px rgba(0,0,0,.35);
                  }
                  .goods-buy.ready:hover { filter: brightness(1.15); }
                `}
            </style>
        </div>
    );
}


interface PurchasedDetailGoodsProps {
    good: Goods,
}

export function PurchasedDetailGoods({ good }: PurchasedDetailGoodsProps) {
    const { translate } = useLocaleMessages();
    const name = translate(goodsKey(good.nameKey));
    const description = translate(goodsKey(good.descriptionKey));
    const iconUrl = publicAssetUrl(good.iconKey);

    return (
        <div className="goods-detail">
            <div className="goods-hero">
                <div className="goods-hero-icon">
                    <img src={iconUrl} alt={name} draggable="false" style={{ opacity: 0.75 }} />
                </div>
                <div className="goods-hero-meta">
                    <div className="goods-category">{translate(shopKey(`category_${good.category}`))}</div>
                    <h2>{name}</h2>
                    <span className="goods-owned-badge">{translate(shopKey("purchased"))}</span>
                </div>
            </div>
            <p className="goods-desc">{description}</p>
        </div>
    );
}

interface initDetailProps {
    myItems: GoodsItem[],
}


export function InitDetail({ myItems }: initDetailProps) {
    const { translate } = useLocaleMessages();
    const fallbackUnknownIcon = (event: React.SyntheticEvent<HTMLImageElement>) => {
        event.currentTarget.src = unknownGoodsItemIconKey();
    };

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
                src={goodsItemIconKey({ id: 1, count: 0, nameKey: "gold", iconKey: "gold" })}
                alt={translate(stuffKey("gold"))}
                onError={fallbackUnknownIcon}
                style={{ width: "38px", height: "38px", objectFit: "contain" }}
                draggable="false"
            />
            <h2 style={{ margin: 0, fontSize: "22px" }}>{translate(shopKey("material_backpack"))}</h2>
        </div>
        {CurrentStuffs(myItems, translate)}
        <StuffList items={[]} currentItems={myItems} translate={translate} />
    </div>)
}
