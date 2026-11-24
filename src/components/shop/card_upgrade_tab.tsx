import React, { useEffect, useMemo, useState } from 'react';
import { useLocaleMessages } from '../../hooks/useLocaleMessages';
import { useSaveManager } from '../../context/save_ctx';
import { publicUrl } from '../../utils/browser';
import { PlantLibrary } from '../../game/managers/library/PlantLibrary';
import type { PlantModel } from '../../game/models/PlantModel';
import { cardKey } from '../../i18n/keys';
import { cardBaseName, cardTextKey } from '../../i18n/cardText';
import { getUpgradeMaterials, type MaterialRequirement } from '../../game/utils/sqlite/materials';
import StuffList from './stuff_list';
import CardStatsPanel from './card_stats';
import CardAdvanceList from './card_advance_list';
import LevelBadge from '../widget/levelBadge';
import LevelBadgeStyles from '../widget/levelBadgeStyles';
import { CARD_MAX_LEVEL } from './cardStats';
import type { GoodsItem } from '../../types/goods';

interface CardEntry {
  pid: number;
  level: number;
  model: PlantModel;
  image: string;
  name: string;
}

interface Props {
  /** 进入页面时默认聚焦的卡片 pid（从图鉴跳转）。 */
  initialCardPid?: number | null;
  /** 升级消耗材料后通知外层刷新（金币/材料数量） */
  onProgressChanged?: () => void;
}

