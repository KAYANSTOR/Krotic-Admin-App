import { cn } from '../../lib/cn';

const TONES = {
  brand: 'icon-tile--brand',
  success: 'icon-tile--success',
  warning: 'icon-tile--warning',
  danger: 'icon-tile--danger',
  gold: 'icon-tile--gold',
  neutral: 'icon-tile--neutral',
};

// Literal class names so the Tailwind scanner keeps the matching accent rules.
const ACCENTS = {
  brand: 'stat-card--brand',
  success: 'stat-card--success',
  warning: 'stat-card--warning',
  danger: 'stat-card--danger',
  gold: 'stat-card--gold',
  neutral: 'stat-card--neutral',
};

export default function StatCard({ title, value, icon: Icon, tone = 'brand', subtitle, iconStart = false, className }) {
  const resolvedTone = TONES[tone] ? tone : 'brand';
  return (
    <div className={cn('card stat-card', ACCENTS[resolvedTone], iconStart && 'stat-card--icon-start', className)}>
      <div className="stat-card__body">
        <p className="stat-card__label">{title}</p>
        <p className="stat-card__value">{value}</p>
        {subtitle && <p className="stat-card__hint">{subtitle}</p>}
      </div>
      {Icon && (
        <span className={cn('icon-tile stat-card__icon', TONES[resolvedTone])}>
          <Icon className="w-5 h-5" aria-hidden="true" />
        </span>
      )}
    </div>
  );
}
