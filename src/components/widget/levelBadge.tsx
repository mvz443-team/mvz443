interface LevelBadgeProps {
  level: number;
  className?: string;
}

export default function LevelBadge({ level, className = '' }: LevelBadgeProps) {
  const theme = (() => {
    if (level < 3) {
      return {
        shadow: 'shadow-brown',
        shape: 'shape-star',
        background: 'bg-tier1',
        text: 'text-tier1',
      };
    }
    if (level < 5) {
      return {
        shadow: 'shadow-black',
        shape: 'shape-star',
        background: 'bg-tier2',
        text: 'text-tier2',
      };
    }
    if (level < 7) {
      return {
        shadow: 'shadow-blue',
        shape: 'shape-diamond',
        background: 'bg-tier3',
        text: 'text-tier3',
      };
    }
    return {
      shadow: 'shadow-pink',
      shape: 'shape-diamond',
      background: 'bg-tier4',
      text: 'text-tier4',
    };
  })();

  return (
    <span className={`level-badge badge-wrapper ${theme.shadow} ${className}`.trim()}>
      <span className={`badge-body ${theme.shape} ${theme.background}`}>
        <span className="sweep-light" />
        <span className={`badge-text ${theme.text}`}>{level}</span>
      </span>
    </span>
  );
}
