import { useLocaleMessages } from '../../../hooks/useLocaleMessages';
import { PlantLibrary } from '../../../game/managers/library/PlantLibrary';
import { cardBaseName, cardTextKey } from '../../../i18n/cardText';
import { cardKey } from '../../../i18n/keys';
import CardAdvanceList from '../../shop/card_advance_list';

interface Props {
  pid: number;
  level: number;
  /** PC 悬浮弹窗需要标题；移动端右栏已有标题可关闭 */
  showTitle?: boolean;
}

/**
 * 选卡界面的卡片说明：简介 + 星之碎片技能 + 已解锁进阶。
 * PC 悬浮弹窗与移动端长按右栏复用同一份内容，避免两端口径不一致。
 */
export default function CardInfoContent({ pid, level, showTitle = true }: Props) {
  const { translate } = useLocaleMessages();
  const model = PlantLibrary.GetModel(pid);
  if (!model) return null;

  const base = cardBaseName(model.nameKey);
  const brief = translate(cardTextKey.brief(base), { defaultValue: '' });
  const skill = translate(cardTextKey.starshards(base), { defaultValue: '' });

  return (
    <div className="card-info">
      {showTitle ? (
        <div className="card-info-head">
          <span className="card-info-name">{translate(cardKey(model.nameKey))}</span>
          <span className="card-info-level">Lv.{level}</span>
        </div>
      ) : null}

      {brief ? <div className="card-info-brief">{brief}</div> : null}

      {skill ? (
        <div className="card-info-skill">
          <span className="card-info-skill-label">{translate('shop.card_section_skill')}</span>
          <div>{skill}</div>
        </div>
      ) : null}

      <CardAdvanceList base={base} unlockedLevel={level} onlyUnlocked />

      <style>
        {`
          .card-info { color: #e6e6e6; white-space: pre-wrap; }
          .card-info-head {
            display: flex; align-items: center; justify-content: space-between;
            gap: 10px; margin-bottom: 10px;
          }
          .card-info-name { font-size: 16px; font-weight: 800; letter-spacing: .04em; }
          .card-info-level { color: #e0b46e; font-size: 12px; font-weight: 800; }
          .card-info-brief { line-height: 1.6; font-size: 13px; margin-bottom: 10px; }
          .card-info-skill {
            margin-bottom: 10px; padding-left: 9px; border-left: 3px solid #e0b46e;
            line-height: 1.6; font-size: 13px; color: #dedede;
          }
          .card-info-skill-label {
            display: block; color: #e0b46e; font-size: 11px;
            font-weight: 800; letter-spacing: .08em; margin-bottom: 2px;
          }
        `}
      </style>
    </div>
  );
}
