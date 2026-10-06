import StatCard from './ui/StatCard';

const COLOR_TO_TONE = {
  blue: 'brand',
  green: 'success',
  orange: 'warning',
  red: 'danger',
  purple: 'gold',
  cyan: 'neutral',
};

export default function StatsCard({ title, value, icon, color = 'blue', subtitle }) {
  return (
    <StatCard
      title={title}
      value={value}
      icon={icon}
      tone={COLOR_TO_TONE[color] || 'brand'}
      subtitle={subtitle}
    />
  );
}
