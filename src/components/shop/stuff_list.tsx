import Stuff from "../../constants/stuffs";
import { getItemIcon } from "./assets";
import { item } from "./types";

type Props = {
    items: item[]
    currentItems: item[]
    translate: (key: string, params?: Record<string, string>) => string
}

export default function StuffList({ items, currentItems, translate }: Props) {
    // Convert currentItems into a map for efficient lookup
    const currentItemsMap = new Map(currentItems.map(item => [item.type, item.count]));


    const stuffItem = (type: number, requiredCount: number) => {
        const availableCount = currentItemsMap.get(type) || 0;
        const isInsufficient = requiredCount > availableCount;

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
                    src={getItemIcon(type)}
                    alt={Stuff(type, translate)}
                    style={{ width: '24px', height: '24px', objectFit: 'contain' }}
                    draggable="false"
                />
                <span>{`${Stuff(type, translate)}: ${availableCount}/${requiredCount}`}</span>
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
                    {stuffItem(item.type, item.count)}
                </div>
            ))}
        </div>
    );
}

export function CurrentStuffs(items: item[], translate: (key: string, params?: Record<string, string>) => string) {

    return (
        <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(52px, 1fr))',
            gap: '8px',
            width: '100%'
        }}>
            {items.map((item, index) => (
                <div key={index} title={Stuff(item.type, translate)} style={{
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
                        src={getItemIcon(item.type)}
                        alt={Stuff(item.type, translate)}
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
