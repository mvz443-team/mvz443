import type { ReactNode } from 'react';
import { useLocaleMessages } from '../../hooks/useLocaleMessages';
import type { PlantModel } from '../../game/models/PlantModel';
import { buildCardStatRows } from './cardStats';

interface Props {
  model: PlantModel;
  level: number;
  /** true 时并列展示下一级数值并高亮变化项 */
  compareNext?: boolean;
  /** 面板标题；不传则不渲染标题 */
  title?: string;
  /** 标题行右侧的额外内容（图鉴的 1-9 等级按钮） */
  headerRight?: ReactNode;
}

/** 卡片基础数值面板：血量 / 伤害 / 冷却 / 能量开销，可选对比下一级。 */
export default function CardStatsPanel({ model, level, compareNext = false, title, headerRight }: Props) {
  const { translate } = useLocaleMessages();
  const rows = buildCardStatRows(model, level, compareNext);

  return (
    <div className="card-stats">
      {title || headerRight ? (
        <div className="card-stats-head">
          {title ? <div className="card-stats-title">{title}</div> : null}
          {headerRight ? <div className="card-stats-head-extra">{headerRight}</div> : null}
        </div>
      ) : null}
      <div className="card-stats-grid">
        {rows.map(row => (
          <div key={row.key} className={`card-stat ${row.changed ? 'card-stat--changed' : ''}`}>
            <span className="card-stat-label">{translate(row.labelKey)}</span>
            <span className="card-stat-values">
              <span className="card-stat-current">{row.current}</span>
              {row.next !== null && row.changed ? (
                <>
                  <span className="card-stat-arrow">→</span>
                  <span className="card-stat-next">{row.next}</span>
                </>
              ) : null}
            </span>
          </div>
        ))}
      </div>
      <style>
        {`
          .card-stats {
            border: 1px solid rgba(224,176,102,.35);
            border-radius: 6px;
            background: rgba(0,0,0,.28);
            padding: 12px 14px;
            margin-bottom: 14px;
          }
          .card-stats-head {
            display: flex;
            align-items: center;
            flex-wrap: wrap;
            gap: 8px 10px;
            margin-bottom: 10px;
          }
          .card-stats-title {
            color: #e0b46e;
            font-size: 13px;
            font-weight: 800;
            letter-spacing: .08em;
            flex: 1 1 auto;
            min-width: 0;
          }
          .card-stats-head-extra {
            flex: 0 0 auto;
            margin-left: auto;
          }
          .card-stats-grid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 8px 18px;
          }
          .card-stat {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
            padding: 5px 8px;
            border-radius: 4px;
            background: rgba(255,255,255,.04);
            font-size: 14px;
          }
          .card-stat-label { color: #a9b0bb; }
          .card-stat-values { display: flex; align-items: center; gap: 6px; font-weight: 700; }
          .card-stat-current { color: #e8e8e8; }
          .card-stat-arrow { color: #7f8996; }
          .card-stat-next { color: #8fe3a3; }
          .card-stat--changed { background: rgba(143,227,163,.10); }
        `}
      </style>
    </div>
  );
}
