import type React from "react";
import {
    goodsItemIconKey,
    goodsItemName,
    unknownGoodsItemIconKey,
    type GoodsItem,
} from "../../types/goods";

type Props = {
    items: GoodsItem[]
    currentItems: GoodsItem[]
    translate: (key: string, params?: Record<string, string>) => string
}

export default function StuffList({ items, currentItems, translate }: Props) {
    // Convert currentItems into a map for efficient lookup
    const currentItemsMap = new Map(currentItems.map(item => [item.id, item.count]));

    const fallbackUnknownIcon = (event: React.SyntheticEvent<HTMLImageElement>) => {
        event.currentTarget.src = unknownGoodsItemIconKey();
    };

    const stuffItem = (item: GoodsItem) => {
        const requiredCount = item.count;
        const availableCount = currentItemsMap.get(item.id) || 0;
        const isInsufficient = requiredCount > availableCount;
        const name = goodsItemName(item, translate);

        return (
            <div style={{
                color: isInsufficient ? '#ff6868' : '#f3f3f3',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                minHeight: '28px',
                whiteSpace: 'nowrap'
            }}>
                <img
                    src={goodsItemIconKey(item)}
                    alt={name}
                    onError={fallbackUnknownIcon}
                    style={{ width: '24px', height: '24px', objectFit: 'contain' }}
                    draggable="false"
                />
                <span>{`${name}: ${availableCount}/${requiredCount}`}</span>
            </div>
        );
    }

    return (
        <div style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '8px 14px',
            alignItems: 'center'
        }}>
            {items.map((item, index) => (
                <div key={index}>
                    {stuffItem(item)}
                </div>
            ))}
        </div>
    );
}

export function CurrentStuffs(items: GoodsItem[], translate: (key: string, params?: Record<string, string>) => string) {
    const fallbackUnknownIcon = (event: React.SyntheticEvent<HTMLImageElement>) => {
        event.currentTarget.src = unknownGoodsItemIconKey();
    };

    return (
        <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(52px, 1fr))',
            gap: '8px',
            width: '100%'
        }}>
            {items.map((item, index) => (
                <div key={index} title={goodsItemName(item, translate)} style={{
                    position: 'relative',
                    height: '52px',
                    border: '1px solid #555',
                    borderRadius: '6px',
                    background: '#2d2d2d',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                }}>
                    <img
                        src={goodsItemIconKey(item)}
                        alt={goodsItemName(item, translate)}
                        onError={fallbackUnknownIcon}
                        style={{ width: '34px', height: '34px', objectFit: 'contain' }}
                        draggable="false"
                    />
                    <span style={{
                        position: 'absolute',
                        right: '4px',
                        bottom: '2px',
                        color: '#fff',
                        fontSize: '11px',
                        fontWeight: 700,
                        textShadow: '0 1px 2px #000'
                    }}>{item.count}</span>
                </div>
            ))}
        </div>
    );
}