/** 背包「卡片」页：选择卡片、查看升级前后数值与进阶解锁，并消耗材料升级。 */
export default function CardUpgradeTab({ initialCardPid, onProgressChanged }: Props) {
  const saveManager = useSaveManager();
  const { translate } = useLocaleMessages();

  const [selectedPid, setSelectedPid] = useState<number | null>(initialCardPid ?? null);
  const [version, setVersion] = useState(0);
  const [materials, setMaterials] = useState<MaterialRequirement[]>([]);
  const [loadingMaterials, setLoadingMaterials] = useState(false);
  const [upgrading, setUpgrading] = useState(false);

  const cards = useMemo<CardEntry[]>(() => {
    const entries: CardEntry[] = [];
    for (const plant of saveManager.currentProgress.plants) {
      const model = PlantLibrary.GetModel(plant.pid);
      if (!model) continue;
      entries.push({
        pid: plant.pid,
        level: plant.level,
        model,
        image: `${publicUrl}/assets/card/${model.texturePath}.png`,
        name: translate(cardKey(model.nameKey)),
      });
    }
    return entries.sort((a, b) => a.pid - b.pid);
    // version 变化时重新读取存档里的等级
  }, [saveManager, translate, version]);

  const selected = cards.find(card => card.pid === selectedPid) ?? cards[0] ?? null;
  const level = selected?.level ?? 1;
  const nextLevel = level + 1;
  const isMaxLevel = level >= CARD_MAX_LEVEL;

  const base = selected ? cardBaseName(selected.model.nameKey) : '';
  const brief = base ? translate(cardTextKey.brief(base), { defaultValue: '' }) : '';
  const upgradeBrief = base ? translate(cardTextKey.upgradeBrief(base), { defaultValue: '' }) : '';

  const currentItems = useMemo<GoodsItem[]>(
    () => Array.from(saveManager.currentProgress.items.values()),
    [saveManager, version],
  );

  useEffect(() => {
    if (!selected || isMaxLevel) {
      setMaterials([]);
      setLoadingMaterials(false);
      return;
    }
    let cancelled = false;
    setLoadingMaterials(true);
    getUpgradeMaterials(selected.pid, level)
      .then(result => {
        if (!cancelled) setMaterials(result);
      })
      .catch(error => {
        console.error('加载升级材料失败', error);
        if (!cancelled) setMaterials([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingMaterials(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected?.pid, level, isMaxLevel]);

  const canUpgrade = useMemo(() => {
    if (loadingMaterials || isMaxLevel || materials.length === 0) return false;
    const owned = new Map(currentItems.map(item => [item.id, item.count]));
    return materials.every(material => (owned.get(material.type) ?? 0) >= material.count);
  }, [currentItems, isMaxLevel, loadingMaterials, materials]);

  const handleUpgrade = async () => {
    if (!selected || !canUpgrade || upgrading) return;
    setUpgrading(true);
    materials.forEach(material => {
      saveManager.updateItemCount(material.type, -material.count);
    });

    const plant = saveManager.currentProgress.plants.find(item => item.pid === selected.pid);
    if (plant) {
      plant.level = Math.min(CARD_MAX_LEVEL, plant.level + 1);
    }

    try {
      await saveManager.saveProgress();
    } catch (error) {
      console.error('保存失败:', error);
    }
    setUpgrading(false);
    setVersion(value => value + 1);
    onProgressChanged?.();
  };

  return (
    <div className="card-upgrade">
      <LevelBadgeStyles />
      <div className="card-upgrade-list">
        {cards.length === 0 ? (
          <div className="card-upgrade-empty">{translate('shop.card_no_cards')}</div>
        ) : cards.map(card => {
          const isSelected = selected?.pid === card.pid;
          return (
            <button
              key={card.pid}
              type="button"
              className={`card-upgrade-item ${isSelected ? 'active' : ''}`}
              onClick={() => setSelectedPid(card.pid)}
              title={card.name}
            >
              <span className="card-upgrade-badge">
                <LevelBadge level={card.level} className="level-badge--inline" />
              </span>
              <img src={card.image} alt={card.name} draggable="false" />
              <span className="card-upgrade-item-name">{card.name}</span>
            </button>
          );
        })}
      </div>

      <div className="card-upgrade-detail">
        {selected ? (
          <>
            <div className="card-upgrade-head">
              <img src={selected.image} alt={selected.name} draggable="false" />
              <div className="card-upgrade-head-text">
                <h2>{selected.name}</h2>
                <LevelBadge level={selected.level} className="level-badge--inline" />
              </div>
            </div>

            {brief ? <div className="card-upgrade-brief">{brief}</div> : null}

            <CardStatsPanel
              model={selected.model}
              level={level}
              compareNext={!isMaxLevel}
              title={isMaxLevel
                ? translate('shop.card_stats_level', { level })
                : translate('shop.card_stats_compare', { from: level, to: nextLevel })}
            />

            {upgradeBrief ? (
              <div className="card-upgrade-brief card-upgrade-brief--muted">{upgradeBrief}</div>
            ) : null}

            <CardAdvanceList
              base={base}
              unlockedLevel={level}
              blinkNextUnlock={!isMaxLevel}
            />

            {isMaxLevel ? (
              <div className="card-upgrade-max">{translate('shop.card_max_level')}</div>
            ) : (
              <>
                <div className="card-upgrade-materials">
                  <div className="card-upgrade-materials-title">
                    {translate('shop.card_upgrade_to', { level: nextLevel })}
                  </div>
                  <StuffList
                    items={materials.map(material => ({ id: material.type, count: material.count }))}
                    currentItems={currentItems}
                    translate={translate}
                  />
                </div>

                <button
                  type="button"
                  className="card-upgrade-button"
                  onClick={handleUpgrade}
                  disabled={!canUpgrade || upgrading}
                >
                  {loadingMaterials
                    ? translate('shop.upgrade_loading')
                    : canUpgrade
                      ? translate('shop.upgrade_button')
                      : translate('shop.upgrade_not_enough')}
                </button>
              </>
            )}
          </>
        ) : (
          <div className="card-upgrade-empty">{translate('shop.card_select_hint')}</div>
        )}
      </div>

      <style>
        {`
          .card-upgrade { height: 100%; min-height: 0; display: flex; gap: 16px; color: #eee; }
          .card-upgrade-list {
            width: 42%; min-width: 240px; height: 100%; box-sizing: border-box;
            display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
            align-content: start; gap: 8px; padding: 4px 14px 4px 4px;
            overflow-y: auto; border-right: 1px solid #444;
            scrollbar-width: thin; scrollbar-color: #888 #333;
          }
          .card-upgrade-item {
            position: relative; display: flex; flex-direction: column; align-items: center;
            gap: 4px; padding: 6px 4px; border: 1px solid #555; border-radius: 6px;
            background: #303030; color: #ddd; cursor: pointer; overflow: hidden;
            transition: border-color .15s, background .15s;
          }
          .card-upgrade-item:hover { border-color: #e0b46e; }
          .card-upgrade-item.active { border: 2px solid #f4f4f4; background: #3f5360; }
          .card-upgrade-item img { width: 100%; height: 58px; object-fit: contain; }
          .card-upgrade-item-name {
            max-width: 100%; font-size: 12px; font-weight: 700; line-height: 1.2;
            overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
          }
          .card-upgrade-badge {
            position: absolute; top: 6px; right: 6px; z-index: 5;
            display: block; width: 32px; height: 32px;
            line-height: 0; pointer-events: none;
          }
          .card-upgrade-badge .badge-wrapper {
            width: 32px; height: 32px;
          }
          .card-upgrade-detail {
            flex: 1; min-width: 0; height: 100%; padding: 4px 4px 4px 0;
            overflow-y: auto; scrollbar-width: thin; scrollbar-color: #888 #333;
          }
          .card-upgrade-head { display: flex; align-items: center; gap: 14px; margin-bottom: 12px; }
          .card-upgrade-head img { width: 84px; height: 84px; object-fit: contain; flex: 0 0 auto; }
          .card-upgrade-head-text { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
          .card-upgrade-head-text h2 { margin: 0; font-size: 22px; }
          .card-upgrade-brief {
            white-space: pre-wrap; line-height: 1.6; color: #ededed; margin-bottom: 12px;
          }
          .card-upgrade-brief--muted { color: #b8bec7; font-size: 13px; }
          .card-upgrade-materials { margin-bottom: 12px; }
          .card-upgrade-materials-title { color: #e0b46e; font-size: 13px; font-weight: 800; margin-bottom: 8px; }
          .card-upgrade-button {
            padding: 10px 26px; border: none; border-radius: 4px; color: #fff;
            font-size: 14px; font-weight: 700; cursor: pointer;
            background: #2f7fd1; transition: background .15s;
          }
          .card-upgrade-button:hover:not(:disabled) { background: #3d95ec; }
          .card-upgrade-button:disabled { background: #555; cursor: not-allowed; }
          .card-upgrade-empty { color: #8e97a3; padding: 24px; font-size: 14px; }
          .card-upgrade-max { color: #e0b46e; font-size: 14px; font-weight: 700; }
        `}
      </style>
    </div>
  );
}
